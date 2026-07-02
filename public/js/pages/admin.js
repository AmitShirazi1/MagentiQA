// public/js/pages/admin.js — User management & system info

async function renderAdmin(params = {}) {
  const el = document.getElementById('page-admin');
  el.innerHTML = skeletonPage();
  try {
    const isAdmin = currentUser?.role === 'ADMIN';
    const [users, backups, invites] = await Promise.all([
      API.users(),
      isAdmin ? API.backups().catch(() => []) : Promise.resolve([]),
      isAdmin ? API.listInvites().catch(() => []) : Promise.resolve([]),
    ]);
    el.innerHTML = `
      <div class="page-header">
        <div><h1>Admin</h1><p class="subtitle">User management, data export &amp; integrations</p></div>
      </div>
      <div class="page-body">
        <div class="card flush mb-16">
          <div class="card-header">
            <span class="card-title">Users</span>
            <div style="display:flex;align-items:center;gap:12px">
              <span class="t-meta">${users.length} user${users.length === 1 ? '' : 's'}</span>
              ${isAdmin ? `<button class="btn-primary btn-sm" onclick="openInviteUserModal()">${ICONS.plus || ''} Invite user</button>` : ''}
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr>
                ${sortableTH('Name')}
                ${sortableTH('Username')}
                ${sortableTH('Role')}
                ${sortableTH('Status')}
                ${sortableTH('Joined')}
                <th style="width:160px">Actions</th>
              </tr></thead>
              <tbody>
                ${users.map(u => {
                  const active = u.active !== false;
                  const isSelf = u.id === currentUser?.id;
                  return `
                  <tr${active ? '' : ' class="row-muted"'}>
                    <td>
                      <div style="display:flex;align-items:center;gap:10px">
                        <div class="user-avatar neutral" style="width:26px;height:26px;font-size:10.5px">${esc((u.name || u.username || '?')[0].toUpperCase())}</div>
                        <span class="bold">${esc(u.name || '—')}</span>
                      </div>
                    </td>
                    <td class="mono">${esc(u.username)}</td>
                    <td data-sort="${esc(u.role)}">${badge(u.role)}</td>
                    <td data-sort="${active ? 'active' : 'inactive'}">${badge(active ? 'active' : 'inactive')}</td>
                    <td class="t-meta" data-sort="${u.createdAt || ''}">${relTime(u.createdAt)}</td>
                    <td>
                      ${currentUser?.role === 'ADMIN' ? `
                        <div class="btn-row" style="gap:4px">
                          <button class="btn-ghost btn-sm" onclick="openEditUserModal('${u.id}','${esc(u.name || '')}','${u.role}')">${ICONS.edit} Role</button>
                          <button class="btn-ghost btn-sm" onclick="openResetPasswordModal('${u.id}','${esc(u.name || u.username)}')">Reset password</button>
                          ${isSelf ? '' : (active
                            ? `<button class="btn-ghost btn-sm danger" onclick="setUserActive('${u.id}', false)">Deactivate</button>`
                            : `<button class="btn-ghost btn-sm" onclick="setUserActive('${u.id}', true)">Reactivate</button>`)}
                        </div>`
                        : '<span class="text-muted text-sm">—</span>'}
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        ${isAdmin && invites.length ? `
        <div class="card flush mb-16">
          <div class="card-header">
            <span class="card-title">Pending invites</span>
            <span class="t-meta">${invites.length} pending</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>Name</th><th>Username</th><th>Role</th><th>Expires</th>
                <th style="width:200px">Actions</th>
              </tr></thead>
              <tbody>
                ${invites.map(i => `
                  <tr>
                    <td class="bold">${esc(i.name || '—')}</td>
                    <td class="mono">${esc(i.username)}</td>
                    <td>${badge(i.role)}</td>
                    <td class="t-meta">${relTime(i.expiresAt)}</td>
                    <td>
                      <div class="btn-row" style="gap:4px">
                        <button class="btn-ghost btn-sm" onclick="copyInviteLink('${esc(i.url)}')">${ICONS.copy || ''} Copy link</button>
                        <button class="btn-ghost btn-sm danger" onclick="revokeInvite('${i.id}')">Revoke</button>
                      </div>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}

        ${isAdmin ? `
        <div class="card flush mb-16">
          <div class="card-header">
            <span class="card-title">Backup &amp; Restore</span>
          </div>
          <div style="padding:14px 16px">
            <p class="text-sm text-secondary mb-16">
              Saves a complete, timestamped snapshot (a <em>.zip</em> image) of the database,
              all uploaded files and the full application code into the
              <span class="mono">backups/</span> folder. Use it before risky changes, or to
              recover an old version of the code or data after a mistake. To restore: unzip,
              run <span class="mono">npm install</span>, then <span class="mono">npm start</span>.
            </p>
            <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap" class="mb-16">
              <div class="field-group" style="margin:0;flex:1;min-width:220px">
                <label for="backup-label">Optional label</label>
                <input type="text" id="backup-label"
                  maxlength="60" autocomplete="off"
                  oninput="onBackupLabelInput()">
                <span class="text-sm text-muted" id="backup-name-preview"></span>
              </div>
              <button class="btn-primary" id="backup-btn" onclick="runBackup()">${ICONS.download} Create Backup</button>
            </div>
            <div id="backup-list">${backupListHtml(backups)}</div>
          </div>
        </div>` : ''}

        <div class="grid-2">
          <div class="card">
            <div class="card-title" style="margin-bottom:6px">Data Export</div>
            <p class="text-sm text-secondary mb-16">Download the full verification library for backup or external processing.</p>
            <div class="btn-row">
              <a href="${API.exportTests()}" class="btn-secondary" download>${ICONS.download} Export All Verifications (JSON)</a>
            </div>
          </div>

          <div class="card">
            <div class="card-title" style="margin-bottom:6px">CI/CD Integration</div>
            <p class="text-sm text-secondary mb-16">Send automated test results from Jenkins/CI via webhook:</p>
            <div class="code-block">POST /api/executions/ci<br>
Authorization: Bearer &lt;MAGENTIQA_CI_API_KEY from .env&gt;<br><br>
{<br>
&nbsp;&nbsp;"versionTestId": "...",<br>
&nbsp;&nbsp;"result": "PASSED" | "FAILED",<br>
&nbsp;&nbsp;"swVersion": "v2.4.1",<br>
&nbsp;&nbsp;"buildNumber": "204",<br>
&nbsp;&nbsp;"ciJobUrl": "...",<br>
&nbsp;&nbsp;"logs": "optional log output"<br>
}</div>
          </div>
        </div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="page-body"><div class="form-error">${ICONS.alert} ${esc(err.message)}</div></div>`;
  }
}

function openEditUserModal(id, name, role) {
  openModal('Edit User Role', `
    <div class="field-group">
      <label for="eu-name">User</label>
      <input type="text" id="eu-name" value="${esc(name)}" disabled>
    </div>
    <div class="field-group">
      <label for="eu-role">Role</label>
      <select id="eu-role">
        ${['ADMIN', 'APPROVER', 'QA_ENGINEER'].map(r =>
          `<option value="${r}" ${r === role ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveUserRole('${id}')">Save</button>
    </div>`);
}

async function saveUserRole(id) {
  const role = document.getElementById('eu-role').value;
  try {
    await API.updateUser(id, { role });
    closeModal();
    toast('Role updated', 'success');
    renderAdmin();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Invites ───────────────────────────────────────────────────────────────────

function openInviteUserModal() {
  openModal('Invite user', `
    <p class="text-sm text-secondary mb-16">Create an account and share the generated link.
      The invitee opens it once to set their own password.</p>
    <div class="field-group">
      <label for="inv-name">Full name</label>
      <input type="text" id="inv-name" placeholder="Jane Smith" autocomplete="off">
    </div>
    <div class="field-group">
      <label for="inv-username">Username</label>
      <input type="text" id="inv-username" placeholder="jsmith" autocomplete="off">
    </div>
    <div class="field-group">
      <label for="inv-role">Role</label>
      <select id="inv-role">
        ${['QA_ENGINEER', 'APPROVER', 'ADMIN'].map(r => `<option value="${r}">${roleLabel(r)}</option>`).join('')}
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="submitInvite()">Create invite</button>
    </div>`);
}

async function submitInvite() {
  const name = document.getElementById('inv-name').value.trim();
  const username = document.getElementById('inv-username').value.trim();
  const role = document.getElementById('inv-role').value;
  if (!username) return toast('Username is required', 'error');
  try {
    const { url } = await API.inviteUser({ name, username, role });
    const fullUrl = inviteFullUrl(url);
    openModal('Invite created', `
      <p class="text-sm text-secondary mb-16">Share this single-use link with <b>${esc(username)}</b>.
        It expires in 7 days.</p>
      <div class="field-group">
        <label for="inv-link">Invite link</label>
        <input type="text" id="inv-link" value="${esc(fullUrl)}" readonly onclick="this.select()">
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeModal();renderAdmin()">Done</button>
        <button class="btn-primary" onclick="copyInviteLink('${esc(url)}')">${ICONS.copy || ''} Copy link</button>
      </div>`);
  } catch (err) { toast(err.message, 'error'); }
}

// The server sends an absolute URL when PUBLIC_URL is configured; otherwise it
// sends a site-relative path we resolve against the current origin.
function inviteFullUrl(url) {
  return /^https?:\/\//i.test(url) ? url : location.origin + url;
}

function copyInviteLink(url) {
  const fullUrl = inviteFullUrl(url);
  navigator.clipboard.writeText(fullUrl)
    .then(() => toast('Invite link copied', 'success'))
    .catch(() => toast(fullUrl, 'info'));
}

async function revokeInvite(id) {
  if (!confirm('Revoke this invite? The link will stop working.')) return;
  try {
    await API.revokeInvite(id);
    toast('Invite revoked', 'success');
    renderAdmin();
  } catch (err) { toast(err.message, 'error'); }
}

// ── User lifecycle ──────────────────────────────────────────────────────────

async function setUserActive(id, active) {
  const verb = active ? 'Reactivate' : 'Deactivate';
  if (!active && !confirm('Deactivate this user? They will no longer be able to sign in. Their signatures and history are preserved.')) return;
  try {
    await (active ? API.reactivateUser(id) : API.deactivateUser(id));
    toast(`User ${active ? 'reactivated' : 'deactivated'}`, 'success');
    renderAdmin();
  } catch (err) { toast(err.message, 'error'); }
}

function openResetPasswordModal(id, label) {
  openModal('Reset password', `
    <p class="text-sm text-secondary mb-16">Set a new password for <b>${esc(label)}</b>.
      Share it with them securely; they can change it after signing in.</p>
    <div class="field-group">
      <label for="rp-new">New password</label>
      <input type="password" id="rp-new" autocomplete="new-password" placeholder="Minimum 8 characters">
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="submitResetPassword('${id}')">Set password</button>
    </div>`);
}

async function submitResetPassword(id) {
  const pw = document.getElementById('rp-new').value;
  if (pw.length < 8) return toast('Password must be at least 8 characters', 'error');
  try {
    await API.adminResetPassword(id, pw);
    closeModal();
    toast('Password reset', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// ── Backup ──────────────────────────────────────────────────────────────────

function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function backupListHtml(backups) {
  if (!backups || !backups.length) {
    return '<p class="text-sm text-muted">No backups yet.</p>';
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Backup</th>
          <th style="width:110px">Size</th>
          <th style="width:170px">Created</th>
          <th style="width:120px">Actions</th>
        </tr></thead>
        <tbody>
          ${backups.map(b => `
            <tr>
              <td class="mono text-sm">${esc(b.filename)}</td>
              <td class="text-sm">${fmtBytes(b.sizeBytes)}</td>
              <td class="t-meta">${relTime(b.createdAt)}</td>
              <td>
                <a class="btn-ghost btn-sm" href="${API.downloadBackup(b.filename)}" download>${ICONS.download} Download</a>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// Live-sanitize the label to the allowed set (lowercase letters, digits, - and _)
// and preview the resulting filename so the rules are obvious as the user types.
function onBackupLabelInput() {
  const input = document.getElementById('backup-label');
  if (!input) return;
  const cleaned = input.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (cleaned !== input.value) input.value = cleaned;
  const preview = document.getElementById('backup-name-preview');
  if (preview) {
    preview.textContent = `Filename: magentiqa-backup${cleaned ? '-' + cleaned : ''}_YYYY-MM-dd_HH-mm.zip`;
  }
}

async function runBackup() {
  const btn = document.getElementById('backup-btn');
  if (!btn || btn.disabled) return;
  const labelEl = document.getElementById('backup-label');
  const label = labelEl ? labelEl.value.trim() : '';
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${ICONS.clock} Creating backup…`;
  try {
    const res = await API.createBackup(label);
    toast(`Backup created: ${res.filename} (${fmtBytes(res.sizeBytes)})`, 'success');
    if (labelEl) labelEl.value = '';
    onBackupLabelInput();
    const list = document.getElementById('backup-list');
    if (list) {
      const backups = await API.backups().catch(() => []);
      list.innerHTML = backupListHtml(backups);
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}
