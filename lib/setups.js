/**
 * lib/setups.js — shared persistence for a setup-tracked verification's setups.
 *
 * Setups are the rows of the dynamic tracker table (one condition each). They
 * are stored replace-on-save, exactly like a test's steps, so both the tests
 * route (manual CRUD) and the import route (xlsx) write them the same way.
 */

const db = require('./db');

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

module.exports = { saveSetups, uniqueSetupId };
