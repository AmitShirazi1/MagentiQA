/**
 * lib/session-store.js — SQLite-backed express-session store
 *
 * Sessions live in the same magentiqa.db file, so logins survive server
 * restarts (the default MemoryStore loses everything and leaks memory).
 */

const session = require('express-session');
const db = require('./db');

const sqlite = db.sqlite;

sqlite.exec(`CREATE TABLE IF NOT EXISTS http_sessions (
  sid     TEXT PRIMARY KEY,
  expires INTEGER NOT NULL,
  data    TEXT NOT NULL
)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_http_sessions_expires ON http_sessions (expires)`);

class SQLiteSessionStore extends session.Store {
  constructor({ cleanupIntervalMs = 15 * 60 * 1000 } = {}) {
    super();
    this._get     = sqlite.prepare('SELECT data, expires FROM http_sessions WHERE sid = ?');
    this._set     = sqlite.prepare(`INSERT INTO http_sessions (sid, expires, data) VALUES (?, ?, ?)
                                    ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, data = excluded.data`);
    this._touch   = sqlite.prepare('UPDATE http_sessions SET expires = ? WHERE sid = ?');
    this._destroy = sqlite.prepare('DELETE FROM http_sessions WHERE sid = ?');
    this._cleanup = sqlite.prepare('DELETE FROM http_sessions WHERE expires < ?');
    // Periodically purge expired sessions
    const timer = setInterval(() => this._cleanup.run(Date.now()), cleanupIntervalMs);
    timer.unref();
  }

  _expiresOf(sess) {
    const maxAge = sess?.cookie?.maxAge;
    return Date.now() + (typeof maxAge === 'number' ? maxAge : 7 * 24 * 60 * 60 * 1000);
  }

  get(sid, cb) {
    try {
      const row = this._get.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb = () => {}) {
    try {
      this._set.run(sid, this._expiresOf(sess), JSON.stringify(sess));
      cb(null);
    } catch (err) { cb(err); }
  }

  touch(sid, sess, cb = () => {}) {
    try {
      this._touch.run(this._expiresOf(sess), sid);
      cb(null);
    } catch (err) { cb(err); }
  }

  destroy(sid, cb = () => {}) {
    try {
      this._destroy.run(sid);
      cb(null);
    } catch (err) { cb(err); }
  }
}

module.exports = { SQLiteSessionStore };
