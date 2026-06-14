/**
 * lib/cascade.js — cascade deletes for the version-test join and everything that
 * hangs off it (executions → step results / signatures / evidence files, plus
 * in-progress drafts and approval requests).
 *
 * Used when deleting a version, and when deleting a verification definition that
 * is still linked to versions (so no "ghost" version-test rows are left behind).
 */

const fs = require('fs');
const db = require('./db');

function deleteVersionTestCascade(vtId) {
  for (const ex of db.executions.findAll({ versionTestId: vtId })) {
    db.stepResults.findAll({ executionId: ex.id }).forEach(r => db.stepResults.delete(r.id));
    db.signatures.findAll({ executionId: ex.id }).forEach(s => db.signatures.delete(s.id));
    for (const ev of db.evidence.findAll({ executionId: ex.id })) {
      try { fs.unlinkSync(ev.path); } catch { /* file already gone */ }
      db.evidence.delete(ev.id);
    }
    db.executions.delete(ex.id);
  }
  db.executionDrafts.findAll({ versionTestId: vtId }).forEach(d => db.executionDrafts.delete(d.id));
  db.approvals.findAll({ versionTestId: vtId }).forEach(a => db.approvals.delete(a.id));
  db.versionTests.delete(vtId);
}

/**
 * Wipe a version-test's execution history while keeping the link itself, so the
 * verification returns to a clean NOT_STARTED state. Removes its executions
 * (with step results / signatures / evidence files), in-progress drafts, and any
 * legacy per-verification approval requests; for setup-tracked verifications it
 * also clears each setup's recorded outcome (Status / Tester). The caller is
 * responsible for resetting the version-test's `status` and re-checking the
 * version's auto sign-off. Returns counts of what was deleted (for the audit log).
 */
function resetVersionTestExecutions(vtId) {
  const counts = { executions: 0, signatures: 0, evidence: 0 };
  for (const ex of db.executions.findAll({ versionTestId: vtId })) {
    db.stepResults.findAll({ executionId: ex.id }).forEach(r => db.stepResults.delete(r.id));
    db.signatures.findAll({ executionId: ex.id }).forEach(s => { db.signatures.delete(s.id); counts.signatures++; });
    for (const ev of db.evidence.findAll({ executionId: ex.id })) {
      try { fs.unlinkSync(ev.path); } catch { /* file already gone */ }
      db.evidence.delete(ev.id);
      counts.evidence++;
    }
    db.executions.delete(ex.id);
    counts.executions++;
  }
  db.executionDrafts.findAll({ versionTestId: vtId }).forEach(d => db.executionDrafts.delete(d.id));
  db.approvals.findAll({ versionTestId: vtId }).forEach(a => db.approvals.delete(a.id));

  // Setup-tracked: clear the recorded outcome on each setup so its baseline
  // Status / Tester columns return to blank.
  const vt = db.versionTests.findById(vtId);
  const test = vt && db.tests.findById(vt.testDefId);
  if (test && (test.type || 'STANDARD') === 'SETUP_TRACKED') {
    db.setups.findAll({ testId: vt.testDefId }).forEach(s => db.setups.update(s.id, { status: null, testerName: null }));
  }
  return counts;
}

/**
 * Delete a version and everything under it: its version-tests (deep), its
 * version-level approval requests, and its version-level sign-off signatures.
 */
function deleteVersionCascade(versionId) {
  for (const vt of db.versionTests.findAll({ versionId })) deleteVersionTestCascade(vt.id);
  db.approvals.findAll({ versionId, scope: 'VERSION' }).forEach(a => db.approvals.delete(a.id));
  db.signatures.findAll({ versionId }).forEach(s => db.signatures.delete(s.id));
  db.versions.delete(versionId);
}

module.exports = { deleteVersionTestCascade, resetVersionTestExecutions, deleteVersionCascade };
