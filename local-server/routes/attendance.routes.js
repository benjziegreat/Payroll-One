const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireUser } = require('../auth');

const router = express.Router();

router.use(requireUser);

router.post('/', async (req, res) => {
  const { action, method } = req.body || {};
  if (!['login', 'logout'].includes(action) || !['face', 'fingerprint'].includes(method)) {
    res.status(400).json({ error: 'Invalid action or method' });
    return;
  }

  await pool.query(
    'INSERT INTO attendance_logs (id, user_id, action, method) VALUES (?, ?, ?, ?)',
    [crypto.randomUUID(), req.userId, action, method],
  );
  res.status(200).json({ ok: true });
});

router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const [rows] = await pool.query(
    'SELECT id, user_id, action, method, created_at FROM attendance_logs ' +
      'WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [req.userId, limit],
  );
  res.status(200).json({ logs: rows });
});

router.get('/last', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT action FROM attendance_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [req.userId],
  );
  res.status(200).json({ action: rows[0]?.action ?? null });
});

module.exports = router;
