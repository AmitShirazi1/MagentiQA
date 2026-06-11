/**
 * lib/verification-doc.js — Generate a clean verification .docx template.
 *
 * The exact inverse of lib/parsers/docx.js: given a verification definition
 * (title, configuration/files/description/preconditions, ordered steps) it emits
 * a .docx that looks like the source documents and re-imports to the same model.
 *
 * Fidelity strategy: a committed skeleton (templates/verification-template.docx,
 * a real document) supplies every styled part verbatim — styles (the `Table1`
 * steps-table style), embedded Tahoma fonts, the footer, theme, numbering,
 * settings. We reuse its document.xml *prologue* (namespaces) and *sectPr*
 * (footer reference + landscape page setup), and regenerate only the body in
 * between: the header field paragraphs, the steps table (one row per step, with
 * empty Results/Comments), and the boilerplate Summary/Approval/Signature
 * footer. Result/Comment/Tester/Signature/Approval fields are always left blank —
 * a clean, un-executed template.
 *
 * No new dependency: built on jszip (already vendored via mammoth).
 */

const fs    = require('fs');
const path  = require('path');
const JSZip = require('jszip');

const TEMPLATE = path.join(__dirname, 'templates', 'verification-template.docx');

// ── XML helpers ───────────────────────────────────────────────────────────────
function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Run-property fragments matching the source template.
const ARIAL  = '<w:rFonts w:ascii="Arial" w:cs="Arial" w:eastAsia="Arial" w:hAnsi="Arial"/>';
const TAHOMA = '<w:rFonts w:ascii="Tahoma" w:cs="Tahoma" w:eastAsia="Tahoma" w:hAnsi="Tahoma"/>';
const SZ20   = '<w:sz w:val="20"/><w:szCs w:val="20"/>';

/** A sequence of runs for free text, turning newlines into line breaks. */
function textRuns(text, rPrExtra = '') {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  return lines.map((line, i) => {
    const br = i > 0 ? '<w:r><w:rPr><w:rtl w:val="0"/></w:rPr><w:br/></w:r>' : '';
    return `${br}<w:r><w:rPr>${rPrExtra}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>`;
  }).join('');
}

// ── Header field paragraphs ─────────────────────────────────────────────────
function titlePara(title) {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:rPr>${TAHOMA}<w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr>${TAHOMA}<w:sz w:val="40"/><w:szCs w:val="40"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">Test:</w:t><w:tab/></w:r>` +
    `<w:r><w:rPr>${TAHOMA}<w:sz w:val="40"/><w:szCs w:val="40"/><w:u w:val="single"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">${xmlEscape(title)}</w:t></w:r>` +
    `</w:p>`;
}

// Boilerplate form lines (kept blank — filled in only when a run is executed).
const BP_TESTER =
  `<w:p><w:pPr><w:spacing w:after="120" w:before="120" w:line="240" w:lineRule="auto"/><w:rPr>${ARIAL}${SZ20}</w:rPr></w:pPr>` +
  `<w:r><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/>${SZ20}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">Tester:</w:t></w:r>` +
  `<w:r><w:rPr>${ARIAL}${SZ20}<w:rtl w:val="0"/></w:rPr><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/></w:r>` +
  `<w:r><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/>${SZ20}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">Signature:</w:t></w:r>` +
  `<w:r><w:rPr>${ARIAL}${SZ20}<w:rtl w:val="0"/></w:rPr><w:tab/></w:r></w:p>`;
const BP_DATE =
  `<w:p><w:pPr><w:spacing w:after="120" w:before="120" w:line="240" w:lineRule="auto"/><w:rPr>${ARIAL}${SZ20}</w:rPr></w:pPr>` +
  `<w:r><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/>${SZ20}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">Date:</w:t></w:r>` +
  `<w:r><w:rPr>${ARIAL}${SZ20}<w:rtl w:val="0"/></w:rPr><w:tab/></w:r></w:p>`;
const BP_SWVER =
  `<w:p><w:pPr><w:spacing w:after="120" w:before="120" w:line="240" w:lineRule="auto"/><w:rPr>${ARIAL}${SZ20}</w:rPr></w:pPr>` +
  `<w:r><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/>${SZ20}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">SW version \\ build number:</w:t></w:r>` +
  `<w:r><w:rPr>${ARIAL}${SZ20}<w:rtl w:val="0"/></w:rPr><w:tab/></w:r></w:p>`;

/** "Label:" + tabs + value — the Configurations/Files/Description/Pre conditions lines. */
function fieldPara(label, value, tabs) {
  const tabRuns = '<w:tab/>'.repeat(tabs);
  const valueRuns = value ? textRuns(value, ARIAL + SZ20) : '';
  return `<w:p><w:pPr><w:spacing w:after="120" w:before="120" w:line="240" w:lineRule="auto"/><w:rPr>${ARIAL}${SZ20}</w:rPr></w:pPr>` +
    `<w:r><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/>${SZ20}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">${xmlEscape(label)}</w:t>${tabRuns}</w:r>` +
    `${valueRuns}</w:p>`;
}

const EMPTY_PARA = `<w:p><w:pPr><w:rPr>${ARIAL}${SZ20}</w:rPr></w:pPr><w:r><w:rPr><w:rtl w:val="0"/></w:rPr></w:r></w:p>`;

// Summary / Approval / Signature footer — boilerplate, always blank.
const FOOTER_BLOCK =
  EMPTY_PARA +
  `<w:p><w:pPr><w:spacing w:after="120" w:before="120" w:line="240" w:lineRule="auto"/><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/>${SZ20}</w:rPr></w:pPr>` +
    `<w:r><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/>${SZ20}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">Summary, conclusion and recommendations:</w:t><w:tab/></w:r></w:p>` +
  EMPTY_PARA +
  `<w:p><w:pPr><w:spacing w:after="120" w:before="120" w:line="240" w:lineRule="auto"/><w:rPr>${ARIAL}${SZ20}</w:rPr></w:pPr>` +
    `<w:r><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/>${SZ20}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">Approval:</w:t></w:r>` +
    `<w:r><w:rPr>${ARIAL}${SZ20}<w:rtl w:val="0"/></w:rPr><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/></w:r>` +
    `<w:r><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/>${SZ20}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">Date:</w:t></w:r>` +
    `<w:r><w:rPr>${ARIAL}${SZ20}<w:rtl w:val="0"/></w:rPr><w:tab/></w:r></w:p>` +
  `<w:p><w:pPr><w:spacing w:after="120" w:before="120" w:line="240" w:lineRule="auto"/><w:rPr>${ARIAL}${SZ20}</w:rPr></w:pPr>` +
    `<w:r><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/>${SZ20}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">Signature:</w:t><w:tab/></w:r>` +
    `<w:r><w:rPr>${ARIAL}${SZ20}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>`;

// ── Steps table ─────────────────────────────────────────────────────────────
const BORDERS =
  '<w:tcBorders>' +
  '<w:top w:color="000000" w:space="0" w:sz="4" w:val="single"/>' +
  '<w:left w:color="000000" w:space="0" w:sz="4" w:val="single"/>' +
  '<w:bottom w:color="000000" w:space="0" w:sz="4" w:val="single"/>' +
  '<w:right w:color="000000" w:space="0" w:sz="4" w:val="single"/>' +
  '</w:tcBorders>';

const TBL_PR_GRID =
  '<w:tblPr><w:tblStyle w:val="Table1"/><w:tblW w:w="14055.0" w:type="dxa"/><w:jc w:val="left"/>' +
  '<w:tblLayout w:type="fixed"/><w:tblLook w:val="0000"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="555"/><w:gridCol w:w="4425"/><w:gridCol w:w="4995"/>' +
  '<w:gridCol w:w="1290"/><w:gridCol w:w="2790"/></w:tblGrid>';

function headerCell(text) {
  return `<w:tc><w:tcPr>${BORDERS}<w:shd w:fill="f2f2f2" w:val="clear"/></w:tcPr>` +
    `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:after="40" w:before="40" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr>${ARIAL}<w:b w:val="1"/><w:bCs w:val="1"/><w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p></w:tc>`;
}
function numCell(n) {
  return `<w:tc><w:tcPr>${BORDERS}</w:tcPr>` +
    `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:after="40" w:before="40" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr>${ARIAL}</w:rPr></w:pPr>` +
    `<w:r><w:rPr>${ARIAL}<w:rtl w:val="0"/></w:rPr><w:t xml:space="preserve">${n}.</w:t></w:r></w:p></w:tc>`;
}
function textCell(text) {
  return `<w:tc><w:tcPr>${BORDERS}</w:tcPr>` +
    `<w:p><w:pPr><w:widowControl w:val="0"/><w:rPr/></w:pPr>${textRuns(text)}</w:p></w:tc>`;
}
function emptyCell(centered) {
  const jc = centered ? '<w:jc w:val="center"/>' : '';
  return `<w:tc><w:tcPr>${BORDERS}</w:tcPr>` +
    `<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:after="40" w:before="40" w:line="240" w:lineRule="auto"/>${jc}<w:rPr>${ARIAL}</w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rtl w:val="0"/></w:rPr></w:r></w:p></w:tc>`;
}

function stepRow(n, action, expected) {
  return '<w:tr><w:trPr><w:cantSplit w:val="0"/><w:tblHeader w:val="0"/></w:trPr>' +
    numCell(n) + textCell(action) + textCell(expected || '') + emptyCell(true) + emptyCell(false) +
    '</w:tr>';
}

function stepsTable(steps) {
  const header = '<w:tr><w:trPr><w:cantSplit w:val="0"/><w:tblHeader w:val="0"/></w:trPr>' +
    headerCell('#') + headerCell('Test') + headerCell('Expected Results') +
    headerCell('Results') + headerCell('Comments/Problems') + '</w:tr>';
  const rows = (steps || []).map((s, i) =>
    stepRow(s.order || i + 1, s.action || '', s.expectedResult || '')).join('');
  return `<w:tbl>${TBL_PR_GRID}${header}${rows}</w:tbl>`;
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Build a clean verification .docx as a Buffer.
 * @param {object} test  { title, configuration, files, description, preconditions }
 * @param {Array}  steps [{ order, action, expectedResult }]
 */
async function buildVerificationDocx(test, steps) {
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
  const skeleton = await zip.file('word/document.xml').async('string');

  const bodyOpen = skeleton.indexOf('<w:body>') + '<w:body>'.length;
  const sectStart = skeleton.indexOf('<w:sectPr>');
  if (bodyOpen < 8 || sectStart < 0) throw new Error('verification template is malformed');
  const prologue = skeleton.slice(0, bodyOpen);
  const tail     = skeleton.slice(sectStart);   // <w:sectPr> … </w:body></w:document>

  const middle =
    titlePara(test.title || '') + EMPTY_PARA +
    BP_TESTER + BP_DATE + BP_SWVER +
    fieldPara('Configurations:', test.configuration || '', 1) +
    fieldPara('Files:', test.files || '', 3) +
    fieldPara('Description:', test.description || '', 2) +
    fieldPara('Pre conditions:', test.preconditions || '', 1) +
    EMPTY_PARA +
    stepsTable(steps) +
    FOOTER_BLOCK;

  zip.file('word/document.xml', prologue + middle + tail);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildVerificationDocx };
