// public/js/pages/audit.js — Audit trail page

const AUDIT_ENTITY_LABELS = {
  tests: 'Verification',
  versionTests: 'Version Link',
  versions: 'Version',
  projects: 'Project',
  executions: 'Execution',
  approvals: 'Approval',
  signatures: 'Signature',
  evidence: 'Evidence',
};

const AUDIT_ACTION_COLORS = {
  CREATE: 'badge-info',
  UPDATE: 'badge-warn',
  DELETE: 'badge-fail',
  EXECUTE: 'badge-pass',
  APPROVE: 'badge-pass',
  SIGN: 'badge-info',
  IMPORT: 'badge-info',
  EXPORT: 'badge-info',
  LINK: 'badge-info',
  UNLINK: 'badge-warn',
};

async function renderAudit(params = {}) {
  const el = document.getElementById('page-audit');
  el.innerHTML = skeletonPage();
  try {
    const logs = await API.audit({ limit: 200 });
    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Audit Trail</h1>
          <p class="subtitle">Immutable record of all verification events · showing latest ${logs.length}</p>
        </div>
      </div>
      <div class="toolbar">
        <div class="search-bar">
          ${ICONS.search}
          <input type="text" id="audit-filter" placeholder="Filter events…" oninput="filterAuditRows()">
        </div>
        <select id="audit-action-filter" onchange="filterAuditRows()" style="max-width:180px;width:auto">
          <option value="">All actions</option>
          ${[...new Set(logs.map(l => l.action))].sort().map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}
        </select>
      </div>
      <div class="page-body">
        <div class="card flush">
          <div class="table-wrap">
            <table id="audit-table">
              <thead><tr>
                ${sortableTH('Time')}
                ${sortableTH('User')}
                ${sortableTH('Action')}
                ${sortableTH('Entity')}
                <th>Details</th>
              </tr></thead>
              <tbody>
                ${logs.length === 0
                  ? `<tr><td colspan="5" class="table-empty-cell">No audit events yet</td></tr>`
                  : logs.map(l => `
                    <tr class="audit-row row-click" onclick="openAuditDetailModal('${l.id}')" title="Click for full details"
                        data-filter="${esc(((l.userName || '') + ' ' + l.action + ' ' + l.entity + ' ' + auditSummary(l)).toLowerCase())}"
                        data-action="${esc(l.action)}">
                      <td class="mono" style="white-space:nowrap;font-size:11px" data-sort="${l.timestamp || l.createdAt || ''}">${fmtDate(l.timestamp || l.createdAt)}</td>
                      <td>${esc(l.userName || l.userId || 'system')}</td>
                      <td data-sort="${esc(l.action)}"><span class="badge ${AUDIT_ACTION_COLORS[l.action] || 'badge-info'}">${esc(l.action)}</span></td>
                      <td><span class="tag">${esc(AUDIT_ENTITY_LABELS[l.entity] || l.entity)}</span></td>
                      <td class="text-muted text-sm">${auditSummary(l)}</td>
                    </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="page-body"><div class="form-error">${ICONS.alert} ${esc(err.message)}</div></div>`;
  }
}

function filterAuditRows() {
  const q = (document.getElementById('audit-filter')?.value || '').trim().toLowerCase();
  const action = document.getElementById('audit-action-filter')?.value || '';
  document.querySelectorAll('#audit-table tbody tr').forEach(tr => {
    const matchQ = !q || (tr.dataset.filter || '').includes(q);
    const matchA = !action || tr.dataset.action === action;
    tr.style.display = matchQ && matchA ? '' : 'none';
  });
}

function auditSummary(l) {
  try {
    const after = l.after ? JSON.parse(l.after) : null;
    if (after?.title) return esc(trunc(after.title, 50));
    if (after?.name)  return esc(trunc(after.name, 50));
    return esc(l.entityId?.slice(0, 12) + '…');
  } catch { return ''; }
}

async function openAuditDetailModal(logId) {
  try {
    const log = await fetch(`/api/audit/${logId}`, { credentials: 'include' }).then(r => r.json());

    let before = null, after = null;
    try { before = log.before ? JSON.parse(log.before) : null; } catch {}
    try { after  = log.after  ? JSON.parse(log.after)  : null; } catch {}

    const diffHtml = renderAuditDiff(before, after);

    openModal('Audit Entry Details', `
      <div class="form-grid" style="margin-bottom:14px">
        <div><span class="t-label">Time</span><div class="mono" style="margin-top:2px">${fmtDate(log.timestamp || log.createdAt)}</div></div>
        <div><span class="t-label">User</span><div style="margin-top:2px">${esc(log.userName || log.userId)}</div></div>
        <div><span class="t-label">Action</span><div style="margin-top:4px"><span class="badge ${AUDIT_ACTION_COLORS[log.action] || 'badge-info'}">${esc(log.action)}</span></div></div>
        <div><span class="t-label">Entity</span><div style="margin-top:4px"><span class="tag">${esc(AUDIT_ENTITY_LABELS[log.entity] || log.entity)}</span></div></div>
        <div class="span-2"><span class="t-label">Entity ID</span><div class="mono" style="font-size:11px;margin-top:2px">${esc(log.entityId)}</div></div>
        ${log.ipAddress ? `<div><span class="t-label">IP</span><div class="mono" style="margin-top:2px">${esc(log.ipAddress)}</div></div>` : ''}
      </div>
      ${diffHtml}
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeModal()">Close</button>
      </div>`);
  } catch (err) {
    toast('Could not load audit detail: ' + err.message, 'error');
  }
}

function renderAuditDiff(before, after) {
  if (!before && !after) return '';

  const allKeys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after  || {}),
  ]);

  // Exclude internal/noisy fields
  const SKIP = new Set(['id', 'createdAt', 'updatedAt', 'passwordHash', 'tags']);

  const rows = [...allKeys]
    .filter(k => !SKIP.has(k))
    .map(k => {
      const bv = before ? stringify(before[k]) : null;
      const av = after  ? stringify(after[k])  : null;
      const changed = bv !== av;
      return { k, bv, av, changed };
    })
    .filter(r => r.bv || r.av);

  if (!rows.length) return '';

  return `
    <div class="divider"></div>
    <h4 class="kpi-label" style="margin-bottom:10px">
      ${before && after ? 'Changes' : after ? 'Created with' : 'Deleted record'}
    </h4>
    <div style="overflow-x:auto;max-height:300px;overflow-y:auto;border:1px solid var(--border-subtle);border-radius:var(--radius)">
      <table style="font-size:11.5px">
        <thead>
          <tr>
            <th style="width:120px">Field</th>
            ${before && after ? '<th>Before</th><th>After</th>' : '<th>Value</th>'}
          </tr>
        </thead>
        <tbody>
          ${rows.map(({ k, bv, av, changed }) => `
            <tr style="${changed && before && after ? 'background:var(--brand-soft)' : ''}">
              <td class="mono" style="color:var(--text-muted)">${esc(k)}</td>
              ${before && after
                ? `<td style="color:${changed ? 'var(--fail)' : 'var(--text-secondary)'}">${esc(trunc(bv || '—', 80))}</td>
                   <td style="color:${changed ? 'var(--pass)' : 'var(--text-secondary)'}">${esc(trunc(av || '—', 80))}</td>`
                : `<td>${esc(trunc(av || bv || '—', 120))}</td>`}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function stringify(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
