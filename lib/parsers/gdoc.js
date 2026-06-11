/**
 * lib/parsers/gdoc.js
 * Parses a Google Docs API document (JSON) into a verification test.
 *
 * The Docs API returns the document as structured content — paragraphs and
 * tables arrive directly, so unlike the .docx path there is no
 * export/convert/scrape step. We walk the body, collect every paragraph as
 * text and every table as rows of plain-text cells (in document order), then
 * hand off to the shared interpretBlocks() logic.
 */

const { interpretBlocks } = require('./docx');

/**
 * @param {object} doc — response of GET https://docs.googleapis.com/v1/documents/{id}
 */
function parseGoogleDoc(doc) {
  const blocks = [];
  for (const el of doc.body?.content || []) {
    if (el.paragraph) {
      const text = paragraphText(el.paragraph);
      if (text) blocks.push({ type: 'paragraph', text });
    } else if (el.table) {
      const rows = [];
      for (const tr of el.table.tableRows || []) {
        const cells = (tr.tableCells || []).map(cellText);
        if (cells.some(c => c.trim())) rows.push(cells);
      }
      if (rows.length > 0) blocks.push({ type: 'table', rows });
    }
  }
  return interpretBlocks(blocks, doc.title || 'Untitled');
}

/** Flatten a paragraph's text runs to plain text. */
function paragraphText(paragraph) {
  let out = '';
  for (const pe of paragraph.elements || []) {
    if (pe.textRun?.content) out += pe.textRun.content;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Flatten a table cell's content (paragraphs, nested tables) to plain text. */
function cellText(cell) {
  let out = '';
  for (const el of cell.content || []) {
    if (el.paragraph) {
      out += paragraphText(el.paragraph) + ' ';
    } else if (el.table) {
      for (const tr of el.table.tableRows || []) {
        for (const c of tr.tableCells || []) out += cellText(c) + ' ';
      }
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

module.exports = { parseGoogleDoc };
