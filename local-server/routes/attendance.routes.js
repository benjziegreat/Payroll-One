const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireUser } = require('../auth');
const { checkGeofence } = require('../attendance-helpers');

const router = express.Router();

router.use(requireUser);

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_OCCURRED_AT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

router.post('/', async (req, res) => {
  const { action, method, latitude, longitude, occurredAt, clientEventId } = req.body || {};
  if (!['login', 'logout'].includes(action) || !['face', 'fingerprint'].includes(method)) {
    res.status(400).json({ error: 'Invalid action or method' });
    return;
  }

  if (clientEventId !== undefined && typeof clientEventId !== 'string') {
    res.status(400).json({ error: 'clientEventId must be a string' });
    return;
  }

  let occurredAtDate = null;
  if (occurredAt !== undefined) {
    occurredAtDate = new Date(occurredAt);
    const ageMs = Date.now() - occurredAtDate.getTime();
    if (
      Number.isNaN(occurredAtDate.getTime()) ||
      ageMs < -MAX_CLOCK_SKEW_MS ||
      ageMs > MAX_OCCURRED_AT_AGE_MS
    ) {
      res.status(400).json({ error: 'Invalid occurredAt' });
      return;
    }
  }

  if (clientEventId) {
    const [existing] = await pool.query(
      'SELECT id FROM attendance_logs WHERE client_event_id = ?',
      [clientEventId],
    );
    if (existing.length > 0) {
      // Already synced from a previous attempt — idempotent no-op.
      res.status(200).json({ ok: true });
      return;
    }
  }

  const geofence = await checkGeofence(pool, req.userId, latitude, longitude);
  if (!geofence.ok) {
    res.status(geofence.status).json({ error: geofence.error, distance: geofence.distance });
    return;
  }

  await pool.query(
    'INSERT INTO attendance_logs (id, user_id, action, method, latitude, longitude, occurred_at, client_event_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      crypto.randomUUID(),
      req.userId,
      action,
      method,
      latitude ?? null,
      longitude ?? null,
      occurredAtDate,
      clientEventId ?? null,
    ],
  );
  res.status(200).json({ ok: true });
});

router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const [rows] = await pool.query(
    'SELECT id, user_id, action, method, occurred_at, created_at FROM attendance_logs ' +
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
