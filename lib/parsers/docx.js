/**
 * lib/parsers/docx.js
 * Parses .docx verification files.
 *
 * Document structure (fields live in PARAGRAPHS, not table rows):
 *   Test: <title>
 *   Tester: ... Signature: ____    (boilerplate form lines — kept only if filled in)
 *   Date: / SW version \ build number:
 *   Configurations: <value>
 *   Files:          <value>
 *   Description:    <value>
 *   Pre conditions: <value>
 *   Steps table: # | Test/Action | Expected Results | Results | Comments/Problems
 *   (optional) Setup-matrix table, e.g. input/system resolution combinations
 *   Summary/Approval/Signature footer paragraphs
 *
 * Some documents instead keep the metadata as key-value rows in the first
 * table — both layouts are supported. Anything that doesn't map onto a known
 * field (setup matrices, step comments, filled-in form lines, stray
 * paragraphs) is collected into `notes` so no information is lost.
 */

const mammoth = require('mammoth');
const path = require('path');

async function parseDocxTest(filePath) {
  const result = await mammoth.convertToHtml({ path: filePath });
  return extractFromHtml(result.value, path.basename(filePath, '.docx'));
}

function extractFromHtml(html, fallbackTitle) {
  return interpretBlocks(extractBlocks(html), fallbackTitle);
}

/**
 * Back-compat shim for callers that only have tables (no paragraphs).
 */
function interpretTables(tables, fallbackTitle) {
  return interpretBlocks(tables.map(rows => ({ type: 'table', rows })), fallbackTitle);
}

// ── Field / boilerplate label patterns ───────────────────────────────────────

// Paragraph labels that map onto verification fields
const FIELD_LABELS = [
  { re: /^configurations?\s*[:：]\s*/i,        field: 'configuration' },
  { re: /^files?\s*[:：]\s*/i,                 field: 'files' },
  { re: /^description\s*[:：]\s*/i,            field: 'description' },
  { re: /^pre[\s-]*conditions?\s*[:：]\s*/i,   field: 'preconditions' },
];

// Template form lines (Tester / Date / Approval…) — pure boilerplate when
// blank, but kept as a note when someone actually filled them in.
const BOILERPLATE_START = /^(tester|signature|date|sw\s*version|summary|approval|results?)\b/i;
const BOILERPLATE_TOKENS = /(tester|signature|date|sw\s*version\s*[\\/]?\s*build\s*number|sw\s*version|summary[^:：]*|approval|results?)\s*[:：]?/gi;

/**
 * Interpret an ordered list of blocks ({type:'paragraph', text} and
 * {type:'table', rows}) into a parsed test. Format-agnostic: used by both the
 * .docx parser (blocks from mammoth HTML) and the Google Docs parser (blocks
 * from the Docs API JSON).
 */
function interpretBlocks(blocks, fallbackTitle) {
  let title = fallbackTitle;
  const fields = { configuration: '', files: '', description: '', preconditions: '' };
  const steps = [];
  const notes = [];

  // Field a continuation paragraph should append to (label paragraphs whose
  // value spills into the following paragraph)
  let currentField = null;

  for (const block of blocks) {
    if (block.type === 'paragraph') {
      const text = block.text;
      if (!text) continue;

      // Title: "Test: Foo" ("t?est" tolerates a clipped leading T in the doc)
      const tm = text.match(/^t?est\s*[:：]\s*(.+)/i);
      if (tm && title === fallbackTitle) { title = cleanCell(tm[1]); currentField = null; continue; }

      // Known field label → start (or extend) that field
      const label = FIELD_LABELS.find(l => l.re.test(text));
      if (label) {
        const val = cleanCell(text.replace(label.re, ''));
        if (val) fields[label.field] = appendText(fields[label.field], val);
        currentField = label.field;
        continue;
      }

      // Boilerplate form line → note only if someone filled it in
      if (BOILERPLATE_START.test(text)) {
        const note = boilerplateNote(text);
        if (note) notes.push(note);
        currentField = null;
        continue;
      }

      // Unlabelled paragraph: continuation of the last field, else a note
      if (currentField) fields[currentField] = appendText(fields[currentField], cleanCell(text));
      else if (isMeaningful(text)) notes.push(cleanCell(text));
      continue;
    }

    // ── Table block ──────────────────────────────────────────────────────────
    currentField = null;
    const table = block.rows;
    if (!table || table.length === 0) continue;

    const headerRow = (table[0] || []).map(c => c.toLowerCase().trim());
    const isStepsTable =
      headerRow.some(h => /^#$|^no\.?$/.test(h)) &&
      headerRow.some(h => /test|action|step|description/.test(h));

    if (isStepsTable) {
      // ── Steps table ────────────────────────────────────────────────────
      const actionIdx  = headerRow.findIndex(h => /test|action|step/.test(h));
      const expectIdx  = headerRow.findIndex(h => /expected/.test(h));
      const resultIdx  = headerRow.findIndex(h => /^results?$/.test(h));
      const commentIdx = headerRow.findIndex(h => /comment|problem/.test(h));

      for (let i = 1; i < table.length; i++) {
        const row = table[i];
        // skip entirely empty rows
        if (row.every(c => !c.trim())) continue;

        const num = cleanCell(row[0] || '');
        // Summary/approval footer rows (non-numeric first cell after steps
        // start) aren't steps — keep whatever was written in them as a note
        if (steps.length > 0 && num && !/^\d+[.)]?$/.test(num)) {
          const note = boilerplateNote(row.join(' '));
          if (note) notes.push(note);
          continue;
        }

        const action   = cleanCell(row[actionIdx]  ?? row[1] ?? '');
        const expected = cleanCell(row[expectIdx]  ?? row[2] ?? '');
        if (action && action.length > 1) {
          steps.push({ order: steps.length + 1, action, expectedResult: expected });
          // Filled-in Results / Comments cells carry real information
          const result  = resultIdx  >= 0 ? cleanCell(row[resultIdx]  || '') : '';
          const comment = commentIdx >= 0 ? cleanCell(row[commentIdx] || '') : '';
          if (result)  notes.push(`Step ${steps.length} result: ${result}`);
          if (comment) notes.push(`Step ${steps.length} comment: ${comment}`);
        }
      }
    } else {
      // ── Metadata key-value table, or a setup-matrix table ──────────────
      const unmatched = [];
      for (const row of table) {
        const full = row.join(' ');
        const key  = (row[0] || '').toLowerCase().trim();
        const val  = cleanCell(row.slice(1).join(' '));

        // Title: "Test: Foo" anywhere in a cell
        const tm = full.match(/test\s*[:：]\s*(.+)/i);
        if ((!title || title === fallbackTitle) && tm) { title = cleanCell(tm[1]); continue; }

        if (/^config/.test(key))               fields.configuration = val || fields.configuration;
        else if (/^files?$/.test(key))         fields.files = val || fields.files;
        else if (/^description/.test(key))     fields.description = val || fields.description;
        else if (/^pre[\s-]*condition/.test(key)) fields.preconditions = val || fields.preconditions;
        else if (BOILERPLATE_START.test(key)) {
          const note = boilerplateNote(full);
          if (note) notes.push(note);
        } else {
          // Not a recognized key — part of a setup matrix or free-form table
          const cells = row.map(cleanCell);
          while (cells.length && !cells[cells.length - 1]) cells.pop(); // trim trailing empties
          while (cells.length && !cells[0]) cells.shift();              // and leading ones
          if (cells.length) unmatched.push(cells.join(' | '));
        }
      }
      // Preserve the whole unrecognized table (e.g. resolution setup matrix)
      if (unmatched.length) notes.push(`Setup table:\n${unmatched.join('\n')}`);
    }
  }

  // Fallback: scan all raw text for "Test: <title>"
  if (title === fallbackTitle) {
    const allText = blocks
      .map(b => b.type === 'table' ? b.rows.flat().join(' ') : b.text)
      .join(' ');
    const m = allText.match(/test\s*[:：]\s*([^\n|]+)/i);
    if (m) title = cleanCell(m[1]);
  }

  return {
    title,
    path: '',
    tags: [],
    configuration: fields.configuration,
    files: fields.files,
    description: fields.description,
    preconditions: fields.preconditions,
    steps,
    notes: notes.join('\n'),
    metadata: { ...fields },
  };
}

/**
 * A boilerplate form line ("Tester: … Signature: ___") is template noise when
 * blank. If anything other than the labels and the blank-fill underscores
 * remains, return the cleaned line so the filled-in value is kept as a note.
 */
function boilerplateNote(text) {
  const cleaned = cleanCell(text.replace(/_{2,}/g, ' '));
  const residue = cleaned.replace(BOILERPLATE_TOKENS, ' ').replace(/[\s:：_]+/g, '');
  return isMeaningful(residue) ? cleaned : null;
}

/** True when the text carries actual content (not just punctuation/blanks). */
function isMeaningful(text) {
  return /[\p{L}\p{N}]/u.test(text || '');
}

function appendText(existing, addition) {
  if (!addition) return existing;
  return existing ? `${existing}\n${addition}` : addition;
}

// ── HTML extraction ──────────────────────────────────────────────────────────

/**
 * Extract document blocks — paragraphs and tables, in document order — from
 * mammoth's HTML output. Paragraphs inside table cells belong to the table,
 * so the text segments between/around tables are scanned separately.
 */
function extractBlocks(html) {
  const blocks = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let last = 0, m;
  while ((m = tableRe.exec(html))) {
    pushParagraphBlocks(html.slice(last, m.index), blocks);
    const rows = extractTableRows(m[0]);
    if (rows.length > 0) blocks.push({ type: 'table', rows });
    last = m.index + m[0].length;
  }
  pushParagraphBlocks(html.slice(last), blocks);
  return blocks;
}

function pushParagraphBlocks(html, blocks) {
  const paraMatches = html.match(/<(?:p|h[1-6]|li)[^>]*>[\s\S]*?<\/(?:p|h[1-6]|li)>/gi) || [];
  for (const p of paraMatches) {
    const text = stripTags(p);
    if (text) blocks.push({ type: 'paragraph', text });
  }
}

function extractTableRows(tableHtml) {
  const rows = [];
  const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const rowHtml of rowMatches) {
    const cells = [];
    const cellMatches = rowHtml.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [];
    for (const cellHtml of cellMatches) cells.push(stripTags(cellHtml));
    if (cells.some(c => c.trim())) rows.push(cells);
  }
  return rows;
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function cleanCell(str) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

module.exports = { parseDocxTest, extractFromHtml, interpretTables, interpretBlocks };
