/**
 * lib/approvals.js — keep a version's auto-requested sign-off in step with its
 * coverage. Called after any execution changes a version-test's status.
 *
 *   - reaches 100% coverage with no pending request → auto-create a PENDING
 *     version approval (`auto: true`)
 *   - an AUTO pending request that no longer reflects 100% → WITHDRAWN
 *
 * A manually-requested PENDING approval (`auto` falsy) is never auto-touched —
 * only an approver clears it.
 */

const db = require('./db');
const { audit } = require('./audit');
const { versionCoverage } = require('./rollup');

function autoRequestIfComplete(versionId, actorId, req) {
  if (!versionId) return;
  const { isComplete } = versionCoverage(versionId);
  const pending = db.approvals.findOne({ versionId, scope: 'VERSION', status: 'PENDING' });

  if (isComplete && !pending) {
    const ap = db.approvals.create({
      scope: 'VERSION', versionId, versionTestId: null,
      requestedBy: actorId, status: 'PENDING', auto: true,
      comment: 'Auto-requested at 100% coverage',
    });
    audit(actorId, 'CREATE', 'approvals', ap.id, null, ap, req);
  } else if (!isComplete && pending && pending.auto) {
    const updated = db.approvals.update(pending.id, {
      status: 'WITHDRAWN', resolvedAt: new Date().toISOString(),
    });
    audit(actorId, 'UPDATE', 'approvals', pending.id, pending, updated, req);
  }
}

module.exports = { autoRequestIfComplete };
