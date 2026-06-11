/**
 * lib/parsers/xlsx.js
 * Parses .xlsx "test tracker" spreadsheets that accompany a verification .docx.
 *
 * A tracker enumerates the SETUPS / CONDITIONS a verification must be performed
 * under. Layout (confirmed against the example trackers):
 *   - Rows above the table hold summary statistics (Total/Passed/Failed/…) and
 *     are IGNORED.
 *   - The table header lives at row 8 (1-based). We locate it dynamically by
 *     finding the row that contains a "Test ID" cell, falling back to row 8.
 *   - Guaranteed columns: "Test ID" (serial, e.g. TEST-HW-001), "Status"
 *     (Passed/Failed/Pending) and "Tester Name". Every other column varies
 *     between documents and is captured verbatim — no information is lost.
 *
 * Implemented on top of `jszip` (already vendored via mammoth) so no new
 * dependency or SheetJS/exceljs is required — consistent with the app's
 * minimal, local-only posture.
 *
 * The Status and Tester values are runtime outcomes (a setup's verdict and who
 * signed it), not descriptive data — they are captured as `status`/`testerName`
 * and kept OUT of `data`, which holds only the descriptive columns (Test ID, any
 * extra columns, Setup Details). On export they are re-created as columns.
 *
 * parseXlsxTracker(filePath) / parseXlsxBuffer(buffer) →
 *   { name, columns:[label], idColumn, statusColumn, testerColumn,
 *     setups:[{ setupId, label, status, testerName, data:{label:value} }] }
 */

const fs = require('fs');
const JSZip = require('jszip');

async function parseXlsxTracker(filePath) {
  return parseXlsxBuffer(fs.readFileSync(filePath));
}

async function parseXlsxBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const shared = parseSharedStrings(await readEntry(zip, 'xl/sharedStrings.xml'));
  const sheetPath = await resolveFirstSheetPath(zip);
  const sheetXml = await readEntry(zip, sheetPath);
  const sheetName = await resolveFirstSheetName(zip);

  const grid = parseSheet(sheetXml, shared); // array of rows; each row = array of strings indexed by column
  return buildTracker(grid, sheetName);
}

// ── Tracker assembly ──────────────────────────────────────────────────────────

function buildTracker(grid, name) {
  // Locate the header row: the first row containing a cell that reads "Test ID".
  let headerIdx = grid.findIndex(row =>
    row.some(c => /^test\s*id$/i.test((c || '').trim()))
  );
  // Fall back to row 8 (1-based) per the documented layout.
  if (headerIdx === -1) headerIdx = grid[7] ? 7 : -1;
  if (headerIdx === -1) {
    return { name, columns: [], idColumn: null, statusColumn: null, testerColumn: null, setups: [] };
  }

  const headerRow = grid[headerIdx];
  // Columns in order, trimming trailing empty-header cells (blank padding cols).
  let lastCol = -1;
  for (let i = 0; i < headerRow.length; i++) if ((headerRow[i] || '').trim()) lastCol = i;
  const columns = [];
  for (let i = 0; i <= lastCol; i++) columns.push((headerRow[i] || '').trim());

  const idColumn     = columns.find(c => /^test\s*id$/i.test(c)) || columns[0] || null;
  const statusColumn = columns.find(c => /status/i.test(c)) || null;
  const testerColumn = columns.find(c => /tester/i.test(c)) || null;

  const idIdx     = idColumn     ? columns.indexOf(idColumn)     : 0;
  const statusIdx = statusColumn ? columns.indexOf(statusColumn) : -1;
  const testerIdx = testerColumn ? columns.indexOf(testerColumn) : -1;

  const setups = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    // Stop at a fully blank row (end of the table); skip blanks defensively.
    const hasContent = columns.some((_, i) => (row[i] || '').trim());
    if (!hasContent) continue;

    // The Status and Tester columns are runtime outcomes, not descriptive setup
    // data: their values are captured separately (below) as the setup's status /
    // tester, and re-created as columns only on export. Everything else (Test ID,
    // any extra columns, Setup Details) is the setup's descriptive `data`.
    const data = {};
    for (let i = 0; i < columns.length; i++) {
      if (i === statusIdx || i === testerIdx) continue;
      const label = columns[i] || `Column ${i + 1}`;
      data[label] = (row[i] || '').trim();
    }

    const setupId = (row[idIdx] || '').trim();
    const status  = statusIdx >= 0 ? normalizeStatus(row[statusIdx]) : '';
    const tester  = testerIdx >= 0 ? (row[testerIdx] || '').trim() : '';

    // A row with no Test ID and no other data isn't a setup.
    if (!setupId && !Object.values(data).some(v => v)) continue;

    setups.push({
      setupId: setupId || `Setup ${setups.length + 1}`,
      label: setupId || `Setup ${setups.length + 1}`,
      status,
      testerName: tester,
      data,
    });
  }

  return { name, columns, idColumn, statusColumn, testerColumn, setups };
}

function normalizeStatus(raw) {
  const s = (raw || '').trim().toLowerCase();
  if (/^pass/.test(s)) return 'PASSED';
  if (/^fail/.test(s)) return 'FAILED';
  if (/^block/.test(s)) return 'BLOCKED';
  if (/^pend/.test(s)) return 'PENDING';
  return '';
}

// ── Workbook navigation ─────────────────────────────────────────────────────

async function readEntry(zip, name) {
  const f = zip.file(name);
  return f ? f.async('string') : '';
}

/** First sheet's worksheet path, via workbook rels; falls back to sheet1.xml. */
async function resolveFirstSheetPath(zip) {
  const workbook = await readEntry(zip, 'xl/workbook.xml');
  const rels     = await readEntry(zip, 'xl/_rels/workbook.xml.rels');

  const sheetMatch = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/i)
    || workbook.match(/<sheet\b[^>]*\bid="([^"]+)"/i);
  if (sheetMatch && rels) {
    const rid = sheetMatch[1];
    const relRe = new RegExp(`<Relationship\\b[^>]*\\bId="${escapeReg(rid)}"[^>]*\\bTarget="([^"]+)"`, 'i');
    const m = rels.match(relRe);
    if (m) {
      let target = m[1].replace(/^\/?xl\//, '').replace(/^\.\//, '');
      if (!target.startsWith('worksheets/') && !target.startsWith('xl/')) {
        // Targets are relative to xl/; most are "worksheets/sheetN.xml"
      }
      return target.startsWith('xl/') ? target : `xl/${target}`;
    }
  }
  // Fallback: first worksheet file present
  const names = Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)).sort();
  return names[0] || 'xl/worksheets/sheet1.xml';
}

async function resolveFirstSheetName(zip) {
  const workbook = await readEntry(zip, 'xl/workbook.xml');
  const m = workbook.match(/<sheet\b[^>]*\bname="([^"]*)"/i);
  return m ? decodeXml(m[1]) : 'Tracker';
}

// ── XML parsing (regex-based; xlsx parts are machine-generated & well-formed) ──

/** sharedStrings.xml → array of strings (one per <si>, runs concatenated). */
function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/gi;
  let m;
  while ((m = siRe.exec(xml))) {
    const inner = m[1] || '';
    // Concatenate every <t>…</t> (covers both plain <si><t> and rich <si><r><t>)
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/gi;
    let t;
    while ((t = tRe.exec(inner))) text += decodeXml(t[1] || '');
    out.push(text);
  }
  return out;
}

/**
 * Worksheet sheetData → array of rows; each row is an array indexed by 0-based
 * column, holding the resolved string value of each cell.
 */
function parseSheet(xml, shared) {
  const rows = [];
  if (!xml) return rows;

  const sheetData = (xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/i) || [])[1] || '';
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/gi;
  let rm;
  while ((rm = rowRe.exec(sheetData))) {
    const attrs = rm[1] || rm[3] || '';
    const body  = rm[2] || '';
    const rAttr = attrs.match(/\br="(\d+)"/);
    const rowIdx = rAttr ? parseInt(rAttr[1], 10) - 1 : rows.length; // 0-based

    const cells = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi;
    let cm;
    while ((cm = cellRe.exec(body))) {
      const cAttrs = cm[1] || cm[3] || '';
      const cBody  = cm[2] || '';
      const ref  = (cAttrs.match(/\br="([A-Z]+)\d+"/i) || [])[1];
      const type = (cAttrs.match(/\bt="([^"]+)"/) || [])[1] || 'n';
      const colIdx = ref ? colToIndex(ref) : cells.length;
      cells[colIdx] = resolveCell(type, cBody, shared);
    }
    rows[rowIdx] = cells;
  }

  // Normalize: ensure no holes (undefined → '') for callers that map by index.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    for (let j = 0; j < r.length; j++) if (r[j] == null) r[j] = '';
    rows[i] = r;
  }
  return rows;
}

function resolveCell(type, body, shared) {
  if (type === 'inlineStr') {
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    let t;
    while ((t = tRe.exec(body))) text += decodeXml(t[1] || '');
    return text;
  }
  const v = (body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i) || [])[1];
  if (v == null || v === '') return '';
  if (type === 's') {
    const idx = parseInt(v, 10);
    return shared[idx] != null ? shared[idx] : '';
  }
  if (type === 'b') return v === '1' ? 'TRUE' : 'FALSE';
  // 'str' (formula string), 'e' (error), 'n'/default (number) → decoded literal
  return decodeXml(v);
}

/** "A" → 0, "B" → 1, … "Z" → 25, "AA" → 26 … */
function colToIndex(ref) {
  const letters = ref.toUpperCase().replace(/[^A-Z]/g, '');
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function decodeXml(s) {
  return (s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { parseXlsxTracker, parseXlsxBuffer };
