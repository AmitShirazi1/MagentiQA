// public/js/pages/dashboard.js — QA command center
//
// The dashboard is an operational workspace, not a report. It leads with what
// needs attention (a personal work queue), surfaces release readiness and
// coverage prominently, keeps metrics compact (and clickable as table filters),
// and prioritises actionable verifications. All data is real: stats come from
// /dashboard, the verification list from /tests/version, pending approvals from
// /approvals, and activity from the audit trail.

// Status → display priority for the "needs attention first" ordering.
// Default ("All" filter) ordering: in-progress first, then not started, blocked,
// failed, partial, passed.
const DASH_PRIORITY = { IN_PROGRESS: 0, NOT_STARTED: 1, BLOCKED: 2, FAILED: 3, PARTIAL: 4, PASSED: 5 };
const DASH_VERIF_CAP = 12;
const DASH_STATUS_LABELS = {
  PASSED: 'passed', FAILED: 'failed', PARTIAL: 'partial',
  IN_PROGRESS: 'in progress', BLOCKED: 'blocked', NOT_STARTED: 'not started',
};

// State shared with the filter + table helpers below.
let _dashTests = [];
let _dashCtx = { projectId: null, versionId: null };
let _dashFilter = null;

async function renderDashboard(params = {}) {
  const el = document.getElementById('page-dashboard');
  el.innerHTML = skeletonPage();

  try {
    const projects = await API.projects.list();

    if (projects.length === 0) {
      el.innerHTML = `
        <div class="page-header">
          <div><h1>Dashboard</h1><p class="subtitle">Welcome to MagentiQA</p></div>
        </div>
        <div class="page-body">
          ${emptyState('No projects yet', 'Create your first project to start managing verification runs.', {
            action: { label: 'Create Project', onclick: "navigate('projects')" },
          })}
        </div>`;
      return;
    }

    // Build the version set across all projects.
    let allVersions = [];
    for (const p of projects) {
      const versions = await API.projects.versions(p.id);
      allVersions.push(...versions.map(v => ({ ...v, projectName: p.name })));
    }

    // Resolve the selected project, then the version within it.
    let selectedProjectId = params.projectId;
    if (!selectedProjectId && params.versionId) {
      selectedProjectId = allVersions.find(v => v.id === params.versionId)?.projectId;
    }
    if (!selectedProjectId) {
      selectedProjectId = (projects.find(p => allVersions.some(v => v.projectId === p.id)) || projects[0])?.id;
    }

    const projectVersions = allVersions.filter(v => v.projectId === selectedProjectId);
    let selectedVid = params.versionId;
    if (!selectedVid || !projectVersions.some(v => v.id === selectedVid)) {
      selectedVid = projectVersions[0]?.id;
    }

    const projectOpts = projects.map(p =>
      `<option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>${esc(p.name)}</option>`
    ).join('');
    const versionOpts = projectVersions.map(v =>
      `<option value="${v.id}" ${v.id === selectedVid ? 'selected' : ''}>${esc(v.name)}</option>`
    ).join('');

    const selectedVersion = allVersions.find(v => v.id === selectedVid);

    let dashData = null, recentActivity = [], dashTests = [], pendingApprovals = [];
    if (selectedVid) {
      [dashData, recentActivity, dashTests, pendingApprovals] = await Promise.all([
        API.dashboard(selectedVid),
        API.audit({ limit: 40 }).catch(() => []),
        API.tests.forVersion(selectedVid).catch(() => []),
        API.approvals({ status: 'PENDING' }).catch(() => []),
      ]);
    }

    // Scope pending approvals to this version (legacy per-verification rows are
    // matched by their versionTestId).
    const vtIdSet = new Set(dashTests.map(t => t.id));
    const versionApprovals = pendingApprovals.filter(a =>
      a.scope === 'VERSION' ? a.versionId === selectedVid : vtIdSet.has(a.versionTestId));

    // Filter state for the verification table + KPI strip.
    _dashTests = dashTests;
    _dashCtx = { projectId: selectedVersion?.projectId, versionId: selectedVid };
    _dashFilter = null;

    const s = dashData?.stats || {};
    const u = dashData?.unitStats || {};   // per-setup units for the readiness progress line
    const verdict = readinessVerdict(u);
    const attention = (s.failed || 0) + (s.blocked || 0) + (s.inProgress || 0) + versionApprovals.length;

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1>${esc(dashGreeting())}</h1>
          <p class="subtitle">${dashSinceLastVisit(recentActivity)}</p>
        </div>
        <div class="btn-row">
          <button class="btn-secondary" onclick="navigate('projects')">${ICONS.plus} New Version</button>
        </div>
      </div>

      <div class="version-selector">
        <label for="dash-project-select" class="t-label" style="text-transform:uppercase;letter-spacing:0.7px;font-size:11px;font-weight:600">Project</label>
        <select id="dash-project-select" onchange="switchDashProject(this.value)" style="max-width:280px;width:auto">
          ${projectOpts}
        </select>
        <label for="dash-version-select" class="t-label" style="text-transform:uppercase;letter-spacing:0.7px;font-size:11px;font-weight:600">Version</label>
        <select id="dash-version-select" onchange="switchDashVersion(this.value)" style="max-width:280px;width:auto">
          ${versionOpts}
        </select>
        ${dashData ? badge(dashData.version.status) : ''}
      </div>

      ${dashData ? `
      <div class="page-body">
        <div class="dash-grid-top">
          <section class="card wq-card">
            <div class="card-header">
              <span class="card-title" style="font-size:14px">${ICONS.clock} Continue where you left off</span>
              <span class="badge badge-not_started no-dot">${attention}</span>
            </div>
            ${dashWorkQueueHtml(dashTests, versionApprovals, s, selectedVid)}
          </section>

          <section class="card readiness-card">
            <div class="card-header">
              <span class="card-title" style="font-size:14px">Release readiness</span>
              <span class="rd-verdict tone-${verdict.tone}">${esc(verdict.label)}</span>
            </div>
            ${dashReadinessHtml(u)}
          </section>
        </div>

        <section class="card flush" id="dash-verif-card" style="margin-bottom:16px">
          <div class="card-header">
            <span class="card-title" style="font-size:14px">Verifications</span>
            <button class="btn-ghost btn-sm" onclick="openDashFilterInVersion()">Open in version view ${ICONS.arrowR}</button>
          </div>
          ${dashStatStripHtml(s)}
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th style="width:120px">ID</th>
                <th>Title</th>
                <th style="width:150px">Actions</th>
                <th>Tags</th>
                <th style="width:160px">Status</th>
              </tr></thead>
              <tbody id="dash-verif-rows"></tbody>
            </table>
          </div>
          <div class="t-meta" id="dash-verif-foot" style="padding:9px 20px;border-top:1px solid var(--border-subtle)"></div>
        </section>

        <section class="card">
          <div class="card-header">
            <span class="card-title" style="font-size:14px">Recent activity</span>
            <button class="btn-ghost btn-sm" onclick="navigate('audit')">View audit trail ${ICONS.arrowR}</button>
          </div>
          ${recentActivity.length
            ? `<div class="feed">${recentActivity.slice(0, 10).map(feedItem).join('')}</div>`
            : '<p class="text-muted" style="padding:8px 0">No recent activity.</p>'}
        </section>
      </div>
      ` : `<div class="page-body">${emptyState('Select a version', 'Choose a project and version above to open its command center.')}</div>`}
    `;

    renderDashVerifRows();
  } catch (err) {
    el.innerHTML = `<div class="page-body"><div class="form-error">${ICONS.alert} ${esc(err.message)}</div></div>`;
  }
}

// ── Personalization ───────────────────────────────────────────────────────────
function dashGreeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const first = (currentUser?.name || currentUser?.username || '').split(/\s+/)[0] || 'there';
  return `${part}, ${first}`;
}

// Counts audit entries newer than this user's previous visit, then records now.
function dashSinceLastVisit(activity) {
  const uid = currentUser?.id || 'anon';
  const key = `mq:dash:lastVisit:${uid}`;
  const role = typeof roleLabel === 'function' ? roleLabel(currentUser?.role) : (currentUser?.role || '');
  const suffix = role ? ` · ${esc(role)}` : '';
  let prev = null;
  try { prev = localStorage.getItem(key); } catch {}
  try { localStorage.setItem(key, new Date().toISOString()); } catch {}

  if (!prev) return `Your verification command center${suffix}`;
  const cut = new Date(prev).getTime();
  const n = activity.filter(a => new Date(a.timestamp || a.createdAt).getTime() > cut).length;
  if (n === 0) return `No new activity since your last visit${suffix}`;
  const plus = (activity.length >= 40 && n >= 40) ? '+' : '';
  return `${n}${plus} update${n === 1 ? '' : 's'} since your last visit${suffix}`;
}

// ── Work queue ("Needs your attention") ───────────────────────────────────────
function dashWorkQueueHtml(vTests, approvals, s, versionId) {
  const byStatus = st => vTests.filter(t => t.status === st);
  const inProgress = byStatus('IN_PROGRESS').sort(dashByLastExecDesc).slice(0, 5);
  const failed     = byStatus('FAILED').sort(dashByLastExecDesc).slice(0, 5);
  const blocked    = byStatus('BLOCKED').slice(0, 5);

  const groups = [];

  if (inProgress.length) groups.push(dashWqGroup('',
    inProgress.map(vt => dashWqRow(vt, { kind: 'resume', btnClass: 'btn-primary', icon: ICONS.play, action: 'Resume', onclick: dashExecNav(vt), progress: dashResumeProgress(vt) }))));

  if (failed.length) groups.push(dashWqGroup('Investigate failures',
    failed.map(vt => dashWqRow(vt, { kind: 'fail', btnClass: 'btn-secondary', action: 'Review', onclick: `openTestContentModal('${vt.id}','${versionId}')`, secondary: { label: 'Re-execute', onclick: dashExecNav(vt) } }))));

  if (blocked.length) groups.push(dashWqGroup('Unblock',
    blocked.map(vt => dashWqRow(vt, { kind: 'blocked', btnClass: 'btn-secondary', action: 'Open', onclick: `openTestContentModal('${vt.id}','${versionId}')` }))));

  if (approvals.length) groups.push(dashWqGroup('Pending approvals',
    approvals.slice(0, 5).map(a => dashWqApprovalRow(a))));

  // A genuine "jump back in" list, scoped to this version, for items not already
  // shown above.
  const shownIds = new Set([...inProgress, ...failed, ...blocked].map(t => t.id));
  const recents = getRecentVerifications()
    .filter(r => r.versionId === versionId && !shownIds.has(r.versionTestId))
    .slice(0, 3);
  if (recents.length) groups.push(dashWqGroup('Jump back in',
    recents.map(r => dashWqRecentRow(r))));

  if (!groups.length) {
    const notStarted = byStatus('NOT_STARTED');
    return `
      <div class="wq-empty">
        <div class="wq-empty-icon">${ICONS.check}</div>
        <div style="flex:1">
          <div class="bold">You're all caught up</div>
          <div class="text-muted text-sm">Nothing needs attention in this version${notStarted.length ? ` — ${notStarted.length} verification${notStarted.length === 1 ? '' : 's'} not started yet.` : '.'}</div>
        </div>
        ${notStarted.length ? `<button class="btn-secondary btn-sm" onclick="filterDashTests('NOT_STARTED')">View not started</button>` : ''}
      </div>`;
  }
  return `<div class="wq-list">${groups.join('')}</div>`;
}

function dashByLastExecDesc(a, b) { return (b.lastExecutedAt || '').localeCompare(a.lastExecutedAt || ''); }

function dashExecNav(vt) {
  const { projectId, versionId } = _dashCtx;
  return `navigate('test-execute',{versionTestId:'${vt.id}',versionId:'${versionId}',projectId:'${projectId}'})`;
}

function dashAssignedToMe(vt) {
  return vt.assignedTo && currentUser && vt.assignedTo === currentUser.id;
}

// Real progress for setup-tracked runs (setups executed / total). Standard tests
// don't expose step-level progress here, so they fall back to a "last run" note.
function dashResumeProgress(vt) {
  const c = vt.versionCoverage;
  if (vt.test?.type === 'SETUP_TRACKED' && c && c.total) {
    return { done: c.executed, total: c.total, unit: 'setups' };
  }
  return null;
}

function dashWqGroup(title, rows) {
  const head = title ? `<div class="wq-group-head">${esc(title)}</div>` : '';
  return `<div class="wq-group">${head}${rows.join('')}</div>`;
}

function dashWqRow(vt, o) {
  const pct = o.progress && o.progress.total ? Math.round((o.progress.done / o.progress.total) * 100) : 0;
  const progress = o.progress
    ? `<div class="wq-progress"><div class="wq-progress-bar"><span style="width:${pct}%"></span></div><span class="wq-progress-label">${o.progress.done}/${o.progress.total} ${esc(o.progress.unit || '')}</span></div>`
    : (vt.lastExecutedAt ? `<span class="wq-meta">last run ${relTime(vt.lastExecutedAt)}</span>` : '');
  const secondary = o.secondary ? `<button class="btn-ghost btn-sm" onclick="${o.secondary.onclick}">${esc(o.secondary.label)}</button>` : '';
  return `
    <div class="wq-item wq-${o.kind}">
      <div class="wq-main">
        <div class="wq-title-row">
          <span class="mono wq-id">${esc(vt.test?.testId || '—')}</span>
          <span class="clickable-title" onclick="openTestContentModal('${vt.id}','${_dashCtx.versionId}')">${esc(vt.test?.title || '—')}</span>
          ${dashAssignedToMe(vt) ? '<span class="wq-assigned">Assigned to you</span>' : ''}
        </div>
        ${progress}
      </div>
      <div class="wq-actions">
        ${secondary}
        <button class="${o.btnClass}" onclick="${o.onclick}" style="padding:5px 11px;font-size:12px">${o.icon || ''} ${esc(o.action)}</button>
      </div>
    </div>`;
}

function dashWqApprovalRow(a) {
  return `
    <div class="wq-item wq-approval">
      <div class="wq-main">
        <div class="wq-title-row">
          <span class="clickable-title" onclick="navigate('approvals')">${esc(a.label || a.testTitle || 'Version approval')}</span>
        </div>
        <span class="wq-meta">requested ${relTime(a.createdAt)}${a.requesterName ? ` · ${esc(a.requesterName)}` : ''}</span>
      </div>
      <div class="wq-actions"><button class="btn-secondary btn-sm" onclick="navigate('approvals')">Review</button></div>
    </div>`;
}

function dashWqRecentRow(r) {
  const { projectId, versionId } = _dashCtx;
  const go = `navigate('test-execute',{versionTestId:'${r.versionTestId}',versionId:'${versionId}',projectId:'${projectId}'})`;
  return `
    <div class="wq-item wq-recent">
      <div class="wq-main">
        <div class="wq-title-row">
          <span class="mono wq-id">${esc(r.testId || '—')}</span>
          <span class="clickable-title" onclick="${go}">${esc(r.title || 'Verification')}</span>
        </div>
        <span class="wq-meta">opened ${relTime(r.at)}</span>
      </div>
      <div class="wq-actions"><button class="btn-ghost btn-sm" onclick="${go}">Open</button></div>
    </div>`;
}

// ── Release readiness + coverage ──────────────────────────────────────────────
// Verdict from unit stats (no pending-approval / partial concepts here).
function readinessVerdict(u) {
  const total = u.total || 0;
  if (!total) return { label: 'No tests', tone: 'neutral' };
  if ((u.failed || 0) > 0 || (u.blocked || 0) > 0) return { label: 'At risk', tone: 'fail' };
  if ((u.notStarted || 0) > 0 || (u.inProgress || 0) > 0) return { label: 'In progress', tone: 'info' };
  return { label: 'Ready for release', tone: 'pass' };
}

// Readiness is unit-based: setup-verification couples are counted individually,
// so the percentages and the bar reflect per-setup pass/fail/blocked.
function dashReadinessHtml(u) {
  const total   = u.total || 0;
  const passed  = u.passed || 0, failed = u.failed || 0, blocked = u.blocked || 0;
  const covered = passed + failed;   // terminal verdicts (excludes Blocked / In Progress / Not Started)
  const remaining = total - covered;
  const pct = (n) => total ? Math.round((n / total) * 100) : 0;
  // Each row's colour reflects what the metric *is*, aligned with the app palette.
  const rows = [
    ['Passed',  `${pct(passed)}%`,  'pass'],     // green
    ['Failed',  `${pct(failed)}%`,  'fail'],     // red
    ['Blocked', `${pct(blocked)}%`, 'blocked'],  // dark red
  ];
  return `
    <div class="readiness-coverage">
      <div class="rc-pct">${pct(covered)}<span class="rc-unit">%</span></div>
      <div class="rc-meta">
        <div class="rc-cap">Coverage</div>
        <div class="text-muted text-sm">${covered} of ${total} completed · ${remaining} remaining</div>
      </div>
    </div>
    <div class="readiness-bar">${segmentedBar(statusSegments(u), { legend: false })}</div>
    <div class="readiness-checklist">
      ${rows.map(([l, v, tone]) => `
        <div class="rd-row">
          <span class="rd-dot tone-${tone}"></span>
          <span class="rd-label">${esc(l)}</span>
          <span class="rd-val">${v}</span>
        </div>`).join('')}
    </div>`;
}

// ── Compact KPI strip (doubles as table filters) ──────────────────────────────
function dashStatStripHtml(s) {
  // Every chip is a real, clickable filter button; the tone tints only its number.
  const chip = (label, value, status, tone) =>
    `<button class="stat-chip${tone ? ` tone-${tone}` : ''}${status === 'ALL' ? ' selected' : ''}" data-status="${status}" onclick="filterDashTests('${status}')">
      <span class="sc-val">${value ?? 0}</span><span class="sc-label">${esc(label)}</span>
    </button>`;
  return `
    <div class="stat-strip" id="dash-kpis">
      ${chip('All', s.total ?? 0, 'ALL', null)}
      ${chip('Not Started', s.notStarted ?? 0, 'NOT_STARTED', 'neutral')}
      ${chip('In Progress', s.inProgress ?? 0, 'IN_PROGRESS', 'info')}
      ${chip('Blocked', s.blocked ?? 0, 'BLOCKED', 'blocked')}
      ${chip('Failed', s.failed ?? 0, 'FAILED', 'fail')}
      ${chip('Partial', s.partial ?? 0, 'PARTIAL', 'warn')}
      ${chip('Passed', s.passed ?? 0, 'PASSED', 'pass')}
    </div>`;
}

// ── Verification table (priority-ordered, filtered in place) ──────────────────
function dashRowRank(vt) {
  return DASH_PRIORITY[vt.status] ?? 6;
}

function dashVerifRowHtml(vt) {
  const { projectId, versionId } = _dashCtx;
  return `
    <tr data-status="${esc(vt.status || '')}">
      <td class="mono">${esc(vt.test?.testId || '—')}</td>
      <td><span class="clickable-title" onclick="openTestContentModal('${vt.id}','${versionId}')">${esc(vt.test?.title || '—')}</span></td>
      <td>
        <div style="display:inline-flex;gap:6px;flex-wrap:nowrap">
          <button class="btn-secondary btn-sm" onclick="navigate('test-execute',{versionTestId:'${vt.id}',versionId:'${versionId}',projectId:'${projectId}'})">${ICONS.play} Execute</button>
          <button class="btn-ghost btn-sm" onclick="openTestContentModal('${vt.id}','${versionId}')">View</button>
        </div>
      </td>
      <td>${(vt.test?.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</td>
      <td>${badge(vt.status)}</td>
    </tr>`;
}

function renderDashVerifRows() {
  const tbody = document.getElementById('dash-verif-rows');
  if (!tbody) return;
  let list = (_dashFilter ? _dashTests.filter(vt => vt.status === _dashFilter) : _dashTests.slice());
  // Attention items first; recent runs break ties.
  list.sort((a, b) => {
    const ra = dashRowRank(a), rb = dashRowRank(b);
    if (ra !== rb) return ra - rb;
    return (b.lastExecutedAt || '').localeCompare(a.lastExecutedAt || '');
  });
  const shown = list.slice(0, DASH_VERIF_CAP);
  tbody.innerHTML = shown.length
    ? shown.map(dashVerifRowHtml).join('')
    : `<tr><td colspan="5" class="table-empty-cell">No verifications${_dashFilter ? ` are ${DASH_STATUS_LABELS[_dashFilter] || 'in this status'}` : ' in this version'}.</td></tr>`;

  const foot = document.getElementById('dash-verif-foot');
  if (foot) foot.innerHTML = list.length > shown.length
    ? `Showing ${shown.length} of ${list.length}, attention items first. <a href="#" onclick="openDashFilterInVersion();return false">Open in version view →</a>`
    : `${list.length} verification${list.length === 1 ? '' : 's'}${_dashFilter ? ' shown' : ', attention items first'}`;
}

function filterDashTests(status) {
  _dashFilter = (status === 'ALL' || status === _dashFilter) ? null : status;
  document.querySelectorAll('#dash-kpis [data-status]').forEach(c => {
    const cs = c.dataset.status;
    c.classList.toggle('selected', _dashFilter ? cs === _dashFilter : cs === 'ALL');
  });
  renderDashVerifRows();
}

function openDashFilterInVersion() {
  const { projectId, versionId } = _dashCtx;
  if (!projectId || !versionId) return;
  navigate('version-detail', { projectId, versionId, status: _dashFilter || 'ALL' });
}

function switchDashVersion(vid) {
  navigate('dashboard', { versionId: vid });
}

// Switching project loads that project's first version (no versionId carried).
function switchDashProject(pid) {
  navigate('dashboard', { projectId: pid });
}
