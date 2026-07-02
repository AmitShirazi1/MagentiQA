/**
 * lib/rollup.js — overall status for a setup-tracked verification.
 *
 * A setup-tracked verification owns several setups (conditions), each executed
 * independently. The version-test's single `status` field must summarise all of
 * them rather than just mirroring the most recent execution. Rules:
 *
 *   - no setup executed yet            → NOT_STARTED
 *   - at least one setup not executed  → IN_PROGRESS  (count = executed/total)
 *   - all executed, all passed         → PASSED       (count = passed/total)
 *   - all executed, ≥1 failed/blocked  → PARTIAL      (count = passed/total)
 *
 * A verification is never reported as fully FAILED while ≥1 setup has passed —
 * PARTIAL carries that nuance instead.
 */

const db = require('./db');

/** Latest (by executedAt) execution per setupId, ignoring setup-less runs. */
function latestBySetup(executions) {
  const byId = new Map();
  for (const e of executions) {
    if (!e.setupId) continue;
    const cur = byId.get(e.setupId);
    if (!cur || (e.executedAt || '') > (cur.executedAt || '')) byId.set(e.setupId, e);
  }
  return byId;
}

/**
 * Roll up a setup-tracked verification's overall status.
 * @param {Array<{setupId:string}>} setups  the verification's setup rows
 * @param {Array} executions                all executions for the version-test
 * @returns {{status:string,total:number,executed:number,passed:number}}
 */
function setupRollup(setups, executions) {
  const latest = latestBySetup(executions);
  const total = setups.length;
  let executed = 0, passed = 0;
  for (const s of setups) {
    const ex = latest.get(s.setupId);
    if (!ex) continue;
    executed++;
    if (ex.result === 'PASSED') passed++;
  }

  let status;
  if (total === 0 || executed === 0) status = 'NOT_STARTED';
  else if (executed < total)         status = 'IN_PROGRESS';
  else if (passed === total)         status = 'PASSED';
  else                               status = 'PARTIAL';

  return { status, total, executed, passed };
}

/**
 * In-progress override from a shared (unsigned) draft. Drafts live in their own
 * collection and never touch signed executions or the PDF report — but the live
 * version view reflects them: a draft whose step marks include a BLOCKED step
 * reads BLOCKED; any other recorded step mark reads IN_PROGRESS. A draft with no
 * step marks (only notes) is ignored. Returns 'BLOCKED' | 'IN_PROGRESS' | null.
 */
function draftMarkStatus(draft) {
  const marks = (draft?.stepResults || []).map(r => r.result).filter(Boolean);
  if (marks.includes('BLOCKED')) return 'BLOCKED';
  if (marks.length) return 'IN_PROGRESS';
  return null;
}

/**
 * Draft override for a whole verification, across all its setups. BLOCKED (a
 * blocked step on any setup) wins over IN_PROGRESS; null means no active draft.
 */
function versionTestDraftStatus(versionTestId) {
  let status = null;
  for (const d of db.executionDrafts.findAll({ versionTestId })) {
    const m = draftMarkStatus(d);
    if (m === 'BLOCKED') return 'BLOCKED';
    if (m === 'IN_PROGRESS') status = 'IN_PROGRESS';
  }
  return status;
}

/**
 * Effective status of a version-test for aggregate counts. An active shared
 * draft (in-progress or blocked step marks) overrides the last signed result so
 * the version view shows live work; otherwise setup-tracked tests are rolled up
 * across their setups and everything else keeps its stored status (the most
 * recent execution result).
 */
function effectiveStatus(vt) {
  const draft = versionTestDraftStatus(vt.id);
  if (draft) return draft;
  const test = db.tests.findById(vt.testDefId);
  if (!test || (test.type || 'STANDARD') !== 'SETUP_TRACKED') return vt.status;
  const setups = db.setups.findAll({ testId: vt.testDefId });
  const executions = db.executions.findAll({ versionTestId: vt.id });
  return setupRollup(setups, executions).status;
}

/**
 * Coverage for a version. A verification is "covered" once it has a terminal
 * verdict — PASSED, FAILED or PARTIAL (using the rolled-up effective status).
 * NOT_STARTED, IN_PROGRESS and BLOCKED are "remaining". A version with no
 * verifications is never complete.
 */
const COVERED = new Set(['PASSED', 'FAILED', 'PARTIAL']);
function versionCoverage(versionId) {
  const vTests = db.versionTests.findAll({ versionId });
  const total = vTests.length;
  const covered = vTests.filter(vt => COVERED.has(effectiveStatus(vt))).length;
  return { total, covered, isComplete: total > 0 && covered === total };
}

/**
 * Unit-based status breakdown for a version, where a "unit" is a single
 * pass/fail/blocked decision:
 *   - a standard verification = 1 unit (its effective status)
 *   - each setup of a setup-tracked verification = 1 unit ("setup-verification
 *     couple"), bucketed by that setup's latest execution result
 * Because setup verdicts split directly into passed/failed/blocked there is no
 * PARTIAL bucket. Returns { total, notStarted, inProgress, blocked, failed, passed }.
 */
function versionUnitStats(versionId) {
  const vTests = db.versionTests.findAll({ versionId })
    .filter(vt => db.tests.findById(vt.testDefId));   // ignore links to deleted definitions
  const u = { total: 0, notStarted: 0, inProgress: 0, blocked: 0, failed: 0, passed: 0 };
  const bump = key => { u[key]++; u.total++; };

  for (const vt of vTests) {
    const test = db.tests.findById(vt.testDefId);
    const setups = (test.type || 'STANDARD') === 'SETUP_TRACKED'
      ? db.setups.findAll({ testId: vt.testDefId }) : [];

    if (setups.length) {
      const latest = latestBySetup(db.executions.findAll({ versionTestId: vt.id }));
      // A shared draft on a setup (in-progress / blocked marks) overrides that
      // setup's last signed result for the live breakdown, keyed by setup.
      const draftBySetup = new Map();
      for (const d of db.executionDrafts.findAll({ versionTestId: vt.id })) {
        draftBySetup.set(d.setupId || null, draftMarkStatus(d));
      }
      for (const s of setups) {
        const dm = draftBySetup.get(s.setupId);
        if (dm === 'BLOCKED')          { bump('blocked'); continue; }
        if (dm === 'IN_PROGRESS')      { bump('inProgress'); continue; }
        const r = latest.get(s.setupId)?.result;
        if (r === 'PASSED')      bump('passed');
        else if (r === 'FAILED') bump('failed');
        else if (r === 'BLOCKED') bump('blocked');
        else                     bump('notStarted');
      }
    } else {
      const st = effectiveStatus(vt);
      if (st === 'PASSED')        bump('passed');
      else if (st === 'FAILED')   bump('failed');
      else if (st === 'BLOCKED')  bump('blocked');
      else if (st === 'IN_PROGRESS') bump('inProgress');
      else                        bump('notStarted');
    }
  }
  return u;
}

module.exports = { setupRollup, effectiveStatus, versionCoverage, versionUnitStats };
