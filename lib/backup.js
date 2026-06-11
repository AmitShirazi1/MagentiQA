'use strict';
/**
 * lib/backup.js — Full application snapshot ("image") into a single zip.
 *
 * A backup is a timestamped zip in backups/ that contains, ready to restore:
 *   - data/magentiqa.db   — a CONSISTENT snapshot taken via SQLite's online
 *                           backup API (safe even while the server is running;
 *                           folds in any pending WAL so no -wal/-shm needed)
 *   - storage/            — evidence files, generated PDFs, imported sources
 *   - all application code — lib/ routes/ public/ scripts/ server.js, etc.
 *   - .env, configs, docs, legacy-json — anything else useful for a restore
 *   - BACKUP-MANIFEST.json — what's inside + row counts for a sanity check
 *
 * To restore: unzip into a folder, `npm install`, `npm start`.
 *
 * This is the single source of truth for the "Backup" button (routes/misc.js)
 * and the `npm run backup` CLI (scripts/backup.js).
 */

const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const JSZip = require('jszip');
const db    = require('./db');

const ROOT       = path.join(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'backups');

// Top-level entries never worth backing up:
//   node_modules — huge & reproducible via `npm install`
//   backups      — don't nest backups inside backups
//   .git         — version control history, not app state
const EXCLUDE_TOP = new Set(['node_modules', 'backups', '.git']);

// The live DB files are replaced by a consistent snapshot (see below), and the
// LibreOffice lock file is transient noise.
const SKIP_REL = new Set([
  'data/magentiqa.db',
  'data/magentiqa.db-wal',
  'data/magentiqa.db-shm',
  '.~lock.README.md#',
]);

// Recursively collect { abs, rel } for every regular file under `absDir`,
// honouring the exclusion rules. Never throws — unreadable dirs are skipped.
function collectFiles(absDir, rel = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out; // unreadable / missing dir — skip rather than fail the backup
  }
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (rel === '' && EXCLUDE_TOP.has(entry.name)) continue;
    if (SKIP_REL.has(relPath)) continue;
    if (entry.isSymbolicLink()) continue; // don't follow symlinks
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(abs, relPath));
    } else if (entry.isFile()) {
      out.push({ abs, rel: relPath });
    }
  }
  return out;
}

function safeCount(name) {
  try { return db[name].count(); } catch { return null; }
}

const FILE_PREFIX = 'magentiqa-backup';

// Local-time stamp in the required YYYY-MM-dd_HH-mm format (minute precision).
function timestamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

/**
 * Validate an optional, user-supplied filename label.
 * Allowed: lowercase letters, digits, "-" and "_" only — no spaces, no
 * capitals, no other special characters. Returns the cleaned label ('' if none).
 * Throws on anything that doesn't fit, so the caller can surface a clear error.
 */
function sanitizeLabel(label) {
  if (label === undefined || label === null) return '';
  if (typeof label !== 'string') throw new Error('Invalid backup label');
  const trimmed = label.trim();
  if (trimmed === '') return '';
  if (!/^[a-z0-9_-]+$/.test(trimmed)) {
    throw new Error('Backup label may only contain lowercase letters, numbers, "-" and "_" (no spaces, capitals or other characters)');
  }
  if (trimmed.length > 60) throw new Error('Backup label is too long (max 60 characters)');
  return trimmed;
}

/**
 * Create one backup zip in backups/. Returns metadata about the new archive.
 * Filename: magentiqa-backup_<YYYY-MM-dd_HH-mm>.zip, or, with a label,
 * magentiqa-backup-<label>_<YYYY-MM-dd_HH-mm>.zip.
 *
 * @param {string} [actor] — username/id recorded in the manifest (optional)
 * @param {string} [label] — optional filename label (see sanitizeLabel)
 */
async function createBackup(actor, label) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const clean    = sanitizeLabel(label);
  // magentiqa-backup[-<label>]_<timestamp>
  let baseName   = `${FILE_PREFIX}${clean ? `-${clean}` : ''}_${timestamp()}`;
  // Minute-precision stamps can repeat — keep each archive unique.
  let outFile    = path.join(BACKUP_DIR, `${baseName}.zip`);
  for (let i = 2; fs.existsSync(outFile); i++) {
    outFile = path.join(BACKUP_DIR, `${baseName}-${i}.zip`);
  }
  const finalBase = path.basename(outFile, '.zip');
  const zip       = new JSZip();

  // ── 1. Consistent DB snapshot ──────────────────────────────────────────────
  // sqlite.backup() produces a single, fully-checkpointed db file even while
  // the server is mid-write. Snapshot to a temp file, fold into the zip, delete.
  const tmpDb = path.join(os.tmpdir(), `${finalBase}.db`);
  await db.sqlite.backup(tmpDb);
  try {
    zip.file('data/magentiqa.db', fs.readFileSync(tmpDb));
  } finally {
    fs.rmSync(tmpDb, { force: true });
  }

  // ── 2. Code + storage + configs ────────────────────────────────────────────
  const files = collectFiles(ROOT);
  for (const f of files) {
    zip.file(f.rel, fs.readFileSync(f.abs));
  }

  // ── 3. Manifest ─────────────────────────────────────────────────────────────
  const manifest = {
    application: 'MagentiQA',
    createdAt:   new Date().toISOString(),
    createdBy:   actor || 'system',
    node:        process.version,
    platform:    `${os.platform()} ${os.release()}`,
    contents: {
      database: 'data/magentiqa.db (consistent SQLite snapshot)',
      storage:  'storage/ (evidence, pdfs, imports)',
      code:     'lib/, routes/, public/, scripts/, server.js, package.json, …',
    },
    fileCount: files.length + 1, // + the db snapshot
    rowCounts: {
      users:      safeCount('users'),
      projects:   safeCount('projects'),
      versions:   safeCount('versions'),
      tests:      safeCount('tests'),
      executions: safeCount('executions'),
      auditLogs:  safeCount('auditLogs'),
    },
    restore: 'Unzip into a folder, run `npm install`, then `npm start`.',
  };
  zip.file('BACKUP-MANIFEST.json', JSON.stringify(manifest, null, 2));

  // ── 4. Stream the zip to disk (low peak memory via streamFiles) ─────────────
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outFile);
    ws.on('error', reject);
    zip.generateNodeStream(
      { type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } },
    )
      .on('error', reject)
      .pipe(ws)
      .on('finish', resolve);
  });

  // If anything above threw, a partial/zero zip could linger — guard the result.
  let size = 0;
  try { size = fs.statSync(outFile).size; } catch {}
  if (!size) {
    fs.rmSync(outFile, { force: true });
    throw new Error('Backup archive was not written');
  }

  return {
    filename:  `${finalBase}.zip`,
    path:      outFile,
    sizeBytes: size,
    fileCount: manifest.fileCount + 1, // + manifest
    createdAt: manifest.createdAt,
  };
}

// Matches both forms — magentiqa-backup_<ts>.zip and
// magentiqa-backup-<label>_<ts>.zip — i.e. the prefix, then "-" or "_", then
// only safe filename characters. Used to list and to guard downloads.
const BACKUP_NAME_RE = /^magentiqa-backup[-_][\w.-]+\.zip$/;

/** List existing backup archives, newest first. Never throws. */
function listBackups() {
  let names;
  try { names = fs.readdirSync(BACKUP_DIR); } catch { return []; }
  return names
    .filter(n => BACKUP_NAME_RE.test(n))
    .map(n => {
      const st = fs.statSync(path.join(BACKUP_DIR, n));
      return { filename: n, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

module.exports = { createBackup, listBackups, sanitizeLabel, BACKUP_DIR, BACKUP_NAME_RE };
