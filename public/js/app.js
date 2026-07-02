// public/js/app.js — App bootstrap, auth, navigation, topbar (search / notifications / account)

let currentUser = null;
let currentPage = 'dashboard';

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  applyStoredTheme();

  // Invite acceptance link: /?invite=<token> — show the set-password view (pre-auth).
  const inviteToken = new URLSearchParams(location.search).get('invite');
  if (inviteToken) { return showInvite(inviteToken); }

  try {
    const { user } = await API.auth.me();
    if (user) {
      currentUser = user;
      showApp();
      // Deep link support: restore page from URL hash (e.g. #/tests)
      const { page, params } = parseHash();
      navigate(page, params, false);
      history.replaceState({ page, params }, '', hashFor(page, params));
      pollApprovalBadge();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
});

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  // Update sidebar + topbar user info
  const name = currentUser.name || currentUser.username || '?';
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-role').textContent = roleLabel(currentUser.role);
  document.getElementById('user-avatar').textContent = name[0].toUpperCase();
  const topAvatar = document.getElementById('topbar-avatar');
  if (topAvatar) topAvatar.textContent = name[0].toUpperCase();
}

function roleLabel(role) {
  const labels = {
    ADMIN: 'Administrator', APPROVER: 'Approver', QA_ENGINEER: 'QA Engineer',
  };
  return labels[role] || role || '—';
}

// ── Auth handlers ─────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const pw = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  try {
    errEl.classList.add('hidden');
    const { user } = await API.auth.login(username, pw);
    currentUser = user;
    showApp();
    navigate('dashboard');
    pollApprovalBadge();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

// ── Invite acceptance ───────────────────────────────────────────────────────
async function showInvite(token) {
  document.getElementById('app').classList.add('hidden');
  const loginScreen = document.getElementById('login-screen');
  loginScreen.classList.remove('hidden');
  document.getElementById('login-form').classList.add('hidden');
  const inviteForm = document.getElementById('invite-form');
  const errEl = document.getElementById('invite-error');
  try {
    const invite = await API.auth.getInvite(token);
    document.getElementById('invite-name').value = invite.name || '';
    document.getElementById('invite-username').value = invite.username || '';
    inviteForm.dataset.token = token;
    inviteForm.classList.remove('hidden');
  } catch (err) {
    inviteForm.classList.remove('hidden');
    inviteForm.querySelectorAll('input, button').forEach(el => { el.disabled = true; });
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function handleAcceptInvite(e) {
  e.preventDefault();
  const token = document.getElementById('invite-form').dataset.token;
  const pw  = document.getElementById('invite-password').value;
  const pw2 = document.getElementById('invite-password2').value;
  const errEl = document.getElementById('invite-error');
  errEl.classList.add('hidden');
  if (pw !== pw2) {
    errEl.textContent = 'Passwords do not match';
    errEl.classList.remove('hidden');
    return;
  }
  try {
    const { user } = await API.auth.acceptInvite(token, pw);
    currentUser = user;
    // Drop the ?invite token from the URL, then enter the app.
    history.replaceState({}, '', '/');
    showApp();
    navigate('dashboard');
    pollApprovalBadge();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function logout() {
  await API.auth.logout();
  currentUser = null;
  closePopovers();
  showLogin();
}

// ── Navigation ────────────────────────────────────────────────────────────────
// All navigable pages. 'project-versions' renders into the projects page element.
const PAGES = new Set([
  'dashboard', 'projects', 'project-versions', 'tests', 'trackers', 'import',
  'approvals', 'audit', 'admin', 'version-detail', 'test-execute',
]);

function navigate(page, params = {}, push = true) {
  if (!PAGES.has(page)) page = 'dashboard';
  closePopovers();

  // Leaving the execution screen (back link, popstate, any nav all route here):
  // bank the open on-screen segment and persist the draft so accrued time isn't
  // lost. Re-navigating within test-execute (e.g. setup deep-links) is not a leave.
  if (currentPage === 'test-execute' && page !== 'test-execute') {
    if (typeof flushExecTiming === 'function') flushExecTiming();
    if (typeof saveDraftNow === 'function') saveDraftNow();
  }

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });

  // Update nav active state ('project-versions' lives under Projects)
  const navPage = page === 'project-versions' ? 'projects' : page;
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === navPage);
  });

  const pageEl = document.getElementById(`page-${page === 'project-versions' ? 'projects' : page}`);
  if (pageEl) {
    pageEl.classList.remove('hidden');
    pageEl.classList.add('active');
  }
  currentPage = page;

  // Record history so the browser Back/Forward buttons work
  if (push) history.pushState({ page, params }, '', hashFor(page, params));

  // Render page content
  switch (page) {
    case 'dashboard':        renderDashboard(params); break;
    case 'projects':         renderProjects(params);  break;
    case 'project-versions': openProjectVersions(params.projectId); break;
    case 'tests':            renderTests(params);     break;
    case 'trackers':         renderTrackers(params);  break;
    case 'import':           renderImport(params);    break;
    case 'approvals':        renderApprovals(params); break;
    case 'audit':            renderAudit(params);     break;
    case 'admin':            renderAdmin(params);     break;
    case 'version-detail':   renderVersionDetail(params); break;
    case 'test-execute':     renderTestExecute(params);   break;
  }
}

function hashFor(page, params = {}) {
  const q = new URLSearchParams(params).toString();
  return `#/${page}${q ? '?' + q : ''}`;
}

function parseHash() {
  const m = location.hash.match(/^#\/([\w-]+)(?:\?(.*))?$/);
  if (!m || !PAGES.has(m[1])) return { page: 'dashboard', params: {} };
  return { page: m[1], params: Object.fromEntries(new URLSearchParams(m[2] || '')) };
}

// Browser Back/Forward → re-render the recorded page without pushing again
window.addEventListener('popstate', (e) => {
  if (!currentUser) return;
  closeModal();
  const target = (e.state && e.state.page) ? e.state : parseHash();
  navigate(target.page, target.params || {}, false);
});

// ── Popovers (notifications / user menu) ──────────────────────────────────────
function closePopovers() {
  document.querySelectorAll('.popover').forEach(p => p.classList.add('hidden'));
  const sr = document.getElementById('search-results');
  if (sr) sr.classList.add('hidden');
}

// Close any open popover when clicking elsewhere
document.addEventListener('click', (e) => {
  if (!e.target.closest('.notif-wrap, .usermenu-wrap, .topbar-search')) closePopovers();
});

// ── Notifications ─────────────────────────────────────────────────────────────
let _pendingApprovals = [];

function toggleNotifications(e) {
  e.stopPropagation();
  const pop = document.getElementById('notif-popover');
  const wasHidden = pop.classList.contains('hidden');
  closePopovers();
  if (!wasHidden) return;

  pop.innerHTML = `
    <div class="popover-header">Notifications
      ${_pendingApprovals.length ? `<span class="badge badge-pending no-dot">${_pendingApprovals.length} pending</span>` : ''}
    </div>
    <div class="popover-body">
      ${_pendingApprovals.length === 0
        ? '<div class="popover-empty">You’re all caught up.<br>No pending approvals.</div>'
        : _pendingApprovals.slice(0, 6).map(a => `
          <div class="popover-item" onclick="navigate('approvals')">
            <div class="pi-icon" style="background:var(--warn-dim);color:var(--warn)">${ICONS.clock}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.label || a.testTitle || 'Approval request')}</div>
              <div class="t-meta">Awaiting approval · ${relTime(a.createdAt)}</div>
            </div>
          </div>`).join('')}
    </div>
    ${_pendingApprovals.length ? `
    <div class="popover-footer">
      <button class="btn-ghost btn-sm" onclick="navigate('approvals')">View all approvals ${ICONS.arrowR}</button>
    </div>` : ''}`;
  pop.classList.remove('hidden');
}

// ── User menu ─────────────────────────────────────────────────────────────────
function toggleUserMenu(e) {
  e.stopPropagation();
  const pop = document.getElementById('user-popover');
  const wasHidden = pop.classList.contains('hidden');
  closePopovers();
  if (!wasHidden) return;

  const name = currentUser?.name || currentUser?.username || '?';
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  pop.innerHTML = `
    <div class="user-menu-head">
      <div class="user-avatar">${esc(name[0].toUpperCase())}</div>
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</div>
        <div class="t-meta">${esc(roleLabel(currentUser?.role))}</div>
      </div>
    </div>
    <div style="padding:5px">
      <button class="menu-item" onclick="toggleTheme();toggleUserMenu(event)">
        ${isDark
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> Switch to light theme'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> Switch to dark theme'}
      </button>
      <button class="menu-item" onclick="navigate('admin')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>
        Admin &amp; settings
      </button>
      <button class="menu-item" onclick="toggleUserMenu(event);openChangePasswordModal()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Change password
      </button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" onclick="logout()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Sign out
      </button>
    </div>`;
  pop.classList.remove('hidden');
}

function openChangePasswordModal() {
  openModal('Change password', `
    <div class="field-group">
      <label for="cp-current">Current password</label>
      <input type="password" id="cp-current" autocomplete="current-password">
    </div>
    <div class="field-group">
      <label for="cp-new">New password</label>
      <input type="password" id="cp-new" autocomplete="new-password" placeholder="Minimum 8 characters">
    </div>
    <div class="field-group">
      <label for="cp-new2">Confirm new password</label>
      <input type="password" id="cp-new2" autocomplete="new-password">
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="submitChangePassword()">Update password</button>
    </div>`);
}

async function submitChangePassword() {
  const current = document.getElementById('cp-current').value;
  const next  = document.getElementById('cp-new').value;
  const next2 = document.getElementById('cp-new2').value;
  if (next.length < 8) return toast('New password must be at least 8 characters', 'error');
  if (next !== next2)   return toast('Passwords do not match', 'error');
  try {
    await API.auth.changePassword(current, next);
    closeModal();
    toast('Password updated', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// ── Global search ─────────────────────────────────────────────────────────────
const SEARCH_PAGES = [
  { label: 'Dashboard', page: 'dashboard' },
  { label: 'Projects', page: 'projects' },
  { label: 'Verifications Library', page: 'tests' },
  { label: 'Setup Trackers', page: 'trackers' },
  { label: 'Import Verifications', page: 'import' },
  { label: 'Approvals', page: 'approvals' },
  { label: 'Audit Trail', page: 'audit' },
  { label: 'Admin', page: 'admin' },
];

let _searchTimer = null;

function onGlobalSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(runGlobalSearch, 220);
}

async function runGlobalSearch() {
  const input = document.getElementById('global-search');
  const box = document.getElementById('search-results');
  const q = input.value.trim();
  if (!q) { box.classList.add('hidden'); return; }

  const ql = q.toLowerCase();
  const pageHits = SEARCH_PAGES.filter(p => p.label.toLowerCase().includes(ql));

  let testHits = [];
  try {
    testHits = (await API.tests.list({ search: q })).slice(0, 8);
  } catch {}

  if (!pageHits.length && !testHits.length) {
    box.innerHTML = `<div class="search-empty">No results for “${esc(q)}”</div>`;
    box.classList.remove('hidden');
    return;
  }

  box.innerHTML = `
    ${pageHits.length ? `
      <div class="search-result-group">Pages</div>
      ${pageHits.map(p => `
        <div class="search-result" onclick="searchGo('${p.page}')">
          ${ICONS.arrowR}<span class="sr-title">${esc(p.label)}</span>
        </div>`).join('')}` : ''}
    ${testHits.length ? `
      <div class="search-result-group">Verifications</div>
      ${testHits.map(t => `
        <div class="search-result" onclick="searchGoTest('${esc(t.testId || '')}')">
          ${ICONS.doc}
          <span class="sr-title">${esc(t.title)}</span>
          <span class="sr-meta">${esc(t.testId || '')}</span>
        </div>`).join('')}` : ''}`;
  box.classList.remove('hidden');
}

function searchGo(page) {
  clearGlobalSearch();
  navigate(page);
}

function searchGoTest(testId) {
  const q = document.getElementById('global-search').value.trim();
  clearGlobalSearch();
  navigate('tests', { search: testId || q });
}

function clearGlobalSearch() {
  const input = document.getElementById('global-search');
  input.value = '';
  document.getElementById('search-results').classList.add('hidden');
  input.blur();
}

// Keyboard: "/" focuses global search (unless typing in a field)
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey &&
      !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
    const input = document.getElementById('global-search');
    if (input && currentUser) { e.preventDefault(); input.focus(); }
  }
});

// ── Approval badge polling ────────────────────────────────────────────────────
async function pollApprovalBadge() {
  if (!currentUser) return; // stop polling after logout
  try {
    const approvals = await API.approvals({ status: 'PENDING' });
    _pendingApprovals = approvals;
    const badge = document.getElementById('approval-badge');
    const dot = document.getElementById('notif-dot');
    if (approvals.length > 0) {
      badge.textContent = approvals.length;
      badge.classList.remove('hidden');
      if (dot) { dot.textContent = approvals.length > 9 ? '9+' : approvals.length; dot.classList.remove('hidden'); }
    } else {
      badge.classList.add('hidden');
      if (dot) dot.classList.add('hidden');
    }
  } catch {}
  clearTimeout(window._approvalTimer);
  window._approvalTimer = setTimeout(pollApprovalBadge, 30000);
}
