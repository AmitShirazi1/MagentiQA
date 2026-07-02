// public/js/pages/tests.js — Version detail, verifications library, execute views

// Status badge for a verification row. Setup-tracked verifications append a
// setup count so a partially-covered verification reads clearly:
//   In Progress 2/3  → 2 of 3 setups executed (rest still pending)
//   Partial 1/3      → all executed, only 1 passed (others failed/blocked)
//   Passed 3/3       → every setup passed
function statusBadgeWithCount(vt) {
  const b = badge(vt.status);
  const c = vt.versionCoverage;
  if (!c || !c.total) return b;
  const inProgress = vt.status === 'IN_PROGRESS';
  const n = inProgress ? c.executed : c.covered;
  const hint = inProgress ? 'setups executed' : 'setups passed';
  return `${b} <span class="text-muted text-sm tabular" title="${n}/${c.total} ${hint}">${n}/${c.total}</span>`;
}

// ── Version-view unit helpers ─────────────────────────────────────────────────
// The version view counts *units*: a standard verification is one unit; each
// setup of a setup-tracked verification is its own unit. These helpers keep the
// hierarchical list, the KPI filters and the counts speaking the same vocabulary
// (PASSED / FAILED / BLOCKED / IN_PROGRESS / NOT_STARTED — no PARTIAL at the unit
// level; PARTIAL survives only as a setup-tracked verification's rolled-up badge).
function unitKey(status) {
  return ['PASSED', 'FAILED', 'BLOCKED', 'IN_PROGRESS'].includes(status) ? status : 'NOT_STARTED';
}
// A verification's units as sent by the API (fallback: treat as a single unit).
function vtUnits(vt) {
  return Array.isArray(vt.units) && vt.units.length
    ? vt.units : [{ setupId: null, status: vt.status || 'NOT_STARTED' }];
}
// A setup-tracked verification shown as an expandable parent (has ≥1 setup unit).
function vtIsTracked(vt) {
  return vt.test?.type === 'SETUP_TRACKED' && Array.isArray(vt.units) && vt.units.length > 0;
}
function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s); }
function setupDetailFrom(data) {
  if (!data || typeof data !== 'object') return '';
  // Prefer the descriptive "Setup Details" column; the id column is already shown.
  for (const k of Object.keys(data)) {
    if (/setup\s*details?/i.test(k) && String(data[k] ?? '').trim()) return String(data[k]).trim();
  }
  const vals = Object.values(data).map(v => String(v ?? '').trim()).filter(Boolean);
  return vals[0] || '';
}

// Execute button whose label tracks the status; a setupId deep-links to that setup.
function vdExecBtn(vt, versionId, projectId, status, setupId) {
  const extra = setupId ? `,setupId:'${esc(setupId)}'` : '';
  return `<button class="btn-secondary btn-sm" onclick="navigate('test-execute',{versionTestId:'${vt.id}',versionId:'${versionId}',projectId:'${projectId}'${extra}})">${ICONS.play} ${execActionLabel(status)}</button>`;
}
// Verification-level manage actions (reset / unlink) — never per-setup.
function vdManageBtns(vt, versionId, projectId, started) {
  const title = esc(vt.test?.title || '');
  return `${started ? `<button class="icon-btn" title="Reset to Not Started (deletes this version's executions)" aria-label="Reset verification to Not Started" onclick="resetVerification('${projectId}','${versionId}','${vt.id}','${title}')">${ICONS.reset}</button>` : ''}
    <button class="icon-btn" title="Unlink from this version" aria-label="Unlink verification from this version" onclick="unlinkVerification('${projectId}','${versionId}','${vt.id}','${title}')">${ICONS.unlink}</button>`;
}

// Table row(s) for one verification: a leaf row for standard tests, or an
// expandable parent + one nested sub-row per setup for setup-tracked tests.
function vdRowsFor(vt, versionId, projectId) {
  const units = vtUnits(vt);
  const tags = (vt.test?.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join(' ');
  const titleLink = `<span class="clickable-title" onclick="openTestContentModal('${vt.id}','${versionId}')">${esc(vt.test?.title || '—')}</span>`;

  if (!vtIsTracked(vt)) {
    const st = units[0].status;
    const started = unitKey(st) !== 'NOT_STARTED';
    return `
      <tr class="vd-top vd-leaf" data-vt="${vt.id}" data-status="${unitKey(st)}">
        <td class="mono">${esc(vt.test?.testId || '—')}</td>
        <td class="vd-title" title="${esc(vt.test?.title || '')}">${titleLink}</td>
        <td><div class="vd-actions">${vdExecBtn(vt, versionId, projectId, st, null)} ${vdManageBtns(vt, versionId, projectId, started)}</div></td>
        <td>${tags}</td>
        <td data-sort="${unitKey(st)}">${badge(st)}</td>
        <td class="t-meta" data-sort="${vt.lastExecutedAt || ''}">${relTime(vt.lastExecutedAt)}</td>
      </tr>`;
  }

  const statusesAttr = [...new Set(units.map(u => unitKey(u.status)))].join(' ');
  const started = units.some(u => unitKey(u.status) !== 'NOT_STARTED');
  const parent = `
      <tr class="vd-top vd-parent" data-vt="${vt.id}" data-unit-statuses="${statusesAttr}">
        <td class="mono">
          <button class="vd-disclosure" onclick="toggleSetupRows('${vt.id}')" aria-label="Show setups" title="Show setups">${ICONS.chevR}</button>
          ${esc(vt.test?.testId || '—')}
        </td>
        <td class="vd-title" title="${esc(vt.test?.title || '')}">${titleLink}</td>
        <td><div class="vd-actions">${vdExecBtn(vt, versionId, projectId, vt.status, null)} ${vdManageBtns(vt, versionId, projectId, started)}</div></td>
        <td>${tags}</td>
        <td data-sort="${esc(vt.status || '')}">${statusBadgeWithCount(vt)}</td>
        <td class="t-meta" data-sort="${vt.lastExecutedAt || ''}">${relTime(vt.lastExecutedAt)}</td>
      </tr>`;
  const kids = units.map(u => {
    const detail = setupDetailFrom(u.setupData);
    return `
      <tr class="vd-setup-row" data-parent="${vt.id}" data-status="${unitKey(u.status)}" style="display:none">
        <td class="mono vd-setup-id">${esc(u.setupId || '—')}</td>
        <td class="vd-setup-detail" title="${esc(detail)}">${detail ? esc(detail) : '<span class="text-muted">—</span>'}</td>
        <td><div class="vd-actions">${vdExecBtn(vt, versionId, projectId, u.status, u.setupId)}</div></td>
        <td>${u.testerName ? `<span class="t-meta">${esc(u.testerName)}</span>` : ''}</td>
        <td data-sort="${unitKey(u.status)}">${badge(u.status)}</td>
        <td class="t-meta" data-sort="${u.lastExecutedAt || ''}">${relTime(u.lastExecutedAt)}</td>
      </tr>`;
  }).join('');
  return parent + kids;
}

// ── Version Detail ────────────────────────────────────────────────────────────
async function renderVersionDetail(params = {}) {
  const { projectId, versionId } = params;
  const el = document.getElementById('page-version-detail');
  el.innerHTML = skeletonPage();

  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
  el.classList.remove('hidden'); el.classList.add('active');
  // Version detail lives under Projects in the nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === 'projects'));

  try {
    const [version, vTests] = await Promise.all([
      API.projects.getVersion(projectId, versionId),
      API.tests.forVersion(versionId),
    ]);

    // Group by primary tag, then uncategorized
    const byTag = {};
    for (const vt of vTests) {
      const tags = vt.test?.tags || [];
      const group = tags[0] || 'uncategorized';
      if (!byTag[group]) byTag[group] = [];
      byTag[group].push(vt);
    }

    // A fresh visit starts unfiltered.
    _vdFilter = null;

    // KPI cards double as status filters. They count *units* (each setup on its
    // own), matching the Execution Progress bar exactly — no Partial at unit level.
    const statsHtml = `
      <div class="kpi-grid" id="vd-kpis">
        ${kpiCard('Total', version.testCount,        { filter: true, status: 'ALL',         selected: true })}
        ${kpiCard('Not Started', version.notStarted, { tone: 'neutral', filter: true, status: 'NOT_STARTED' })}
        ${kpiCard('In Progress', version.inProgress, { tone: 'info',    filter: true, status: 'IN_PROGRESS' })}
        ${kpiCard('Blocked', version.blocked || 0,   { tone: 'blocked', filter: true, status: 'BLOCKED' })}
        ${kpiCard('Failed', version.failed,          { tone: 'fail',    filter: true, status: 'FAILED', alert: version.failed > 0 })}
        ${kpiCard('Passed', version.passed,          { tone: 'pass',    filter: true, status: 'PASSED' })}
      </div>
      <div class="card mb-16">
        <div class="card-header"><span class="card-title">Execution Progress</span></div>
        ${progressOverview(version.unitStats || {})}
      </div>`;

    const testsByTag = Object.entries(byTag).sort(([a], [b]) => a.localeCompare(b)).map(([tag, tests], gi) => {
      const groupUnits = tests.flatMap(vtUnits);
      const groupPassed = groupUnits.filter(u => unitKey(u.status) === 'PASSED').length;
      return `
      <div class="card flush mb-16 test-group">
        <div class="card-header collapsible-header open" onclick="toggleTestGroup(this, 'tg-${gi}')">
          <span class="collapsible-arrow">${ICONS.chevR}</span>
          <span class="card-title"><span class="path-crumb">${esc(tag)}</span></span>
          <span class="t-meta ml-auto tabular">${groupPassed}/${groupUnits.length} passed</span>
        </div>
        <div class="table-wrap" id="tg-${gi}">
          <table class="vd-table">
            <colgroup>
              <col class="vd-col-id">
              <col class="vd-col-title">
              <col class="vd-col-actions">
              <col class="vd-col-tags">
              <col class="vd-col-status">
              <col class="vd-col-lastrun">
            </colgroup>
            <thead><tr>
              ${sortableTH('ID')}
              ${sortableTH('Title')}
              <th>Actions</th>
              <th>Tags</th>
              ${sortableTH('Status')}
              ${sortableTH('Last Run')}
            </tr></thead>
            <tbody>
              ${tests.map(vt => vdRowsFor(vt, versionId, projectId)).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="page-header">
        <div>
          <div class="breadcrumbs">
            <a href="#/projects" onclick="navigate('projects');return false">Projects</a>
            ${ICONS.chevR}
            <a href="#" onclick="navigate('project-versions',{projectId:'${projectId}'});return false">Versions</a>
            ${ICONS.chevR}
            <span>${esc(version.name)}</span>
          </div>
          <h1 style="display:flex;align-items:center;gap:12px">${esc(version.name)} ${badge(version.status)}</h1>
          <p class="subtitle">${vTests.length} verification${vTests.length === 1 ? '' : 's'}${version.testCount !== vTests.length ? ` · ${version.testCount} execution units (setups counted individually)` : ''} in this version</p>
          <div class="vd-setup-toggle" onclick="toggleTestGroup(this,'vd-setup')">
            <span class="collapsible-arrow">${ICONS.chevR}</span>
            <span>Default Setup</span>
          </div>
          <div class="vd-setup-body hidden" id="vd-setup">${esc(version.defaultSetup || '')}</div>
        </div>
        <div class="btn-row">
          <button class="btn-secondary" onclick="openAddTestToVersionModal('${versionId}','${projectId}')">${ICONS.plus} Add Test</button>
          <button class="btn-secondary" title="Download the PDF report (results + approvals)" onclick="downloadReportPdf('${versionId}')">${ICONS.download} Download PDF</button>
          <button class="btn-secondary" title="Export the PDF report to Google Drive" onclick="exportReportPdfToDrive('${versionId}', this)">${ICONS.upload} PDF to Drive</button>
          <button class="btn-secondary" title="Export blank verification templates (no results) to Google Drive" onclick="exportTemplatesToDrive('${versionId}', this)">${ICONS.upload} Templates to Drive</button>
          <button class="btn-secondary" onclick="requestVersionApproval('${versionId}', this)">${ICONS.sign} Request approval</button>
          <button class="btn-secondary" onclick="openEditVersionModal('${projectId}','${versionId}')">${ICONS.edit} Edit version</button>
        </div>
      </div>
      <div class="page-body">
        ${statsHtml}
        ${vTests.length === 0
          ? emptyState('No tests in this version', 'Add tests from the library or import verification files.', {
              action: { label: 'Add Test', onclick: `openAddTestToVersionModal('${versionId}','${projectId}')` },
            })
          : testsByTag}
      </div>`;

    // Arriving from the main dashboard with a status pre-selected.
    if (params.status && params.status !== 'ALL') filterVersionTests(params.status);
  } catch (err) {
    el.innerHTML = `<div class="page-body"><div class="form-error">${ICONS.alert} ${esc(err.message)}</div></div>`;
  }
}

// Unlink a verification from this version — drops the link (and its runs in this
// Execute-button label reflects how far along the verification is:
//   Not Started            → Execute
//   In Progress / Blocked  → Continue
//   Passed/Failed/Partial  → Re-execute (a finished run; start a fresh attempt)
function execActionLabel(status) {
  if (status === 'IN_PROGRESS' || status === 'BLOCKED') return 'Continue';
  if (status === 'PASSED' || status === 'FAILED' || status === 'PARTIAL') return 'Re-execute';
  return 'Execute';
}

// Reset a verification to NOT_STARTED, deleting its executions/signatures/evidence
// for this version (a clean slate). Server-gated to ADMIN / QA_ENGINEER.
async function resetVerification(projectId, versionId, vtId, title) {
  const ok = await confirmDialog('Reset verification to Not Started?',
    `This permanently deletes “${title}”’s executions, signatures and uploaded evidence in this version, returning it to Not Started. The verification definition and its other versions are untouched. This cannot be undone. Continue?`,
    { confirmLabel: 'Reset', danger: true });
  if (!ok) return;
  try {
    await API.tests.resetVT(versionId, vtId);
    toast('Verification reset to Not Started', 'info');
    renderVersionDetail({ projectId, versionId });
  } catch (err) { toast(err.message, 'error'); }
}

// version) without touching the verification definition in the library.
async function unlinkVerification(projectId, versionId, vtId, title) {
  const ok = await confirmDialog('Unlink verification from this version?',
    `“${title}” will be removed from this version, along with its executions and signatures in this version. The verification stays in the library and in other versions. Continue?`,
    { confirmLabel: 'Unlink' });
  if (!ok) return;
  try {
    await API.tests.removeFromVersion(versionId, vtId);
    toast('Verification unlinked from this version', 'info');
    renderVersionDetail({ projectId, versionId });
  } catch (err) { toast(err.message, 'error'); }
}

// Request a version-level sign-off (the report approval). Approvers resolve it
// on the Approvals page; the auto-trigger also requests one at 100% coverage.
async function requestVersionApproval(versionId, btn) {
  try {
    await API.requestVersionApproval(versionId);
    toast('Approval requested — awaiting sign-off', 'success');
    if (btn) btn.disabled = true;
  } catch (err) {
    toast(err.message, err.message && /already pending/i.test(err.message) ? 'info' : 'error');
  }
}

function toggleTestGroup(header, bodyId) {
  const body = document.getElementById(bodyId);
  const isOpen = header.classList.toggle('open');
  if (body) body.classList.toggle('hidden', !isOpen);
}

// ── Setup expand/collapse ─────────────────────────────────────────────────────
// Setup-tracked verifications render as a parent row with nested setup sub-rows.
// A sub-row is visible when its parent is expanded and it matches any active
// filter. Parents collapse by default; a status filter auto-expands matches.
function setupChildrenOf(vtId) {
  return document.querySelectorAll(`#page-version-detail tr.vd-setup-row[data-parent="${cssEsc(vtId)}"]`);
}
function showSetupChildren(vtId, open) {
  setupChildrenOf(vtId).forEach(k => {
    const match = !_vdFilter || k.dataset.status === _vdFilter;
    k.style.display = (open && match) ? '' : 'none';
  });
}
function toggleSetupRows(vtId) {
  const parent = document.querySelector(`#page-version-detail tr.vd-parent[data-vt="${cssEsc(vtId)}"]`);
  if (!parent) return;
  const open = !parent.classList.contains('expanded');
  parent.classList.toggle('expanded', open);
  showSetupChildren(vtId, open);
}

// ── Version dashboard status filter ───────────────────────────────────────────
// Clicking a KPI card filters the grouped verification tables below by unit
// status. A standard verification matches its own status; a setup-tracked one
// matches (and auto-expands, showing only the matching setups) when any of its
// setups is in that status. 'ALL' (Total) clears; re-clicking the filter clears.
let _vdFilter = null;

function filterVersionTests(status) {
  _vdFilter = (status === 'ALL' || status === _vdFilter) ? null : status;

  document.querySelectorAll('#vd-kpis .kpi-card').forEach(c => {
    const s = c.dataset.status;
    c.classList.toggle('selected', _vdFilter ? s === _vdFilter : s === 'ALL');
  });

  const page = document.getElementById('page-version-detail');
  if (!page) return;
  page.querySelectorAll('tr.vd-top').forEach(top => {
    if (top.classList.contains('vd-parent')) {
      const statuses = (top.dataset.unitStatuses || '').split(' ').filter(Boolean);
      const show = !_vdFilter || statuses.includes(_vdFilter);
      top.style.display = show ? '' : 'none';
      const open = show && !!_vdFilter;   // auto-expand to reveal the matching setups
      top.classList.toggle('expanded', open);
      showSetupChildren(top.dataset.vt, open);
    } else {
      top.style.display = (!_vdFilter || top.dataset.status === _vdFilter) ? '' : 'none';
    }
  });
  // Collapse tag groups left with no matching verification under the active
  // filter (check top-level rows — parents have no data-status of their own).
  page.querySelectorAll('.test-group').forEach(g => {
    const anyVisible = [...g.querySelectorAll('tr.vd-top')]
      .some(tr => tr.style.display !== 'none');
    g.style.display = anyVisible ? '' : 'none';
  });
}

// Show full content of a test (usable for passed tests and for "View")
async function openTestContentModal(vtId, versionId) {
  try {
    const vTests = await API.tests.forVersion(versionId);
    const vt = vTests.find(v => v.id === vtId);
    if (!vt) { toast('Test not found', 'error'); return; }
    const test = vt.test;
    const execs = await API.executions.list(vtId);
    const lastExec = execs[0];

    let stepResultMap = {};
    if (lastExec) {
      const full = await API.executions.get(lastExec.id);
      for (const sr of full.stepResults || []) stepResultMap[sr.stepId] = sr;
    }

    const metaFields = [
      ['Configuration', test?.configuration],
      ['Files', test?.files],
      ['Pre conditions', test?.preconditions],
      ['Notes', test?.notes],
    ].filter(([, v]) => v).map(([k, v]) => `
      <div class="field-group">
        <label>${k}</label>
        <div class="text-sm text-secondary" style="padding:2px 0;line-height:1.55;white-space:pre-wrap">${esc(v)}</div>
      </div>`).join('');

    const stepsHtml = (test?.steps || []).map((s, i) => {
      const sr = stepResultMap[s.id] || {};
      const res = sr.result || '—';
      return `<tr>
        <td class="mono">${s.order || i + 1}</td>
        <td>${esc(s.action)}</td>
        <td class="text-secondary">${esc(s.expectedResult || '—')}</td>
        <td>${res === '—' ? '<span class="text-muted">—</span>' : badge(res)}</td>
        <td class="text-secondary">${esc(sr.actual || '—')}</td>
      </tr>`;
    }).join('');

    openModal(`${test?.testId} — ${test?.title}`, `
      ${test?.description ? `<p class="text-secondary" style="margin:0 0 14px;line-height:1.55;white-space:pre-wrap">${esc(test.description)}</p>` : ''}
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
        ${badge(vt.status)}
        ${(test?.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
      </div>
      ${metaFields}
      ${test?.type === 'SETUP_TRACKED' ? `
        <div class="divider"></div>
        <h4 class="h-card" style="margin-bottom:10px">Setups</h4>
        ${setupMatrixHtml(test)}` : ''}
      ${test?.steps?.length ? `
        <div class="divider"></div>
        <h4 class="h-card" style="margin-bottom:10px">Steps</h4>
        <div style="overflow-x:auto;max-height:320px;overflow-y:auto;border:1px solid var(--border-subtle);border-radius:var(--radius)">
          <table class="steps-table">
            <thead><tr><th>#</th><th>Action</th><th>Expected Result</th><th>Result</th><th>Actual / Note</th></tr></thead>
            <tbody>${stepsHtml}</tbody>
          </table>
        </div>` : ''}
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeModal()">Close</button>
      </div>`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openEditVersionModal(projectId, versionId) {
  const v = await API.projects.getVersion(projectId, versionId);
  const labels = { DRAFT: 'Draft', IN_VERIFICATION: 'In Verification', VERIFIED: 'Verified', RELEASED: 'Released', OBSOLETE: 'Obsolete' };
  openModal('Edit Version', `
    <div class="field-group">
      <label for="vs-name">Version Name</label>
      <input type="text" id="vs-name" value="${esc(v.name)}">
    </div>
    <div class="field-group">
      <label for="vs-status">Status</label>
      <select id="vs-status">
        ${Object.entries(labels).map(([s, l]) =>
          `<option value="${s}" ${s === v.status ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="field-group">
      <label for="vs-setup">Default Setup <span class="label-hint">shown on the opening page of the verification report; new versions inherit it from the previous version</span></label>
      <textarea id="vs-setup" rows="12">${esc(v.defaultSetup || '')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveVersion('${projectId}','${versionId}')">Save Changes</button>
    </div>`);
}

async function saveVersion(projectId, versionId) {
  const name = document.getElementById('vs-name').value.trim();
  const status = document.getElementById('vs-status').value;
  const defaultSetup = document.getElementById('vs-setup').value;
  if (!name) { toast('Version name required', 'error'); return; }
  try {
    await API.projects.updateVersion(projectId, versionId, { name, status, defaultSetup });
    closeModal();
    toast('Version updated', 'success');
    // Stay where the edit was launched from: the project's version list or the
    // version detail page.
    if (currentPage === 'project-versions') openProjectVersions(projectId);
    else navigate('version-detail', { projectId, versionId });
  } catch (err) { toast(err.message, 'error'); }
}

async function openAddTestToVersionModal(versionId, projectId) {
  const tests = await API.tests.list();
  const linked = await API.tests.forVersion(versionId);
  const linkedIds = linked.map(vt => vt.testDefId);
  const available = tests.filter(t => !linkedIds.includes(t.id));

  openModal('Add Test to Version', `
    <div class="field-group">
      <label for="add-test-filter">Search</label>
      <input type="text" id="add-test-filter" placeholder="Filter by title, ID or path…" oninput="filterAddTestList()">
    </div>
    <div class="field-group">
      <label for="add-test-select">Select Test</label>
      <select id="add-test-select" size="8" style="height:220px">
        ${available.map(t => `<option value="${t.id}" data-text="${esc((t.testId + ' ' + t.title + ' ' + (t.path || '')).toLowerCase())}">[${esc(t.testId)}] ${esc(t.title)} — ${esc(t.path)}</option>`).join('')}
      </select>
    </div>
    ${available.length === 0 ? '<p class="text-muted text-sm">All tests are already in this version.</p>' : ''}
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="addTestToVersion('${versionId}','${projectId}')">Add to Version</button>
    </div>`);
}

function filterAddTestList() {
  const q = document.getElementById('add-test-filter').value.trim().toLowerCase();
  document.querySelectorAll('#add-test-select option').forEach(o => {
    o.hidden = q && !(o.dataset.text || '').includes(q);
  });
}

async function addTestToVersion(versionId, projectId) {
  const sel = document.getElementById('add-test-select');
  const testDefId = sel?.value;
  if (!testDefId) { toast('Select a test', 'error'); return; }
  try {
    await API.tests.addToVersion(versionId, { testDefId });
    closeModal();
    toast('Test added', 'success');
    navigate('version-detail', { projectId, versionId });
  } catch (err) { toast(err.message, 'error'); }
}

// Re-render whichever verification list is currently visible (the library or
// the Setup Trackers page), so edits made from a shared modal stay in sync.
function afterTestMutation() {
  if (document.getElementById('page-trackers')?.classList.contains('active')) {
    if (typeof renderTrackers === 'function') return renderTrackers();
  }
  renderTests();
}

// ── Verifications Library ─────────────────────────────────────────────────────
async function renderTests(params = {}) {
  const el = document.getElementById('page-tests');
  el.innerHTML = skeletonPage();

  try {
    const tests = await API.tests.list();

    el.innerHTML = `
      <div class="page-header">
        <div><h1>Verifications Library</h1><p class="subtitle">${tests.length} verification definition${tests.length === 1 ? '' : 's'}</p></div>
        <button class="btn-primary" onclick="openNewTestModal()">${ICONS.plus} New Verification</button>
      </div>
      <div class="toolbar">
        <div class="search-bar">
          ${ICONS.search}
          <input type="text" id="test-search" placeholder="Search verifications…" value="${esc(params.search || '')}" oninput="debounceFilterTests()">
        </div>
        <select id="test-path-filter" onchange="filterTestLibrary()" style="max-width:220px;width:auto">
          <option value="">All paths</option>
          ${[...new Set(tests.map(t => t.path).filter(Boolean))].sort().map(p =>
            `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
        </select>
        <button class="btn-ghost ml-auto" onclick="window.open(API.exportTests(),'_blank')">${ICONS.download} Export JSON</button>
      </div>
      <div class="bulk-bar hidden" id="vt-bulkbar">
        <span class="bulk-count"><b id="vt-sel-count">0</b> selected</span>
        <div class="btn-row" style="margin-left:auto">
          <button class="btn-secondary btn-sm" onclick="openBulkAddToVersion()">${ICONS.plus} Add to version</button>
          <button class="btn-secondary btn-sm" onclick="openBulkRemoveFromVersion()">Remove from version</button>
          <button class="btn-danger btn-sm" onclick="bulkDeleteTests()">${ICONS.trash} Delete</button>
          <button class="btn-ghost btn-sm" onclick="clearVerifSelection()">Clear</button>
        </div>
      </div>
      <div class="page-body">
        <div id="test-library-table">
          ${renderTestTable(tests)}
        </div>
      </div>`;

    // Apply deep-linked search (e.g. arriving from global search)
    if (params.search) filterTestLibrary();
  } catch (err) {
    el.innerHTML = `<div class="page-body"><div class="form-error">${ICONS.alert} ${esc(err.message)}</div></div>`;
  }
}

function renderTestTable(tests) {
  if (!tests.length) return emptyState('No verifications found', 'Import verification files or create definitions manually.', {
    action: { label: 'New Verification', onclick: 'openNewTestModal()' },
  });
  return `
    <div class="card flush">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="width:34px"><input type="checkbox" id="vt-check-all" title="Select all" onclick="toggleAllVerifs(this)"></th>
            ${sortableTH('Test ID')}
            ${sortableTH('Title')}
            <th style="width:84px">Actions</th>
            <th>Type</th>
            <th>Tags</th>
            ${sortableTH('Steps')}
          </tr></thead>
          <tbody>
            ${tests.map(t => `
              <tr>
                <td><input type="checkbox" class="vt-check" value="${t.id}" onclick="onVerifSelect()"></td>
                <td class="mono">${esc(t.testId)}</td>
                <td>
                  <div class="clickable-title" onclick="openEditTestModal('${t.id}')">${esc(t.title)}</div>
                  ${t.description ? `<div class="text-muted text-sm" style="margin-top:2px">${esc(trunc(t.description))}</div>` : ''}
                </td>
                <td>
                  <div style="display:flex;gap:2px;flex-wrap:nowrap">
                    <button class="icon-btn" title="Edit" aria-label="Edit verification" onclick="openEditTestModal('${t.id}')">${ICONS.edit}</button>
                    <button class="icon-btn" title="Delete" aria-label="Delete verification" style="color:var(--fail)" onclick="deleteTest('${t.id}')">${ICONS.trash}</button>
                  </div>
                </td>
                <td>${t.type === 'SETUP_TRACKED'
                  ? `<span class="tag">Setup-tracked</span> <span class="text-muted text-sm tabular">${(t.setupCoverage?.passed || 0)}/${(t.setupCoverage?.total || 0)}</span>`
                  : '<span class="text-muted text-sm">Standard</span>'}</td>
                <td>${(t.tags || []).slice(0, 4).map(tag => `<span class="tag">${esc(tag)}</span>`).join(' ')}</td>
                <td class="tabular">${(t.steps || []).length}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

let _testFilterTimer = null;
function debounceFilterTests() {
  clearTimeout(_testFilterTimer);
  _testFilterTimer = setTimeout(filterTestLibrary, 250);
}

async function filterTestLibrary() {
  const search = document.getElementById('test-search')?.value || '';
  const path   = document.getElementById('test-path-filter')?.value || '';
  const target = document.getElementById('test-library-table');
  target.innerHTML = skeletonTable(5);
  const tests = await API.tests.list({ search, path });
  target.innerHTML = renderTestTable(tests);
  onVerifSelect();   // selection resets on re-render — refresh the bulk bar
}

// ── Bulk operations (Verifications library) ──────────────────────────────────
function selectedTestIds() {
  return [...document.querySelectorAll('#test-library-table .vt-check:checked')].map(c => c.value);
}

// Reflect the current selection in the bulk bar + the select-all checkbox state.
function onVerifSelect() {
  const ids   = selectedTestIds();
  const boxes = document.querySelectorAll('#test-library-table .vt-check');
  const bar   = document.getElementById('vt-bulkbar');
  const count = document.getElementById('vt-sel-count');
  if (count) count.textContent = ids.length;
  if (bar)   bar.classList.toggle('hidden', ids.length === 0);
  const all = document.getElementById('vt-check-all');
  if (all) {
    all.checked = boxes.length > 0 && ids.length === boxes.length;
    all.indeterminate = ids.length > 0 && ids.length < boxes.length;
  }
}

function toggleAllVerifs(cb) {
  document.querySelectorAll('#test-library-table .vt-check').forEach(c => { c.checked = cb.checked; });
  onVerifSelect();
}

function clearVerifSelection() {
  document.querySelectorAll('#test-library-table .vt-check').forEach(c => { c.checked = false; });
  onVerifSelect();
}

async function bulkDeleteTests() {
  const ids = selectedTestIds();
  if (!ids.length) return;
  const ok = await confirmDialog('Delete verifications?',
    `Permanently delete ${ids.length} verification${ids.length === 1 ? '' : 's'} and their definitions (and unlink them from every version)? This cannot be undone.`,
    { confirmLabel: 'Delete' });
  if (!ok) return;
  let done = 0, fail = 0;
  for (const id of ids) { try { await API.tests.delete(id); done++; } catch { fail++; } }
  toast(`Deleted ${done} verification${done === 1 ? '' : 's'}${fail ? `, ${fail} failed` : ''}`, fail ? 'info' : 'success');
  renderTests();
}

const openBulkAddToVersion      = () => openBulkVersionModal('add');
const openBulkRemoveFromVersion = () => openBulkVersionModal('remove');

// Version picker (grouped by project) for bulk link / unlink.
async function openBulkVersionModal(mode) {
  const ids = selectedTestIds();
  if (!ids.length) { toast('Select verifications first', 'error'); return; }
  try {
    const projects = await API.projects.list();
    let groups = '';
    for (const p of projects) {
      const versions = await API.projects.versions(p.id);
      if (!versions.length) continue;
      groups += `<optgroup label="${esc(p.name)}">` +
        versions.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('') +
        `</optgroup>`;
    }
    const verb = mode === 'add' ? 'Add to version' : 'Remove from version';
    openModal(verb, `
      <p class="text-sm text-secondary" style="margin-bottom:12px">${ids.length} verification${ids.length === 1 ? '' : 's'} selected.</p>
      <div class="field-group">
        <label for="bulk-version">Version <span class="label-hint">grouped by project</span></label>
        <select id="bulk-version">${groups || '<option value="">No versions available</option>'}</select>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="${mode === 'add' ? 'btn-primary' : 'btn-danger'}" onclick="submitBulkVersion('${mode}')">${verb}</button>
      </div>`);
  } catch (err) { toast(err.message, 'error'); }
}

async function submitBulkVersion(mode) {
  const vid = document.getElementById('bulk-version')?.value;
  const ids = selectedTestIds();
  if (!vid || !ids.length) { closeModal(); return; }
  try {
    const linked = await API.tests.forVersion(vid);
    if (mode === 'add') {
      const have = new Set(linked.map(vt => vt.testDefId));
      let added = 0, skipped = 0;
      for (const id of ids) {
        if (have.has(id)) { skipped++; continue; }
        try { await API.tests.addToVersion(vid, { testDefId: id }); added++; } catch { /* skip */ }
      }
      toast(`Linked ${added} to the version${skipped ? `, ${skipped} already linked` : ''}`, 'success');
    } else {
      const vtByTest = new Map(linked.map(vt => [vt.testDefId, vt.id]));
      let removed = 0, missing = 0;
      for (const id of ids) {
        const vtId = vtByTest.get(id);
        if (!vtId) { missing++; continue; }
        try { await API.tests.removeFromVersion(vid, vtId); removed++; } catch { /* skip */ }
      }
      toast(`Unlinked ${removed} from the version${missing ? `, ${missing} weren't linked` : ''}`, 'success');
    }
    closeModal();
    clearVerifSelection();
  } catch (err) { toast(err.message, 'error'); }
}

function openNewTestModal(opts = {}) {
  const presetTracked = opts.type === 'SETUP_TRACKED';
  openModal('New Verification Definition', `
    <div class="form-grid">
      <div class="field-group span-2">
        <label>Verification type</label>
        <div class="type-toggle">
          <label class="type-opt"><input type="radio" name="nt-type" value="STANDARD" ${presetTracked ? '' : 'checked'} onchange="toggleNewTestType()"> Standard</label>
          <label class="type-opt"><input type="radio" name="nt-type" value="SETUP_TRACKED" ${presetTracked ? 'checked' : ''} onchange="toggleNewTestType()"> Setup-tracked <span class="label-hint">runs across multiple setups</span></label>
        </div>
      </div>
      <div class="field-group span-2">
        <label for="nt-title">Title</label>
        <input type="text" id="nt-title" placeholder="e.g. Logo + Version Appearance" required>
      </div>
      <div class="field-group">
        <label for="nt-path">Path <span class="label-hint">subject folder</span></label>
        <input type="text" id="nt-path" placeholder="features/appearances">
      </div>
      <div class="field-group">
        <label for="nt-tags">Tags <span class="label-hint">comma-separated</span></label>
        <input type="text" id="nt-tags" placeholder="ui, logo, appearance">
      </div>
      <div class="field-group span-2">
        <label for="nt-config">Configuration</label>
        <textarea id="nt-config" rows="2"></textarea>
      </div>
      <div class="field-group span-2">
        <label for="nt-files">Files</label>
        <textarea id="nt-files" rows="1"></textarea>
      </div>
      <div class="field-group span-2">
        <label for="nt-desc">Description</label>
        <textarea id="nt-desc" rows="2"></textarea>
      </div>
      <div class="field-group span-2">
        <label for="nt-precond">Pre conditions</label>
        <textarea id="nt-precond" rows="2"></textarea>
      </div>
      <div class="field-group span-2">
        <label for="nt-notes">Notes</label>
        <textarea id="nt-notes" rows="2"></textarea>
      </div>
    </div>
    <div class="divider"></div>
    <h4 class="h-card" style="margin-bottom:10px">Test Steps</h4>
    <div id="nt-steps-list"></div>
    <button class="btn-ghost" onclick="addStepRow('nt-steps-list')">${ICONS.plus} Add Step</button>

    <div id="nt-setup-section" class="${presetTracked ? '' : 'hidden'}">
      <div class="divider"></div>
      <h4 class="h-card" style="margin-bottom:6px">Setups</h4>
      <p class="text-muted text-sm" style="margin-bottom:10px">Each row is one setup/condition this verification must be performed under. Columns are free-form; a <span class="mono">Status</span> column tracks coverage.</p>
      <div id="nt-setup-editor"></div>
    </div>

    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="createTest()">Create Verification</button>
    </div>`, { onOpen: () => {
      addStepRow('nt-steps-list');
      initSetupModel([], []);   // fresh editor model for this modal (no stale rows)
      if (presetTracked) { setupAddRow(); renderSetupEditor('nt-setup-editor'); }
    } });
}

function toggleNewTestType() {
  const tracked = document.querySelector('input[name="nt-type"]:checked')?.value === 'SETUP_TRACKED';
  document.getElementById('nt-setup-section').classList.toggle('hidden', !tracked);
  if (tracked && !_setupModel.rows.length) setupAddRow();   // seed one empty setup row
  if (tracked) renderSetupEditor('nt-setup-editor');
}

function addStepRow(containerId) {
  const container = document.getElementById(containerId);
  const idx = container.children.length;
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:32px 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:start';
  row.innerHTML = `
    <span class="mono" style="padding-top:9px;color:var(--text-muted)">${idx + 1}.</span>
    <input type="text" placeholder="Action / step description" class="step-action">
    <input type="text" placeholder="Expected result" class="step-expected">
    <button class="icon-btn" aria-label="Remove step" onclick="this.parentElement.remove();renumberSteps('${containerId}')">${ICONS.trash}</button>`;
  container.appendChild(row);
  row.querySelector('.step-action').focus();
}

function renumberSteps(containerId) {
  const container = document.getElementById(containerId);
  [...container.children].forEach((row, i) => {
    const numEl = row.querySelector('.mono');
    if (numEl) numEl.textContent = `${i + 1}.`;
  });
}

function collectSteps(containerId) {
  const container = document.getElementById(containerId);
  return [...container.children].map((row, i) => ({
    order: i + 1,
    action: row.querySelector('.step-action')?.value.trim() || '',
    expectedResult: row.querySelector('.step-expected')?.value.trim() || '',
  })).filter(s => s.action);
}

// ── Setups editor (dynamic tracker table) ─────────────────────────────────────
// A setup-tracked verification owns a dynamic table: ordered columns + rows.
// The editor keeps an in-memory model and re-renders on structural changes
// (add/remove column or row); cell + column-name edits update the model in place.
let _setupModel = { columns: [], rows: [] }; // rows: arrays of cell strings aligned to columns
let _setupContainerId = null;

const DEFAULT_SETUP_COLUMNS = ['Test ID', 'Setup Details', 'Status', 'Tester Name'];

function statusColIndex(cols)  { return cols.findIndex(c => /status/i.test(c)); }
function testerColIndex(cols)  { return cols.findIndex(c => /tester/i.test(c)); }
function idColIndex(cols)      { const i = cols.findIndex(c => /^test\s*id$/i.test(c)); return i >= 0 ? i : 0; }

function initSetupModel(columns, setups) {
  const cols = (columns && columns.length) ? [...columns] : [...DEFAULT_SETUP_COLUMNS];
  const sIdx = statusColIndex(cols), tIdx = testerColIndex(cols);
  // Status and Tester aren't part of `data` — they're the setup's recorded
  // verdict/signer, surfaced into their own columns here.
  _setupModel = {
    columns: cols,
    rows: (setups || []).map(s => cols.map((c, ci) =>
      ci === sIdx ? (s.status || '')
      : ci === tIdx ? (s.testerName || '')
      : ((s.data && s.data[c] != null) ? s.data[c] : '')
    )),
  };
}

function renderSetupEditor(containerId) {
  _setupContainerId = containerId;
  const m = _setupModel;
  const sIdx = statusColIndex(m.columns);
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="setup-editor-scroll">
      <table class="setup-editor-table steps-table">
        <thead><tr>
          <th style="width:30px"></th>
          ${m.columns.map((c, ci) => `
            <th>
              <div class="setup-col-head">
                <input class="setup-col-name" value="${esc(c)}" oninput="setupSetColName(${ci}, this.value)" placeholder="Column">
                <button type="button" class="icon-btn" title="Remove column" onclick="setupRemoveColumn(${ci})">${ICONS.trash}</button>
              </div>
            </th>`).join('')}
        </tr></thead>
        <tbody>
          ${m.rows.map((row, ri) => `
            <tr>
              <td><button type="button" class="icon-btn" title="Remove setup" onclick="setupRemoveRow(${ri})">${ICONS.trash}</button></td>
              ${m.columns.map((_, ci) => `<td>${
                ci === sIdx
                  ? `<select class="setup-cell" onchange="setupSetCell(${ri},${ci},this.value)">
                       ${['', 'PASSED', 'FAILED', 'PENDING'].map(o =>
                         `<option value="${o}" ${o === (row[ci] || '') ? 'selected' : ''}>${o || '—'}</option>`).join('')}
                     </select>`
                  : `<input class="setup-cell" value="${esc(row[ci] || '')}" oninput="setupSetCell(${ri},${ci},this.value)">`
              }</td>`).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="btn-row" style="margin-top:8px">
      <button type="button" class="btn-ghost btn-sm" onclick="setupAddColumn()">${ICONS.plus} Column</button>
      <button type="button" class="btn-ghost btn-sm" onclick="setupAddRow()">${ICONS.plus} Setup</button>
    </div>`;
}

function setupSetColName(ci, val) { _setupModel.columns[ci] = val; }
function setupSetCell(ri, ci, val) { _setupModel.rows[ri][ci] = val; }
// Extra columns always live between the Test ID column and the descriptive
// Setup Details (and the Status/Tester columns that follow), so a new column is
// inserted just after Test ID rather than appended at the end.
function setupAddColumn() {
  const at = idColIndex(_setupModel.columns) + 1;
  _setupModel.columns.splice(at, 0, 'New Column');
  _setupModel.rows.forEach(r => r.splice(at, 0, ''));
  renderSetupEditor(_setupContainerId);
}
function setupRemoveColumn(ci) {
  if (_setupModel.columns.length <= 1) { toast('A setups table needs at least one column', 'error'); return; }
  _setupModel.columns.splice(ci, 1); _setupModel.rows.forEach(r => r.splice(ci, 1)); renderSetupEditor(_setupContainerId);
}
function setupAddRow() { _setupModel.rows.push(_setupModel.columns.map(() => '')); renderSetupEditor(_setupContainerId); }
function setupRemoveRow(ri) { _setupModel.rows.splice(ri, 1); renderSetupEditor(_setupContainerId); }

// Read the editor model back into { columns, setups, meta } for the API.
function collectSetupData() {
  const cols = _setupModel.columns.map((c, i) => (c || '').trim() || `Column ${i + 1}`);
  const sIdx = statusColIndex(cols), idIdx = idColIndex(cols), tIdx = testerColIndex(cols);
  const setups = _setupModel.rows
    .filter(row => row.some(v => (v || '').trim()))
    .map((row, ri) => {
      // Status / Tester are recorded as the setup's verdict / signer, not as
      // descriptive `data` — exclude them here (they re-appear as columns on export).
      const data = {};
      cols.forEach((c, ci) => { if (ci !== sIdx && ci !== tIdx) data[c] = (row[ci] || '').trim(); });
      const setupId = (row[idIdx] || '').trim() || `Setup ${ri + 1}`;
      const st = (row[sIdx] || '').toUpperCase();
      return {
        setupId, label: setupId,
        status: ['PASSED', 'FAILED', 'PENDING'].includes(st) ? st : '',
        testerName: tIdx >= 0 ? (row[tIdx] || '').trim() : '',
        data,
      };
    });
  return {
    columns: cols,
    setups,
    meta: { idColumn: cols[idIdx], statusColumn: sIdx >= 0 ? cols[sIdx] : null, testerColumn: tIdx >= 0 ? cols[tIdx] : null },
  };
}

// Convert a verification between STANDARD and SETUP_TRACKED.
async function convertTest(id, to) {
  if (to === 'STANDARD') {
    const ok = await confirmDialog('Convert to standard test?',
      'This removes the setups table and all its rows. The verification, its fields and steps are kept.',
      { confirmLabel: 'Convert' });
    if (!ok) return;
  }
  try {
    await API.tests.convert(id, to);
    toast(to === 'SETUP_TRACKED' ? 'Now a setup-tracked test — add its setups' : 'Converted to standard test', 'success');
    closeModal();
    openEditTestModal(id);
  } catch (err) { toast(err.message, 'error'); }
}

// Read-only setups matrix + coverage (for the View modal & tracker page).
function setupMatrixHtml(test) {
  const cols = test.setupColumns || [];
  const setups = test.setups || [];
  const cov = test.setupCoverage || { passed: 0, total: setups.length };
  if (!cols.length && !setups.length) return '<p class="text-muted text-sm">No setups defined yet.</p>';
  const sIdx = statusColIndex(cols), tIdx = testerColIndex(cols);
  return `
    <div style="margin-bottom:10px">${progressBar(cov.passed || 0, cov.total || 0)}</div>
    <div style="overflow-x:auto;border:1px solid var(--border-subtle);border-radius:var(--radius)">
      <table class="steps-table">
        <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>
          ${setups.map(s => `<tr>${cols.map((c, ci) =>
            ci === sIdx
              ? `<td>${s.status ? badge(s.status) : '<span class="text-muted">—</span>'}</td>`
              : ci === tIdx
              ? `<td>${esc(s.testerName || '')}</td>`
              : `<td>${esc((s.data && s.data[c]) || '')}</td>`
          ).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function createTest() {
  const title = document.getElementById('nt-title').value.trim();
  if (!title) { toast('Title required', 'error'); return; }

  const tags  = document.getElementById('nt-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const steps = collectSteps('nt-steps-list');
  const type  = document.querySelector('input[name="nt-type"]:checked')?.value || 'STANDARD';

  const payload = {
    title,
    path:          document.getElementById('nt-path').value.trim(),
    tags,
    configuration: document.getElementById('nt-config').value.trim(),
    files:         document.getElementById('nt-files').value.trim(),
    description:   document.getElementById('nt-desc').value.trim(),
    preconditions: document.getElementById('nt-precond').value.trim(),
    notes:         document.getElementById('nt-notes').value.trim(),
    steps,
    type,
  };
  if (type === 'SETUP_TRACKED') {
    const c = collectSetupData();
    payload.setupColumns = c.columns;
    payload.setupMeta = c.meta;
    payload.setups = c.setups;
  }

  try {
    await API.tests.create(payload);
    closeModal();
    toast('Verification created', 'success');
    afterTestMutation();
  } catch (err) { toast(err.message, 'error'); }
}

async function openEditTestModal(testId) {
  const test = await API.tests.get(testId);
  const isTracked = test.type === 'SETUP_TRACKED';
  openModal(`Edit: ${test.title}`, `
    <div class="type-banner">
      <span>${isTracked
        ? `<span class="tag">Setup-tracked</span> ${(test.setupCoverage?.passed || 0)}/${(test.setupCoverage?.total || 0)} setups passed`
        : '<span class="text-muted text-sm">Standard verification</span>'}</span>
      ${isTracked
        ? `<button type="button" class="btn-ghost btn-sm" onclick="convertTest('${testId}','STANDARD')">Convert to standard</button>`
        : `<button type="button" class="btn-ghost btn-sm" onclick="convertTest('${testId}','SETUP_TRACKED')">Convert to setup-tracked</button>`}
    </div>
    <div class="form-grid">
      <div class="field-group span-2">
        <label for="et-title">Title</label>
        <input type="text" id="et-title" value="${esc(test.title)}">
      </div>
      <div class="field-group">
        <label for="et-path">Path</label>
        <input type="text" id="et-path" value="${esc(test.path || '')}">
      </div>
      <div class="field-group">
        <label for="et-tags">Tags</label>
        <input type="text" id="et-tags" value="${esc((test.tags || []).join(', '))}">
      </div>
      <div class="field-group span-2">
        <label for="et-config">Configuration</label>
        <textarea id="et-config" rows="2">${esc(test.configuration || test.configurations || '')}</textarea>
      </div>
      <div class="field-group span-2">
        <label for="et-files">Files</label>
        <textarea id="et-files" rows="1">${esc(test.files || '')}</textarea>
      </div>
      <div class="field-group span-2">
        <label for="et-desc">Description</label>
        <textarea id="et-desc" rows="2">${esc(test.description || '')}</textarea>
      </div>
      <div class="field-group span-2">
        <label for="et-precond">Pre conditions</label>
        <textarea id="et-precond" rows="2">${esc(test.preconditions || '')}</textarea>
      </div>
      <div class="field-group span-2">
        <label for="et-notes">Notes</label>
        <textarea id="et-notes" rows="2">${esc(test.notes || '')}</textarea>
      </div>
    </div>
    <div class="divider"></div>
    <h4 class="h-card" style="margin-bottom:10px">Steps</h4>
    <div id="et-steps-list">
      ${(test.steps || []).map((s, i) => `
        <div style="display:grid;grid-template-columns:32px 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:start">
          <span class="mono" style="padding-top:9px;color:var(--text-muted)">${i + 1}.</span>
          <input type="text" class="step-action" value="${esc(s.action)}" placeholder="Action">
          <input type="text" class="step-expected" value="${esc(s.expectedResult || '')}" placeholder="Expected">
          <button class="icon-btn" aria-label="Remove step" onclick="this.parentElement.remove();renumberSteps('et-steps-list')">${ICONS.trash}</button>
        </div>`).join('')}
    </div>
    <button class="btn-ghost" onclick="addStepRow('et-steps-list')">${ICONS.plus} Add Step</button>

    ${isTracked ? `
      <div class="divider"></div>
      <h4 class="h-card" style="margin-bottom:6px">Setups</h4>
      <p class="text-muted text-sm" style="margin-bottom:10px">Each row is one setup/condition this verification must be performed under.</p>
      <div id="et-setup-editor"></div>` : ''}

    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveTest('${testId}', ${isTracked})">Save Changes</button>
    </div>`, { onOpen: () => {
      if (isTracked) { initSetupModel(test.setupColumns, test.setups); renderSetupEditor('et-setup-editor'); }
    } });
}

async function saveTest(id, isTracked = false) {
  const steps = collectSteps('et-steps-list');
  const tags  = document.getElementById('et-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const payload = {
    title:         document.getElementById('et-title').value.trim(),
    path:          document.getElementById('et-path').value.trim(),
    tags,
    configuration: document.getElementById('et-config').value.trim(),
    files:         document.getElementById('et-files').value.trim(),
    description:   document.getElementById('et-desc').value.trim(),
    preconditions: document.getElementById('et-precond').value.trim(),
    notes:         document.getElementById('et-notes').value.trim(),
    steps,
  };
  if (isTracked) {
    const c = collectSetupData();
    payload.setupColumns = c.columns;
    payload.setupMeta = c.meta;
    payload.setups = c.setups;
  }
  try {
    await API.tests.update(id, payload);
    closeModal();
    toast('Verification saved', 'success');
    afterTestMutation();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTest(id) {
  const ok = await confirmDialog('Delete verification?',
    'This permanently deletes the verification definition. This cannot be undone.',
    { confirmLabel: 'Delete' });
  if (!ok) return;
  try {
    await API.tests.delete(id);
    toast('Verification deleted', 'info');
    renderTests();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Verification Execution Workspace ─────────────────────────────────────────
// A step-first execution surface: sticky identity + progress header, a setup
// briefing, a preconditions instruction panel, one card per step (single-click
// status, inline note, inline evidence), a step navigator, and a review-and-sign
// flow.
//
// Setup-tracked verifications execute PER SETUP: step results / notes / evidence /
// summary / deviations are scoped per setup in _exec.bySetup[key] (key = setupId
// or '__none__'); switching the setup picker swaps the working set, and each setup
// finalises into its own execution (keyed by setupId). In-progress marks are
// autosaved as drafts (server-side, separate executionDrafts collection) so they
// survive navigation — they're loaded on open and deleted once the run is signed.
//
// Data contract is unchanged: step results map Pass/Fail/Blocked/Not Tested →
// PASS/FAIL/BLOCKED/NOT_TESTED; per-step evidence uploads after create carry a
// "Step N — …" description; the overall result is derived (and overridable).

let _exec = null;

const STEP_STATES = [
  { r: 'PASS',       label: 'Pass' },
  { r: 'FAIL',       label: 'Fail' },
  { r: 'BLOCKED',    label: 'Blocked' },
  { r: 'NOT_TESTED', label: 'Not Tested' },
];

function _testerName()    { return currentUser?.name || currentUser?.username || 'Tester'; }
function _testerInitials() {
  return _testerName().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase() || '?';
}
function _stepIdByIdx(i)  { return _exec.steps[i]?.id; }

// Per-setup working state. key = setupId, or '__none__' for standard tests / the
// "not setup-specific" option.
function _setupKey(id) { return id || '__none__'; }
function curState()    { return _exec.bySetup[_setupKey(_exec.currentSetupId)]; }
function _stepStates() { return Object.values(curState().stepState); }

// Persist the current setup's draft when the page is hidden (tab close / switch).
// SPA navigation away is covered by the immediate save on each recorded result.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveDraftNow();
});

async function renderTestExecute(params = {}) {
  const { versionTestId, versionId, projectId, setupId } = params;
  const el = document.getElementById('page-test-execute');
  el.innerHTML = skeletonPage();

  document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
  el.classList.remove('hidden'); el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === 'projects'));

  try {
    const vTests = await API.tests.forVersion(versionId);
    const vt = vTests.find(v => v.id === versionTestId);
    if (!vt) throw new Error('Version test not found');

    const test = vt.test;
    const steps = test?.steps || [];
    const execHistory = await API.executions.list(versionTestId);
    // Software version is derived from the version this verification belongs to
    // (not entered by hand) — recorded on the execution for the audit trail.
    const version = await API.projects.getVersion(projectId, versionId).catch(() => null);
    // Shared in-progress drafts (per setup) for this verification — any user may
    // have started or edited them; the signer becomes the recorded performer.
    const drafts = await API.executions.drafts(versionTestId).catch(() => []);

    // Remember this verification so the dashboard can offer "jump back in".
    recordRecentVerification({
      versionTestId, versionId, projectId,
      testId: test?.testId, title: test?.title,
    });

    const setups       = (test?.type === 'SETUP_TRACKED') ? (test.setups || []) : [];
    const setupColumns = test?.setupColumns || [];

    // Latest signed-execution result per setup in THIS version, and which setups
    // already have an in-progress draft — used by the "Setups in this version"
    // overview to show what's still to perform. execHistory is sorted newest-first.
    const execBySetup = {};
    for (const ex of execHistory) {
      if (ex.setupId && !(ex.setupId in execBySetup)) execBySetup[ex.setupId] = ex.result;
    }

    _exec = {
      ids: { versionTestId, versionId, projectId },
      vt, test, steps, setups, setupColumns,
      swVersion: version?.name || '',
      // Deep-link: open the requested setup if it exists, else the first one.
      currentSetupId: (setupId && setups.some(s => s.setupId === setupId)) ? setupId : (setups[0]?.setupId || null),
      bySetup: {},          // key → { stepState, generalEvidence, summary, deviations }
      execBySetup,
      draftSetups: new Set((drafts || []).map(d => d.setupId).filter(Boolean)),
    };

    // Build per-setup working state, seeded from any saved draft.
    const draftByKey = {};
    for (const d of (drafts || [])) draftByKey[_setupKey(d.setupId)] = d;
    const keys = setups.length ? [...setups.map(s => s.setupId), '__none__'] : ['__none__'];
    for (const key of keys) {
      const d = draftByKey[key];
      const stepState = {};
      for (const s of steps) {
        const sr = d?.stepResults?.find(x => x.stepId === s.id);
        stepState[s.id] = { result: sr?.result || null, actual: sr?.actual || '', evidence: [] };
      }
      _exec.bySetup[key] = {
        stepState,
        generalEvidence: [],
        summary: d?.summary || '',
        deviations: d?.deviations || '',
      };
    }

    const tracked = setups.length > 0;
    el.innerHTML = `
      ${execHeaderHtml(test, vt)}
      ${setupBriefingHtml()}
      <div class="exec-workspace" id="exec-layout">
        <div class="exec-main">
          ${test?.preconditions ? preconditionsHtml(test.preconditions) : ''}
          ${steps.length ? `
            <div class="steps-head">
              <span class="card-title">Test Steps</span>
              <div class="btn-row">
                <span class="t-meta">${steps.length} step${steps.length === 1 ? '' : 's'}${tracked ? ' · recorded per setup' : ''} · single-click to record</span>
                <button class="btn-secondary btn-sm" id="pass-remaining-btn" onclick="passRemainingSteps()" title="Mark every step without a result as Pass${tracked ? ' (this setup only)' : ''}">${ICONS.check} Mark steps as passed</button>
              </div>
            </div>
            <div class="exec-steps" id="exec-steps">
              ${steps.map((s, i) => stepCardHtml(s, i)).join('')}
            </div>`
            : '<div class="card"><p class="text-muted text-sm">This verification has no defined steps. Record the overall result via Review &amp; Sign.</p></div>'}
          <div class="completion-panel hidden" id="exec-completion"></div>
        </div>
        ${execSideHtml(execHistory)}
      </div>`;

    renderBriefingGrid();
    hydrateSteps();          // reflect saved-draft results onto the cards
    updateExecProgress();
    renderGeneralEvidence();
  } catch (err) {
    el.innerHTML = `<div class="page-body"><div class="form-error">${ICONS.alert} ${esc(err.message)}</div></div>`;
  }
}

// ── Draft autosave ────────────────────────────────────────────────────────────
let _draftTimer = null;

function buildDraftPayload() {
  const st = curState().stepState;
  const stepResults = _exec.steps
    .map(s => ({ stepId: s.id, result: st[s.id].result, actual: st[s.id].actual || '' }))
    .filter(r => r.result || r.actual);
  return {
    versionTestId: _exec.ids.versionTestId,
    setupId: _exec.currentSetupId || null,
    stepResults,
    summary: curState().summary || '',
    deviations: curState().deviations || '',
  };
}

function scheduleDraftSave() { clearTimeout(_draftTimer); _draftTimer = setTimeout(saveDraftNow, 500); }

// Best-effort persistence of the current setup's in-progress marks.
async function saveDraftNow() {
  clearTimeout(_draftTimer);
  if (!_exec) return;
  if (!document.getElementById('page-test-execute')?.classList.contains('active')) return;
  try { await API.executions.saveDraft(buildDraftPayload()); } catch { /* drafts are best-effort */ }
}

// ── Sticky header ─────────────────────────────────────────────────────────────
function execHeaderHtml(test, vt) {
  return `
    <div class="exec-header">
      <div class="exec-header-top">
        <a class="back-link" href="#" onclick="navigate('version-detail',{projectId:'${_exec.ids.projectId}',versionId:'${_exec.ids.versionId}'});return false">${ICONS.arrowL} Back to version</a>
      </div>
      <div class="exec-header-main">
        <span class="exec-id-chip">${esc(test?.testId || '—')}</span>
        <span class="exec-title">${esc(test?.title || 'Execute Verification')}</span>
        <span id="exec-status-badge">${badge(vt.status)}</span>
        <div class="exec-header-context">
          ${_exec.swVersion ? `
          <div class="exec-tester" title="Software version under verification (from this version)">
            ${ICONS.folder} ${esc(_exec.swVersion)}
          </div>` : ''}
          <div class="exec-tester" title="Tester (signs this execution)">
            <span class="user-avatar">${_testerInitials()}</span>${esc(_testerName())}
          </div>
          <button class="btn-primary" id="exec-sign-btn" onclick="openReviewAndSign()">${ICONS.sign} Review &amp; Sign</button>
        </div>
      </div>
      ${test?.description ? `<p class="exec-desc text-secondary">${esc(test.description)}</p>` : ''}
      <div class="exec-progress" id="exec-progress"></div>
    </div>`;
}

function progressStripHtml() {
  const states = _stepStates();
  const total = states.length;
  const pass    = states.filter(s => s.result === 'PASS').length;
  const fail    = states.filter(s => s.result === 'FAIL').length;
  const blocked = states.filter(s => s.result === 'BLOCKED').length;
  const recorded = states.filter(s => s.result).length;
  const left = total - recorded;
  const pct = (n) => total ? (n / total * 100).toFixed(2) : 0;
  const restCount = total - pass - fail - blocked;   // not_tested + unrecorded

  return `
    <div class="seg-bar" title="${recorded}/${total} recorded">
      ${pass    ? `<div class="seg-pass" style="width:${pct(pass)}%"></div>` : ''}
      ${fail    ? `<div class="seg-fail" style="width:${pct(fail)}%"></div>` : ''}
      ${blocked ? `<div class="seg-blocked" style="width:${pct(blocked)}%"></div>` : ''}
      ${restCount ? `<div class="seg-rest" style="width:${pct(restCount)}%"></div>` : ''}
    </div>
    <div class="exec-progress-stats">
      <span class="exec-stat"><span class="exec-recorded">${recorded}/${total}</span> recorded</span>
      <span class="exec-stat"><span class="dot pass"></span><b>${pass}</b> Pass</span>
      <span class="exec-stat"><span class="dot fail"></span><b>${fail}</b> Fail</span>
      <span class="exec-stat"><span class="dot blocked"></span><b>${blocked}</b> Blocked</span>
      <span class="exec-stat"><span class="dot left"></span><b>${left}</b> left</span>
    </div>`;
}

// ── Setup briefing ────────────────────────────────────────────────────────────
// A compact, horizontal metadata strip pinned directly under the execution
// header — it reflects the setup currently selected in the right-hand "Setups in
// this version" navigator (the single, authoritative selector). It carries no
// controls of its own; switching setups happens in the sidebar.
function setupBriefingHtml() {
  return `
    <div class="briefing-strip" id="briefing-grid" aria-label="Setup briefing"></div>`;
}

function briefingItem(label, valueHtml, opts = {}) {
  return `
    <div class="briefing-item${opts.wide ? ' wide' : ''}">
      <div class="briefing-label">${esc(label)}</div>
      <div class="briefing-value${opts.mono ? ' mono' : ''}">${valueHtml}</div>
    </div>`;
}

// Descriptive setup columns (everything that isn't the Test ID, Status, or
// Tester column) — used by both the briefing strip and the sidebar navigator.
function setupDetailText(s) {
  const cols = _exec.setupColumns;
  const sIdx = statusColIndex(cols), idIdx = idColIndex(cols), tIdx = testerColIndex(cols);
  return cols
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => i !== sIdx && i !== idIdx && i !== tIdx)
    .map(({ c }) => (s.data && s.data[c]) || '')
    .filter(Boolean).join(' · ');
}

function setupTesterName(s) {
  return s.testerName || '';
}

function renderBriefingGrid() {
  const grid = document.getElementById('briefing-grid');
  if (!grid) return;
  let html = '';

  if (_exec.setups.length) {
    const s = _exec.setups.find(x => x.setupId === _exec.currentSetupId);
    if (s) {
      const cols = _exec.setupColumns.length ? _exec.setupColumns : Object.keys(s.data || {});
      const sIdx = statusColIndex(cols), tIdx = testerColIndex(cols);
      // The briefing describes the setup only. Its verdict (Status) and signer
      // (Tester) are runtime outcomes — recorded via Review & Sign, not shown here.
      html = cols.map((c, i) => {
        if (i === sIdx || i === tIdx) return '';
        const raw = (s.data && s.data[c]) || '';
        const value = raw ? esc(raw) : '<span class="text-muted">—</span>';
        return briefingItem(c, value, { wide: raw.length > 42 });
      }).join('');
    } else {
      html = '<p class="text-muted text-sm">No specific setup — this run won’t be attributed to a setup.</p>';
    }
  } else {
    const t = _exec.test || {};
    const fields = [
      ['Configuration', t.configuration],
      ['Files', t.files],
      ['Description', t.description],
    ].filter(([, v]) => v);
    html = fields.length
      ? fields.map(([k, v]) => briefingItem(k, esc(v), { wide: true })).join('')
      : '<p class="text-muted text-sm">No setup details recorded for this verification.</p>';
  }
  grid.innerHTML = html;
}

// Switch the setup being executed: persist what we're leaving, then load the
// chosen setup's own results / notes / evidence into the cards. `newId` is the
// setupId to switch to (null / '' selects the "not setup-specific" run).
async function onSetupChange(newId) {
  await saveDraftNow();
  _exec.currentSetupId = newId || null;

  const cont = document.getElementById('exec-steps');
  if (cont) cont.innerHTML = _exec.steps.map((s, i) => stepCardHtml(s, i)).join('');
  const sum = document.getElementById('exec-summary'); if (sum) sum.value = curState().summary || '';
  const dev = document.getElementById('exec-dev');     if (dev) dev.value = curState().deviations || '';

  renderBriefingGrid();
  hydrateSteps();
  renderGeneralEvidence();
  _exec.currentStep = 0;
  updateExecProgress();
}

// Reflect the current setup's stored state onto the step cards.
function hydrateSteps() {
  const st = curState().stepState;
  _exec.steps.forEach((s, i) => {
    applyStepResult(s.id, i, st[s.id].result);
    const ta = document.querySelector(`#note-extra-${i} textarea`);
    if (ta) ta.value = st[s.id].actual || '';
    if (st[s.id].actual) {
      document.getElementById('note-extra-' + i)?.classList.remove('hidden');
      document.getElementById('note-toggle-' + i)?.classList.add('on');
    }
    renderStepEvidence(i);
  });
}

// ── Preconditions ─────────────────────────────────────────────────────────────
function preconditionsHtml(text) {
  return `
    <div class="precond-panel">
      <div class="precond-icon">${ICONS.info}</div>
      <div class="precond-body">
        <div class="precond-title">Preconditions — must be true before execution</div>
        <div class="precond-text">${esc(text)}</div>
      </div>
    </div>`;
}

// ── Step cards ──────────────────────────────────────────────────────────────
function stepCardHtml(s, i) {
  const stepId = s.id;
  return `
    <div class="step-card" id="step-card-${i}" data-step-id="${esc(stepId)}" data-idx="${i}">
      <div class="step-card-head">
        <span class="step-num">${s.order || i + 1}</span>
        <div class="step-action">${esc(s.action)}</div>
      </div>
      ${s.expectedResult ? `
        <div class="step-expected">
          <span class="se-label">Expected</span>
          <span class="se-text">${esc(s.expectedResult)}</span>
        </div>` : ''}
      <div class="step-status-row">
        ${STEP_STATES.map(st => `
          <button class="step-status-btn" data-r="${st.r}" onclick="setStepResult('${esc(stepId)}','${st.r}',${i})">
            <span class="dot"></span>${st.label}
          </button>`).join('')}
        <div class="step-toggles">
          <button class="step-toggle-btn" id="note-toggle-${i}" onclick="toggleStepExtra(${i},'note')">${ICONS.edit} Note</button>
          <button class="step-toggle-btn" id="ev-toggle-${i}" onclick="toggleStepExtra(${i},'ev')">${ICONS.upload} Evidence</button>
        </div>
      </div>
      <div class="step-extra step-note hidden" id="note-extra-${i}">
        <textarea placeholder="Observations / actual result for this step…" oninput="onStepNoteInput(${i}, this.value)" onchange="saveDraftNow()"></textarea>
      </div>
      <div class="step-extra step-evidence hidden" id="ev-extra-${i}">
        <div class="step-evidence-drop"
          onclick="document.getElementById('step-file-${i}').click()"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="onStepEvidenceDrop(event,${i})">
          ${ICONS.upload} Drop files or click to attach evidence for this step
        </div>
        <input type="file" id="step-file-${i}" multiple class="hidden" onchange="onStepEvidencePick(event,${i})">
        <div class="ev-thumbs" id="ev-thumbs-${i}"></div>
      </div>
    </div>`;
}

function onStepNoteInput(i, val) {
  curState().stepState[_stepIdByIdx(i)].actual = val;
  scheduleDraftSave();
}

// Set a step's result and reflect it on its card (no toggle, no progress refresh —
// callers refresh progress so a batch can update once).
function applyStepResult(stepId, i, result) {
  curState().stepState[stepId].result = result;
  const card = document.getElementById('step-card-' + i);
  if (!card) return;
  card.querySelectorAll('.step-status-btn').forEach(b => b.classList.toggle('active', result && b.dataset.r === result));
  card.classList.remove('is-pass', 'is-fail', 'is-blocked');
  if (result === 'PASS') card.classList.add('is-pass');
  else if (result === 'FAIL') card.classList.add('is-fail');
  else if (result === 'BLOCKED') card.classList.add('is-blocked');
}

function setStepResult(stepId, result, i) {
  const cur = curState().stepState[stepId].result;
  applyStepResult(stepId, i, cur === result ? null : result);   // click active again → clear
  _exec.currentStep = i;
  updateExecProgress();
  saveDraftNow();
}

// Mark every step (in the CURRENT setup) that has no result yet as Pass. Steps
// already recorded are left untouched, so the order of recording a failure and
// clicking this button doesn't matter.
function passRemainingSteps() {
  const st = curState().stepState;
  let n = 0;
  _exec.steps.forEach((s, i) => {
    if (!st[s.id].result) { applyStepResult(s.id, i, 'PASS'); n++; }
  });
  updateExecProgress();
  if (n) saveDraftNow();
  toast(n ? `Marked ${n} remaining step${n === 1 ? '' : 's'} as Pass` : 'No remaining steps to mark', n ? 'success' : 'info');
}

function toggleStepExtra(i, kind) {
  const extra  = document.getElementById((kind === 'note' ? 'note-extra-' : 'ev-extra-') + i);
  const toggle = document.getElementById((kind === 'note' ? 'note-toggle-' : 'ev-toggle-') + i);
  const willShow = extra.classList.contains('hidden');
  extra.classList.toggle('hidden', !willShow);
  toggle.classList.toggle('on', willShow);
  if (willShow && kind === 'note') extra.querySelector('textarea')?.focus();
}

// ── Per-step evidence (current setup, in-memory until sign) ───────────────────
function onStepEvidencePick(e, i) { addStepEvidence(i, e.target.files); }
function onStepEvidenceDrop(e, i) {
  e.preventDefault();
  document.querySelector(`#ev-extra-${i} .step-evidence-drop`)?.classList.remove('drag-over');
  addStepEvidence(i, e.dataTransfer.files);
}
function addStepEvidence(i, files) {
  curState().stepState[_stepIdByIdx(i)].evidence.push(...files);
  renderStepEvidence(i);
  updateExecProgress();
}
function removeStepEvidence(i, idx) {
  curState().stepState[_stepIdByIdx(i)].evidence.splice(idx, 1);
  renderStepEvidence(i);
  updateExecProgress();
}
function renderStepEvidence(i) {
  const list = document.getElementById('ev-thumbs-' + i);
  if (!list) return;
  const ev = curState().stepState[_stepIdByIdx(i)].evidence;
  list.innerHTML = ev.map((f, idx) => evThumbHtml(f, `removeStepEvidence(${i},${idx})`)).join('');
}

function evThumbHtml(f, onRemove) {
  const ext = (f.name.split('.').pop() || '?').toUpperCase();
  return `
    <div class="ev-thumb">
      <span class="tag ev-tag">${esc(ext)}</span>
      <span class="ev-name" title="${esc(f.name)}">${esc(f.name)}</span>
      <button class="icon-btn" style="padding:2px" aria-label="Remove file" onclick="${onRemove}">${ICONS.trash}</button>
    </div>`;
}

function _evidenceCount() {
  let n = curState().generalEvidence.length;
  for (const s of _stepStates()) n += s.evidence.length;
  return n;
}

// ── General (non-step) evidence — side panel, current setup ───────────────────
function onGeneralEvidencePick(e) { addGeneralEvidence(e.target.files); }
function onGeneralEvidenceDrop(e) {
  e.preventDefault();
  document.getElementById('general-ev-drop')?.classList.remove('drag-over');
  addGeneralEvidence(e.dataTransfer.files);
}
function addGeneralEvidence(files) {
  curState().generalEvidence.push(...files);
  renderGeneralEvidence();
  updateExecProgress();
}
function removeGeneralEvidence(idx) {
  curState().generalEvidence.splice(idx, 1);
  renderGeneralEvidence();
  updateExecProgress();
}
function renderGeneralEvidence() {
  const list = document.getElementById('general-ev-list');
  if (!list) return;
  list.innerHTML = curState().generalEvidence.map((f, idx) => evThumbHtml(f, `removeGeneralEvidence(${idx})`)).join('');
}

// ── Progress / navigator / completion ─────────────────────────────────────────
function updateExecProgress() {
  const strip = document.getElementById('exec-progress');
  if (strip) strip.innerHTML = progressStripHtml();

  const st = curState().stepState;
  _exec.steps.forEach((step, i) => {
    const chip = document.getElementById('nav-chip-' + i);
    if (!chip) return;
    const r = st[step.id].result;
    chip.classList.remove('is-pass', 'is-fail', 'is-blocked');
    if (r === 'PASS') chip.classList.add('is-pass');
    else if (r === 'FAIL') chip.classList.add('is-fail');
    else if (r === 'BLOCKED') chip.classList.add('is-blocked');
    chip.classList.toggle('current', i === _exec.currentStep);
  });

  const evCount = document.getElementById('exec-ev-count');
  if (evCount) evCount.textContent = _evidenceCount();

  const states = _stepStates();
  const hasSteps = states.length > 0;
  const allRecorded = hasSteps && states.every(s => s.result);
  // Signing requires EVERY step to be Pass or Fail — Blocked / Not Tested /
  // unrecorded steps block the sign-off (per setup).
  const canSign = !hasSteps || states.every(s => s.result === 'PASS' || s.result === 'FAIL');

  const panel = document.getElementById('exec-completion');
  if (panel) {
    if (hasSteps && canSign)       { panel.classList.remove('hidden'); panel.innerHTML = completionPanelHtml(); }
    else if (hasSteps && !canSign) { panel.classList.remove('hidden'); panel.innerHTML = signBlockedHtml(); }
    else                           { panel.classList.add('hidden'); }
  }

  const passBtn = document.getElementById('pass-remaining-btn');
  if (passBtn) passBtn.disabled = allRecorded || !hasSteps;

  const signBtn = document.getElementById('exec-sign-btn');
  if (signBtn) {
    signBtn.disabled = !canSign;
    signBtn.title = canSign ? 'Review & sign this setup' : 'Mark every step Pass or Fail to sign';
  }

  renderSetupOverview();
}

// Shown instead of the completion panel when steps still need a Pass/Fail.
function signBlockedHtml() {
  const st = curState().stepState;
  const pending = _exec.steps
    .map((s, i) => ({ s, i, r: st[s.id].result }))
    .filter(x => x.r !== 'PASS' && x.r !== 'FAIL');
  return `
    <div class="completion-head" style="border-top-color:var(--warn)">
      <div class="precond-icon" style="background:var(--warn-dim);color:var(--warn);width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center">${ICONS.alert}</div>
      <h3>Not ready to sign</h3>
    </div>
    <p class="text-sm text-secondary" style="margin-bottom:12px">
      ${pending.length} step${pending.length === 1 ? '' : 's'} still need a <b>Pass</b> or <b>Fail</b> result —
      Blocked, Not Tested and unrecorded steps can't be signed.
    </p>
    <div class="completion-issues">
      ${pending.map(x => `
        <div class="completion-issue">
          ${x.r ? badge(x.r) : '<span class="badge badge-not_started no-dot">Unmarked</span>'}
          <span class="text-secondary" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Step ${x.s.order || x.i + 1} — ${esc(x.s.action)}</span>
          <button class="btn-ghost btn-sm" onclick="scrollToStep(${x.i})">Go to step</button>
        </div>`).join('')}
    </div>`;
}

// ── Setup coverage overview (which setups still need performing) ──────────────
// A setup is "performed" once it has a signed execution in this version (any
// result); "in progress" if it has a saved draft or recorded marks this session;
// otherwise "not performed". Lets the tester see and jump to remaining setups.
function setupStatus(setupId) {
  const signed = _exec.execBySetup[setupId];
  if (signed) return { kind: 'result', value: signed };
  const ss = _exec.bySetup[setupId]?.stepState;
  const results = ss ? Object.values(ss).map(s => s.result).filter(Boolean) : [];
  if (results.length) {
    // A Blocked step halts the setup, so Blocked wins; an all-Not-Tested setup is
    // Not Tested. Anything else still in flight reads as In progress. (These can't
    // be signed, so they never become a finalised execution result.)
    if (results.includes('BLOCKED')) return { kind: 'result', value: 'BLOCKED' };
    if (results.every(r => r === 'NOT_TESTED')) return { kind: 'result', value: 'NOT_TESTED' };
    return { kind: 'progress' };
  }
  if (_exec.draftSetups.has(setupId)) return { kind: 'progress' };
  return { kind: 'none' };
}

function renderSetupOverview() {
  const el = document.getElementById('setup-overview');
  if (!el) return;
  const setups = _exec.setups;
  const performed = setups.filter(s => _exec.execBySetup[s.setupId]).length;
  const passed    = setups.filter(s => _exec.execBySetup[s.setupId] === 'PASSED').length;

  // Preserve the list's scroll position: this re-renders on every setup switch,
  // and rebuilding innerHTML would otherwise snap the scrolled list back to the
  // top, throwing the user away from the setup they just clicked.
  const prevScroll = el.querySelector('.setup-ov-list')?.scrollTop || 0;

  el.innerHTML = `
    <div class="setup-ov-head">
      <span class="t-meta"><b class="tabular">${performed}</b>/${setups.length} performed${passed ? ` · ${passed} passed` : ''}</span>
    </div>
    <div class="setup-ov-list">
      ${setups.map(s => {
        const st = setupStatus(s.setupId);
        const chip = st.kind === 'result'   ? badge(st.value)
                   : st.kind === 'progress' ? '<span class="badge badge-in_progress">In progress</span>'
                   :                          '<span class="badge badge-not_started no-dot">Not performed</span>';
        const details = setupDetailText(s);
        const tester  = setupTesterName(s);
        return `
          <div class="setup-ov-item${s.setupId === _exec.currentSetupId ? ' current' : ''}"
               onclick="selectSetup('${esc(s.setupId)}')" title="${esc(s.setupId)} — click to execute">
            <div class="setup-ov-top">
              <span class="setup-ov-id">${esc(s.setupId)}</span>
              ${chip}
            </div>
            ${details ? `<div class="setup-ov-detail" title="${esc(details)}">${esc(details)}</div>` : ''}
            ${tester ? `<div class="setup-ov-tester"><span class="setup-ov-tlabel">Tester</span>${esc(tester)}</div>` : ''}
          </div>`;
      }).join('')}
      <div class="setup-ov-item setup-ov-none${_exec.currentSetupId === null ? ' current' : ''}"
           onclick="selectSetup('')" title="Record a run not attributed to any setup">
        <span class="setup-ov-id text-muted">— Not setup-specific —</span>
      </div>
    </div>`;

  if (prevScroll) {
    const list = el.querySelector('.setup-ov-list');
    if (list) list.scrollTop = prevScroll;
  }
}

// Jump to a setup from the sidebar navigator — the single, authoritative
// selector for the run being executed.
async function selectSetup(setupId) {
  await onSetupChange(setupId || null);
}

function scrollToStep(i) {
  const card = document.getElementById('step-card-' + i);
  if (!card) return;
  _exec.currentStep = i;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 900);
  updateExecProgress();
}

function deriveOverallResult() {
  const states = _stepStates();
  if (!states.length) return 'PASSED';
  if (states.some(s => s.result === 'FAIL')) return 'FAILED';
  if (states.some(s => s.result === 'BLOCKED')) return 'BLOCKED';
  if (states.every(s => s.result === 'PASS')) return 'PASSED';
  return 'IN_PROGRESS';
}

function _counts() {
  const states = _stepStates();
  return {
    total: states.length,
    pass:    states.filter(s => s.result === 'PASS').length,
    fail:    states.filter(s => s.result === 'FAIL').length,
    blocked: states.filter(s => s.result === 'BLOCKED').length,
    recorded: states.filter(s => s.result).length,
  };
}

function completionPanelHtml() {
  const c = _counts();
  const st = curState().stepState;
  const issues = _exec.steps
    .map((s, i) => ({ s, i, r: st[s.id].result }))
    .filter(x => x.r === 'FAIL' || x.r === 'BLOCKED');
  const overall = deriveOverallResult();
  return `
    <div class="completion-head">
      ${ICONS.check} <h3>All steps recorded</h3>
      <span style="margin-left:auto">${badge(overall)}</span>
    </div>
    <div class="completion-stats">
      <div class="comp-stat pass"><div class="v">${c.pass}</div><div class="l">Passed</div></div>
      <div class="comp-stat fail"><div class="v">${c.fail}</div><div class="l">Failed</div></div>
      <div class="comp-stat blocked"><div class="v">${c.blocked}</div><div class="l">Blocked</div></div>
      <div class="comp-stat"><div class="v">${_evidenceCount()}</div><div class="l">Evidence</div></div>
    </div>
    ${issues.length ? `
      <div class="completion-issues">
        <div class="t-label" style="margin-bottom:6px">Outstanding issues</div>
        ${issues.map(x => `
          <div class="completion-issue">
            ${badge(x.r)}
            <span class="text-secondary" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.s.action)}</span>
            <button class="btn-ghost btn-sm" onclick="scrollToStep(${x.i})">Go to step ${x.s.order || x.i + 1}</button>
          </div>`).join('')}
      </div>` : '<p class="text-sm text-secondary" style="margin-bottom:16px">No failures or blocks recorded.</p>'}
    <div class="btn-row">
      <button class="btn-primary" onclick="openReviewAndSign()">${ICONS.sign} Review &amp; Sign</button>
    </div>`;
}

// ── Side panel ────────────────────────────────────────────────────────────────
function execSideHtml(execHistory) {
  const navChips = _exec.steps.length
    ? `<div class="step-nav">${_exec.steps.map((s, i) =>
        `<div class="step-nav-chip" id="nav-chip-${i}" title="Step ${s.order || i + 1}" onclick="scrollToStep(${i})">${s.order || i + 1}</div>`).join('')}</div>`
    : '<p class="text-muted text-sm">No steps to navigate.</p>';

  const historyHtml = execHistory.length === 0
    ? '<p class="text-muted text-sm">No executions yet.</p>'
    : execHistory.map(ex => `
        <div class="exec-history-item">
          <div class="eh-top">${badge(ex.result)}<span class="t-meta">${relTime(ex.executedAt)}</span></div>
          <div class="text-sm" style="margin-top:5px">${esc(ex.executorName)}</div>
          ${ex.swVersion ? `<div class="mono">${esc(ex.swVersion)}</div>` : ''}
          ${ex.evidenceCount ? `<div class="t-meta">${ex.evidenceCount} evidence file${ex.evidenceCount === 1 ? '' : 's'}</div>` : ''}
        </div>`).join('');

  return `
    <div class="exec-side" id="exec-side">
      ${_exec.setups.length ? `
      <div class="side-group">
        <div class="side-group-head open" onclick="toggleSideGroup(this)">
          ${ICONS.check} Setups in this version
          <span class="collapsible-arrow">${ICONS.chevR}</span>
        </div>
        <div class="side-group-body" id="setup-overview"></div>
      </div>` : ''}

      <div class="side-group">
        <div class="side-group-head open" onclick="toggleSideGroup(this)">
          ${ICONS.folder} Step Navigator
          <span class="collapsible-arrow">${ICONS.chevR}</span>
        </div>
        <div class="side-group-body">${navChips}</div>
      </div>

      <div class="side-group">
        <div class="side-group-head open" onclick="toggleSideGroup(this)">
          ${ICONS.doc} Execution Details
          <span class="collapsible-arrow">${ICONS.chevR}</span>
        </div>
        <div class="side-group-body">
          <div class="field-group">
            <label for="exec-summary">Summary / Conclusion</label>
            <textarea id="exec-summary" rows="3" placeholder="Test summary and conclusion…" oninput="curState().summary=this.value;scheduleDraftSave()" onchange="saveDraftNow()"></textarea>
          </div>
          <div class="field-group" style="margin-bottom:0">
            <label for="exec-dev">Deviations / Comments</label>
            <textarea id="exec-dev" rows="2" placeholder="Any deviations from expected…" oninput="curState().deviations=this.value;scheduleDraftSave()" onchange="saveDraftNow()"></textarea>
          </div>
        </div>
      </div>

      <div class="side-group">
        <div class="side-group-head open" onclick="toggleSideGroup(this)">
          ${ICONS.upload} Evidence <span class="badge badge-count" id="exec-ev-count" style="margin-left:6px">0</span>
          <span class="collapsible-arrow">${ICONS.chevR}</span>
        </div>
        <div class="side-group-body">
          <p class="t-meta" style="margin-bottom:8px">General evidence (not tied to a single step). Per-step evidence attaches on each card.</p>
          <div class="step-evidence-drop" id="general-ev-drop"
            onclick="document.getElementById('general-ev-input').click()"
            ondragover="event.preventDefault();this.classList.add('drag-over')"
            ondragleave="this.classList.remove('drag-over')"
            ondrop="onGeneralEvidenceDrop(event)">
            ${ICONS.upload} Drop files or click to upload
          </div>
          <input type="file" id="general-ev-input" multiple class="hidden" onchange="onGeneralEvidencePick(event)">
          <div class="ev-thumbs" id="general-ev-list"></div>
        </div>
      </div>

      <div class="side-group">
        <div class="side-group-head" onclick="toggleSideGroup(this)">
          ${ICONS.clock} Execution History
          <span class="collapsible-arrow">${ICONS.chevR}</span>
        </div>
        <div class="side-group-body hidden">${historyHtml}</div>
      </div>
    </div>`;
}

function toggleSideGroup(head) {
  const body = head.nextElementSibling;
  const open = head.classList.toggle('open');
  if (body) body.classList.toggle('hidden', !open);
}

// ── Review & Sign ─────────────────────────────────────────────────────────────
function openReviewAndSign() {
  // Gate: every step must be Pass or Fail for the current setup.
  const states = _stepStates();
  if (states.length > 0 && !states.every(s => s.result === 'PASS' || s.result === 'FAIL')) {
    toast('Mark every step as Pass or Fail before signing', 'error');
    return;
  }
  const c = _counts();
  const overall = deriveOverallResult();
  const dev = document.getElementById('exec-dev')?.value.trim() || '';
  const st = curState().stepState;
  const setupLabel = _exec.currentSetupId
    ? (_exec.setups.find(s => s.setupId === _exec.currentSetupId)?.setupId || _exec.currentSetupId)
    : null;

  const issues = _exec.steps
    .map((s, i) => ({ s, i, r: st[s.id].result }))
    .filter(x => x.r === 'FAIL' || x.r === 'BLOCKED');

  const resultOptions = ['PASSED', 'FAILED', 'BLOCKED', 'IN_PROGRESS', 'NOT_APPLICABLE'];

  openModal('Review & Sign Execution', `
    <p class="text-sm text-secondary" style="margin-bottom:14px">
      Review the execution below. Signing makes this a permanent part of the formal quality record
      and applies your electronic signature as <b>${esc(_testerName())}</b>.
    </p>

    ${setupLabel ? `
      <div class="field-group">
        <label>Setup under test</label>
        <div class="text-sm"><span class="exec-id-chip">${esc(setupLabel)}</span></div>
      </div>` : ''}

    <div class="completion-stats" style="margin-bottom:16px">
      <div class="comp-stat pass"><div class="v">${c.pass}</div><div class="l">Passed</div></div>
      <div class="comp-stat fail"><div class="v">${c.fail}</div><div class="l">Failed</div></div>
      <div class="comp-stat blocked"><div class="v">${c.blocked}</div><div class="l">Blocked</div></div>
      <div class="comp-stat"><div class="v">${_evidenceCount()}</div><div class="l">Evidence</div></div>
    </div>

    ${issues.length ? `
      <div class="field-group">
        <label>Outstanding issues</label>
        ${issues.map(x => `
          <div class="completion-issue">
            ${badge(x.r)}
            <span class="text-secondary" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Step ${x.s.order || x.i + 1} — ${esc(x.s.action)}</span>
          </div>`).join('')}
      </div>` : ''}

    <div class="form-grid">
      ${_exec.swVersion ? `
      <div class="field-group span-2">
        <label>Software Version <span class="label-hint">from this version</span></label>
        <div class="text-sm text-secondary mono">${esc(_exec.swVersion)}</div>
      </div>` : ''}
      <div class="field-group span-2">
        <label for="review-result">Overall Result <span class="label-hint">derived from step results — override if needed</span></label>
        <select id="review-result">
          ${resultOptions.map(o => `<option value="${o}" ${o === overall ? 'selected' : ''}>${badgeLabel(o)}</option>`).join('')}
        </select>
      </div>
      ${dev ? `<div class="field-group span-2"><label>Deviations / Comments</label><div class="text-sm text-secondary" style="white-space:pre-wrap;line-height:1.55">${esc(dev)}</div></div>` : ''}
    </div>

    <div class="sig-block">
      <div class="sig-meaning">Electronic signature — VERIFIED BY</div>
      <div class="sig-name">${esc(_testerName())}</div>
      <div class="sig-date">Recorded at submission · appears as "Verified By" on this verification in the report</div>
    </div>

    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Keep editing</button>
      <button class="btn-primary" id="sign-submit-btn" onclick="submitExecution()">${ICONS.sign} Sign &amp; Submit</button>
    </div>`);
}

// Human label for a status without rendering the badge chrome (for <option>s).
function badgeLabel(status) {
  const tmp = document.createElement('div');
  tmp.innerHTML = badge(status);
  return tmp.textContent.trim();
}

// ── Submit (finalise the current setup's run) ─────────────────────────────────
async function submitExecution() {
  const result      = document.getElementById('review-result')?.value || deriveOverallResult();
  const swVersion   = _exec.swVersion || '';   // derived from the version; not entered by hand
  const summary     = curState().summary || '';
  const deviations  = curState().deviations || '';
  const setupId     = _exec.currentSetupId || null;
  const st          = curState().stepState;

  const stepResults = _exec.steps.map(s => ({
    stepId: s.id,
    result: st[s.id].result || 'NOT_TESTED',
    actual: st[s.id].actual || '',
  }));

  const btn = document.getElementById('sign-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    const exec = await API.executions.create({
      versionTestId: _exec.ids.versionTestId,
      result, swVersion, environment: '', summary, deviations, stepResults, setupId,
    });

    await uploadAllEvidence(exec.id);

    closeModal();
    toast(`Execution recorded as ${badgeLabel(result)}`, 'success');
    navigate('version-detail', { projectId: _exec.ids.projectId, versionId: _exec.ids.versionId });
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = `${ICONS.sign} Sign &amp; Submit`; }
    toast(err.message, 'error');
  }
}

// Upload per-step evidence (description carries the step attribution) then
// general evidence — for the current setup's run. One request per step keeps the
// per-step description.
async function uploadAllEvidence(execId) {
  const st = curState().stepState;
  for (let i = 0; i < _exec.steps.length; i++) {
    const s = _exec.steps[i];
    const files = st[s.id].evidence;
    if (!files.length) continue;
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('description', `Step ${s.order || i + 1} — ${trunc(s.action, 40)}`);
    await API.executions.uploadEvidence(execId, fd);
  }
  if (curState().generalEvidence.length) {
    const fd = new FormData();
    curState().generalEvidence.forEach(f => fd.append('files', f));
    fd.append('description', 'General evidence');
    await API.executions.uploadEvidence(execId, fd);
  }
}
