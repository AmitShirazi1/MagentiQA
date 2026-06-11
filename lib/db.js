/**
 * lib/db.js — SQLite database (better-sqlite3)
 *
 * Each "collection" is a SQLite table: (id TEXT PRIMARY KEY, data TEXT json).
 * Filtering/sorting/pagination run inside SQLite via json_extract(), with
 * expression indexes on the hot keys, so executions / audit logs can grow
 * into the millions of rows without slowing down or bloating memory.
 *
 * The public API is identical to the old flat-file JSON layer
 * (findAll / findOne / findById / create / update / delete / count / query),
 * so routes did not have to change.
 *
 * On first start, any legacy data/<collection>.json files are imported
 * automatically and then moved to data/legacy-json/ as a backup.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE  = path.join(DATA_DIR, 'magentiqa.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');   // safe concurrent reads, fast writes
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('foreign_keys = ON');

// ── Collection ────────────────────────────────────────────────────────────────

// Hot filter/sort keys per collection → expression indexes
const INDEXED_KEYS = {
  users:        ['username'],
  projects:     ['name'],
  versions:     ['projectId', 'name'],
  tests:        ['testId', 'title', 'path', 'type'],
  steps:        ['testId'],
  setups:       ['testId', 'status'],
  versionTests: ['versionId', 'testDefId', 'status'],
  executions:   ['versionTestId', 'executedAt', 'setupId'],
  executionDrafts: ['versionTestId', 'setupId', 'userId'],
  stepResults:  ['executionId'],
  signatures:   ['executionId', 'versionId'],
  approvals:    ['versionTestId', 'status', 'versionId', 'scope'],
  evidence:     ['executionId'],
  auditLogs:    ['entity', 'entityId', 'userId'],
  templates:    [],
};

class Collection {
  constructor(name) {
    this.name = name;
    sqlite.exec(`CREATE TABLE IF NOT EXISTS "${name}" (
      id   TEXT PRIMARY KEY,
      data TEXT NOT NULL
    )`);
    // createdAt index (default sort key) + per-collection hot keys
    for (const key of ['createdAt', ...(INDEXED_KEYS[name] || [])]) {
      sqlite.exec(`CREATE INDEX IF NOT EXISTS "idx_${name}_${key}"
                   ON "${name}" (json_extract(data, '$.${key}'))`);
    }
    this._insert = sqlite.prepare(`INSERT INTO "${name}" (id, data) VALUES (?, ?)`);
    this._update = sqlite.prepare(`UPDATE "${name}" SET data = ? WHERE id = ?`);
    this._delete = sqlite.prepare(`DELETE FROM "${name}" WHERE id = ?`);
    this._byId   = sqlite.prepare(`SELECT data FROM "${name}" WHERE id = ?`);
  }

  // Build "WHERE ..." clause + bound params from a filter object
  _where(filter = {}) {
    const clauses = [];
    const params = [];
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined) continue;
      if (!/^[\w]+$/.test(key)) throw new Error(`Invalid filter key: ${key}`);
      const expr = `json_extract(data, '$.${key}')`;
      if (value === null) {
        clauses.push(`${expr} IS NULL`);
      } else if (Array.isArray(value)) {
        if (value.length === 0) { clauses.push('0'); continue; }
        clauses.push(`${expr} IN (${value.map(() => '?').join(',')})`);
        params.push(...value.map(toSql));
      } else {
        clauses.push(`${expr} = ?`);
        params.push(toSql(value));
      }
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  findAll(filter = {}) {
    const { sql, params } = this._where(filter);
    return sqlite.prepare(`SELECT data FROM "${this.name}" ${sql}`)
      .all(...params).map(r => JSON.parse(r.data));
  }

  findOne(filter = {}) {
    const { sql, params } = this._where(filter);
    const row = sqlite.prepare(`SELECT data FROM "${this.name}" ${sql} LIMIT 1`).get(...params);
    return row ? JSON.parse(row.data) : null;
  }

  findById(id) {
    const row = this._byId.get(id);
    return row ? JSON.parse(row.data) : null;
  }

  create(data) {
    const record = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...data,
    };
    this._insert.run(record.id, JSON.stringify(record));
    return record;
  }

  update(id, data) {
    const existing = this.findById(id);
    if (!existing) return null;
    const record = {
      ...existing,
      ...data,
      id,
      updatedAt: new Date().toISOString(),
    };
    this._update.run(JSON.stringify(record), id);
    return record;
  }

  delete(id) {
    return this._delete.run(id).changes > 0;
  }

  count(filter = {}) {
    const { sql, params } = this._where(filter);
    return sqlite.prepare(`SELECT COUNT(*) AS n FROM "${this.name}" ${sql}`).get(...params).n;
  }

  // Ordered query helper — same semantics as before (nulls sort last)
  query({ filter = {}, sortBy = 'createdAt', sortDir = 'desc', limit, offset = 0 } = {}) {
    if (!/^[\w]+$/.test(sortBy)) throw new Error(`Invalid sortBy: ${sortBy}`);
    const { sql, params } = this._where(filter);
    const sortExpr = `json_extract(data, '$.${sortBy}')`;
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
    let q = `SELECT data FROM "${this.name}" ${sql}
             ORDER BY (${sortExpr} IS NULL), ${sortExpr} ${dir}`;
    if (limit)  { q += ' LIMIT ?';  params.push(parseInt(limit, 10)); }
    else if (offset) { q += ' LIMIT -1'; }
    if (offset) { q += ' OFFSET ?'; params.push(parseInt(offset, 10)); }
    return sqlite.prepare(q).all(...params).map(r => JSON.parse(r.data));
  }
}

// SQLite can't bind booleans — store/compare them as json does (0/1)
function toSql(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  return v;
}

// ── Collections ───────────────────────────────────────────────────────────────

const db = {
  users:        new Collection('users'),
  projects:     new Collection('projects'),
  versions:     new Collection('versions'),
  tests:        new Collection('tests'),        // TestDefinition
  steps:        new Collection('steps'),        // TestStep
  setups:       new Collection('setups'),       // Setup row of a setup-tracked test
  versionTests: new Collection('versionTests'), // VersionTest (join)
  executions:   new Collection('executions'),
  executionDrafts: new Collection('executionDrafts'), // in-progress (unsigned) step results
  stepResults:  new Collection('stepResults'),
  signatures:   new Collection('signatures'),
  approvals:    new Collection('approvals'),
  evidence:     new Collection('evidence'),
  auditLogs:    new Collection('auditLogs'),
  templates:    new Collection('templates'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Next sequential test ID (VT-0001, VT-0002…).
 * Uses MAX of existing numeric suffixes — unlike the old `count + 1`,
 * this never produces duplicates after a test is deleted.
 */
db.nextTestId = () => {
  const row = sqlite.prepare(`
    SELECT MAX(CAST(SUBSTR(json_extract(data, '$.testId'), 4) AS INTEGER)) AS maxNum
    FROM "tests" WHERE json_extract(data, '$.testId') LIKE 'VT-%'
  `).get();
  const next = (row.maxNum || 0) + 1;
  return `VT-${String(next).padStart(4, '0')}`;
};

// Run a function inside a single transaction (used for cascading deletes etc.)
db.transaction = (fn) => sqlite.transaction(fn)();

// Raw handle — used by the backup script (sqlite.backup) and session store
db.sqlite = sqlite;

// ── One-time migration from legacy data/<collection>.json files ──────────────

(function migrateLegacyJson() {
  const legacyDir = path.join(DATA_DIR, 'legacy-json');
  let migrated = 0;

  for (const name of Object.keys(INDEXED_KEYS)) {
    const file = path.join(DATA_DIR, `${name}.json`);
    if (!fs.existsSync(file)) continue;

    let records;
    try { records = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { continue; }
    if (!Array.isArray(records)) continue;

    const col = db[name];
    const importAll = sqlite.transaction(() => {
      for (const r of records) {
        if (!r || !r.id || col.findById(r.id)) continue;
        // Data fix: old seed wrote project `code` instead of `type`
        if (name === 'projects' && !r.type && r.code) r.type = r.code;
        col._insert.run(r.id, JSON.stringify(r));
        migrated++;
      }
    });
    importAll();

    if (!fs.existsSync(legacyDir)) fs.mkdirSync(legacyDir, { recursive: true });
    fs.renameSync(file, path.join(legacyDir, `${name}.json`));
  }

  if (migrated > 0) {
    console.log(`📦  Migrated ${migrated} records from data/*.json into data/magentiqa.db`);
    console.log('    (original JSON files kept in data/legacy-json/ as backup)');
  }
})();

module.exports = db;
