const express = require('express');
const { pool } = require('../db');
const { requireUser, requireAdmin } = require('../auth');
const { distanceMeters } = require('../geo');

const router = express.Router();

router.use(requireUser);

router.get('/users', requireAdmin, async (_req, res) => {
  const [officeRows] = await pool.query(
    'SELECT latitude, longitude FROM office_location WHERE id = 1',
  );
  const office = officeRows[0] ?? null;

  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.role, u.bypass_geofence, u.photo_url,
            l.latitude, l.longitude, l.action AS last_action, l.created_at AS last_seen_at
     FROM users u
     LEFT JOIN attendance_logs l ON l.id = (
       SELECT id FROM attendance_logs WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
     )
     ORDER BY u.full_name`,
  );

  const users = rows.map((row) => {
    const hasLocation = row.latitude !== null && row.longitude !== null;
    const distance =
      office && hasLocation
        ? Math.round(distanceMeters(office.latitude, office.longitude, row.latitude, row.longitude))
        : null;
    return {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      bypassGeofence: !!row.bypass_geofence,
      photoUrl: row.photo_url,
      lastAction: row.last_action,
      lastSeenAt: row.last_seen_at,
      distanceMeters: distance,
    };
  });

  res.status(200).json({ users });
});

router.patch('/users/:id/bypass-geofence', requireAdmin, async (req, res) => {
  const { bypassGeofence } = req.body || {};
  if (typeof bypassGeofence !== 'boolean') {
    res.status(400).json({ error: 'bypassGeofence must be a boolean' });
    return;
  }

  await pool.query('UPDATE users SET bypass_geofence = ? WHERE id = ?', [
    bypassGeofence ? 1 : 0,
    req.params.id,
  ]);
  res.status(200).json({ ok: true });
});

router.get('/attendance-logs', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const [roleRows] = await pool.query('SELECT role FROM users WHERE id = ?', [req.userId]);
  const isAdmin = roleRows[0]?.role === 'admin';

  const [rows] = await pool.query(
    `SELECT u.id AS user_id, u.full_name, u.photo_url, a.action, a.method, a.occurred_at, a.created_at
     FROM attendance_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ${isAdmin ? '' : 'WHERE a.user_id = ?'}
     ORDER BY a.created_at DESC
     LIMIT ?`,
    isAdmin ? [limit] : [req.userId, limit],
  );
  res.status(200).json({ logs: rows });
});

module.exports = router;
