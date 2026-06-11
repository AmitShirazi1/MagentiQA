const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { audit } = require('../lib/audit');
const { requireAuth, requireRole } = require('../lib/auth');
const { effectiveStatus, versionUnitStats } = require('../lib/rollup');
const { deleteVersionCascade } = require('../lib/cascade');

/** Count version-tests by their effective (setup-rolled-up) status. */
function statusCounts(vTests) {
  const statuses = vTests.map(effectiveStatus);
  const count = s => statuses.filter(x => x === s).length;
  return {
    testCount:  vTests.length,
    passed:     count('PASSED'),
    partial:    count('PARTIAL'),
    failed:     count('FAILED'),
    inProgress: count('IN_PROGRESS'),
    blocked:    count('BLOCKED'),
    notStarted: count('NOT_STARTED'),
  };
}

// ── Projects ──────────────────────────────────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
  const projects = db.projects.query({ sortBy: 'name', sortDir: 'asc' });
  // Attach version count
  const result = projects.map(p => ({
    ...p,
    versionCount: db.versions.count({ projectId: p.id }),
  }));
  res.json(result);
});

router.post('/', requireAuth, (req, res) => {
  const { name, type, description, gitRepo, gitBranch } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type required' });
  if (db.projects.findOne({ name })) return res.status(409).json({ error: 'Project name taken' });

  const project = db.projects.create({ name, type, description, gitRepo, gitBranch: gitBranch || 'main' });
  audit(req.user.id, 'CREATE', 'projects', project.id, null, project, req);
  res.status(201).json(project);
});

router.get('/:id', requireAuth, (req, res) => {
  const project = db.projects.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

router.put('/:id', requireAuth, (req, res) => {
  const before = db.projects.findById(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  const updated = db.projects.update(req.params.id, req.body);
  audit(req.user.id, 'UPDATE', 'projects', req.params.id, before, updated, req);
  res.json(updated);
});

router.delete('/:id', requireAuth, requireRole('ADMIN'), (req, res) => {
  const before = db.projects.findById(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });

  // Cascade: project → versions (+ their version-tests, runs, approvals, sign-offs)
  db.transaction(() => {
    for (const version of db.versions.findAll({ projectId: req.params.id })) deleteVersionCascade(version.id);
    db.projects.delete(req.params.id);
  });

  audit(req.user.id, 'DELETE', 'projects', req.params.id, before, null, req);
  res.json({ ok: true });
});

// ── Versions ──────────────────────────────────────────────────────────────────

router.get('/:projectId/versions', requireAuth, (req, res) => {
  const versions = db.versions.query({
    filter: { projectId: req.params.projectId },
    sortBy: 'createdAt',
    sortDir: 'desc',
  });

  const result = versions.map(v => {
    const vTests = db.versionTests.findAll({ versionId: v.id });
    return { ...v, ...statusCounts(vTests) };
  });
  res.json(result);
});

router.post('/:projectId/versions', requireAuth, (req, res) => {
  const { name, status } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const projectId = req.params.projectId;
  if (!db.projects.findById(projectId)) return res.status(404).json({ error: 'Project not found' });
  if (db.versions.findOne({ projectId, name })) return res.status(409).json({ error: 'Version name taken' });

  const version = db.versions.create({ projectId, name, status: status || 'DRAFT' });
  audit(req.user.id, 'CREATE', 'versions', version.id, null, version, req);

  // Inherit tests from previous version
  const allVersions = db.versions.query({ filter: { projectId }, sortBy: 'createdAt', sortDir: 'asc' });
  const prevVersion = allVersions.filter(v => v.id !== version.id).pop();

  let inheritedCount = 0;
  if (prevVersion) {
    const prevTests = db.versionTests.findAll({ versionId: prevVersion.id });
    for (const pt of prevTests) {
      db.versionTests.create({
        versionId: version.id,
        testDefId: pt.testDefId,
        status: 'NOT_STARTED',
        workflowState: 'DRAFT',
        configurations: pt.configurations,
        assignedTo: pt.assignedTo,
      });
    }
    inheritedCount = prevTests.length;
    audit(req.user.id, 'CREATE', 'versions', version.id, null,
      { inherited: prevTests.length, fromVersion: prevVersion.name }, req);
  }

  res.status(201).json({ ...version, inheritedFrom: prevVersion?.name || null, inheritedCount });
});

router.get('/:projectId/versions/:versionId', requireAuth, (req, res) => {
  const version = db.versions.findById(req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Not found' });
  const vTests = db.versionTests.findAll({ versionId: version.id })
    .filter(vt => db.tests.findById(vt.testDefId));   // ignore links to deleted definitions
  res.json({ ...version, ...statusCounts(vTests), unitStats: versionUnitStats(version.id) });
});

router.put('/:projectId/versions/:versionId', requireAuth, (req, res) => {
  const before = db.versions.findById(req.params.versionId);
  if (!before) return res.status(404).json({ error: 'Not found' });
  const updated = db.versions.update(req.params.versionId, req.body);
  audit(req.user.id, 'UPDATE', 'versions', req.params.versionId, before, updated, req);
  res.json(updated);
});

module.exports = router;
