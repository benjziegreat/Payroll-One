const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { signToken, requireUser } = require('../auth');

const router = express.Router();

function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    user_metadata: { full_name: row.full_name },
  };
}

router.post('/signup', async (req, res) => {
  const { email, password, fullName } = req.body || {};
  if (!email || !password || !fullName) {
    res.status(400).json({ error: 'email, password and fullName are required' });
    return;
  }

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length > 0) {
    res.status(409).json({ error: 'An account with that email already exists' });
    return;
  }

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)',
    [id, email, passwordHash, fullName],
  );

  const user = { id, email, full_name: fullName };
  res.status(200).json({ token: signToken(user), user: toPublicUser(user) });
});

router.post('/signin', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  res.status(200).json({ token: signToken(user), user: toPublicUser(user) });
});

router.get('/me', requireUser, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.userId]);
  const user = rows[0];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.status(200).json({ user: toPublicUser(user) });
});

router.post('/signout', requireUser, (_req, res) => {
  res.status(200).json({ ok: true });
});

module.exports = router;
