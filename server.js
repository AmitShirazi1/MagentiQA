'use strict';

require('./lib/env'); // load .env before anything reads process.env

const express = require('express');
const session  = require('express-session');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

// ── Ensure storage dirs exist ──────────────────────────────────────────────
const dirs = [
  'data',
  'storage/evidence',
  'storage/pdfs',
  'storage/imports',
];
for (const d of dirs) {
  fs.mkdirSync(path.join(__dirname, d), { recursive: true });
}

const { SQLiteSessionStore } = require('./lib/session-store');
const { scheduleSweeps } = require('./lib/cleanup');
const { migrateRoles } = require('./lib/auth');

// One-time, idempotent: rewrite any retired/legacy role (e.g. REVIEWER, DEVELOPER)
// to QA_ENGINEER so stored data always matches the current ROLES set.
const migratedRoles = migrateRoles();
if (migratedRoles) console.log(`[migrate] reassigned ${migratedRoles} user(s) to QA_ENGINEER`);

// ── App ───────────────────────────────────────────────────────────────────
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Session ───────────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(session({
  secret: SESSION_SECRET,
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,          // set true if behind HTTPS
    maxAge: 7 * 24 * 60 * 60 * 1000,  // 1 week
  },
}));

// ── Static files ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ────────────────────────────────────────────────────────────
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/projects',    require('./routes/projects'));
app.use('/api/tests',       require('./routes/tests'));
app.use('/api/executions',  require('./routes/executions'));
app.use('/api/google',      require('./routes/google'));
app.use('/api',             require('./routes/misc'));

// ── SPA fallback — serve index.html for any non-API route ─────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[error]', err.message || err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Housekeeping ──────────────────────────────────────────────────────────
scheduleSweeps(); // remove orphaned evidence files + dangling version-test links (startup + daily)

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅  MagentiQA running → http://localhost:${PORT}`);
  console.log(`   Default login : sysadmin / admin123`);
  console.log(`   Data stored in: ${path.join(__dirname, 'data', 'magentiqa.db')}\n`);
});
