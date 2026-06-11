const express = require('express');
const router = express.Router();
const { createUser, loginUser, ROLES } = require('../lib/auth');
const db = require('../lib/db');

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

// POST /api/auth/register
// The very first account becomes ADMIN (bootstrap); everyone after that
// gets QA_ENGINEER and an admin must promote them via the Admin page.
router.post('/register', async (req, res) => {
  try {
    const { name, username, password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const isFirstUser = db.users.count() === 0;
    const user = await createUser({ name, username, password, role: isFirstUser ? 'ADMIN' : 'QA_ENGINEER' });
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

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  const user = db.users.findById(req.session.userId);
  if (!user) return res.json({ user: null });
  const { passwordHash, ...safe } = user;
  res.json({ user: safe });
});

module.exports = router;
