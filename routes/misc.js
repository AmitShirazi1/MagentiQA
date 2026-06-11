const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const db       = require('../lib/db');
const { audit }           = require('../lib/audit');
const { requireAuth, requireRole } = require('../lib/auth');
const { parseDocxTest }   = require('../lib/parsers/docx');
const { parseMarkdownTest } = require('../lib/parsers/markdown');
const { parseXlsxTracker } = require('../lib/parsers/xlsx');
const { isXlsxFile, trackerBaseName, docBaseName, dirOf } = require('../lib/parsers/tracker-link');
const { effectiveStatus, versionUnitStats } = require('../lib/rollup');
const { sign } = require('../lib/signature');
const { saveSetups } = require('../lib/setups');
const { generateVersionReport } = require('../lib/pdf');
const { createBackup, listBackups, sanitizeLabel, BACKUP_DIR, BACKUP_NAME_RE } = require('../lib/backup');

const IMPORT_DIR = path.join(__dirname, '..', 'storage', 'imports');
if (!fs.existsSync(IMPORT_DIR)) fs.mkdirSync(IMPORT_DIR, { recursive: true });

// Accept both single files and folder uploads (webkitRelativePath uses field "files")
const upload = multer({
  dest: IMPORT_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ── Import ────────────────────────────────────────────────────────────────────

// POST /api/import/preview — parse one file and return structured preview (no save)
router.post('/import/preview', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = req.file.path;
  const ext      = path.extname(req.file.originalname).toLowerCase();

  try {
    if (ext === '.xlsx') {
      // A setup tracker on its own. Build a setup-tracked verification preview;
      // on save it upserts onto the verification with a matching title/base name.
      const tracker = await parseXlsxTracker(filePath);
      const title = trackerBaseName(req.file.originalname) || tracker.name || 'Setup Tracker';
      const parsed = trackerToParsed(title, tracker);
      return res.json({ ok: true, parsed, kind: 'tracker', filename: req.file.originalname });
    }

    let parsed;
    if (ext === '.docx') {
      parsed = await parseDocxTest(filePath);
    } else if (ext === '.md') {
      const content = fs.readFileSync(filePath, 'utf-8');
      parsed = parseMarkdownTest(content, req.file.originalname);
    } else {
      return res.status(400).json({ error: 'Unsupported format. Use .docx, .md or .xlsx' });
    }
    res.json({ ok: true, parsed, filename: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Turn a parsed xlsx tracker into a setup-tracked "parsed test" shape (title is
// derived from the tracker's base name so it upserts onto the matching docx).
function trackerToParsed(title, tracker) {
  return {
    title: titleCase(title),
    path: '',
    tags: [],
    description: '',
    preconditions: '',
    configuration: '',
    files: '',
    notes: '',
    steps: [],
    type: 'SETUP_TRACKED',
    tracker,
  };
}

function titleCase(s) {
  return (s || '').replace(/\b\w/g, c => c.toUpperCase());
}

// POST /api/import/folder — parse multiple files (folder upload), return array of results
// Client sends each file with its webkitRelativePath as the field name (or as multipart array).
router.post('/import/folder', requireAuth, upload.array('files', 500), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  // relativePaths sent as JSON array in body field "relativePaths"
  let relativePaths = [];
  try { relativePaths = JSON.parse(req.body.relativePaths || '[]'); } catch {}

  const results = [];
  const trackers = []; // parsed .xlsx trackers, paired with verifications afterward

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const relativePath = relativePaths[i] || file.originalname;
    const ext = path.extname(file.originalname).toLowerCase();

    // Tags from folder path segments (skip root folder + filename)
    const segments = relativePath.replace(/\\/g, '/').split('/');
    const tagSegments = segments.slice(1, -1).map(s => s.trim()).filter(Boolean);

    if (isXlsxFile(file.originalname)) {
      try {
        const tracker = await parseXlsxTracker(file.path);
        trackers.push({
          tracker, filename: file.originalname, relativePath, tagSegments,
          dir: dirOf(relativePath), base: trackerBaseName(file.originalname),
        });
      } catch (err) {
        results.push({ filename: file.originalname, relativePath, error: err.message });
      }
      continue;
    }

    if (ext !== '.docx' && ext !== '.md') {
      results.push({ filename: file.originalname, skipped: true, reason: 'not .docx, .md or .xlsx' });
      continue;
    }

    try {
      let parsed;
      if (ext === '.docx') {
        parsed = await parseDocxTest(file.path);
      } else {
        const content = fs.readFileSync(file.path, 'utf-8');
        parsed = parseMarkdownTest(content, file.originalname);
      }
      parsed.tags = [...new Set([...(parsed.tags || []), ...tagSegments])];
      parsed.sourceFile = file.originalname;

      results.push({
        filename: file.originalname, relativePath, parsed, ok: true,
        dir: dirOf(relativePath), base: docBaseName(file.originalname),
      });
    } catch (err) {
      results.push({ filename: file.originalname, relativePath, error: err.message });
    }
  }

  // ── Pair each tracker with its verification (same folder + same base name) ──
  for (const tr of trackers) {
    const partner = results.find(r => r.ok && r.parsed && r.dir === tr.dir && r.base === tr.base
      && r.parsed.type !== 'SETUP_TRACKED');
    if (partner) {
      partner.parsed.type = 'SETUP_TRACKED';
      partner.parsed.tracker = tr.tracker;
      partner.trackerFile = tr.filename;
    } else {
      // No matching docx/md — import the tracker as its own setup-tracked test
      const parsed = trackerToParsed(trackerBaseName(tr.filename) || tr.tracker.name, tr.tracker);
      parsed.tags = [...new Set(tr.tagSegments)];
      parsed.sourceFile = tr.filename;
      results.push({ filename: tr.filename, relativePath: tr.relativePath, parsed, ok: true, kind: 'tracker' });
    }
  }

  res.json({ ok: true, results });
});

/**
 * Persist one parsed item (docx/md verification, optionally carrying a `tracker`,
 * or an xlsx-only setup tracker) to the DB. Upserts by title (preserving testId);
 * a paired/standalone tracker promotes the test to SETUP_TRACKED and writes its
 * setups (replace-on-save). Returns { test, wasUpdated }.
 */
function persistParsedTest(parsed, versionId, req) {
  const tracker = parsed.tracker || null;       // { columns, idColumn, statusColumn, testerColumn, setups }
  const isTracked = !!tracker || parsed.type === 'SETUP_TRACKED';
  const existing = db.tests.findOne({ title: parsed.title });

  // Tracker schema fields are written only when a tracker is present, so
  // re-importing a docx without its xlsx never downgrades a tracked test.
  const trackerFields = tracker ? {
    type: 'SETUP_TRACKED',
    setupColumns: JSON.stringify(tracker.columns || []),
    setupMeta: JSON.stringify({
      idColumn: tracker.idColumn, statusColumn: tracker.statusColumn, testerColumn: tracker.testerColumn,
    }),
    setupSource: parsed.trackerSource || '',
  } : (isTracked ? { type: 'SETUP_TRACKED' } : {});

  let test;
  if (existing) {
    test = db.tests.update(existing.id, {
      path:           parsed.path          || existing.path,
      tags:           JSON.stringify(parsed.tags || []),
      description:    parsed.description   || existing.description,
      preconditions:  parsed.preconditions || existing.preconditions,
      configuration:  parsed.configuration || existing.configuration,
      files:          parsed.files         || existing.files,
      notes:          parsed.notes         || existing.notes || '',
      sourceFile:     parsed.sourceFile    || existing.sourceFile || '',
      ...trackerFields,
    });
  } else {
    test = db.tests.create({
      testId:        db.nextTestId(),
      title:          parsed.title,
      path:           parsed.path          || '',
      tags:           JSON.stringify(parsed.tags || []),
      description:    parsed.description   || '',
      preconditions:  parsed.preconditions || '',
      configuration:  parsed.configuration || '',
      files:          parsed.files         || '',
      notes:          parsed.notes         || '',
      sourceFile:     parsed.sourceFile    || '',
      type:           isTracked ? 'SETUP_TRACKED' : 'STANDARD',
      setupColumns:   JSON.stringify(tracker ? (tracker.columns || []) : []),
      setupMeta:      JSON.stringify(tracker ? {
        idColumn: tracker.idColumn, statusColumn: tracker.statusColumn, testerColumn: tracker.testerColumn,
      } : {}),
    });
  }

  // Replace steps only when the parsed item actually has steps — a tracker-only
  // re-import (no steps) must not wipe the verification's existing steps.
  if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
    for (const s of db.steps.findAll({ testId: test.id })) db.steps.delete(s.id);
    parsed.steps.forEach((s, i) => {
      db.steps.create({ testId: test.id, order: s.order || i + 1, action: s.action, expectedResult: s.expectedResult || '' });
    });
  }

  // Write setups when a tracker is attached (replace-on-save).
  if (tracker) saveSetups(test.id, tracker.setups || []);

  if (versionId) {
    const alreadyLinked = db.versionTests.findOne({ versionId, testDefId: test.id });
    if (!alreadyLinked) {
      db.versionTests.create({ versionId, testDefId: test.id, status: 'NOT_STARTED', workflowState: 'DRAFT' });
    }
  }

  audit(req.user.id, 'IMPORT', 'tests', test.id, null, test, req);
  return { test, wasUpdated: !!existing };
}

// POST /api/import/save — save one parsed test to DB
router.post('/import/save', requireAuth, async (req, res) => {
  const { parsed, versionId } = req.body;
  if (!parsed) return res.status(400).json({ error: 'parsed data required' });

  try {
    const { test, wasUpdated } = persistParsedTest(parsed, versionId, req);
    const steps = db.steps.query({ filter: { testId: test.id }, sortBy: 'order', sortDir: 'asc' });
    res.status(201).json({ test: { ...test, steps }, wasUpdated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/import/save-batch — save multiple parsed tests
router.post('/import/save-batch', requireAuth, async (req, res) => {
  const { items, versionId } = req.body; // items = array of parsed objects
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

  const saved = [];
  for (const parsed of items) {
    try {
      const { test, wasUpdated } = persistParsedTest(parsed, versionId, req);
      saved.push({ title: parsed.title, id: test.id, wasUpdated, type: test.type });
    } catch (err) {
      saved.push({ title: parsed?.title, error: err.message });
    }
  }

  res.json({ ok: true, saved });
});

// ── Export ────────────────────────────────────────────────────────────────────

router.get('/export/report/:versionId', requireAuth, async (req, res) => {
  try {
    audit(req.user.id, 'EXPORT', 'versions', req.params.versionId, null, { versionId: req.params.versionId }, req);
    const result = await generateVersionReport(req.params.versionId);
    if (result.type === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.sendFile(result.path);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.sendFile(result.path);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/export/tests', requireAuth, (req, res) => {
  const tests = db.tests.findAll().map(t => ({
    ...t,
    tags: JSON.parse(t.tags || '[]'),
    steps: db.steps.query({ filter: { testId: t.id }, sortBy: 'order', sortDir: 'asc' }),
  }));
  res.setHeader('Content-Disposition', 'attachment; filename="magentiqa-tests-export.json"');
  res.json(tests);
});

router.get('/export/version/:versionId', requireAuth, (req, res) => {
  const version = db.versions.findById(req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Not found' });

  const vTests = db.versionTests.findAll({ versionId: version.id });
  const full = vTests.map(vt => {
    const test       = db.tests.findById(vt.testDefId);
    const steps      = db.steps.query({ filter: { testId: vt.testDefId }, sortBy: 'order', sortDir: 'asc' });
    const executions = db.executions.findAll({ versionTestId: vt.id });
    const exWithDetails = executions.map(ex => ({
      ...ex,
      stepResults: db.stepResults.findAll({ executionId: ex.id }),
      signatures:  db.signatures.findAll({ executionId: ex.id }),
      evidence:    db.evidence.findAll({ executionId: ex.id }),
    }));
    return { ...vt, test: { ...test, steps }, executions: exWithDetails };
  });

  res.setHeader('Content-Disposition', `attachment; filename="version-${version.name}-export.json"`);
  res.json({ version, tests: full, exportedAt: new Date().toISOString() });
});

// ── Backup ──────────────────────────────────────────────────────────────────
// Full application "image": consistent DB snapshot + storage + all code, zipped
// into backups/magentiqa-backup-<timestamp>.zip. Admin-only.

// POST /api/backup — create a new backup archive. Optional body { label }
// appends a validated string to the filename (magentiqa-backup-<label>_<ts>.zip).
router.post('/backup', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const label = req.body?.label;
  // Validate the label up front so bad input is a clean 400, not a 500.
  try {
    sanitizeLabel(label);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const result = await createBackup(req.user?.username || req.user?.id, label);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    console.error('[backup] failed:', err);
    res.status(500).json({ error: `Backup failed: ${err.message}` });
  }
});

// GET /api/backups — list existing backup archives (newest first)
router.get('/backups', requireAuth, requireRole('ADMIN'), (req, res) => {
  res.json(listBackups());
});

// GET /api/backups/:name/download — download one archive
router.get('/backups/:name/download', requireAuth, requireRole('ADMIN'), (req, res) => {
  const name = path.basename(req.params.name); // strip any path traversal
  if (!BACKUP_NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Invalid backup name' });
  }
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'Backup not found' });
  }
  res.download(file, name);
});

// ── Audit Trail ───────────────────────────────────────────────────────────────

router.get('/audit', requireAuth, (req, res) => {
  const { entity, entityId, userId, limit = 200, offset = 0 } = req.query;
  const filter = {};
  if (entity)   filter.entity   = entity;
  if (entityId) filter.entityId = entityId;
  if (userId)   filter.userId   = userId;

  const logs = db.auditLogs.query({
    filter,
    sortBy: 'createdAt',
    sortDir: 'desc',
    limit: parseInt(limit),
    offset: parseInt(offset),
  });

  const result = logs.map(l => {
    const user = db.users.findById(l.userId);
    return { ...l, userName: user?.name || l.userId };
  });
  res.json(result);
});

// GET /api/audit/:id — full detail for one audit entry
router.get('/audit/:id', requireAuth, (req, res) => {
  const log = db.auditLogs.findById(req.params.id);
  if (!log) return res.status(404).json({ error: 'Not found' });
  const user = db.users.findById(log.userId);
  res.json({ ...log, userName: user?.name || log.userId });
});

// ── Users ─────────────────────────────────────────────────────────────────────

router.get('/users', requireAuth, (req, res) => {
  const users = db.users.findAll().map(u => { const { passwordHash, ...s } = u; return s; });
  res.json(users);
});

router.put('/users/:id', requireAuth, requireRole('ADMIN'), (req, res) => {
  const { name, role } = req.body;
  const user = db.users.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const updated = db.users.update(req.params.id, { name, role });
  const { passwordHash, ...safe } = updated;
  res.json(safe);
});

// ── Approvals ─────────────────────────────────────────────────────────────────

router.get('/approvals', requireAuth, (req, res) => {
  const { versionTestId, versionId, scope, status } = req.query;
  const filter = {};
  if (versionTestId) filter.versionTestId = versionTestId;
  if (versionId)     filter.versionId     = versionId;
  if (scope)         filter.scope         = scope;
  if (status)        filter.status        = status;

  const approvals = db.approvals.query({ filter, sortBy: 'createdAt', sortDir: 'desc' });
  const result = approvals.map(a => {
    const requester = db.users.findById(a.requestedBy || a.approverId);
    const resolver  = a.resolvedBy ? db.users.findById(a.resolvedBy) : null;
    if (a.scope === 'VERSION') {
      const version = db.versions.findById(a.versionId);
      const project = version ? db.projects.findById(version.projectId) : null;
      const label   = version ? `${project?.name ? project.name + ' — ' : ''}${version.name}` : 'Version';
      return {
        ...a, label, versionName: version?.name, projectName: project?.name,
        requesterName: requester?.name, resolverName: resolver?.name,
        approverName: resolver?.name || requester?.name,
      };
    }
    const approver = db.users.findById(a.approverId);
    const vt       = db.versionTests.findById(a.versionTestId);
    const test     = vt ? db.tests.findById(vt.testDefId) : null;
    return { ...a, approverName: approver?.name, testTitle: test?.title };
  });
  res.json(result);
});

router.post('/approvals', requireAuth, (req, res) => {
  const { scope, versionId, versionTestId, comment } = req.body;

  // Version-level sign-off request (the report approval).
  if (scope === 'VERSION') {
    if (!versionId) return res.status(400).json({ error: 'versionId required' });
    if (!db.versions.findById(versionId)) return res.status(404).json({ error: 'Version not found' });
    if (db.versionTests.findAll({ versionId }).length === 0) {
      return res.status(400).json({ error: 'This version has no verifications to approve' });
    }
    if (db.approvals.findOne({ versionId, scope: 'VERSION', status: 'PENDING' })) {
      return res.status(409).json({ error: 'An approval is already pending for this version' });
    }
    const ap = db.approvals.create({
      scope: 'VERSION', versionId, versionTestId: null,
      requestedBy: req.user.id, status: 'PENDING', comment: comment || '',
    });
    audit(req.user.id, 'CREATE', 'approvals', ap.id, null, ap, req);
    return res.status(201).json(ap);
  }

  // Legacy per-verification approval request.
  if (!versionTestId) return res.status(400).json({ error: 'versionTestId required' });
  const ap = db.approvals.create({ scope: 'TEST', versionTestId, approverId: req.user.id, status: 'PENDING', comment: comment || '' });
  audit(req.user.id, 'CREATE', 'approvals', ap.id, null, ap, req);
  res.status(201).json(ap);
});

router.put('/approvals/:id', requireAuth, requireRole('ADMIN', 'APPROVER'), (req, res) => {
  const { status, comment } = req.body;
  const before = db.approvals.findById(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'status must be APPROVED or REJECTED' });
  if (before.status !== 'PENDING') return res.status(409).json({ error: 'Approval already resolved' });

  const now = new Date().toISOString();

  // Version-level sign-off: approving creates the APPROVED signature that the
  // exported PDF renders in its "Approved By" box.
  if (before.scope === 'VERSION') {
    let signatureId = before.signatureId || null;
    if (status === 'APPROVED') {
      const sig = sign(req.user.id, before.versionId, 'APPROVED', req, 'VERSION');
      signatureId = sig.id;
    }
    const updated = db.approvals.update(req.params.id, {
      status, comment: comment || before.comment,
      resolvedAt: now, resolvedBy: req.user.id, approverId: req.user.id, signatureId,
    });
    audit(req.user.id, 'APPROVE', 'approvals', req.params.id, before, updated, req);
    return res.json(updated);
  }

  // Legacy per-verification approval.
  const updated = db.approvals.update(req.params.id, {
    status, comment: comment || before.comment, resolvedAt: now,
  });
  if (status === 'APPROVED') db.versionTests.update(before.versionTestId, { workflowState: 'APPROVED' });
  else if (status === 'REJECTED') db.versionTests.update(before.versionTestId, { workflowState: 'IN_REVIEW' });
  audit(req.user.id, 'APPROVE', 'approvals', req.params.id, before, updated, req);
  res.json(updated);
});

// ── Dashboard stats ───────────────────────────────────────────────────────────

router.get('/dashboard/:versionId', requireAuth, (req, res) => {
  const version = db.versions.findById(req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Not found' });

  const vTests = db.versionTests.findAll({ versionId: version.id })
    .filter(vt => db.tests.findById(vt.testDefId));   // ignore links to deleted definitions
  // Approval is version-level: a version has at most one pending sign-off.
  const pendingApprovals = db.approvals.findAll({ versionId: version.id, scope: 'VERSION', status: 'PENDING' });

  // Effective status rolls up setup-tracked verifications across their setups.
  const statuses = new Map(vTests.map(t => [t.id, effectiveStatus(t)]));
  const count = s => vTests.filter(t => statuses.get(t.id) === s).length;
  const stats = {
    total:            vTests.length,
    passed:           count('PASSED'),
    partial:          count('PARTIAL'),
    failed:           count('FAILED'),
    inProgress:       count('IN_PROGRESS'),
    notStarted:       count('NOT_STARTED'),
    blocked:          count('BLOCKED'),
    pendingApprovals: pendingApprovals.length,
  };

  const failedTests = vTests
    .filter(t => statuses.get(t.id) === 'FAILED')
    .map(t => ({ ...t, test: db.tests.findById(t.testDefId) }));

  res.json({ version, stats, unitStats: versionUnitStats(version.id), failedTests });
});

// ── Templates ─────────────────────────────────────────────────────────────────

router.get('/templates', requireAuth, (req, res) => {
  res.json(db.templates.findAll());
});

router.post('/templates', requireAuth, (req, res) => {
  const { name, category, structure } = req.body;
  const tmpl = db.templates.create({ name, category, structure: JSON.stringify(structure || {}) });
  res.status(201).json(tmpl);
});

module.exports = router;
