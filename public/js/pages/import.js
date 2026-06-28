// public/js/pages/import.js
async function renderImport(params = {}) {
  const el = document.getElementById('page-import');
  el.innerHTML = skeletonPage();
  const projects = await API.projects.list();
  let allVersions = [];
  for (const p of projects) {
    const versions = await API.projects.versions(p.id);
    allVersions.push(...versions.map(v => ({ ...v, projectName: p.name })));
  }

  const versionSelect = `
    <select id="import-version-select">
      <option value="">Don't link to a version</option>
      ${allVersions.map(v => `<option value="${v.id}">${v.projectName} — ${v.name}</option>`).join('')}
    </select>`;

  el.innerHTML = `
    <div class="page-header">
      <div><h1>Import Verifications</h1><p class="subtitle">Import from Google Drive, or from .docx / .md files</p></div>
    </div>
    <div class="page-body" style="max-width:840px">

      <!-- Mode tabs -->
      <div class="card mb-16">
        <div class="tabs" style="margin:-4px -4px 18px">
          <button id="tab-gdrive" class="tab-btn tab-active" onclick="switchImportTab('gdrive')">Google Drive</button>
          <button id="tab-single" class="tab-btn" onclick="switchImportTab('single')">Single File</button>
          <button id="tab-folder" class="tab-btn" onclick="switchImportTab('folder')">Folder</button>
        </div>

        <!-- Google Drive mode -->
        <div id="import-gdrive-mode">
          <div id="gdrive-panel"><p class="text-muted">Checking Google Drive connection…</p></div>
          <div id="gdrive-status" style="margin-top:12px"></div>
        </div>

        <!-- Single file mode -->
        <div id="import-single-mode" class="hidden">
          <div class="drop-zone" onclick="document.getElementById('import-file').click()"
            ondragover="event.preventDefault();this.classList.add('drag-over')"
            ondragleave="this.classList.remove('drag-over')"
            ondrop="handleImportDrop(event)">
            <svg width="32" height="32" class="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <p>Drop a .docx, .md or .xlsx file here</p>
            <p style="font-size:11px;color:var(--text-muted)">A verification file, or a “… test tracker.xlsx” setup tracker</p>
          </div>
          <input type="file" id="import-file" accept=".docx,.md,.xlsx" style="display:none" onchange="handleImportFile(event)">
          <div id="import-status" style="margin-top:12px"></div>
        </div>

        <!-- Folder mode -->
        <div id="import-folder-mode" class="hidden">
          <div class="drop-zone" id="folder-drop-zone"
            ondragover="event.preventDefault();this.classList.add('drag-over')"
            ondragleave="this.classList.remove('drag-over')"
            ondrop="handleFolderDrop(event)">
            <svg width="32" height="32" class="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <p>Drop a folder here</p>
            <p style="font-size:11px;color:var(--text-muted)">All .docx, .md and .xlsx files found recursively. A “… test tracker.xlsx” attaches to the verification of the same name. Folder names become tags.</p>
          </div>
          <input type="file" id="import-folder-input" webkitdirectory multiple style="display:none" onchange="handleFolderInput(event)">
          <button class="btn-secondary" style="margin-top:12px" onclick="document.getElementById('import-folder-input').click()">
            ${ICONS.folder} Browse for Folder…
          </button>
          <div id="folder-status" style="margin-top:12px"></div>
        </div>
      </div>

      <!-- Single file preview -->
      <div id="import-preview" class="hidden">
        <div class="card mb-16">
          <div class="card-header">
            <span class="card-title">Parsed Preview</span>
            <span id="import-filename" class="mono text-muted"></span>
          </div>
          <div id="preview-content"></div>
        </div>
        <div class="card mb-16">
          <div class="card-title" style="margin-bottom:10px">Link to Version (optional)</div>
          ${versionSelect}
        </div>
        <div class="btn-row">
          <button class="btn-primary" onclick="saveImport()">${ICONS.check} Save Verification</button>
          <button class="btn-secondary" onclick="resetImport()">Clear</button>
        </div>
      </div>

      <!-- Folder batch preview -->
      <div id="folder-preview" class="hidden">
        <div class="card mb-16">
          <div class="card-header">
            <span class="card-title" id="folder-preview-title">Parsed files</span>
            <span id="folder-file-count" class="mono text-muted"></span>
          </div>
          <div id="folder-preview-list" style="max-height:400px;overflow-y:auto"></div>
        </div>
        <div class="card mb-16">
          <div class="card-title" style="margin-bottom:10px">Link all to Version (optional)</div>
          <select id="folder-version-select">
            <option value="">Don't link to a version</option>
            ${allVersions.map(v => `<option value="${v.id}">${v.projectName} — ${v.name}</option>`).join('')}
          </select>
        </div>
        <div class="btn-row">
          <button class="btn-primary" onclick="saveFolderImport()">${ICONS.upload} Import All</button>
          <button class="btn-secondary" onclick="resetFolderImport()">Clear</button>
        </div>
      </div>

    </div>`;

  // Surface OAuth redirect result (/#/import?google=connected|error:…)
  if (params.google === 'connected') {
    toast('Google Drive connected', 'success');
  } else if (params.google?.startsWith('error:')) {
    toast(params.google.slice(6), 'error');
  }
  await renderGdrivePanel();
}

// ── Progress bar ──────────────────────────────────────────────────────────────
// Renders a progress bar into a status container and returns handles to drive it.
// Real upload byte-progress fills the bar; once the bytes are up and the server
// is parsing, it switches to an indeterminate sweep so the page never looks frozen.
function showImportProgress(containerId, label) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="import-progress">
      <div class="progress-bar-wrap"><div class="progress-bar"></div></div>
      <div class="progress-label"></div>
    </div>`;
  const wrap = container.querySelector('.progress-bar-wrap');
  const bar  = container.querySelector('.progress-bar');
  const lbl  = container.querySelector('.progress-label');
  lbl.textContent = label || 'Uploading…';
  return {
    // Determinate fill while bytes upload (0–100).
    upload(pct) {
      wrap.classList.remove('indeterminate');
      bar.style.width = pct + '%';
      lbl.textContent = `Uploading… ${pct}%`;
    },
    // Indeterminate sweep while the server works (no measurable progress).
    pending(msg) {
      wrap.classList.add('indeterminate');
      bar.style.width = '';
      lbl.textContent = msg;
    },
    clear() { container.innerHTML = ''; },
    fail(msg) { container.innerHTML = `<div class="form-error">${msg}</div>`; },
  };
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchImportTab(tab) {
  document.getElementById('import-gdrive-mode').classList.toggle('hidden', tab !== 'gdrive');
  document.getElementById('import-single-mode').classList.toggle('hidden', tab !== 'single');
  document.getElementById('import-folder-mode').classList.toggle('hidden', tab !== 'folder');
  document.getElementById('tab-gdrive').classList.toggle('tab-active', tab === 'gdrive');
  document.getElementById('tab-single').classList.toggle('tab-active', tab === 'single');
  document.getElementById('tab-folder').classList.toggle('tab-active', tab === 'folder');
  resetImport();
  resetFolderImport();
}

// ── Google Drive ──────────────────────────────────────────────────────────────
let _gdriveImportDefault = null; // GOOGLE_IMPORT_FOLDER from .env, via /status

async function renderGdrivePanel() {
  const panel = document.getElementById('gdrive-panel');
  if (!panel) return;
  try {
    const st = await API.google.status();
    _gdriveImportDefault = st.importFolder;

    if (!st.configured) {
      panel.innerHTML = `
        <p>Google Drive isn't configured yet.</p>
        <p class="text-muted text-sm" style="margin-top:8px">
          Create an OAuth client in Google Cloud Console (Desktop app, with the Drive API and
          Docs API enabled), then set <span class="mono">GOOGLE_CLIENT_ID</span> and
          <span class="mono">GOOGLE_CLIENT_SECRET</span> in <span class="mono">.env</span>
          and restart the server. See the README for step-by-step setup.
        </p>`;
      return;
    }

    if (!st.connected) {
      panel.innerHTML = `
        <p>Connect your Google account to sync verification Docs straight from a Drive folder —
           no download or .docx export needed.</p>
        <button class="btn-primary" style="margin-top:10px"
          onclick="window.location.href='/api/google/connect'">Connect Google Drive</button>`;
      return;
    }

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span class="text-sm">Connected as <span class="bold">${esc(st.email || 'Google account')}</span></span>
        <button class="btn-ghost btn-sm" onclick="gdriveDisconnect()">Disconnect</button>
      </div>
      <label class="text-muted text-sm">Drive folder</label>
      <div style="display:flex;gap:8px;margin-top:4px">
        <input type="text" id="gdrive-folder" style="flex:1" placeholder="Browse… or paste a folder URL/ID"
          value="${esc(st.folderId || st.importFolder || '')}">
        <button class="btn-secondary" onclick="gdriveBrowse()">Browse…</button>
        <button class="btn-primary" id="gdrive-sync-btn" onclick="gdriveSync()">Import</button>
      </div>
      <div id="gdrive-folder-name" class="text-muted" style="font-size:11px;margin-top:4px"></div>
      <p class="text-muted" style="font-size:11px;margin-top:6px">
        Reads every Google Doc (Docs API) and .docx file in the folder and all its
        subfolders — shared folders and shortcuts included. Subfolder names along
        a file's path become its tags.
      </p>`;
  } catch (err) {
    panel.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
  }
}

async function gdriveSync() {
  const folder = document.getElementById('gdrive-folder').value.trim();
  if (!folder) { toast('Enter a Drive folder URL or ID', 'error'); return; }

  const btn = document.getElementById('gdrive-sync-btn');
  btn.disabled = true;
  const prog = showImportProgress('gdrive-status', '');
  prog.pending('Reading and parsing Docs from Drive…');

  try {
    const data = await API.google.sync(folder);
    _folderParsedItems = data.results.filter(r => r.ok && r.parsed);
    renderFolderPreview(_folderParsedItems, data.results);
    if (data.total === 0) prog.fail('No Google Docs found in that folder.');
    else prog.clear();
  } catch (err) {
    prog.fail(esc(err.message));
  } finally {
    btn.disabled = false;
  }
}

// ── Drive folder browser modal (shared picker lives in ui.js) ────────────────
function gdriveBrowse() {
  openDriveFolderPicker({
    startFolder: _gdriveImportDefault,
    onSelect: ({ id, pathNames }) => {
      document.getElementById('gdrive-folder').value = id;
      document.getElementById('gdrive-folder-name').textContent = 'Selected: ' + pathNames;
    },
  });
}

async function gdriveDisconnect() {
  try {
    await API.google.disconnect();
    toast('Google Drive disconnected', 'success');
    await renderGdrivePanel();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Single file ───────────────────────────────────────────────────────────────
let _importParsed = null;

async function handleImportFile(event) {
  const file = event.target.files[0];
  if (file) await doImportPreview(file);
}

async function handleImportDrop(event) {
  event.preventDefault();
  document.querySelector('.drop-zone').classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) await doImportPreview(file);
}

async function doImportPreview(file) {
  const prog = showImportProgress('import-status', `Uploading ${esc(file.name)}…`);
  const fd = new FormData();
  fd.append('file', file);
  try {
    const result = await API.uploadProgress('/import/preview', fd,
      pct => pct < 100 ? prog.upload(pct) : prog.pending(`Parsing ${esc(file.name)}…`));
    _importParsed = result.parsed;

    const tracker = result.parsed.tracker;
    document.getElementById('import-filename').textContent = file.name;
    document.getElementById('preview-content').innerHTML = `
      ${result.parsed.type === 'SETUP_TRACKED' ? `<div class="type-banner" style="margin-bottom:12px"><span><span class="tag">Setup-tracked</span> ${tracker ? `${tracker.setups.length} setup(s) across ${tracker.columns.length} column(s)` : ''}</span></div>` : ''}
      <div class="form-grid" style="margin-bottom:12px">
        <div><span class="text-muted text-sm">Title</span><div class="bold">${esc(result.parsed.title)}</div></div>
        <div><span class="text-muted text-sm">Steps found</span><div class="bold">${(result.parsed.steps||[]).length}</div></div>
        ${tracker ? `<div><span class="text-muted text-sm">Setups</span><div class="bold">${tracker.setups.length}</div></div>` : ''}
        ${result.parsed.configuration ? `<div class="span-2"><span class="text-muted text-sm">Configuration</span><div>${esc(trunc(result.parsed.configuration))}</div></div>` : ''}
        ${result.parsed.files ? `<div class="span-2"><span class="text-muted text-sm">Files</span><div>${esc(trunc(result.parsed.files))}</div></div>` : ''}
        ${result.parsed.description ? `<div class="span-2"><span class="text-muted text-sm">Description</span><div>${esc(trunc(result.parsed.description))}</div></div>` : ''}
        ${result.parsed.preconditions ? `<div class="span-2"><span class="text-muted text-sm">Pre conditions</span><div>${esc(trunc(result.parsed.preconditions))}</div></div>` : ''}
        ${result.parsed.notes ? `<div class="span-2"><span class="text-muted text-sm">Notes</span><div style="white-space:pre-wrap">${esc(result.parsed.notes)}</div></div>` : ''}
        ${result.parsed.tags?.length ? `<div><span class="text-muted text-sm">Tags</span><div>${result.parsed.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join(' ')}</div></div>` : ''}
      </div>
      ${(result.parsed.steps||[]).length ? `
      <div class="divider"></div>
      <div style="max-height:220px;overflow-y:auto">
        <table class="steps-table">
          <thead><tr><th>#</th><th>Action</th><th>Expected Result</th></tr></thead>
          <tbody>
            ${(result.parsed.steps||[]).map(s => `
              <tr><td class="mono">${s.order}</td><td>${esc(s.action)}</td><td style="color:var(--text-secondary)">${esc(s.expectedResult||'—')}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}
      ${tracker ? `
        <div class="divider"></div>
        <div class="card-title" style="margin-bottom:8px">Setups (${tracker.setups.length})</div>
        <div style="max-height:260px;overflow:auto;border:1px solid var(--border-subtle);border-radius:var(--radius)">
          <table class="steps-table">
            <thead><tr>${tracker.columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>
              ${tracker.setups.map(s=>`<tr>${tracker.columns.map(c=>`<td>${esc((s.data&&s.data[c])||'')}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}`;

    document.getElementById('import-preview').classList.remove('hidden');
    prog.clear();
  } catch (err) {
    prog.fail(err.message);
  }
}

async function saveImport() {
  if (!_importParsed) { toast('Nothing to save', 'error'); return; }
  const versionId = document.getElementById('import-version-select').value || null;
  try {
    const result = await API.importSave({ parsed: _importParsed, versionId });
    toast(result.wasUpdated ? 'Verification updated' : 'Verification imported', 'success');
    resetImport();
  } catch (err) { toast(err.message, 'error'); }
}

function resetImport() {
  _importParsed = null;
  document.getElementById('import-preview').classList.add('hidden');
  const fi = document.getElementById('import-file');
  if (fi) fi.value = '';
  document.getElementById('import-status').innerHTML = '';
}

// ── Folder import ─────────────────────────────────────────────────────────────
let _folderParsedItems = [];

async function handleFolderInput(event) {
  const files = [...event.target.files];
  if (!files.length) return;
  await processFolderFiles(files);
}

async function handleFolderDrop(event) {
  event.preventDefault();
  document.getElementById('folder-drop-zone').classList.remove('drag-over');

  // Read directory entries recursively from DataTransfer
  const files = await readDroppedEntries(event.dataTransfer.items);
  if (files.length) await processFolderFiles(files, true);
}

// Read FileSystemEntry items recursively
async function readDroppedEntries(items) {
  const allFiles = [];
  const promises = [];

  for (const item of items) {
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (!entry) continue;
    promises.push(readEntry(entry, '', allFiles));
  }
  await Promise.all(promises);
  return allFiles;
}

function readEntry(entry, relativePath, allFiles) {
  return new Promise(resolve => {
    if (entry.isFile) {
      entry.file(file => {
        // Attach relative path
        Object.defineProperty(file, 'relativePath', {
          value: relativePath ? `${relativePath}/${file.name}` : file.name,
          writable: false,
        });
        allFiles.push(file);
        resolve();
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = () => {
        reader.readEntries(async entries => {
          if (!entries.length) { resolve(); return; }
          const subBase = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          await Promise.all(entries.map(e => readEntry(e, subBase, allFiles)));
          readAll(); // keep reading until empty batch
        });
      };
      readAll();
    } else {
      resolve();
    }
  });
}

async function processFolderFiles(files, fromDrop = false) {
  // Filter to .docx, .md and .xlsx (setup trackers)
  const supported = files.filter(f => /\.(docx|md|xlsx)$/i.test(f.name));
  if (!supported.length) {
    document.getElementById('folder-status').innerHTML = '<div class="form-error">No .docx, .md or .xlsx files found in this folder.</div>';
    return;
  }

  const prog = showImportProgress('folder-status', `Uploading ${supported.length} file(s)…`);

  const fd = new FormData();
  const relativePaths = [];

  for (const file of supported) {
    fd.append('files', file);
    // webkitRelativePath is set by <input webkitdirectory>, relativePath by our drop handler
    const rp = file.relativePath || file.webkitRelativePath || file.name;
    relativePaths.push(rp);
  }
  fd.append('relativePaths', JSON.stringify(relativePaths));

  try {
    const data = await API.uploadProgress('/import/folder', fd,
      pct => pct < 100 ? prog.upload(pct) : prog.pending(`Parsing ${supported.length} file(s) on the server…`));

    // Only keep successfully parsed items
    _folderParsedItems = data.results.filter(r => r.ok && r.parsed);

    renderFolderPreview(_folderParsedItems, data.results);
    prog.clear();
  } catch (err) {
    prog.fail(err.message);
  }
}

function renderFolderPreview(items, allResults) {
  const skipped = allResults.filter(r => !r.ok);
  document.getElementById('folder-file-count').textContent =
    `${items.length} to import${skipped.length ? `, ${skipped.length} skipped` : ''}`;

  document.getElementById('folder-preview-list').innerHTML = items.map((item, idx) => `
    <div style="display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--border-subtle)">
      <div class="feed-icon tone-info" style="margin-top:1px">${ICONS.doc}</div>
      <div style="flex:1;min-width:0">
        <div class="bold">${esc(item.parsed.title)}</div>
        <div class="mono text-muted" style="font-size:10px">${esc(item.relativePath || item.filename)}</div>
        <div style="margin-top:5px">
          ${item.parsed.type === 'SETUP_TRACKED' ? '<span class="tag">Setup-tracked</span> ' : ''}
          ${(item.parsed.tags||[]).map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        <span class="badge badge-automated no-dot">${(item.parsed.steps||[]).length} steps</span>
        ${item.parsed.tracker ? `<span class="badge badge-in_review no-dot">${item.parsed.tracker.setups.length} setups</span>` : ''}
      </div>
    </div>`).join('');

  document.getElementById('folder-preview').classList.remove('hidden');
}

async function saveFolderImport() {
  if (!_folderParsedItems.length) { toast('Nothing to save', 'error'); return; }
  const versionId = document.getElementById('folder-version-select').value || null;
  try {
    const items = _folderParsedItems.map(item => item.parsed);
    const result = await API.importSaveBatch({ items, versionId });
    const saved   = result.saved.filter(r => !r.error).length;
    const errored = result.saved.filter(r => r.error).length;
    toast(`Imported ${saved} verification(s)${errored ? `, ${errored} failed` : ''}`, 'success');
    resetFolderImport();
  } catch (err) { toast(err.message, 'error'); }
}

function resetFolderImport() {
  _folderParsedItems = [];
  document.getElementById('folder-preview').classList.add('hidden');
  document.getElementById('folder-status').innerHTML = '';
  const fi = document.getElementById('import-folder-input');
  if (fi) fi.value = '';
}
