// public/js/pages/projects.js — Projects grid + version timeline

async function renderProjects(params = {}) {
  const el = document.getElementById('page-projects');
  el.innerHTML = skeletonPage();

  try {
    const projects = await API.projects.list();

    el.innerHTML = `
      <div class="page-header">
        <div><h1>Projects</h1><p class="subtitle">${projects.length} project${projects.length === 1 ? '' : 's'} under verification management</p></div>
        <button class="btn-primary" onclick="openNewProjectModal()">
          ${ICONS.plus} New Project
        </button>
      </div>
      <div class="page-body">
        ${projects.length === 0
          ? emptyState('No projects yet', 'Projects group your product versions and their verification runs.', {
              action: { label: 'Create Project', onclick: 'openNewProjectModal()' },
            })
          : `<div class="grid-cards">${projects.map(p => renderProjectCard(p)).join('')}</div>`}
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="page-body"><div class="form-error">${ICONS.alert} ${esc(err.message)}</div></div>`;
  }
}

function renderProjectCard(p) {
  return `
    <div class="card interactive" onclick="navigate('project-versions',{projectId:'${p.id}'})">
      <div class="card-header" style="margin-bottom:10px">
        <div style="display:flex;gap:12px;align-items:flex-start;min-width:0">
          <div class="empty-icon" style="width:36px;height:36px;border-radius:10px;margin:0;flex-shrink:0">
            ${ICONS.folder}
          </div>
          <div style="min-width:0">
            <div class="bold" style="font-size:14.5px;letter-spacing:-0.2px">${esc(p.name)}</div>
            <span class="tag" style="margin-top:4px;display:inline-block">${esc(p.type)}</span>
          </div>
        </div>
        <button class="icon-btn" title="Edit project" aria-label="Edit project" onclick="event.stopPropagation();openEditProjectModal('${p.id}')">
          ${ICONS.edit}
        </button>
      </div>
      ${p.description ? `<p class="text-secondary text-sm" style="margin-bottom:14px;line-height:1.5">${esc(trunc(p.description, 120))}</p>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--border-subtle);padding-top:12px;margin-top:auto">
        <span class="t-meta">${p.versionCount} version${p.versionCount === 1 ? '' : 's'}</span>
        <button class="btn-secondary btn-sm" onclick="event.stopPropagation();openNewVersionModal('${p.id}')">${ICONS.plus} Version</button>
      </div>
    </div>`;
}

// ── Version timeline ──────────────────────────────────────────────────────────
const VERSION_TL_TONE = {
  RELEASED: 'tl-pass', VERIFIED: 'tl-pass', IN_VERIFICATION: 'tl-prog',
  DRAFT: 'tl-neutral', OBSOLETE: 'tl-neutral',
};

async function openProjectVersions(projectId) {
  if (!projectId) return navigate('projects', {}, false);
  const el = document.getElementById('page-projects');
  el.innerHTML = skeletonPage();

  try {
    const project = await API.projects.get(projectId);
    const versions = await API.projects.versions(projectId);

    el.innerHTML = `
      <div class="page-header">
        <div>
          <div class="breadcrumbs">
            <a href="#/projects" onclick="navigate('projects');return false">Projects</a>
            ${ICONS.chevR}
            <span>${esc(project.name)}</span>
          </div>
          <h1>${esc(project.name)}</h1>
          <p class="subtitle"><span class="tag">${esc(project.type)}</span> · ${versions.length} version${versions.length === 1 ? '' : 's'}</p>
        </div>
        <button class="btn-primary" onclick="openNewVersionModal('${projectId}')">${ICONS.plus} New Version</button>
      </div>
      <div class="page-body">
        ${versions.length === 0
          ? emptyState('No versions yet', 'Each version carries its own verification runs. Tests are inherited from the previous version automatically.', {
              action: { label: 'Add First Version', onclick: `openNewVersionModal('${projectId}')` },
            })
          : `
          <!-- Version history as a visual timeline: newest first, status-colored markers -->
          <div class="timeline" style="max-width:980px">
            ${versions.map((v, i) => renderVersionTimelineItem(v, projectId, i === 0)).join('')}
          </div>`}
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="page-body"><div class="form-error">${ICONS.alert} ${esc(err.message)}</div></div>`;
  }
}

function renderVersionTimelineItem(v, projectId, isLatest) {
  const tone = isLatest && v.status === 'IN_VERIFICATION' ? 'tl-brand' : (VERSION_TL_TONE[v.status] || 'tl-neutral');
  const open = `navigate('version-detail',{projectId:'${projectId}',versionId:'${v.id}'})`;
  return `
    <div class="timeline-item ${tone}">
      <div class="timeline-marker"></div>
      <div class="card interactive version-card" onclick="${open}">
        <div class="version-card-head">
          <div>
            <div class="version-name">
              ${esc(v.name)}
              ${badge(v.status)}
              ${isLatest ? '<span class="badge badge-automated no-dot" style="background:var(--brand-dim);color:var(--brand-text)">Latest</span>' : ''}
            </div>
            <div class="t-meta" style="margin-top:3px">Created ${relTime(v.createdAt)}</div>
          </div>
          <div class="btn-row" onclick="event.stopPropagation()">
            <button class="btn-secondary btn-sm" onclick="${open}">Open ${ICONS.arrowR}</button>
            <button class="btn-ghost btn-sm" title="Download the PDF report (results + approvals)" onclick="downloadReportPdf('${v.id}')">${ICONS.download} PDF report</button>
            <button class="btn-ghost btn-sm" title="Export the PDF report to Google Drive" onclick="exportReportPdfToDrive('${v.id}', this)">${ICONS.upload} PDF to Drive</button>
            <button class="btn-ghost btn-sm" title="Export blank verification templates (no results) to Google Drive" onclick="exportTemplatesToDrive('${v.id}', this)">${ICONS.upload} Templates to Drive</button>
            <button class="icon-btn" title="Edit version (name & status)" aria-label="Edit version" onclick="openEditVersionModal('${projectId}','${v.id}')">${ICONS.edit}</button>
            ${currentUser?.role === 'ADMIN' ? `<button class="icon-btn" title="Delete version" aria-label="Delete version" onclick="deleteVersion('${projectId}','${v.id}','${esc(v.name)}')">${ICONS.x}</button>` : ''}
          </div>
        </div>
        <div class="version-stats">
          <span class="version-stat"><b>${v.testCount}</b> tests</span>
          <span class="version-stat" style="color:var(--pass)"><b style="color:var(--pass)">${v.passed}</b> passed</span>
          <span class="version-stat" style="color:${v.failed > 0 ? 'var(--fail)' : 'inherit'}"><b style="color:${v.failed > 0 ? 'var(--fail)' : 'inherit'}">${v.failed}</b> failed</span>
        </div>
        ${segmentedBar([
          { label: 'Passed', value: v.passed, cls: 'seg-pass', swatch: 'var(--chart-3)' },
          { label: 'Partial', value: v.partial || 0, cls: 'seg-partial', swatch: 'var(--warn)' },
          { label: 'Failed', value: v.failed, cls: 'seg-fail', swatch: 'var(--chart-4)' },
          { label: 'Remaining', value: Math.max(0, (v.testCount || 0) - (v.passed || 0) - (v.partial || 0) - (v.failed || 0)), cls: 'seg-rest', swatch: 'var(--chart-6)' },
        ], { legend: false })}
      </div>
    </div>`;
}

// ── Modals ────────────────────────────────────────────────────────────────────
function openNewProjectModal() {
  openModal('New Project', `
    <div class="form-grid">
      <div class="field-group span-2">
        <label for="np-name">Project Name</label>
        <input type="text" id="np-name" placeholder="Main Product" required>
      </div>
      <div class="field-group">
        <label for="np-type">Type</label>
        <select id="np-type">
          <option value="US_SOFTWARE">US Software</option>
          <option value="EU_SOFTWARE">EU Software</option>
          <option value="IMAGE_VERSION">Image Version</option>
        </select>
      </div>
      <div class="field-group">
        <label for="np-git">Git Repo <span class="label-hint">optional</span></label>
        <input type="url" id="np-git" placeholder="https://bitbucket.org/...">
      </div>
      <div class="field-group span-2">
        <label for="np-desc">Description</label>
        <textarea id="np-desc" rows="2" placeholder="Brief description…"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="createProject()">Create Project</button>
    </div>`);
}

async function createProject() {
  const name = document.getElementById('np-name').value.trim();
  const type = document.getElementById('np-type').value;
  const gitRepo = document.getElementById('np-git').value.trim();
  const description = document.getElementById('np-desc').value.trim();
  if (!name) { toast('Name required', 'error'); return; }

  try {
    await API.projects.create({ name, type, gitRepo, description });
    closeModal();
    toast('Project created', 'success');
    renderProjects();
  } catch (err) { toast(err.message, 'error'); }
}

async function openEditProjectModal(projectId) {
  const p = await API.projects.get(projectId);
  openModal('Edit Project', `
    <div class="field-group">
      <label for="ep-name">Project Name</label>
      <input type="text" id="ep-name" value="${esc(p.name)}">
    </div>
    <div class="field-group">
      <label for="ep-desc">Description</label>
      <textarea id="ep-desc" rows="2">${esc(p.description || '')}</textarea>
    </div>
    <div class="field-group">
      <label for="ep-git">Git Repo</label>
      <input type="url" id="ep-git" value="${esc(p.gitRepo || '')}">
    </div>
    <div class="modal-footer">
      <button class="btn-danger push-left" onclick="deleteProject('${projectId}')">Delete Project</button>
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveProject('${projectId}')">Save Changes</button>
    </div>`);
}

async function saveProject(id) {
  const name = document.getElementById('ep-name').value.trim();
  const description = document.getElementById('ep-desc').value;
  const gitRepo = document.getElementById('ep-git').value;
  if (!name) { toast('Project name required', 'error'); return; }
  try {
    await API.projects.update(id, { name, description, gitRepo });
    closeModal();
    toast('Project saved', 'success');
    renderProjects();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteProject(id) {
  const ok = await confirmDialog('Delete project?',
    'This permanently deletes the project and all of its versions. This action cannot be undone.',
    { confirmLabel: 'Delete Project' });
  if (!ok) return;
  try {
    await API.projects.delete(id);
    closeModal();
    toast('Project deleted', 'info');
    renderProjects();
  } catch (err) { toast(err.message, 'error'); }
}

function openNewVersionModal(projectId) {
  openModal('New Version', `
    <div class="field-group">
      <label for="nv-name">Version Name</label>
      <input type="text" id="nv-name" placeholder="1.17.0US" required>
    </div>
    <p class="text-muted text-sm" style="display:flex;gap:6px;align-items:center">${ICONS.info} Tests are automatically inherited from the previous version.</p>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="createVersion('${projectId}')">Create Version</button>
    </div>`);
}

async function createVersion(projectId) {
  const name = document.getElementById('nv-name').value.trim();
  if (!name) { toast('Version name required', 'error'); return; }

  try {
    const result = await API.projects.createVersion(projectId, { name });
    closeModal();
    const msg = result.inheritedFrom
      ? `Version ${name} created — ${result.inheritedCount || 0} tests inherited from ${result.inheritedFrom}`
      : `Version ${name} created`;
    toast(msg, 'success');
    navigate('project-versions', { projectId });
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteVersion(projectId, versionId, name) {
  const ok = await confirmDialog('Delete version?',
    `This permanently deletes version “${name}” and all of its verification runs, signatures and evidence. This cannot be undone.`,
    { confirmLabel: 'Delete Version' });
  if (!ok) return;
  try {
    await API.projects.deleteVersion(projectId, versionId);
    toast('Version deleted', 'info');
    openProjectVersions(projectId);
  } catch (err) { toast(err.message, 'error'); }
}

// MagentiQA has three distinct version exports — keep them clearly separate:
//   (A) downloadReportPdf        — download the PDF report (results + approvals)
//   (B) exportReportPdfToDrive   — push that same PDF report to a Drive folder
//   (C) exportTemplatesToDrive   — push the verifications as blank .docx/.xlsx
//                                  TEMPLATES (no results) to a Drive folder
// (A) and (B) are the executed report; (C) is the un-executed template set.

// (A) Download the PDF report (every verification with its pass/fail + approvals).
function downloadReportPdf(versionId) {
  window.open(API.exportReport(versionId), '_blank');
}

// (B) Export that same PDF report to Google Drive, into a folder the user picks.
// The picker opens at the configured export default (GOOGLE_EXPORT_FOLDER).
async function exportReportPdfToDrive(versionId, btn) {
  try {
    const st = await API.google.status();
    if (!st.connected) {
      toast('Connect Google Drive first (Import page → Google Drive tab)', 'error');
      return;
    }
    openDriveFolderPicker({
      title: 'Export PDF report to Google Drive',
      startFolder: st.exportFolder,
      onSelect: async ({ id, pathNames }) => {
        const original = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = 'Exporting…'; }
        try {
          const result = await API.google.uploadReport(versionId, id);
          toast(`PDF report exported to ${pathNames}: ${result.file.name}`, 'success');
          if (result.file.webViewLink) window.open(result.file.webViewLink, '_blank');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          if (btn) { btn.disabled = false; btn.innerHTML = original; }
        }
      },
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// (C) Export every verification as a blank TEMPLATE (no pass/fail) to Google
// Drive — the inverse of a Drive folder import (tags become subfolders). The
// picker opens at the import default (where verification templates live).
async function exportTemplatesToDrive(versionId, btn) {
  try {
    const st = await API.google.status();
    if (!st.connected) {
      toast('Connect Google Drive first (Import page → Google Drive tab)', 'error');
      return;
    }
    openDriveFolderPicker({
      title: 'Export verification templates to Google Drive',
      startFolder: st.importFolder,
      onSelect: async ({ id, pathNames }) => {
        const ok = await confirmDialog('Export verification templates to Drive?',
          `This writes each verification in this version as a blank .docx template — no pass/fail results (its tags become subfolders; setup-tracked verifications also get their .xlsx tracker) into “${pathNames}”. Existing files with the same name are updated in place. Continue?`,
          { confirmLabel: 'Export', danger: false });
        if (!ok) return;
        const original = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = 'Exporting…'; }
        try {
          const r = await API.google.exportVersion(versionId, id);
          let msg = `Templates exported to ${pathNames}: ${r.created} created, ${r.updated} updated`;
          if (r.errors?.length) msg += `, ${r.errors.length} failed`;
          toast(msg, r.errors?.length ? 'info' : 'success');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          if (btn) { btn.disabled = false; btn.innerHTML = original; }
        }
      },
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}
