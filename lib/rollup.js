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

/** Draft override per setup for a version-test (null key = standard/no setup). */
function draftStatusBySetup(versionTestId) {
  const m = new Map();
  for (const d of db.executionDrafts.findAll({ versionTestId })) {
    m.set(d.setupId || null, draftMarkStatus(d));
  }
  return m;
}

/** Map any status onto one of the five unit buckets. */
function unitBucket(status) {
  if (status === 'PASSED')      return 'passed';
  if (status === 'FAILED')      return 'failed';
  if (status === 'BLOCKED')     return 'blocked';
  if (status === 'IN_PROGRESS') return 'inProgress';
  return 'notStarted';
}

/**
 * The countable **units** of a version-test — the single source of truth for the
 * version view. Each unit carries its own status (draft-aware: an in-progress or
 * blocked shared draft overrides the last signed result):
 *   - a standard verification            → one unit (its stored/draft status)
 *   - each setup of a setup-tracked test  → one unit ("setup-verification couple"),
 *     from that setup's latest execution in this version (or draft override)
 * Setup verdicts split directly into passed/failed/blocked/in-progress/not-started,
 * so there is no PARTIAL at the unit level. Returns an array of
 * { setupId, status, execution } (execution = the latest signed run, or null).
 */
function versionTestUnits(vt) {
  const test = db.tests.findById(vt.testDefId);
  const drafts = draftStatusBySetup(vt.id);
  if (!test || (test.type || 'STANDARD') !== 'SETUP_TRACKED') {
    return [{ setupId: null, status: drafts.get(null) || vt.status || 'NOT_STARTED', execution: null }];
  }
  const setups = db.setups.findAll({ testId: vt.testDefId });
  const latest = latestBySetup(db.executions.findAll({ versionTestId: vt.id }));
  return setups.map(s => {
    const ex = latest.get(s.setupId) || null;
    return { setupId: s.setupId, status: drafts.get(s.setupId) || ex?.result || 'NOT_STARTED', execution: ex };
  });
}

/**
 * Unit-based status breakdown for a version (the version-view headline). Every
 * setup of a setup-tracked verification is counted on its own, standard
 * verifications count as one unit. Returns
 * { total, notStarted, inProgress, blocked, failed, passed }.
 */
function versionUnitStats(versionId) {
  const u = { total: 0, notStarted: 0, inProgress: 0, blocked: 0, failed: 0, passed: 0 };
  const vTests = db.versionTests.findAll({ versionId })
    .filter(vt => db.tests.findById(vt.testDefId));   // ignore links to deleted definitions
  for (const vt of vTests) {
    for (const unit of versionTestUnits(vt)) { u[unitBucket(unit.status)]++; u.total++; }
  }
  return u;
}

/**
 * Coverage for a version, counted in **units**. A unit is "covered" once it has a
 * terminal verdict — PASSED or FAILED; NOT_STARTED, IN_PROGRESS and BLOCKED are
 * "remaining". A version is complete when every unit is covered (so every setup of
 * every setup-tracked verification must have a verdict). Empty versions are never
 * complete. Drives the auto-approval trigger.
 */
function versionCoverage(versionId) {
  const u = versionUnitStats(versionId);
  const covered = u.passed + u.failed;
  return { total: u.total, covered, isComplete: u.total > 0 && covered === u.total };
}

module.exports = { setupRollup, effectiveStatus, versionCoverage, versionUnitStats, versionTestUnits, unitBucket };
