// public/js/ui.js — Shared UI utilities & design-system components

// ── Icons (shared SVG snippets) ───────────────────────────────────────────────
const ICONS = {
  check:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  x:       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  alert:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  plus:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  search:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  doc:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  play:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  clock:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  edit:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  upload:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  download:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  folder:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  link:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  copy:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  reset:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  unlink:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.71 1.72"/><path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.72"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></svg>',
  trash:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/></svg>',
  sign:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>',
  chevR:   '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',
  arrowR:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  arrowL:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
};

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: ICONS.check, error: ICONS.alert, info: ICONS.info };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${esc(msg)}</span>`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 200);
  }, duration);
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(title, bodyHtml, opts = {}) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.remove('hidden');
  // Focus the first input for keyboard users
  setTimeout(() => {
    const first = document.querySelector('#modal-body input:not([disabled]), #modal-body select, #modal-body textarea');
    if (first) first.focus();
  }, 50);
  if (opts.onOpen) opts.onOpen();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-body').innerHTML = '';
}

// Close modal & popovers on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    if (typeof closePopovers === 'function') closePopovers();
  }
});

// ── Styled confirm dialog (promise-based, replaces window.confirm) ───────────
function confirmDialog(title, message, opts = {}) {
  return new Promise(resolve => {
    window._confirmResolve = (v) => { closeModal(); resolve(v); };
    openModal(title, `
      <p style="font-size:13px;line-height:1.6;color:var(--text-secondary)">${esc(message)}</p>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="window._confirmResolve(false)">${esc(opts.cancelLabel || 'Cancel')}</button>
        <button class="${opts.danger === false ? 'btn-primary' : 'btn-danger'}" onclick="window._confirmResolve(true)">${esc(opts.confirmLabel || 'Confirm')}</button>
      </div>`);
  });
}

// ── Google Drive folder picker ────────────────────────────────────────────────
// Shared navigation modal for choosing a Drive folder (shortcuts and shared
// folders are handled by the backend). Used by the Import page and by the
// report-to-Drive export.
//   openDriveFolderPicker({ title, startFolder, onSelect })
//     startFolder — optional folder URL/ID the picker opens at (default: My Drive)
//     onSelect    — called with { id, name, pathNames } when the user picks a folder
let _gdrivePath = [];      // breadcrumb stack: [{id, name}, …]
let _gdriveOnSelect = null;

async function openDriveFolderPicker({ title = 'Choose a Drive folder', startFolder = null, onSelect } = {}) {
  _gdriveOnSelect = onSelect;
  _gdrivePath = [{ id: 'root', name: 'My Drive' }];
  openModal(title, '<div id="gdrive-browser"><p class="text-muted">Loading…</p></div>');
  if (startFolder) {
    // Seed the breadcrumb at the default folder; fall back to My Drive if it
    // can't be resolved (revoked access, deleted, not a folder, …)
    try {
      const info = await API.google.folderInfo(startFolder);
      _gdrivePath.push({ id: info.id, name: info.name });
    } catch { /* start at My Drive */ }
  }
  gdriveBrowserLoad();
}

async function gdriveBrowserLoad() {
  const el = document.getElementById('gdrive-browser');
  if (!el) return;
  const cur = _gdrivePath[_gdrivePath.length - 1];
  el.innerHTML = '<p class="text-muted">Loading…</p>';

  try {
    const data = await API.google.folders(cur.id);
    if (!document.getElementById('gdrive-browser')) return; // modal closed meanwhile

    // At the top level, offer the "Shared with me" view alongside My Drive folders
    const folders = cur.id === 'root'
      ? [{ id: 'sharedWithMe', name: 'Shared with me' }, ...data.folders]
      : data.folders;

    const crumbs = _gdrivePath.map((p, i) =>
      i === _gdrivePath.length - 1
        ? `<span class="bold">${esc(p.name)}</span>`
        : `<a href="#" onclick="gdriveCrumb(${i});return false">${esc(p.name)}</a>`
    ).join('<span class="text-muted"> / </span>');

    el.innerHTML = `
      <div style="margin-bottom:10px;line-height:1.6">${crumbs}</div>
      <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:6px">
        ${folders.length ? folders.map(f => `
          <div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:8px"
            data-name="${esc(f.name)}" onclick="gdriveEnter('${f.id}', this)"
            onmouseover="this.style.background='var(--bg-hover, rgba(128,128,128,.1))'" onmouseout="this.style.background=''">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            ${esc(f.name)}
          </div>`).join('')
        : '<p class="text-muted" style="padding:12px">No subfolders</p>'}
      </div>
      <div class="btn-row" style="margin-top:14px">
        ${cur.id === 'sharedWithMe'
          ? '<span class="text-muted text-sm">Open a shared folder to select it</span>'
          : `<button class="btn-primary" onclick="gdriveSelectCurrent()">Select &ldquo;${esc(cur.name)}&rdquo;</button>`}
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
  }
}

function gdriveEnter(id, rowEl) {
  _gdrivePath.push({ id, name: rowEl.dataset.name });
  gdriveBrowserLoad();
}

function gdriveCrumb(i) {
  _gdrivePath = _gdrivePath.slice(0, i + 1);
  gdriveBrowserLoad();
}

function gdriveSelectCurrent() {
  const cur = _gdrivePath[_gdrivePath.length - 1];
  const pathNames = _gdrivePath.map(p => p.name).join(' / ');
  const cb = _gdriveOnSelect;
  _gdriveOnSelect = null;
  closeModal();
  if (cb) cb({ id: cur.id, name: cur.name, pathNames });
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('magentiqa-theme', next);
  updateThemeIcon();
}

function applyStoredTheme() {
  // stored preference → legacy key → OS preference → light
  const stored = localStorage.getItem('magentiqa-theme') || localStorage.getItem('vms-theme');
  const system = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', stored || system);
  updateThemeIcon();
}

function updateThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const sun = document.getElementById('theme-icon-sun');
  const moon = document.getElementById('theme-icon-moon');
  if (sun && moon) {
    sun.classList.toggle('hidden', !isDark);   // in dark mode, offer "switch to light"
    moon.classList.toggle('hidden', isDark);
  }
}

// ── Status badge ──────────────────────────────────────────────────────────────
function badge(status) {
  const s = (status || 'unknown').toLowerCase().replace(/[\s/]/g, '_');
  const labels = {
    passed: 'Passed', partial: 'Partial', failed: 'Failed', in_progress: 'In Progress',
    not_started: 'Not Started', blocked: 'Blocked', not_applicable: 'N/A', 'n_a': 'N/A',
    not_tested: 'Not Tested',
    approved: 'Approved', in_review: 'In Review', draft: 'Draft',
    pending: 'Pending', rejected: 'Rejected', obsolete: 'Obsolete', archived: 'Archived',
    released: 'Released', verified: 'Verified', in_verification: 'In Verification',
    pass: 'Pass', fail: 'Fail', skip: 'Skip',
    admin: 'Admin', qa_engineer: 'QA Engineer', approver: 'Approver',
    active: 'Active', inactive: 'Inactive', automated: 'Automated',
  };
  return `<span class="badge badge-${s}">${labels[s] || esc(status)}</span>`;
}

// ── KPI card ──────────────────────────────────────────────────────────────────
// Color is carried by the small indicator dot, not the number — except for
// alert (failures > 0) and brand-selected values, keeping color intentional.
//
// opts.filter turns the card into an interactive filter button: the whole card
// takes its tone's semantic tint, the value is colored, and `data-status`
// records which status it filters by. opts.selected marks the active filter.
function kpiCard(label, value, opts = {}) {
  const tone = opts.tone ? ` tone-${opts.tone}` : '';
  const alert = opts.alert ? ' alert' : '';
  const filter = opts.filter ? ' kpi-filter' : '';
  const selected = opts.selected ? ' selected' : '';
  const click = opts.onclick
    || (opts.filter && opts.status ? `${opts.filterFn || 'filterVersionTests'}('${opts.status}')` : '');
  const attrs = [
    opts.status ? `data-status="${esc(opts.status)}"` : '',
    click ? `style="cursor:pointer" role="button" tabindex="0" onclick="${click}"` : '',
  ].filter(Boolean).join(' ');
  return `
    <div class="kpi-card${tone}${filter}${alert}${selected}" ${attrs}>
      <div class="kpi-label">${opts.tone ? '<span class="kpi-dot"></span>' : ''}${esc(label)}</div>
      <div class="kpi-value">${value}</div>
      ${opts.sub ? `<div class="kpi-sub">${opts.sub}</div>` : ''}
    </div>`;
}

// ── Donut chart (dependency-free inline SVG) ──────────────────────────────────
function donutChart(pct, opts = {}) {
  const size = opts.size || 132;
  const stroke = opts.stroke || 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct || 0));
  const offset = c * (1 - clamped / 100);
  const color = opts.color || (clamped === 100 ? 'var(--chart-3)' : clamped >= 50 ? 'var(--chart-2)' : 'var(--chart-5)');
  return `
    <svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${clamped}% ${esc(opts.caption || '')}">
      <circle class="donut-track" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none"
        stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}"
        transform="rotate(-90 ${size/2} ${size/2})"
        style="transition: stroke-dashoffset 0.5s var(--ease)"/>
      <text class="donut-num" x="50%" y="${opts.caption ? '47%' : '50%'}" dominant-baseline="central" text-anchor="middle">${clamped}%</text>
      ${opts.caption ? `<text class="donut-cap" x="50%" y="62%" dominant-baseline="central" text-anchor="middle">${esc(opts.caption)}</text>` : ''}
    </svg>`;
}

// ── Segmented status bar + legend ─────────────────────────────────────────────
// segments: [{label, value, cls, swatch}]
function segmentedBar(segments, opts = {}) {
  const total = segments.reduce((a, s) => a + (s.value || 0), 0);
  const bars = total
    ? segments.filter(s => s.value > 0).map(s =>
        `<div class="${s.cls}" style="width:${(s.value / total * 100).toFixed(2)}%" title="${esc(s.label)}: ${s.value}"></div>`).join('')
    : '';
  const legend = opts.legend === false ? '' : `
    <div class="legend">
      ${segments.map(s => `
        <span class="legend-item">
          <span class="legend-swatch" style="background:${s.swatch}"></span>
          ${esc(s.label)} <span class="legend-val">${s.value || 0}</span>
        </span>`).join('')}
    </div>`;
  return `<div class="seg-bar">${bars}</div>${legend}`;
}

// ── Stacked progress overview ─────────────────────────────────────────────────
// A thin multi-segment status bar with a small, low-contrast summary label at
// the track's left edge. Per-status counts live in the segment tooltips and the
// legend, so the headline stays quiet: "62% complete · 50% passed · 12% failed".
function progressOverview(s, opts = {}) {
  const total      = s.total || 0;
  const passed     = s.passed || 0;
  const failed     = s.failed || 0;
  const pct = (n) => total ? Math.round((n / total) * 100) : 0;
  // Coverage = units with a terminal verdict (Passed + Failed); Blocked,
  // In Progress and Not Started are not yet "complete".
  const complete = pct(passed + failed);
  const parts = [`${complete}% complete`, `${pct(passed)}% passed`];
  const failHtml = failed ? `<span class="po-fail">${pct(failed)}% failed</span>` : '';
  return `
    <div class="progress-overview">
      <div class="po-label">${parts.join(' · ')}${failHtml ? ' · ' + failHtml : ''}</div>
      ${segmentedBar(statusSegments(s), { legend: opts.legend })}
    </div>`;
}

// Standard verification status segments from a stats object
// Unit-based segments for the progress lines (a setup-tracked verification's
// setups are counted individually, so there is no Partial bucket here). Ordered
// Not Started → In Progress → Blocked → Failed → Passed.
function statusSegments(s) {
  return [
    { label: 'Not Started', value: s.notStarted || 0, cls: 'seg-rest',    swatch: 'var(--chart-6)' },
    { label: 'In Progress', value: s.inProgress || 0, cls: 'seg-prog',    swatch: 'var(--chart-2)' },
    { label: 'Blocked',     value: s.blocked || 0,    cls: 'seg-blocked', swatch: 'var(--blocked)' },
    { label: 'Failed',      value: s.failed || 0,     cls: 'seg-fail',    swatch: 'var(--chart-4)' },
    { label: 'Passed',      value: s.passed || 0,     cls: 'seg-pass',    swatch: 'var(--chart-3)' },
  ];
}

// ── Relative time ─────────────────────────────────────────────────────────────
function relTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

// ── Stats progress bar ────────────────────────────────────────────────────────
function progressBar(passed, total) {
  const pct = total ? Math.round((passed / total) * 100) : 0;
  const color = pct === 100 ? 'var(--chart-3)' : pct >= 80 ? 'var(--chart-5)' : pct > 0 ? 'var(--chart-2)' : 'var(--bg-hover)';
  return `
    <div class="progress-bar-wrap">
      <div class="progress-bar" style="width:${pct}%;background:${color}"></div>
    </div>
    <div class="progress-label">${passed} / ${total} passed (${pct}%)</div>`;
}

// ── Empty state ───────────────────────────────────────────────────────────────
function emptyState(title, subtitle = '', opts = {}) {
  return `
    <div class="empty-state">
      <div class="empty-icon">
        ${opts.icon || '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></svg>'}
      </div>
      <h3>${esc(title)}</h3>
      <p>${esc(subtitle)}</p>
      ${opts.action ? `<button class="btn-primary" onclick="${opts.action.onclick}">${opts.action.icon || ICONS.plus} ${esc(opts.action.label)}</button>` : ''}
    </div>`;
}

// ── Skeleton loaders ──────────────────────────────────────────────────────────
function skeletonPage() {
  return `
    <div class="page-header">
      <div style="flex:1;max-width:320px">
        <div class="skeleton sk-title" style="width:180px"></div>
        <div class="skeleton sk-line" style="width:240px"></div>
      </div>
    </div>
    <div class="page-body">
      <div class="kpi-grid">
        ${'<div class="skeleton sk-card"></div>'.repeat(4)}
      </div>
      <div class="skeleton sk-row" style="height:46px"></div>
      ${'<div class="skeleton sk-row"></div>'.repeat(6)}
    </div>`;
}

function skeletonTable(rows = 6) {
  return `<div style="padding:8px 0">${'<div class="skeleton sk-row"></div>'.repeat(rows)}</div>`;
}

// Back-compat: pages call loadingHTML(); render a skeleton instead of text
function loadingHTML() {
  return skeletonPage();
}

// ── Sortable tables ───────────────────────────────────────────────────────────
// Usage: <th class="sortable" onclick="sortTable(this)">Name<span class="sort-arrow">▲</span></th>
// Sorts tbody rows by the matching cell. Numeric-aware; data-sort overrides text.
function sortTable(th) {
  const table = th.closest('table');
  const tbody = table.querySelector('tbody');
  const idx = [...th.parentElement.children].indexOf(th);
  const wasAsc = th.dataset.dir === 'asc';
  const dir = wasAsc ? 'desc' : 'asc';

  table.querySelectorAll('th.sortable').forEach(h => {
    h.classList.remove('sorted');
    delete h.dataset.dir;
    const a = h.querySelector('.sort-arrow'); if (a) a.textContent = '▲';
  });
  th.classList.add('sorted');
  th.dataset.dir = dir;
  const arrow = th.querySelector('.sort-arrow');
  if (arrow) arrow.textContent = dir === 'asc' ? '▲' : '▼';

  const rows = [...tbody.querySelectorAll('tr')];
  rows.sort((ra, rb) => {
    const ca = ra.children[idx], cb = rb.children[idx];
    const va = ca?.dataset.sort ?? ca?.textContent.trim() ?? '';
    const vb = cb?.dataset.sort ?? cb?.textContent.trim() ?? '';
    const na = parseFloat(va), nb = parseFloat(vb);
    const cmp = (!isNaN(na) && !isNaN(nb) && /^[\d.,%\s-]+$/.test(va))
      ? na - nb
      : va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });
  rows.forEach(r => tbody.appendChild(r));
}

function sortableTH(label, opts = {}) {
  return `<th class="sortable" onclick="sortTable(this)" ${opts.attrs || ''}>${esc(label)}<span class="sort-arrow">▲</span></th>`;
}

// ── Activity feed ─────────────────────────────────────────────────────────────
const FEED_TONES = {
  CREATE: 'info', UPDATE: 'warn', DELETE: 'fail', EXECUTE: 'pass',
  APPROVE: 'pass', REJECT: 'fail', SIGN: 'brand', IMPORT: 'info',
  EXPORT: 'info', LINK: 'info', UNLINK: 'warn', LOGIN: 'info',
};
const FEED_ICONS = {
  CREATE: ICONS.plus, UPDATE: ICONS.edit, DELETE: ICONS.trash, EXECUTE: ICONS.play,
  APPROVE: ICONS.check, REJECT: ICONS.x, SIGN: ICONS.sign, IMPORT: ICONS.upload,
  EXPORT: ICONS.download, LINK: ICONS.link, UNLINK: ICONS.link,
};

const FEED_VERBS = {
  CREATE: 'created', UPDATE: 'updated', DELETE: 'deleted', EXECUTE: 'executed',
  APPROVE: 'approved', REJECT: 'rejected', SIGN: 'signed', IMPORT: 'imported',
  EXPORT: 'exported', LINK: 'linked', UNLINK: 'unlinked', LOGIN: 'logged in',
};

function feedItem(log) {
  const tone = FEED_TONES[log.action] || 'info';
  const icon = FEED_ICONS[log.action] || ICONS.doc;
  let target = '';
  try {
    const after = log.after ? JSON.parse(log.after) : null;
    target = after?.title || after?.name || '';
  } catch {}
  const entityLabels = {
    tests: 'verification', versionTests: 'version link', versions: 'version',
    projects: 'project', executions: 'execution', approvals: 'approval',
    signatures: 'signature', evidence: 'evidence', users: 'user',
  };
  const entity = entityLabels[log.entity] || log.entity;
  return `
    <div class="feed-item">
      <div class="feed-icon tone-${tone}">${icon}</div>
      <div class="feed-body">
        <div class="feed-text"><b>${esc(log.userName || 'system')}</b> ${esc(FEED_VERBS[log.action] || (log.action || '').toLowerCase())} ${esc(entity)}${target ? ` <b>${esc(trunc(target, 44))}</b>` : ''}</div>
        <div class="feed-time">${relTime(log.timestamp || log.createdAt)}</div>
      </div>
    </div>`;
}

// ── Recently accessed verifications (personal, client-side) ──────────────────
// Tracks which verifications this browser opened to execute, so the dashboard
// can offer a "jump back in" shortcut. Stored in localStorage; best-effort.
function recordRecentVerification(entry) {
  if (!entry || !entry.versionTestId) return;
  try {
    const key = 'mq:recents';
    const list = JSON.parse(localStorage.getItem(key) || '[]')
      .filter(r => r.versionTestId !== entry.versionTestId);
    list.unshift({ ...entry, at: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(list.slice(0, 20)));
  } catch { /* storage unavailable / quota — ignore */ }
}

function getRecentVerifications() {
  try { return JSON.parse(localStorage.getItem('mq:recents') || '[]'); }
  catch { return []; }
}

// ── Truncate ──────────────────────────────────────────────────────────────────
function trunc(str, n = 60) {
  if (!str) return '—';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ── Escape HTML ───────────────────────────────────────────────────────────────
function esc(str) {
  if (str === null || str === undefined || str === '') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
