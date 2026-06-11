/**
 * lib/cleanup.js — Orphan evidence sweep
 *
 * Evidence files live in storage/evidence/<executionId>/<file>. They can be
 * orphaned by interrupted uploads or records removed outside the normal flow.
 * The sweep removes:
 *   - execution folders whose execution no longer exists in the DB
 *   - files inside valid folders that no evidence record points to
 *
 * Files younger than GRACE_MS are left alone so we never race an in-flight
 * upload (multer writes the file before the evidence record is created).
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { deleteVersionTestCascade } = require('./cascade');
const { uniqueSetupId } = require('./setups');

const EVIDENCE_DIR = path.join(__dirname, '..', 'storage', 'evidence');
const GRACE_MS = 60 * 60 * 1000; // 1 hour

function sweepOrphanEvidence() {
  if (!fs.existsSync(EVIDENCE_DIR)) return { removedFiles: 0, removedDirs: 0 };

  const now = Date.now();
  let removedFiles = 0;
  let removedDirs = 0;
  const referenced = new Set(db.evidence.findAll().map(ev => path.resolve(ev.path)));

  for (const entry of fs.readdirSync(EVIDENCE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(EVIDENCE_DIR, entry.name);

    // 'misc' is the fallback upload bucket — only sweep unreferenced files in it
    const executionExists = entry.name === 'misc' || !!db.executions.findById(entry.name);

    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs < GRACE_MS) continue; // in-flight upload grace period

      if (!executionExists || !referenced.has(path.resolve(full))) {
        try { fs.unlinkSync(full); removedFiles++; } catch {}
      }
    }

    // Remove the folder itself if it ended up empty
    try {
      if (fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); removedDirs++; }
    } catch {}
  }

  if (removedFiles || removedDirs) {
    console.log(`🧹  Evidence sweep: removed ${removedFiles} orphan file(s), ${removedDirs} empty folder(s)`);
  }
  return { removedFiles, removedDirs };
}

/**
 * Remove version-test links whose verification definition no longer exists
 * (e.g. links left behind by a definition deleted before delete-cascades were in
 * place). Each is torn down with its executions / signatures / evidence / drafts
 * / approvals via the shared cascade.
 */
function sweepOrphanVersionTests() {
  const orphans = db.versionTests.findAll().filter(vt => !db.tests.findById(vt.testDefId));
  if (!orphans.length) return { removed: 0 };
  db.transaction(() => orphans.forEach(vt => deleteVersionTestCascade(vt.id)));
  console.log(`🧹  Orphan sweep: removed ${orphans.length} dangling version-test link(s)`);
  return { removed: orphans.length };
}

/**
 * Repair setup-tracked verifications whose setups have duplicate/empty setupIds
 * (e.g. imported before `saveSetups` enforced uniqueness). Distinct setups that
 * share an id collapse onto one another in the execution screen. Only verifications
 * with NO executions yet are touched, so signed history (which references setupIds)
 * is never rewritten.
 */
function sweepDuplicateSetupIds() {
  let fixed = 0;
  for (const test of db.tests.findAll()) {
    if ((test.type || 'STANDARD') !== 'SETUP_TRACKED') continue;
    const setups = db.setups.query({ filter: { testId: test.id }, sortBy: 'order', sortDir: 'asc' });
    if (setups.length < 2) continue;
    const ids = setups.map(s => (s.setupId || '').trim());
    const needsFix = ids.some(x => !x) || new Set(ids).size !== ids.length;
    if (!needsFix) continue;
    // Skip if any setup has already been executed (don't desync history).
    const vtIds = db.versionTests.findAll({ testDefId: test.id }).map(v => v.id);
    if (vtIds.some(id => db.executions.findAll({ versionTestId: id }).some(e => e.setupId))) continue;

    const used = new Set();
    db.transaction(() => setups.forEach((s, i) => {
      const id = uniqueSetupId(s.setupId || s.label, i, used);
      if (id !== s.setupId) { db.setups.update(s.id, { setupId: id }); fixed++; }
    }));
  }
  if (fixed) console.log(`🧹  Setup sweep: gave ${fixed} setup row(s) unique ids`);
  return { fixed };
}

// Run shortly after startup, then once a day
function scheduleSweeps() {
  const run = () => {
    try { sweepOrphanEvidence(); }      catch (err) { console.error('[cleanup]', err.message); }
    try { sweepOrphanVersionTests(); }  catch (err) { console.error('[cleanup]', err.message); }
    try { sweepDuplicateSetupIds(); }   catch (err) { console.error('[cleanup]', err.message); }
  };
  setTimeout(run, 30 * 1000).unref();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}

module.exports = { sweepOrphanEvidence, sweepOrphanVersionTests, sweepDuplicateSetupIds, scheduleSweeps };
