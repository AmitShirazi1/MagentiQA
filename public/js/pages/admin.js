// public/js/pages/admin.js — User management & system info

async function renderAdmin(params = {}) {
  const el = document.getElementById('page-admin');
  el.innerHTML = skeletonPage();
  try {
    const isAdmin = currentUser?.role === 'ADMIN';
    const [users, backups] = await Promise.all([
      API.users(),
      isAdmin ? API.backups().catch(() => []) : Promise.resolve([]),
    ]);
    el.innerHTML = `
      <div class="page-header">
        <div><h1>Admin</h1><p class="subtitle">User management, data export &amp; integrations</p></div>
      </div>
      <div class="page-body">
        <div class="card flush mb-16">
          <div class="card-header">
            <span class="card-title">Users</span>
            <span class="t-meta">${users.length} user${users.length === 1 ? '' : 's'}</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr>
                ${sortableTH('Name')}
                ${sortableTH('Username')}
                ${sortableTH('Role')}
                ${sortableTH('Joined')}
                <th style="width:120px">Actions</th>
              </tr></thead>
              <tbody>
                ${users.map(u => `
                  <tr>
                    <td>
                      <div style="display:flex;align-items:center;gap:10px">
                        <div class="user-avatar neutral" style="width:26px;height:26px;font-size:10.5px">${esc((u.name || u.username || '?')[0].toUpperCase())}</div>
                        <span class="bold">${esc(u.name || '—')}</span>
                      </div>
                    </td>
                    <td class="mono">${esc(u.username)}</td>
                    <td data-sort="${esc(u.role)}">${badge(u.role)}</td>
                    <td class="t-meta" data-sort="${u.createdAt || ''}">${relTime(u.createdAt)}</td>
                    <td>
                      ${currentUser?.role === 'ADMIN'
                        ? `<button class="btn-ghost btn-sm" onclick="openEditUserModal('${u.id}','${esc(u.name || '')}','${u.role}')">${ICONS.edit} Edit Role</button>`
                        : '<span class="text-muted text-sm">—</span>'}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

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
        ${['ADMIN', 'QA_ENGINEER', 'REVIEWER', 'APPROVER', 'DEVELOPER'].map(r =>
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
