const express = require('express');
const { pool } = require('../db');
const { requireUser } = require('../auth');

const router = express.Router();

router.use(requireUser);

router.get('/office-location', async (req, res) => {
  const [rows] = await pool.query('SELECT latitude, longitude FROM office_location WHERE id = 1');
  res.status(200).json({ location: rows[0] ?? null });
});

router.post('/office-location', async (req, res) => {
  const { latitude, longitude } = req.body || {};
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    res.status(400).json({ error: 'Invalid latitude or longitude' });
    return;
  }

  await pool.query(
    'INSERT INTO office_location (id, latitude, longitude) VALUES (1, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE latitude = ?, longitude = ?',
    [latitude, longitude, latitude, longitude],
  );
  res.status(200).json({ ok: true });
});

module.exports = router;
