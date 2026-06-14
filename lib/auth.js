/**
 * lib/auth.js — Session-based authentication
 * Users live in the SQLite `users` collection with bcrypt-hashed passwords.
 * Accounts are created by an admin (via invite); there is no self-registration.
 * Deactivated accounts (active === false) can neither log in nor use a session.
 */

const bcrypt = require('bcryptjs');
const db = require('./db');
const { audit } = require('./audit');

const ROLES = ['ADMIN', 'APPROVER', 'QA_ENGINEER'];

async function createUser({ name, username, password, role = 'QA_ENGINEER' }) {
  const existing = db.users.findOne({ username });
  if (existing) throw new Error('User already exists');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = db.users.create({ name, username, passwordHash, role, active: true });
  return sanitizeUser(user);
}

async function loginUser(username, password, req) {
  const user = db.users.findOne({ username });
  if (!user) throw new Error('Invalid credentials');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error('Invalid credentials');
  if (user.active === false) throw new Error('Account is deactivated');

  return sanitizeUser(user);
}

// Set (or reset) a user's password. Returns the sanitized user.
async function setUserPassword(id, password) {
  const passwordHash = await bcrypt.hash(password, 10);
  const updated = db.users.update(id, { passwordHash });
  return updated ? sanitizeUser(updated) : null;
}

// Self-healing migration: rewrite any user whose role is no longer valid
// (legacy REVIEWER / DEVELOPER, or imported data) to QA_ENGINEER. Idempotent.
function migrateRoles() {
  let migrated = 0;
  for (const user of db.users.findAll()) {
    if (!ROLES.includes(user.role)) {
      db.users.update(user.id, { role: 'QA_ENGINEER' });
      migrated++;
    }
  }
  return migrated;
}

function sanitizeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    // req.path is relative to the router mount point — use originalUrl
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login');
  }
  // Attach user to request
  const user = db.users.findById(req.session.userId);
  if (!user || user.active === false) {
    req.session.destroy(() => {});
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login');
  }
  req.user = sanitizeUser(user);
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = {
  createUser, loginUser, setUserPassword, migrateRoles,
  sanitizeUser, requireAuth, requireRole, ROLES,
};
