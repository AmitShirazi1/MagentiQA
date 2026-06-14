const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { createUser, loginUser, setUserPassword, requireAuth } = require('../lib/auth');
const { audit } = require('../lib/audit');
const db = require('../lib/db');

// Look up a still-valid invite by token (unused + not expired). Returns null otherwise.
function findValidInvite(token) {
  if (!token) return null;
  const invite = db.invites.findOne({ token });
  if (!invite || invite.usedAt) return null;
  if (invite.expiresAt && invite.expiresAt < new Date().toISOString()) return null;
  return invite;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await loginUser(username, password, req);
    req.session.userId = user.id;
    res.json({ ok: true, user });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// GET /api/auth/invite/:token — public: validate an invite link before sign-up.
router.get('/invite/:token', (req, res) => {
  const invite = findValidInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: 'This invitation is invalid or has expired' });
  res.json({ name: invite.name, username: invite.username, role: invite.role });
});

// POST /api/auth/invite/:token/accept — invitee sets a password; account is created.
router.post('/invite/:token/accept', async (req, res) => {
  try {
    const invite = findValidInvite(req.params.token);
    if (!invite) return res.status(404).json({ error: 'This invitation is invalid or has expired' });

    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await createUser({
      name: invite.name, username: invite.username, password, role: invite.role,
    });
    db.invites.update(invite.id, { usedAt: new Date().toISOString(), usedBy: user.id });
    audit(user.id, 'CREATE', 'users', user.id, null,
      { username: user.username, role: user.role, via: 'invite' }, req);

    req.session.userId = user.id;
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// POST /api/auth/password — self-service password change (authenticated).
router.post('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const user = db.users.findById(req.user.id);
    const valid = await bcrypt.compare(currentPassword || '', user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

    await setUserPassword(user.id, newPassword);
    audit(user.id, 'UPDATE', 'users', user.id, null, { event: 'password-change' }, req);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  const user = db.users.findById(req.session.userId);
  if (!user || user.active === false) return res.json({ user: null });
  const { passwordHash, ...safe } = user;
  res.json({ user: safe });
});

module.exports = router;
