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
 * Delete a version and everything under it: its version-tests (deep), its
 * version-level approval requests, and its version-level sign-off signatures.
 */
function deleteVersionCascade(versionId) {
  for (const vt of db.versionTests.findAll({ versionId })) deleteVersionTestCascade(vt.id);
  db.approvals.findAll({ versionId, scope: 'VERSION' }).forEach(a => db.approvals.delete(a.id));
  db.signatures.findAll({ versionId }).forEach(s => db.signatures.delete(s.id));
  db.versions.delete(versionId);
}

module.exports = { deleteVersionTestCascade, deleteVersionCascade };
