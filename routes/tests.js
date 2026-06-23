const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { audit } = require('../lib/audit');
const { requireAuth, requireRole } = require('../lib/auth');
const { saveSetups } = require('../lib/setups');
const { setupRollup } = require('../lib/rollup');
const { deleteVersionTestCascade, resetVersionTestExecutions } = require('../lib/cascade');
const { autoRequestIfComplete } = require('../lib/approvals');
const { v4: uuidv4 } = require('uuid');

// ── Setup-tracking helpers ─────────────────────────────────────────────────────
// A "setup-tracked" verification (type SETUP_TRACKED) owns a dynamic setups
// table: ordered `setupColumns` (header labels) + `setups` rows. Each setup is
// one condition the test must be performed under, with an editable baseline
// Status/Tester mirrored from the source xlsx tracker. `saveSetups` lives in
// lib/setups.js so the importer writes setups the same way.

/** Setup rows for a test, ordered, with `data` parsed back to an object. */
function loadSetups(testId) {
  return db.setups.query({ filter: { testId }, sortBy: 'order', sortDir: 'asc' })
    .map(s => ({ ...s, data: safeParse(s.data, {}) }));
}

/** Baseline coverage from the setups' editable status. */
function coverageOf(setups) {
  const total  = setups.length;
  const passed = setups.filter(s => s.status === 'PASSED').length;
  const failed = setups.filter(s => s.status === 'FAILED').length;
  const pending = total - passed - failed;
  return { total, passed, failed, pending };
}

function safeParse(json, fallback) {
  try { return JSON.parse(json); } catch { return fallback; }
}

/** Decorate a raw test record with parsed tags/columns + setups + coverage. */
function decorateTest(t, { withSetups = true } = {}) {
  const type = t.type || 'STANDARD';
  const out = {
    ...t,
    type,
    tags: safeParse(t.tags, []),
    setupColumns: safeParse(t.setupColumns, []),
    setupMeta:    safeParse(t.setupMeta, {}),
  };
  if (type === 'SETUP_TRACKED' && withSetups) {
    out.setups = loadSetups(t.id);
    out.setupCoverage = coverageOf(out.setups);
  }
  return out;
}

// ── Test Definitions ──────────────────────────────────────────────────────────

// GET /api/tests — list all test definitions
router.get('/', requireAuth, (req, res) => {
  const { search, path: pathFilter, tag, type } = req.query;
  let tests = db.tests.query({ sortBy: 'testId', sortDir: 'asc' });

  if (search) {
    const q = search.toLowerCase();
    tests = tests.filter(t =>
      t.title?.toLowerCase().includes(q) ||
      t.testId?.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q)
    );
  }
  if (pathFilter) tests = tests.filter(t => t.path?.startsWith(pathFilter));
  if (type) tests = tests.filter(t => (t.type || 'STANDARD') === type);
  if (tag) tests = tests.filter(t => safeParse(t.tags, []).includes(tag));

  const result = tests.map(t => ({
    ...decorateTest(t),
    steps: db.steps.query({ filter: { testId: t.id }, sortBy: 'order', sortDir: 'asc' }),
  }));
  res.json(result);
});

// GET /api/tests/:id
router.get('/:id', requireAuth, (req, res) => {
  const test = db.tests.findById(req.params.id);
  if (!test) return res.status(404).json({ error: 'Not found' });
  const steps = db.steps.query({ filter: { testId: test.id }, sortBy: 'order', sortDir: 'asc' });
  res.json({ ...decorateTest(test), steps });
});

// POST /api/tests
router.post('/', requireAuth, (req, res) => {
  const { title, tags, description, objective, preconditions, setup, configurations, configuration, files, notes, steps,
          type, setupColumns, setupMeta, setups } = req.body;
  const testPath = req.body.path;
  if (!title) return res.status(400).json({ error: 'title required' });

  const isTracked = type === 'SETUP_TRACKED';
  const test = db.tests.create({
    testId: db.nextTestId(),
    title,
    path: testPath || '',
    tags: JSON.stringify(Array.isArray(tags) ? tags : []),
    description: description || '',
    objective: objective || '',
    preconditions: preconditions || '',
    setup: setup || '',
    configuration: configuration || configurations || '',
    files: files || '',
    notes: notes || '',
    type: isTracked ? 'SETUP_TRACKED' : 'STANDARD',
    setupColumns: JSON.stringify(isTracked && Array.isArray(setupColumns) ? setupColumns : []),
    setupMeta: JSON.stringify(isTracked ? (setupMeta || {}) : {}),
  });

  // Create steps
  if (Array.isArray(steps)) {
    for (const s of steps) {
      db.steps.create({ testId: test.id, order: s.order, action: s.action, expectedResult: s.expectedResult || '' });
    }
  }
  if (isTracked) saveSetups(test.id, setups);

  audit(req.user.id, 'CREATE', 'tests', test.id, null, test, req);
  const savedSteps = db.steps.query({ filter: { testId: test.id }, sortBy: 'order', sortDir: 'asc' });
  res.status(201).json({ ...decorateTest(test), steps: savedSteps });
});

// PUT /api/tests/:id
router.put('/:id', requireAuth, (req, res) => {
  const before = db.tests.findById(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });

  const { steps, tags, configurations, setupColumns, setupMeta, setups, type, ...fields } = req.body;
  if (configurations && !fields.configuration) fields.configuration = configurations;

  // Keep the type unless explicitly changed (conversion goes through /convert).
  if (type) fields.type = type === 'SETUP_TRACKED' ? 'SETUP_TRACKED' : 'STANDARD';
  if (setupColumns !== undefined) fields.setupColumns = JSON.stringify(Array.isArray(setupColumns) ? setupColumns : []);
  if (setupMeta !== undefined) fields.setupMeta = JSON.stringify(setupMeta || {});

  const updated = db.tests.update(req.params.id, {
    ...fields,
    tags: tags ? JSON.stringify(Array.isArray(tags) ? tags : []) : before.tags,
  });

  // Replace steps if provided
  if (Array.isArray(steps)) {
    const oldSteps = db.steps.findAll({ testId: req.params.id });
    for (const s of oldSteps) db.steps.delete(s.id);
    for (const s of steps) {
      db.steps.create({ testId: req.params.id, order: s.order, action: s.action, expectedResult: s.expectedResult || '' });
    }
  }
  // Replace setups if provided (only meaningful for setup-tracked tests)
  if (Array.isArray(setups) && (updated.type || 'STANDARD') === 'SETUP_TRACKED') {
    saveSetups(req.params.id, setups);
  }

  audit(req.user.id, 'UPDATE', 'tests', req.params.id, before, updated, req);
  const savedSteps = db.steps.query({ filter: { testId: req.params.id }, sortBy: 'order', sortDir: 'asc' });
  res.json({ ...decorateTest(updated), steps: savedSteps });
});

router.delete('/:id', requireAuth, requireRole('ADMIN', 'QA_ENGINEER', 'APPROVER'), (req, res) => {
  const before = db.tests.findById(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  db.transaction(() => {
    // Unlink from every version (and drop those runs) so no ghost version-test
    // rows are left pointing at a now-deleted definition.
    db.versionTests.findAll({ testDefId: req.params.id }).forEach(vt => deleteVersionTestCascade(vt.id));
    db.steps.findAll({ testId: req.params.id }).forEach(s => db.steps.delete(s.id));
    db.setups.findAll({ testId: req.params.id }).forEach(s => db.setups.delete(s.id));
    db.tests.delete(req.params.id);
  });
  audit(req.user.id, 'DELETE', 'tests', req.params.id, before, null, req);
  res.json({ ok: true });
});

// POST /api/tests/:id/convert — switch a verification between STANDARD and
// SETUP_TRACKED. Standard→tracked seeds a setups table; tracked→standard strips
// all setups but keeps the verification (fields + steps).
router.post('/:id/convert', requireAuth, (req, res) => {
  const before = db.tests.findById(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  const to = req.body.to === 'SETUP_TRACKED' ? 'SETUP_TRACKED' : 'STANDARD';

  let patch;
  if (to === 'SETUP_TRACKED') {
    const columns = Array.isArray(req.body.setupColumns) && req.body.setupColumns.length
      ? req.body.setupColumns
      : ['Test ID', 'Setup Details', 'Status', 'Tester Name'];
    const meta = req.body.setupMeta || {
      idColumn:     columns.find(c => /^test\s*id$/i.test(c)) || columns[0],
      statusColumn: columns.find(c => /status/i.test(c)) || null,
      testerColumn: columns.find(c => /tester/i.test(c)) || null,
    };
    patch = { type: 'SETUP_TRACKED', setupColumns: JSON.stringify(columns), setupMeta: JSON.stringify(meta) };
    const updated = db.tests.update(req.params.id, patch);
    if (Array.isArray(req.body.setups)) saveSetups(req.params.id, req.body.setups);
    audit(req.user.id, 'UPDATE', 'tests', req.params.id, before, updated, req);
    const steps = db.steps.query({ filter: { testId: req.params.id }, sortBy: 'order', sortDir: 'asc' });
    return res.json({ ...decorateTest(updated), steps });
  }

  // → STANDARD: strip the setups table.
  db.setups.findAll({ testId: req.params.id }).forEach(s => db.setups.delete(s.id));
  const updated = db.tests.update(req.params.id, {
    type: 'STANDARD', setupColumns: JSON.stringify([]), setupMeta: JSON.stringify({}),
  });
  audit(req.user.id, 'UPDATE', 'tests', req.params.id, before, updated, req);
  const steps = db.steps.query({ filter: { testId: req.params.id }, sortBy: 'order', sortDir: 'asc' });
  res.json({ ...decorateTest(updated), steps });
});

// ── Version Tests (tests linked to a specific version) ────────────────────────

// GET /api/tests/version/:versionId
router.get('/version/:versionId', requireAuth, (req, res) => {
  const vTests = db.versionTests.query({
    filter: { versionId: req.params.versionId },
    sortBy: 'createdAt',
    sortDir: 'asc',
  }).filter(vt => db.tests.findById(vt.testDefId));   // skip links to deleted definitions

  const result = vTests.map(vt => {
    const test = db.tests.findById(vt.testDefId);
    const steps = db.steps.query({ filter: { testId: vt.testDefId }, sortBy: 'order', sortDir: 'asc' });
    const executions = db.executions.findAll({ versionTestId: vt.id });
    const lastExec = executions.sort((a, b) => b.executedAt > a.executedAt ? 1 : -1)[0];

    let decorated = test ? { ...decorateTest(test), steps } : null;

    // Setup-tracked verifications summarise all their setups. `status` is rolled
    // up (PASSED only when every setup passed; PARTIAL when all ran but some
    // failed/blocked; IN_PROGRESS while any setup is unexecuted) and recomputed
    // on read so it stays correct even if setups were added/removed since the
    // last execution. `versionCoverage` exposes the counts the UI shows.
    let status = vt.status;
    let versionCoverage = null;
    if (decorated && decorated.type === 'SETUP_TRACKED') {
      const roll = setupRollup(decorated.setups, executions);
      status = roll.status;
      versionCoverage = { covered: roll.passed, executed: roll.executed, total: roll.total };
    }

    return {
      ...vt,
      status,
      test: decorated,
      executionCount: executions.length,
      lastExecutedAt: lastExec?.executedAt || null,
      lastResult: lastExec?.result || null,
      versionCoverage,
    };
  });
  res.json(result);
});

// POST /api/tests/version/:versionId — add a test to a version
router.post('/version/:versionId', requireAuth, (req, res) => {
  const { testDefId, configurations, assignedTo } = req.body;
  if (!testDefId) return res.status(400).json({ error: 'testDefId required' });
  if (!db.versions.findById(req.params.versionId)) return res.status(404).json({ error: 'Version not found' });
  if (!db.tests.findById(testDefId)) return res.status(404).json({ error: 'Test not found' });

  const vt = db.versionTests.create({
    versionId: req.params.versionId,
    testDefId,
    status: 'NOT_STARTED',
    workflowState: 'DRAFT',
    configurations: configurations || '',
    assignedTo: assignedTo || null,
  });
  audit(req.user.id, 'CREATE', 'versionTests', vt.id, null, vt, req);
  res.status(201).json(vt);
});

// PUT /api/tests/version/:versionId/:vtId
router.put('/version/:versionId/:vtId', requireAuth, (req, res) => {
  const before = db.versionTests.findById(req.params.vtId);
  if (!before) return res.status(404).json({ error: 'Not found' });
  const updated = db.versionTests.update(req.params.vtId, req.body);
  audit(req.user.id, 'UPDATE', 'versionTests', req.params.vtId, before, updated, req);
  res.json(updated);
});

// POST /api/tests/version/:versionId/:vtId/reset — wipe this verification's
// execution history in the version and return it to NOT_STARTED. Deletes signed
// records, so it is limited to ADMIN / QA_ENGINEER.
router.post('/version/:versionId/:vtId/reset', requireAuth, requireRole('ADMIN', 'QA_ENGINEER'), (req, res) => {
  const before = db.versionTests.findById(req.params.vtId);
  if (!before) return res.status(404).json({ error: 'Not found' });

  let counts;
  db.transaction(() => {
    counts = resetVersionTestExecutions(req.params.vtId);
    db.versionTests.update(req.params.vtId, { status: 'NOT_STARTED', workflowState: 'DRAFT' });
  });
  // Coverage just dropped — withdraw any auto-requested version sign-off that no
  // longer reflects 100% completion.
  autoRequestIfComplete(before.versionId, req.user.id, req);
  audit(req.user.id, 'RESET', 'versionTests', req.params.vtId, before,
    { status: 'NOT_STARTED', deleted: counts }, req);
  res.json({ ok: true, ...counts });
});

// DELETE /api/tests/version/:versionId/:vtId
router.delete('/version/:versionId/:vtId', requireAuth, (req, res) => {
  const before = db.versionTests.findById(req.params.vtId);
  if (!before) return res.status(404).json({ error: 'Not found' });
  // Unlinking also drops this link's executions, signatures, evidence, drafts
  // and approvals — otherwise they'd be orphaned.
  db.transaction(() => deleteVersionTestCascade(req.params.vtId));
  audit(req.user.id, 'DELETE', 'versionTests', req.params.vtId, before, null, req);
  res.json({ ok: true });
});

module.exports = router;
