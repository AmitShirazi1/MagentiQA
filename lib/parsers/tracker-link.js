/**
 * lib/parsers/tracker-link.js
 * Naming convention helpers that link a verification document to its setup
 * tracker: `x.docx` ↔ `x test tracker.xlsx`, always in the same folder.
 *
 * Used by the importers (file/folder/Drive) to pair a parsed .xlsx tracker with
 * the .docx/.md verification it belongs to.
 */

const TRACKER_RE = / test tracker\.xlsx$/i;

/** True for a "<base> test tracker.xlsx" filename. */
function isTrackerFile(name) {
  return TRACKER_RE.test(name || '');
}

/** Any .xlsx file (a tracker that doesn't follow the naming convention still counts). */
function isXlsxFile(name) {
  return /\.xlsx$/i.test(name || '');
}

/** "hardware setup test tracker.xlsx" → "hardware setup" (normalized lower). */
function trackerBaseName(name) {
  const base = (name || '').replace(/\.xlsx$/i, '').replace(/\s*test tracker$/i, '');
  return base.trim().toLowerCase();
}

/** "hardware setup.docx" / "hardware setup.md" → "hardware setup" (normalized lower). */
function docBaseName(name) {
  return (name || '').replace(/\.(docx|md)$/i, '').trim().toLowerCase();
}

/** Directory portion of a relative path ("a/b/c.docx" → "a/b"); "" for a bare name. */
function dirOf(relPath) {
  const norm = (relPath || '').replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i === -1 ? '' : norm.slice(0, i);
}

/** Pairing key: same folder + same base name. */
function pairKey(relPath, base) {
  return `${dirOf(relPath)}::${base}`;
}

module.exports = { isTrackerFile, isXlsxFile, trackerBaseName, docBaseName, dirOf, pairKey };
