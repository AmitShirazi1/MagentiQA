const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { audit } = require('../lib/audit');
const { requireAuth, requireRole } = require('../lib/auth');
const { versionUnitStats } = require('../lib/rollup');
const { deleteVersionCascade } = require('../lib/cascade');
const { DEFAULT_SETUP_TEXT } = require('../lib/setups');

/**
 * Version-view status counts, in **units**: each setup of a setup-tracked
 * verification is counted on its own (standard verifications count as one). No
 * PARTIAL bucket — setups resolve individually. `testCount` is the unit total.
 */
function statusCounts(versionId) {
  const u = versionUnitStats(versionId);
  return {
    testCount:  u.total,
    passed:     u.passed,
    failed:     u.failed,
    inProgress: u.inProgress,
    blocked:    u.blocked,
    notStarted: u.notStarted,
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
  // A rename must stay unique across projects (and non-empty).
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Project name cannot be empty' });
    const clash = db.projects.findOne({ name });
    if (clash && clash.id !== req.params.id) return res.status(409).json({ error: 'Project name taken' });
    req.body.name = name;
  }
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

  const result = versions.map(v => ({ ...v, ...statusCounts(v.id) }));
  res.json(result);
});

router.post('/:projectId/versions', requireAuth, (req, res) => {
  const { name, status } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const projectId = req.params.projectId;
  if (!db.projects.findById(projectId)) return res.status(404).json({ error: 'Project not found' });
  if (db.versions.findOne({ projectId, name })) return res.status(409).json({ error: 'Version name taken' });

  // The new version inherits from the previous version of this project — its
  // tests and its default setup. The first version of a project has no
  // predecessor and falls back to the standard setup text.
  const prevVersion = db.versions
    .query({ filter: { projectId }, sortBy: 'createdAt', sortDir: 'asc' })
    .pop();

  const version = db.versions.create({
    projectId,
    name,
    status: status || 'DRAFT',
    defaultSetup: prevVersion?.defaultSetup ?? DEFAULT_SETUP_TEXT,
  });
  audit(req.user.id, 'CREATE', 'versions', version.id, null, version, req);

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
  res.json({
    ...version,
    defaultSetup: version.defaultSetup ?? DEFAULT_SETUP_TEXT,   // pre-feature versions
    ...statusCounts(version.id),
    unitStats: versionUnitStats(version.id),
  });
});

router.put('/:projectId/versions/:versionId', requireAuth, (req, res) => {
  const before = db.versions.findById(req.params.versionId);
  if (!before) return res.status(404).json({ error: 'Not found' });
  // A rename must stay unique within the project (and non-empty).
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Version name cannot be empty' });
    const clash = db.versions.findOne({ projectId: before.projectId, name });
    if (clash && clash.id !== req.params.versionId) return res.status(409).json({ error: 'Version name taken' });
    req.body.name = name;
  }
  const updated = db.versions.update(req.params.versionId, req.body);
  audit(req.user.id, 'UPDATE', 'versions', req.params.versionId, before, updated, req);
  res.json(updated);
});

router.delete('/:projectId/versions/:versionId', requireAuth, requireRole('ADMIN'), (req, res) => {
  const before = db.versions.findById(req.params.versionId);
  if (!before) return res.status(404).json({ error: 'Not found' });
  // Cascade: version → its version-tests (+ their executions, signatures, evidence,
  // drafts and approvals) so nothing is left orphaned.
  db.transaction(() => deleteVersionCascade(req.params.versionId));
  audit(req.user.id, 'DELETE', 'versions', req.params.versionId, before, null, req);
  res.json({ ok: true });
});

module.exports = router;
