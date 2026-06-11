/**
 * lib/parsers/markdown.js
 * Parses .md verification files.
 *
 * Expected structure:
 *   # Title  (or front-matter title:)
 *
 *   ## Configuration
 *   text...
 *
 *   ## Files
 *   text...
 *
 *   ## Description
 *   text...
 *
 *   ## Pre conditions   (also: Preconditions, Pre-conditions)
 *   text...
 *
 *   ## Steps
 *   | # | Action | Expected Result |
 *   |---|--------|-----------------|
 *   | 1 | ...    | ...             |
 *
 *   (Steps may also be a numbered list instead of a table)
 */

const matter = require('gray-matter');

function parseMarkdownTest(content, filePath = '') {
  const { data: fm, content: body } = matter(content);

  const title = fm.title || extractH1(body) || baseName(filePath);

  // Parse all sections keyed by heading (lowercase, trimmed)
  const sections = parseSections(body);

  const configuration = fm.configuration || fm.configurations || sections['configuration'] || sections['configurations'] || '';
  const files         = fm.files || sections['files'] || '';
  const description   = fm.description || sections['description'] || '';
  const preconditions = fm.preconditions || sections['pre conditions'] || sections['preconditions'] || sections['pre-conditions'] || '';

  const stepsSection  = sections['steps'] || sections['test steps'] || '';
  const steps         = parseSteps(stepsSection);

  // Unrecognized sections become notes, so no information is lost
  const KNOWN = ['configuration', 'configurations', 'files', 'description',
    'pre conditions', 'preconditions', 'pre-conditions', 'steps', 'test steps', 'notes'];
  const noteParts = [];
  if (fm.notes) noteParts.push(String(fm.notes));
  if (sections['notes']) noteParts.push(sections['notes']);
  for (const [heading, text] of Object.entries(sections)) {
    if (!KNOWN.includes(heading) && text) noteParts.push(`${heading}:\n${text}`);
  }

  return {
    title,
    path: fm.path || derivePathFromFilePath(filePath),
    tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []),
    configuration,
    files,
    description,
    preconditions,
    steps,
    notes: noteParts.join('\n'),
    metadata: fm,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractH1(body) {
  const m = body.match(/^#\s+(.+)/m);
  return m ? m[1].trim() : null;
}

function baseName(filePath) {
  if (!filePath) return '';
  return filePath.replace(/.*[/\\]/, '').replace(/\.md$/i, '');
}

/**
 * Split body into sections by ## headings.
 * Returns { "section name lowercase": "section body" }
 */
function parseSections(body) {
  const sections = {};
  // Split on any ## heading
  const parts = body.split(/^##\s+/m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    if (nl === -1) continue;
    const heading = part.slice(0, nl).trim().toLowerCase();
    const content = part.slice(nl + 1).trim();
    sections[heading] = content;
  }
  return sections;
}

/**
 * Parse steps from a section body.
 * Supports:
 *   - Markdown tables:  | 1 | action | expected |
 *   - Numbered lists:   1. action
 */
function parseSteps(text) {
  if (!text) return [];
  const steps = [];

  // ── Try table format ──────────────────────────────────────────────────────
  const lines = text.split('\n');
  const tableLines = lines.filter(l => l.includes('|'));

  if (tableLines.length >= 2) {
    let headerParsed = false;
    let actionIdx = 1;
    let expectedIdx = 2;

    for (const line of tableLines) {
      // Skip separator rows (---|---|---)
      if (/^\s*\|?[\s\-:]+\|/.test(line) && !line.match(/[a-zA-Z]/)) continue;

      const cells = line.split('|').map(c => c.trim()).filter((_, i, arr) => {
        // drop empty first/last cells from | col | col | format
        return !(i === 0 && arr[0] === '') && !(i === arr.length - 1 && arr[arr.length - 1] === '');
      });

      if (cells.length === 0) continue;

      if (!headerParsed) {
        // Parse header to find column indices
        const lower = cells.map(c => c.toLowerCase());
        const aIdx = lower.findIndex(c => /action|step|test|description/.test(c));
        const eIdx = lower.findIndex(c => /expected/.test(c));
        if (aIdx !== -1) actionIdx = aIdx;
        if (eIdx !== -1) expectedIdx = eIdx;
        headerParsed = true;
        continue;
      }

      const action   = cells[actionIdx] || cells[1] || cells[0] || '';
      const expected = cells[expectedIdx] || cells[2] || '';

      if (action && action.length > 1 && !/^-+$/.test(action)) {
        steps.push({ order: steps.length + 1, action: action.trim(), expectedResult: expected.trim() });
      }
    }
  }

  // ── Fallback: numbered list ────────────────────────────────────────────────
  if (steps.length === 0) {
    const listItems = text.match(/^\d+[.)]\s+(.+)$/gm) || [];
    for (const item of listItems) {
      const action = item.replace(/^\d+[.)]\s+/, '').trim();
      if (action) steps.push({ order: steps.length + 1, action, expectedResult: '' });
    }
  }

  return steps;
}

function derivePathFromFilePath(filePath) {
  if (!filePath) return '';
  const parts = filePath.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.slice(-2).join('/');
}

module.exports = { parseMarkdownTest };
