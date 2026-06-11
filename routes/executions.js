const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../lib/db');
const { audit } = require('../lib/audit');
const { sign, verify } = require('../lib/signature');
const { requireAuth } = require('../lib/auth');
const { setupRollup } = require('../lib/rollup');
const { autoRequestIfComplete } = require('../lib/approvals');

const EVIDENCE_DIR = path.join(__dirname, '..', 'storage', 'evidence');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(EVIDENCE_DIR, req.params.executionId || 'misc');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB

// ── Executions ────────────────────────────────────────────────────────────────

// GET /api/executions?versionTestId=xxx
router.get('/', requireAuth, (req, res) => {
  const { versionTestId } = req.query;
  const filter = {};
  if (versionTestId) filter.versionTestId = versionTestId;

  const executions = db.executions.query({ filter, sortBy: 'executedAt', sortDir: 'desc' });
  const result = executions.map(ex => {
    const executor = db.users.findById(ex.executorId);
    const sigs = db.signatures.findAll({ executionId: ex.id });
    const evidence = db.evidence.findAll({ executionId: ex.id });
    return {
      ...ex,
      executorName: executor?.name || '—',
      signatures: sigs,
      evidenceCount: evidence.length,
    };
  });
  res.json(result);
});

// ── Drafts (in-progress, unsigned step results) ───────────────────────────────
// Drafts live in their own collection so they never affect executions, coverage,
// reports or the audit trail. One draft per (versionTest, setup, user); evidence
// is not part of a draft — only step results + notes/summary/deviations.

// GET /api/executions/drafts?versionTestId=xxx — this user's drafts for a vt
router.get('/drafts', requireAuth, (req, res) => {
  const { versionTestId } = req.query;
  if (!versionTestId) return res.status(400).json({ error: 'versionTestId required' });
  const drafts = db.executionDrafts.findAll({ versionTestId, userId: req.user.id });
  res.json(drafts);
});

// PUT /api/executions/draft — upsert this user's draft for (versionTest, setup)
router.put('/draft', requireAuth, (req, res) => {
  const { versionTestId, setupId, stepResults, summary, deviations } = req.body;
  if (!versionTestId) return res.status(400).json({ error: 'versionTestId required' });

  const filter = { versionTestId, userId: req.user.id, setupId: setupId || null };
  const existing = db.executionDrafts.findOne(filter);
  const payload = {
    versionTestId,
    userId: req.user.id,
    setupId: setupId || null,
    stepResults: Array.isArray(stepResults) ? stepResults : [],
    summary: summary || '',
    deviations: deviations || '',
  };
  const draft = existing
    ? db.executionDrafts.update(existing.id, payload)
    : db.executionDrafts.create(payload);
  res.json(draft);
});

// GET /api/executions/:id
router.get('/:id', requireAuth, (req, res) => {
  const ex = db.executions.findById(req.params.id);
  if (!ex) return res.status(404).json({ error: 'Not found' });

  const stepResults = db.stepResults.findAll({ executionId: ex.id });
  const sigs = db.signatures.findAll({ executionId: ex.id });
  const evidence = db.evidence.findAll({ executionId: ex.id });
  const executor = db.users.findById(ex.executorId);

  res.json({ ...ex, stepResults, signatures: sigs, evidence, executorName: executor?.name });
});

// POST /api/executions — create new execution (execute a test)
router.post('/', requireAuth, (req, res) => {
  const {
    versionTestId, result, swVersion, buildNumber, environment,
    configurations, summary, deviations, stepResults, isAutomated,
    ciJobUrl, ciJobId, setupId,
  } = req.body;

  if (!versionTestId || !result) return res.status(400).json({ error: 'versionTestId and result required' });

  const vt = db.versionTests.findById(versionTestId);
  if (!vt) return res.status(404).json({ error: 'VersionTest not found' });

  const ex = db.executions.create({
    versionTestId,
    executorId: req.user.id,
    result,
    swVersion: swVersion || '',
    buildNumber: buildNumber || '',
    environment: environment || '',
    configurations: configurations || '',
    summary: summary || '',
    deviations: deviations || '',
    isAutomated: !!isAutomated,
    ciJobUrl: ciJobUrl || null,
    ciJobId: ciJobId || null,
    setupId: setupId || null,   // which setup (condition) this run covered, if any
    executedAt: new Date().toISOString(),
  });

  // Save step results — default to PASS when overall result is PASSED,
  // but never overwrite an explicitly recorded step result (e.g. a FAIL
  // noted on a step of an otherwise-passing run must stay in the record).
  const allSteps = db.steps.findAll({ testId: vt.testDefId });
  if (Array.isArray(stepResults) && stepResults.length > 0) {
    for (const sr of stepResults) {
      db.stepResults.create({
        executionId: ex.id,
        stepId:  sr.stepId,
        result:  sr.result || (result === 'PASSED' ? 'PASS' : 'SKIP'),
        actual:  sr.actual  || '',
        comment: sr.comment || '',
      });
    }
  } else if (result === 'PASSED') {
    // No step results submitted — auto-create PASS for all steps
    for (const step of allSteps) {
      db.stepResults.create({
        executionId: ex.id,
        stepId:  step.id,
        result:  'PASS',
        actual:  '',
        comment: '',
      });
    }
  }

  // Update versionTest status. Setup-tracked verifications summarise all their
  // setups (PASSED only when every setup passed; PARTIAL when all ran but some
  // failed/blocked; IN_PROGRESS while any setup is still unexecuted) rather than
  // mirroring this single run's result.
  const test = db.tests.findById(vt.testDefId);
  if (test && (test.type || 'STANDARD') === 'SETUP_TRACKED') {
    const setups = db.setups.findAll({ testId: vt.testDefId });
    const allExecutions = db.executions.findAll({ versionTestId });
    db.versionTests.update(versionTestId, { status: setupRollup(setups, allExecutions).status });

    // Record this run's outcome on the setup: its verdict becomes the setup's
    // Status and the signer becomes its Tester. These are re-created as the
    // Status / Tester columns on export — they are never part of the setup's
    // descriptive `data`.
    if (setupId) {
      const setup = db.setups.findOne({ testId: vt.testDefId, setupId });
      if (setup) {
        const name = db.users.findById(req.user.id)?.name || '';
        db.setups.update(setup.id, { status: result, testerName: name });
      }
    }
  } else {
    db.versionTests.update(versionTestId, { status: result });
  }

  // Auto-request a version sign-off once every verification is covered.
  autoRequestIfComplete(vt.versionId, req.user.id, req);

  audit(req.user.id, 'EXECUTE', 'executions', ex.id, null, ex, req);

  // Auto-sign as EXECUTED (the per-verification "Verified By" signature)
  const sig = sign(req.user.id, ex.id, 'EXECUTED', req);

  // This run is now a permanent record — drop the in-progress draft (if any)
  // for this (versionTest, setup, user) so re-opening starts clean.
  const draft = db.executionDrafts.findOne({ versionTestId, userId: req.user.id, setupId: setupId || null });
  if (draft) db.executionDrafts.delete(draft.id);

  res.status(201).json({ ...ex, signature: sig });
});

// ── Signatures ────────────────────────────────────────────────────────────────

// POST /api/executions/:id/sign
router.post('/:executionId/sign', requireAuth, (req, res) => {
  const { meaning } = req.body; // REVIEWED | APPROVED
  if (!['REVIEWED', 'APPROVED', 'EXECUTED'].includes(meaning)) {
    return res.status(400).json({ error: 'meaning must be REVIEWED or APPROVED' });
  }

  const ex = db.executions.findById(req.params.executionId);
  if (!ex) return res.status(404).json({ error: 'Execution not found' });

  const sig = sign(req.user.id, ex.id, meaning, req);
  res.json(sig);
});

// POST /api/executions/bulk-sign — sign multiple executions at once
router.post('/bulk-sign', requireAuth, (req, res) => {
  const { executionIds, meaning } = req.body;
  if (!Array.isArray(executionIds) || !meaning) {
    return res.status(400).json({ error: 'executionIds array and meaning required' });
  }

  const results = [];
  for (const id of executionIds) {
    const ex = db.executions.findById(id);
    if (!ex) { results.push({ id, error: 'Not found' }); continue; }
    const sig = sign(req.user.id, id, meaning, req);
    results.push({ id, sig });
  }
  res.json(results);
});

// GET /api/executions/:id/verify — verify signature integrity
router.get('/:executionId/verify', requireAuth, (req, res) => {
  const sigs = db.signatures.findAll({ executionId: req.params.executionId });
  const results = sigs.map(s => ({ ...s, ...verify(s.id) }));
  res.json(results);
});

// ── Evidence ──────────────────────────────────────────────────────────────────

// GET /api/executions/:executionId/evidence
router.get('/:executionId/evidence', requireAuth, (req, res) => {
  const evidence = db.evidence.findAll({ executionId: req.params.executionId });
  res.json(evidence);
});

// POST /api/executions/:executionId/evidence — upload file
router.post('/:executionId/evidence', requireAuth, upload.array('files', 20), (req, res) => {
  const { executionId } = req.params;
  const ex = db.executions.findById(executionId);
  if (!ex) return res.status(404).json({ error: 'Execution not found' });

  const saved = [];
  for (const file of req.files || []) {
    const type = detectEvidenceType(file.mimetype, file.originalname);
    const ev = db.evidence.create({
      executionId,
      type,
      filename: file.originalname,
      path: file.path,
      mimeType: file.mimetype,
      size: file.size,
      description: req.body.description || '',
    });
    saved.push(ev);
    audit(req.user.id, 'CREATE', 'evidence', ev.id, null, ev, req);
  }
  res.status(201).json(saved);
});

// GET /api/executions/:executionId/evidence/:evidenceId/download
router.get('/:executionId/evidence/:evidenceId/download', requireAuth, (req, res) => {
  const ev = db.evidence.findById(req.params.evidenceId);
  if (!ev) return res.status(404).json({ error: 'Not found' });
  res.download(ev.path, ev.filename);
});

// DELETE /api/executions/:executionId/evidence/:evidenceId
router.delete('/:executionId/evidence/:evidenceId', requireAuth, (req, res) => {
  const ev = db.evidence.findById(req.params.evidenceId);
  if (!ev) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(ev.path); } catch {}
  db.evidence.delete(ev.id);
  audit(req.user.id, 'DELETE', 'evidence', ev.id, ev, null, req);
  res.json({ ok: true });
});

function detectEvidenceType(mime, filename) {
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime === 'application/pdf') return 'PDF';
  if (filename.endsWith('.log') || filename.endsWith('.txt')) return 'LOG';
  return 'OTHER';
}

// ── CI webhook ────────────────────────────────────────────────────────────────

// POST /api/executions/ci — Jenkins/CI webhook
router.post('/ci', (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  const expectedKey = process.env.MAGENTIQA_CI_API_KEY || process.env.VMS_CI_API_KEY;
  if (expectedKey && apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const { versionTestId, result, swVersion, buildNumber, ciJobUrl, ciJobId, logs, setupId } = req.body;
  if (!versionTestId || !result) return res.status(400).json({ error: 'versionTestId and result required' });

  const vt = db.versionTests.findById(versionTestId);
  if (!vt) return res.status(404).json({ error: 'VersionTest not found' });

  // Find CI user
  const ciUser = db.users.findOne({ username: 'ci@magentiqa.local' })
              || db.users.findOne({ username: 'ci@vms.local' });
  const executorId = ciUser?.id || db.users.findAll()[0]?.id;

  const ex = db.executions.create({
    versionTestId,
    executorId,
    result: result === 'SUCCESS' || result === 'PASSED' ? 'PASSED' : 'FAILED',
    swVersion: swVersion || '',
    buildNumber: buildNumber || '',
    isAutomated: true,
    ciJobUrl: ciJobUrl || null,
    ciJobId: ciJobId || null,
    setupId: setupId || null,
    summary: logs ? logs.slice(0, 2000) : '',
    executedAt: new Date().toISOString(),
  });

  // Roll up setup-tracked verifications across all their setups (see POST /).
  const ciTest = db.tests.findById(vt.testDefId);
  if (ciTest && (ciTest.type || 'STANDARD') === 'SETUP_TRACKED') {
    const setups = db.setups.findAll({ testId: vt.testDefId });
    const allExecutions = db.executions.findAll({ versionTestId });
    db.versionTests.update(versionTestId, { status: setupRollup(setups, allExecutions).status });

    // Record the run's verdict/tester on the setup (re-created as the Status /
    // Tester columns on export), mirroring the interactive sign path above.
    if (setupId) {
      const setup = db.setups.findOne({ testId: vt.testDefId, setupId });
      if (setup) db.setups.update(setup.id, { status: ex.result, testerName: db.users.findById(executorId)?.name || '' });
    }
  } else {
    db.versionTests.update(versionTestId, { status: ex.result });
  }

  // Auto-request a version sign-off once every verification is covered.
  autoRequestIfComplete(vt.versionId, executorId, req);

  audit(executorId, 'EXECUTE', 'executions', ex.id, null, { ...ex, source: 'CI' }, req);

  res.status(201).json({ ok: true, executionId: ex.id });
});

module.exports = router;
