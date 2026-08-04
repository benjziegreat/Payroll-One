const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const { pool } = require('../db');
const { requireUser } = require('../auth');
const { checkGeofence } = require('../attendance-helpers');
const { uploadSelfie } = require('../selfie-upload');

const router = express.Router();

router.use(requireUser);

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_OCCURRED_AT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

router.post('/', async (req, res) => {
  const { action, method, latitude, longitude, occurredAt, clientEventId, offlineSync, officeLocationId } =
    req.body || {};
  if (!['login', 'logout'].includes(action) || !['face', 'fingerprint'].includes(method)) {
    res.status(400).json({ error: 'Invalid action or method' });
    return;
  }

  if (officeLocationId !== undefined && typeof officeLocationId !== 'number') {
    res.status(400).json({ error: 'officeLocationId must be a number' });
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

  // A deferred retry of an already-queued offline entry — the geofence
  // check already ran (or couldn't) at the moment it was captured; re-
  // running it now against those same stored coordinates only adds a way
  // for ordinary GPS drift to permanently strand an entry that can never be
  // retried into passing. The live, first-attempt path below still enforces
  // it normally.
  if (!offlineSync) {
    const geofence = await checkGeofence(pool, req.userId, latitude, longitude, officeLocationId);
    if (!geofence.ok) {
      res.status(geofence.status).json({ error: geofence.error, distance: geofence.distance });
      return;
    }
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

// Attaches a video selfie to an already-created attendance log, looked up by
// the same clientEventId the log itself was created with. Separate from the
// POST above because the video may finish uploading later (or fail and
// retry independently) — especially when captured offline. Idempotent: if
// this log already has a selfie attached, further calls are a no-op rather
// than overwriting it.
router.patch('/:clientEventId/selfie', (req, res) => {
  uploadSelfie.single('selfie')(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No selfie video uploaded' });
      return;
    }

    const [rows] = await pool.query(
      'SELECT selfie_url FROM attendance_logs WHERE client_event_id = ? AND user_id = ?',
      [req.params.clientEventId, req.userId],
    );
    if (rows.length === 0) {
      fs.unlink(req.file.path, () => {});
      res.status(404).json({ error: 'Attendance log not found for this event yet' });
      return;
    }
    if (rows[0].selfie_url) {
      // Already attached from a previous attempt — discard this duplicate.
      fs.unlink(req.file.path, () => {});
      res.status(200).json({ selfieUrl: rows[0].selfie_url });
      return;
    }

    const selfieUrl = `/uploads/selfies/${req.file.filename}`;
    await pool.query('UPDATE attendance_logs SET selfie_url = ? WHERE client_event_id = ? AND user_id = ?', [
      selfieUrl,
      req.params.clientEventId,
      req.userId,
    ]);
    res.status(200).json({ selfieUrl });
  });
});

router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const [rows] = await pool.query(
    'SELECT id, user_id, action, method, selfie_url, occurred_at, created_at FROM attendance_logs ' +
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
