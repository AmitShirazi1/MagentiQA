/**
 * lib/setups.js — shared persistence for a setup-tracked verification's setups.
 *
 * Setups are the rows of the dynamic tracker table (one condition each). They
 * are stored replace-on-save, exactly like a test's steps, so both the tests
 * route (manual CRUD) and the import route (xlsx) write them the same way.
 */

const db = require('./db');

/**
 * The standard verification setup, shown at the top of every version and printed
 * as the opening page of the signed verification report. It is the baseline a
 * version starts from: the first version of a project falls back to this text,
 * and each later version inherits its predecessor's (see routes/projects.js). A
 * QA Engineer can override it per version from the version view.
 */
const DEFAULT_SETUP_TEXT = `Each test case is self-contained and executed independently. Any special setup required by a particular test is specified within that test case. Certain tests may additionally require specific software, system versions, or capabilities.

Configuration

Unless a specific test states otherwise, the following configuration is applied on the Technician screen:
  Box Overlay: On
  Size Display: On
  Type Display: On
  BBPS Display: On
  Report: On
  Privacy Mode: Off
  QR Scan Reminders: Off

Test videos are hosted on a PC connected to the system via HDMI.`;

/** Replace all setup rows for a test (delete + recreate, ordered). */
function saveSetups(testId, setups) {
  for (const s of db.setups.findAll({ testId })) db.setups.delete(s.id);
  if (!Array.isArray(setups)) return;
  const used = new Set();
  setups.forEach((s, i) => {
    db.setups.create({
      testId,
      setupId:    uniqueSetupId(s.setupId || s.label, i, used),
      label:      s.label || s.setupId || `Setup ${i + 1}`,
      order:      i + 1,
      status:     s.status || '',
      testerName: s.testerName || '',
      data:       JSON.stringify(s.data || {}),
    });
  });
}

/**
 * A setup's `setupId` is its per-verification identity — it keys the execution
 * working state, drafts, executions and the status rollup. It MUST be unique and
 * non-empty within a verification, otherwise distinct setups collapse onto one
 * another (e.g. a tracker whose id column repeats a value), so marking one
 * setup's steps appears on the others. Disambiguate empties/duplicates.
 */
function uniqueSetupId(raw, i, used) {
  const base = (raw || '').trim() || `Setup ${i + 1}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base} (${n})`;
  used.add(id);
  return id;
}

module.exports = { saveSetups, uniqueSetupId, DEFAULT_SETUP_TEXT };
