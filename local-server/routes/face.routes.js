const express = require('express');
const { pool } = require('../db');
const { requireUser } = require('../auth');

const MATCH_THRESHOLD = 0.55;
const router = express.Router();

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

router.use(requireUser);

router.post('/enroll', async (req, res) => {
  const { descriptor } = req.body || {};
  if (!Array.isArray(descriptor) || descriptor.length === 0) {
    res.status(400).json({ error: 'descriptor array is required' });
    return;
  }

  await pool.query(
    'INSERT INTO face_enrollments (user_id, descriptor) VALUES (?, ?) ' +
      'ON DUPLICATE KEY UPDATE descriptor = VALUES(descriptor)',
    [req.userId, JSON.stringify(descriptor)],
  );
  res.status(200).json({ ok: true });
});

router.get('/status', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT user_id FROM face_enrollments WHERE user_id = ?',
    [req.userId],
  );
  res.status(200).json({ enrolled: rows.length > 0 });
});

router.post('/verify', async (req, res) => {
  const { descriptor } = req.body || {};
  if (!Array.isArray(descriptor)) {
    res.status(400).json({ error: 'descriptor array is required' });
    return;
  }

  const [rows] = await pool.query(
    'SELECT descriptor FROM face_enrollments WHERE user_id = ?',
    [req.userId],
  );
  if (rows.length === 0) {
    res.status(200).json({ matched: false });
    return;
  }

  const stored = rows[0].descriptor;
  const distance = euclideanDistance(stored, descriptor);
  res.status(200).json({ matched: distance <= MATCH_THRESHOLD });
});

module.exports = router;
