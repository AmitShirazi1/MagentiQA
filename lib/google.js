/**
 * lib/google.js — Google Drive + Docs API client (zero dependencies)
 *
 * Uses the OAuth 2.0 installed-app (loopback) flow: the user creates a
 * "Desktop app" OAuth client in Google Cloud Console, puts the client ID and
 * secret in .env, and connects once from the Import page. Tokens are stored
 * locally in data/google-tokens.json and refreshed automatically — consistent
 * with the app's local-only design (no SDK, native fetch, Node 18+).
 *
 * Setup (one time):
 *   1. console.cloud.google.com → create a project
 *   2. Enable "Google Drive API" and "Google Docs API"
 *   3. OAuth consent screen → Internal (Workspace) or External + add yourself as test user
 *   4. Credentials → Create OAuth client ID → type "Desktop app"
 *   5. Put GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env
 */

const fs   = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, '..', 'data', 'google-tokens.json');

// drive: list any folder the user can see + upload PDFs into it.
// documents.readonly: read Doc content as structured JSON.
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents.readonly',
].join(' ');

// ── Local token store ───────────────────────────────────────────────────────

function loadStore() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveStore(store) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function isConnected() {
  return !!loadStore().refreshToken;
}

function disconnect() {
  try { fs.unlinkSync(TOKEN_FILE); } catch { /* already gone */ }
}

// ── OAuth ───────────────────────────────────────────────────────────────────

function getAuthUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',   // get a refresh token…
    prompt: 'consent',        // …even on re-connect
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code, redirectUri) {
  const tokens = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const store = loadStore();
  store.refreshToken = tokens.refresh_token || store.refreshToken;
  store.accessToken  = tokens.access_token;
  store.expiresAt    = Date.now() + (tokens.expires_in - 60) * 1000;
  saveStore(store);

  // Remember whose account this is (shown in the UI)
  try {
    const about = await apiGet('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)');
    store.email = about.user?.emailAddress;
    saveStore(store);
  } catch { /* non-fatal */ }

  return store;
}

async function getAccessToken() {
  const store = loadStore();
  if (!store.refreshToken) throw new Error('Google Drive is not connected');
  if (store.accessToken && Date.now() < (store.expiresAt || 0)) return store.accessToken;

  const tokens = await tokenRequest({
    refresh_token: store.refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  store.accessToken = tokens.access_token;
  store.expiresAt   = Date.now() + (tokens.expires_in - 60) * 1000;
  saveStore(store);
  return store.accessToken;
}

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google token error: ${data.error_description || data.error || res.status}`);
  }
  return data;
}

// ── API helpers ─────────────────────────────────────────────────────────────

async function apiGet(url) {
  const token = await getAccessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google API error ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  }
  return data;
}

/** Accepts a raw folder ID, the 'root' alias, or any Drive folder URL and returns the ID. */
function extractFolderId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (s === 'root') return s; // Drive API alias for "My Drive"
  const m = s.match(/\/folders\/([A-Za-z0-9_-]+)/) || s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

const DOC_MIME      = 'application/vnd.google-apps.document';
const FOLDER_MIME   = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const DOCX_MIME     = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME     = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const LIST_FIELDS = 'nextPageToken,files(id,name,mimeType,modifiedTime,shortcutDetails)';

/**
 * Resolve a shortcut to its target: a shared folder living in My Drive is a
 * shortcut file, not a folder — its children are listed under the TARGET id.
 * Shortcuts to anything other than a folder or Doc are dropped (null).
 */
function resolveShortcut(f) {
  if (f.mimeType !== SHORTCUT_MIME) return f;
  const t = f.shortcutDetails || {};
  if ([FOLDER_MIME, DOC_MIME, DOCX_MIME, XLSX_MIME].includes(t.targetMimeType)) {
    return { id: t.targetId, name: f.name, mimeType: t.targetMimeType, modifiedTime: f.modifiedTime };
  }
  return null;
}

/** Run a files.list query with pagination, resolving shortcuts. */
async function listFiles(query) {
  const q = encodeURIComponent(query);
  const files = [];
  let pageToken = '';
  do {
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}` +
      `&fields=${LIST_FIELDS}&orderBy=name&pageSize=100` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const data = await apiGet(url);
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files.map(resolveShortcut).filter(Boolean);
}

/** List the Docs, .docx files, subfolders, and shortcuts-to-any directly inside one folder. */
function listFolderChildren(folderId) {
  return listFiles(
    `'${folderId}' in parents and ` +
    `(mimeType='${DOC_MIME}' or mimeType='${DOCX_MIME}' or mimeType='${XLSX_MIME}' or mimeType='${FOLDER_MIME}' or mimeType='${SHORTCUT_MIME}') and trashed=false`
  );
}

/**
 * If the given ID is a shortcut, return its target's ID (so pasting a
 * shortcut URL works for sync/upload); otherwise return the ID unchanged.
 */
async function resolveFolderId(id) {
  if (!id || id === 'root') return id;
  try {
    const f = await apiGet(
      `https://www.googleapis.com/drive/v3/files/${id}?fields=id,mimeType,shortcutDetails&supportsAllDrives=true`
    );
    if (f.mimeType === SHORTCUT_MIME) return f.shortcutDetails?.targetId || id;
  } catch { /* fall through — let the actual listing surface the error */ }
  return id;
}

/**
 * Fetch a folder's id and name, resolving a shortcut to its target — used to
 * seed the folder picker at a default location.
 */
async function getFolderInfo(id) {
  if (id === 'root') return { id: 'root', name: 'My Drive' };
  const f = await apiGet(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,shortcutDetails&supportsAllDrives=true`
  );
  if (f.mimeType === SHORTCUT_MIME) {
    if (f.shortcutDetails?.targetMimeType !== FOLDER_MIME) throw new Error('Not a folder');
    return { id: f.shortcutDetails.targetId, name: f.name };
  }
  if (f.mimeType !== FOLDER_MIME) throw new Error('Not a folder');
  return { id: f.id, name: f.name };
}

/**
 * List only the subfolders of a folder ('root' = My Drive) — for the folder
 * browser. Shortcuts to folders (e.g. shared folders added to My Drive) are
 * included, already resolved to their target IDs.
 */
async function listSubfolders(parentId) {
  const files = await listFiles(
    `'${parentId}' in parents and ` +
    `(mimeType='${FOLDER_MIME}' or mimeType='${SHORTCUT_MIME}') and trashed=false`
  );
  return files.filter(f => f.mimeType === FOLDER_MIME);
}

/** List folders shared with the user (the "Shared with me" view in Drive). */
async function listSharedFolders() {
  const files = await listFiles(
    `sharedWithMe = true and ` +
    `(mimeType='${FOLDER_MIME}' or mimeType='${SHORTCUT_MIME}') and trashed=false`
  );
  return files.filter(f => f.mimeType === FOLDER_MIME);
}

/**
 * List all Google Docs in a folder and its subfolders, depth-first.
 * Each returned file carries pathSegments — the subfolder names between the
 * root folder and the Doc (mirrors the folder-import tag rule: root and
 * filename excluded). A visited set guards against shortcut/shared-drive loops.
 */
async function listDocsInFolder(folderId, pathSegments = [], visited = new Set()) {
  if (visited.has(folderId) || visited.size > 200) return [];
  visited.add(folderId);

  const children = await listFolderChildren(folderId);
  const docs = [];
  for (const f of children) {
    if (f.mimeType === FOLDER_MIME) {
      docs.push(...await listDocsInFolder(f.id, [...pathSegments, f.name], visited));
    } else {
      docs.push({ ...f, pathSegments });
    }
  }
  return docs;
}

/** Fetch a Google Doc's structured content (Docs API JSON). */
function getDoc(documentId) {
  return apiGet(`https://docs.googleapis.com/v1/documents/${documentId}`);
}

/** Download a binary file (e.g. a .docx stored in Drive) to a local path. */
async function downloadFile(fileId, destPath) {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive download failed ${res.status}: ${await res.text()}`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
}

/** Escape a value for use inside a Drive `q` query string literal. */
function escapeQ(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** First non-trashed file (any type) with an exact name in a folder, or null. */
async function findFileInFolderByName(parentId, name) {
  const files = await listFiles(
    `name = '${escapeQ(name)}' and '${parentId}' in parents and trashed = false`
  );
  return files[0] || null;
}

/** Find a child subfolder by name, creating it if absent. Returns its id. */
async function findOrCreateFolder(parentId, name) {
  const existing = await listFiles(
    `mimeType = '${FOLDER_MIME}' and name = '${escapeQ(name)}' and '${parentId}' in parents and trashed = false`
  );
  if (existing[0]) return existing[0].id;

  const token = await getAccessToken();
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive folder create failed ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  return data.id;
}

/** Resolve/create a chain of subfolders under parentId; returns the deepest id. */
async function ensureFolderPath(parentId, segments) {
  let id = parentId;
  for (const seg of segments) {
    const name = String(seg).trim();
    if (name) id = await findOrCreateFolder(id, name);
  }
  return id;
}

/**
 * Create or update a file in a folder via a multipart upload.
 *   content              Buffer with the file bytes
 *   opts.existingFileId  PATCH this file in place instead of creating a new one
 *   opts.convertToMime   target Drive mime (e.g. Google Doc) — Drive converts the
 *                        uploaded media on import
 * Returns { id, name, webViewLink }.
 */
async function uploadFile(parentId, content, name, mimeType, opts = {}) {
  const token    = await getAccessToken();
  const boundary = 'magentiqa-' + Math.random().toString(36).slice(2);
  const metadata = opts.existingFileId
    ? { name, ...(opts.convertToMime ? { mimeType: opts.convertToMime } : {}) }
    : { name, mimeType: opts.convertToMime || mimeType, parents: [parentId] };

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    content,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const base = 'https://www.googleapis.com/upload/drive/v3/files';
  const url = (opts.existingFileId ? `${base}/${opts.existingFileId}` : base) +
    '?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true';

  const res = await fetch(url, {
    method: opts.existingFileId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive upload failed ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  return data;
}

/** Upload a local PDF into a Drive folder. Returns { id, name, webViewLink }. */
async function uploadPdf(folderId, filePath, name) {
  return uploadFile(folderId, fs.readFileSync(filePath), name, 'application/pdf');
}

/** Move a Drive file/folder to the trash (recoverable). */
async function trashFile(fileId) {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    }
  );
  if (!res.ok) throw new Error(`Drive trash failed ${res.status}: ${await res.text()}`);
  return true;
}

module.exports = {
  isConfigured, isConnected, disconnect,
  getAuthUrl, exchangeCode,
  loadStore, saveStore,
  extractFolderId, resolveFolderId, getFolderInfo,
  listSubfolders, listSharedFolders, listDocsInFolder, getDoc, downloadFile,
  uploadPdf, uploadFile, findFileInFolderByName, findOrCreateFolder, ensureFolderPath, trashFile,
  DOC_MIME, DOCX_MIME, XLSX_MIME, FOLDER_MIME,
};
