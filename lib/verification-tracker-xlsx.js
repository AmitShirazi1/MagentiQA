/**
 * lib/verification-tracker-xlsx.js — Generate a clean "test tracker" .xlsx.
 *
 * The inverse of lib/parsers/xlsx.js: given a setup-tracked verification's
 * columns + setups, emit a minimal .xlsx whose header row is the columns and
 * whose data rows are the setups — with the Status and Tester columns left
 * blank (a clean, un-executed tracker). Re-imports via parseXlsxTracker to the
 * same columns + setups.
 *
 * Built on jszip (no SheetJS). Cells use inline strings so no sharedStrings part
 * is needed; the header lands on row 1, which parseXlsxTracker locates by the
 * "Test ID" cell.
 */

const JSZip = require('jszip');

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 0 → "A", 25 → "Z", 26 → "AA" … */
function colLetter(i) {
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function cell(col, row, value) {
  const ref = `${colLetter(col)}${row}`;
  if (value == null || value === '') return `<c r="${ref}"/>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '</Relationships>';

/**
 * @param {object} opts
 *   name          sheet/workbook name (e.g. "Verification Tracker")
 *   columns       ordered column labels
 *   setups        [{ data: { <label>: value } }]
 *   statusColumn  label of the Status column (blanked in the template)
 *   testerColumn  label of the Tester column (blanked in the template)
 */
async function buildTrackerXlsx({ name = 'Verification Tracker', columns = [], setups = [], statusColumn = null, testerColumn = null }) {
  const cols = columns.length
    ? columns
    : [...new Set(setups.flatMap(s => Object.keys(s.data || {})))];

  const blank = new Set([statusColumn, testerColumn].filter(Boolean));

  // Match the source trackers' layout: the column headers live on row 8 and the
  // setup rows follow from row 9 (rows 1–7 are left for the summary block).
  const HEADER_ROW = 8;
  const rowsXml = [];
  rowsXml.push(`<row r="${HEADER_ROW}">${cols.map((c, i) => cell(i, HEADER_ROW, c)).join('')}</row>`);
  setups.forEach((s, r) => {
    const rowNum = HEADER_ROW + 1 + r;
    const data = s.data || {};
    const cells = cols.map((c, i) => cell(i, rowNum, blank.has(c) ? '' : (data[c] != null ? data[c] : '')));
    rowsXml.push(`<row r="${rowNum}">${cells.join('')}</row>`);
  });

  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    '</worksheet>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${xmlEscape(name).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>';

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('xl/workbook.xml', workbook);
  zip.file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS);
  zip.file('xl/worksheets/sheet1.xml', sheet);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildTrackerXlsx };
