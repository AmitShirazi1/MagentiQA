/**
 * routes/google.js — Google Drive / Docs integration
 *
 * GET  /api/google/status         — { configured, connected, email, folderId }
 * GET  /api/google/connect        — start OAuth (browser navigation)
 * GET  /api/google/callback       — OAuth redirect target
 * POST /api/google/disconnect     — forget stored tokens
 * GET  /api/google/folders        — list subfolders of a folder ('root' = My Drive)
 * POST /api/google/folders        — create a subfolder → { id, name }
 * GET  /api/google/folder-info    — resolve folder URL/ID → { id, name }
 * POST /api/google/sync           — list Docs in a folder, parse each via Docs API
 * POST /api/google/upload-report  — generate version PDF and upload it to Drive
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');

const google = require('../lib/google');
const db = require('../lib/db');
const { parseGoogleDoc } = require('../lib/parsers/gdoc');
const { parseDocxTest }  = require('../lib/parsers/docx');
const { parseXlsxTracker } = require('../lib/parsers/xlsx');
const { trackerBaseName, docBaseName } = require('../lib/parsers/tracker-link');
const { buildVerificationDocx } = require('../lib/verification-doc');
const { buildTrackerXlsx } = require('../lib/verification-tracker-xlsx');

function safeParse(json, fallback) { try { return JSON.parse(json); } catch { return fallback; } }
function loadSetupsLite(testId) {
  return db.setups.query({ filter: { testId }, sortBy: 'order', sortDir: 'asc' })
    .map(s => ({ ...s, data: safeParse(s.data, {}) }));
}
/** Drive filenames can't contain slashes; collapse them so titles stay intact. */
function safeFileName(name) { return String(name || 'verification').replace(/[\\/]+/g, '-').trim(); }

const IMPORT_DIR = path.join(__dirname, '..', 'storage', 'imports');
const { generateVersionReport } = require('../lib/pdf');
const { audit } = require('../lib/audit');
const { requireAuth } = require('../lib/auth');

function redirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/google/callback`;
}

// ── Status ──────────────────────────────────────────────────────────────────

router.get('/status', requireAuth, (req, res) => {
  const store = google.loadStore();
  res.json({
    configured:   google.isConfigured(),
    connected:    google.isConnected(),
    email:        store.email || null,
    folderId:     store.folderId || null,
    // Default folders (URL or ID) for the picker, from .env
    importFolder: process.env.GOOGLE_IMPORT_FOLDER || null,
    exportFolder: process.env.GOOGLE_EXPORT_FOLDER || null,
  });
});

// ── OAuth flow ──────────────────────────────────────────────────────────────

router.get('/connect', requireAuth, (req, res) => {
  if (!google.isConfigured()) {
    return res.status(400).json({ error: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first' });
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.googleOAuthState = state;
  res.redirect(google.getAuthUrl(redirectUri(req), state));
});

router.get('/callback', requireAuth, async (req, res) => {
  const { code, state, error } = req.query;
  try {
    if (error) throw new Error(`Google returned: ${error}`);
    if (!state || state !== req.session.googleOAuthState) throw new Error('OAuth state mismatch');
    delete req.session.googleOAuthState;

    await google.exchangeCode(code, redirectUri(req));
    audit(req.user.id, 'UPDATE', 'settings', 'google-drive', null, { connected: true }, req);
    res.redirect('/#/import?google=connected');
  } catch (err) {
    res.redirect('/#/import?google=' + encodeURIComponent('error:' + err.message));
  }
});

router.post('/disconnect', requireAuth, (req, res) => {
  google.disconnect();
  audit(req.user.id, 'UPDATE', 'settings', 'google-drive', { connected: true }, { connected: false }, req);
  res.json({ ok: true });
});

// ── Folder browser: list subfolders of a folder ('root' = My Drive) ─────────

router.get('/folders', requireAuth, async (req, res) => {
  try {
    // 'sharedWithMe' is a virtual parent — folders shared with the user
    if (req.query.parent === 'sharedWithMe') {
      return res.json({ ok: true, parent: 'sharedWithMe', folders: await google.listSharedFolders() });
    }
    const parent = google.extractFolderId(req.query.parent) || 'root';
    const folders = await google.listSubfolders(parent);
    res.json({ ok: true, parent, folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Create a subfolder in the picker ('root' = My Drive) ────────────────────

router.post('/folders', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Folder name required' });
    const rawParent = req.body.parent;
    if (rawParent === 'sharedWithMe') {
      return res.status(400).json({ error: "Can't create a folder in “Shared with me” — open a folder first" });
    }
    const parent = google.extractFolderId(rawParent) || 'root';
    const id = await google.findOrCreateFolder(parent, name);
    res.json({ ok: true, id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Folder info: resolve a folder URL/ID to { id, name } for the picker ─────

router.get('/folder-info', requireAuth, async (req, res) => {
  try {
    const id = google.extractFolderId(req.query.id);
    if (!id) return res.status(400).json({ error: 'Provide a Drive folder URL or ID' });
    res.json({ ok: true, ...await google.getFolderInfo(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sync: folder of Google Docs → parsed verifications ─────────────────────

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const store  = google.loadStore();
    let folderId = google.extractFolderId(req.body.folder) || store.folderId
      || google.extractFolderId(process.env.GOOGLE_IMPORT_FOLDER);
    if (!folderId) return res.status(400).json({ error: 'Provide a Drive folder URL or ID' });
    folderId = await google.resolveFolderId(folderId); // pasted shortcut URL → target folder

    const docs = await google.listDocsInFolder(folderId);

    const results = [];
    const trackers = []; // .xlsx trackers, paired with verifications afterward
    for (const f of docs) {
      const relativePath = [...f.pathSegments, f.name].join('/');
      const dir = f.pathSegments.join('/');
      try {
        if (f.mimeType === google.XLSX_MIME) {
          // .xlsx setup tracker — download and parse, pair with its doc below
          const tmpPath = path.join(IMPORT_DIR, `gdrive-${f.id}.xlsx`);
          await google.downloadFile(f.id, tmpPath);
          let tracker;
          try { tracker = await parseXlsxTracker(tmpPath); }
          finally { try { fs.unlinkSync(tmpPath); } catch { /* best effort */ } }
          trackers.push({
            tracker, filename: f.name, relativePath, docId: f.id,
            dir, base: trackerBaseName(f.name),
            tagSegments: f.pathSegments.map(s => s.trim()).filter(Boolean),
          });
          continue;
        }

        let parsed;
        if (f.mimeType === google.DOCX_MIME) {
          // .docx stored in Drive — download and reuse the existing mammoth parser
          const tmpPath = path.join(IMPORT_DIR, `gdrive-${f.id}.docx`);
          await google.downloadFile(f.id, tmpPath);
          try { parsed = await parseDocxTest(tmpPath); }
          finally { try { fs.unlinkSync(tmpPath); } catch { /* best effort */ } }
          // Parser falls back to the temp filename for the title — use the real one
          if (parsed.title === `gdrive-${f.id}`) parsed.title = f.name.replace(/\.docx$/i, '');
        } else {
          // Native Google Doc — read structured JSON via the Docs API
          parsed = parseGoogleDoc(await google.getDoc(f.id));
        }

        // Remember the source filename so an export can reproduce it exactly
        parsed.sourceFile = f.name;

        // Subfolder names along the path become tags (same rule as folder import)
        const tagSegments = f.pathSegments.map(s => s.trim()).filter(Boolean);
        parsed.tags = [...new Set([...(parsed.tags || []), ...tagSegments])];

        results.push({
          filename: f.name, relativePath, docId: f.id, modifiedTime: f.modifiedTime, ok: true, parsed,
          dir, base: docBaseName(f.name),
        });
      } catch (err) {
        results.push({ filename: f.name, relativePath, docId: f.id, ok: false, error: err.message });
      }
    }

    // ── Pair each tracker with its verification (same folder + base name) ──
    for (const tr of trackers) {
      const partner = results.find(r => r.ok && r.parsed && r.dir === tr.dir && r.base === tr.base
        && r.parsed.type !== 'SETUP_TRACKED');
      if (partner) {
        partner.parsed.type = 'SETUP_TRACKED';
        partner.parsed.tracker = tr.tracker;
      } else {
        const base = tr.base || tr.tracker.name || 'Setup Tracker';
        const parsed = {
          title: base.replace(/\b\w/g, c => c.toUpperCase()),
          path: '', tags: [...new Set(tr.tagSegments)], description: '', preconditions: '',
          configuration: '', files: '', notes: '', steps: [], type: 'SETUP_TRACKED', tracker: tr.tracker,
          sourceFile: tr.filename,
        };
        results.push({ filename: tr.filename, relativePath: tr.relativePath, docId: tr.docId, ok: true, parsed, kind: 'tracker' });
      }
    }

    // Remember the folder for next sync / report upload
    store.folderId = folderId;
    google.saveStore(store);

    res.json({ ok: true, folderId, total: docs.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Version export (B): the PDF report → Drive ─────────────────────────────
// Generates the same executed PDF report as the (A) download and uploads it to
// the chosen Drive folder (default GOOGLE_EXPORT_FOLDER). This is the report,
// WITH results — distinct from (C) export-version below, which writes blank
// templates.

router.post('/upload-report', requireAuth, async (req, res) => {
  try {
    const { versionId } = req.body;
    if (!versionId) return res.status(400).json({ error: 'versionId required' });

    const store  = google.loadStore();
    let folderId = google.extractFolderId(req.body.folder)
      || google.extractFolderId(process.env.GOOGLE_EXPORT_FOLDER) || store.folderId;
    if (!folderId) return res.status(400).json({ error: 'No Drive folder set — run a sync first or provide a folder' });
    folderId = await google.resolveFolderId(folderId);

    const report = await generateVersionReport(versionId);
    if (report.type !== 'pdf') {
      return res.status(500).json({ error: 'PDF generation requires Chrome/Chromium installed (got HTML fallback)' });
    }

    const uploaded = await google.uploadPdf(folderId, report.path, report.filename);
    audit(req.user.id, 'EXPORT', 'versions', versionId, null,
      { driveFileId: uploaded.id, driveLink: uploaded.webViewLink }, req);

    res.json({ ok: true, file: uploaded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Version export (C): blank verification templates → Drive ──────────────────
// The inverse of a folder import, and distinct from the (B) PDF report upload:
// this writes each verification as a clean .docx TEMPLATE (no pass/fail results),
// its `tags` becoming the nested subfolders (the exact inverse of import's
// folder→tags rule). Setup-tracked verifications also get their paired "<base>
// test tracker.xlsx". Files are upserted: an existing same-name file in the same
// subfolder is updated in place — so re-exporting an unchanged version reproduces
// the original folder.
router.post('/export-version', requireAuth, async (req, res) => {
  try {
    const { versionId, folder } = req.body;
    if (!versionId) return res.status(400).json({ error: 'versionId required' });
    const version = db.versions.findById(versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const store = google.loadStore();
    let folderId = google.extractFolderId(folder)
      || google.extractFolderId(process.env.GOOGLE_IMPORT_FOLDER)
      || store.folderId;
    if (!folderId) return res.status(400).json({ error: 'No Drive folder set — choose a folder or set GOOGLE_IMPORT_FOLDER' });
    folderId = await google.resolveFolderId(folderId);

    const vTests = db.versionTests.findAll({ versionId });
    const summary = { created: 0, updated: 0, folders: 0, items: [], errors: [] };

    // Guarantee unique filenames within a folder. Drive matches names
    // case-insensitively, so two verifications whose titles differ only by case
    // (e.g. "all resolutions" vs "All Resolutions") would otherwise clobber each
    // other. When the original filename is known (sourceFile) names are already
    // distinct; only derived-from-title names can collide, and we disambiguate
    // those with the stable testId.
    const usedByFolder = new Map(); // parentId -> Set(lowercased names)
    function uniqueName(parentId, name, testId) {
      let set = usedByFolder.get(parentId);
      if (!set) { set = new Set(); usedByFolder.set(parentId, set); }
      let candidate = name;
      if (set.has(candidate.toLowerCase())) {
        const dot = name.lastIndexOf('.');
        const stem = dot >= 0 ? name.slice(0, dot) : name;
        const ext  = dot >= 0 ? name.slice(dot) : '';
        candidate = `${stem} (${testId})${ext}`;
      }
      set.add(candidate.toLowerCase());
      return candidate;
    }

    // Resolve (and cache) a tag path into a Drive folder id, creating as needed.
    const folderCache = new Map();
    async function resolveTagPath(segments) {
      let id = folderId;
      const acc = [];
      for (const seg of segments) {
        acc.push(seg);
        const key = acc.join('/');
        if (folderCache.has(key)) { id = folderCache.get(key); continue; }
        id = await google.findOrCreateFolder(id, seg);
        folderCache.set(key, id);
        summary.folders++;
      }
      return id;
    }

    async function upsert(parentId, buffer, name, mime) {
      const existing = await google.findFileInFolderByName(parentId, name);
      await google.uploadFile(parentId, buffer, name, mime, { existingFileId: existing?.id });
      summary[existing ? 'updated' : 'created']++;
      return !!existing;
    }

    for (const vt of vTests) {
      const t = db.tests.findById(vt.testDefId);
      if (!t) continue;
      // Exported folder + file names are always lowercase.
      const tags    = safeParse(t.tags, []).map(String).map(s => s.trim().toLowerCase()).filter(Boolean);
      const steps   = db.steps.query({ filter: { testId: t.id }, sortBy: 'order', sortDir: 'asc' });
      const tracked = (t.type || 'STANDARD') === 'SETUP_TRACKED';
      const src     = t.sourceFile || '';
      const testId  = (t.testId || '').toLowerCase();
      // Reproduce the source filename when known; otherwise derive from the title.
      const xlsxOnly = tracked && /\.xlsx$/i.test(src) && steps.length === 0;
      const docNameRaw = (/\.docx$/i.test(src) ? src
        : /\.md$/i.test(src) ? src.replace(/\.md$/i, '.docx')
        : `${safeFileName(t.title)}.docx`).toLowerCase();

      try {
        const parentId = tags.length ? await resolveTagPath(tags) : folderId;
        const pathLabel = tags.join('/');
        let docBase = docBaseName(docNameRaw);   // tracker pairs by this base name

        if (!xlsxOnly) {
          const docName = uniqueName(parentId, docNameRaw, testId);
          docBase = docBaseName(docName);        // keep the tracker paired if disambiguated
          const docBuf = await buildVerificationDocx(
            { title: t.title, configuration: t.configuration, files: t.files, description: t.description, preconditions: t.preconditions },
            steps
          );
          const wasUpdate = await upsert(parentId, docBuf, docName, google.DOCX_MIME);
          summary.items.push({ name: docName, path: pathLabel, action: wasUpdate ? 'updated' : 'created' });
        }

        if (tracked) {
          const meta    = safeParse(t.setupMeta, {});
          const columns = safeParse(t.setupColumns, []);
          const setups  = loadSetupsLite(t.id);
          // An xlsx-only tracker keeps its original filename; otherwise pair with the docx base.
          const trackerRaw = ((xlsxOnly && /\.xlsx$/i.test(src)) ? src : `${docBase} test tracker.xlsx`).toLowerCase();
          const trackerName = uniqueName(parentId, trackerRaw, testId);
          const xbuf = await buildTrackerXlsx({
            name: 'Verification Tracker', columns, setups,
            statusColumn: meta.statusColumn, testerColumn: meta.testerColumn,
          });
          const wasUpdate = await upsert(parentId, xbuf, trackerName, google.XLSX_MIME);
          summary.items.push({ name: trackerName, path: pathLabel, action: wasUpdate ? 'updated' : 'created' });
        }
      } catch (err) {
        summary.errors.push({ test: t.title, error: err.message });
      }
    }

    store.folderId = folderId;
    google.saveStore(store);
    audit(req.user.id, 'EXPORT', 'versions', versionId, null,
      { folderId, created: summary.created, updated: summary.updated, folders: summary.folders }, req);

    res.json({ ok: true, folderId, ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
