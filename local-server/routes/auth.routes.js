const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { signToken, requireUser } = require('../auth');

const FACE_MATCH_THRESHOLD = 0.55;

const router = express.Router();

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    user_metadata: {
      full_name: row.full_name,
      role: row.role ?? 'employee',
      photo_url: row.photo_url ?? null,
      require_selfie_verification: !!row.require_selfie_verification,
      bypass_geofence: !!row.bypass_geofence,
    },
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

router.post('/face-signin', async (req, res) => {
  const { descriptor } = req.body || {};
  if (!Array.isArray(descriptor) || descriptor.length === 0) {
    res.status(400).json({ error: 'descriptor array is required' });
    return;
  }

  const [rows] = await pool.query('SELECT user_id, descriptor FROM face_enrollments');

  let bestUserId = null;
  let bestDistance = Infinity;
  for (const row of rows) {
    const distance = euclideanDistance(row.descriptor, descriptor);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestUserId = row.user_id;
    }
  }

  if (!bestUserId || bestDistance > FACE_MATCH_THRESHOLD) {
    res.status(401).json({ error: 'Face not recognized.' });
    return;
  }

  const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [bestUserId]);
  const user = userRows[0];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
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
