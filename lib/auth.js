/**
 * lib/auth.js — Session-based authentication
 * Users are stored in data/users.json with bcrypt-hashed passwords.
 * Google OAuth is optional — for simplicity the default is username+password.
 * Every new user gets ADMIN role.
 */

const bcrypt = require('bcryptjs');
const db = require('./db');
const { audit } = require('./audit');

const ROLES = ['ADMIN', 'QA_ENGINEER', 'REVIEWER', 'APPROVER', 'DEVELOPER'];

async function createUser({ name, username, password, role = 'ADMIN' }) {
  const existing = db.users.findOne({ username });
  if (existing) throw new Error('User already exists');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = db.users.create({ name, username, passwordHash, role });
  audit('system', 'CREATE', 'users', user.id, null, { id: user.id, username, role });
  return sanitizeUser(user);
}

async function loginUser(username, password, req) {
  const user = db.users.findOne({ username });
  if (!user) throw new Error('Invalid credentials');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error('Invalid credentials');

  audit(user.id, 'LOGIN', 'users', user.id, null, { username }, req);
  return sanitizeUser(user);
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
  if (!user) {
    req.session.destroy();
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

module.exports = { createUser, loginUser, sanitizeUser, requireAuth, requireRole, ROLES };
