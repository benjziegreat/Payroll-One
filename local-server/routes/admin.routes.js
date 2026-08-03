const express = require('express');
const { pool } = require('../db');
const { requireUser, requireAdmin } = require('../auth');
const { distanceMeters } = require('../geo');

const router = express.Router();

router.use(requireUser);

router.get('/users', requireAdmin, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.role, u.bypass_geofence, u.photo_url,
            u.office_location_id, ol.name AS office_location_name,
            ol.latitude AS office_latitude, ol.longitude AS office_longitude,
            l.latitude, l.longitude, l.action AS last_action, l.created_at AS last_seen_at
     FROM users u
     LEFT JOIN office_locations ol ON ol.id = u.office_location_id
     LEFT JOIN attendance_logs l ON l.id = (
       SELECT id FROM attendance_logs WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
     )
     ORDER BY u.full_name`,
  );

  const users = rows.map((row) => {
    const hasLocation = row.latitude !== null && row.longitude !== null;
    const hasOffice = row.office_latitude !== null && row.office_longitude !== null;
    const distance =
      hasOffice && hasLocation
        ? Math.round(
            distanceMeters(row.office_latitude, row.office_longitude, row.latitude, row.longitude),
          )
        : null;
    return {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      bypassGeofence: !!row.bypass_geofence,
      photoUrl: row.photo_url,
      officeLocationId: row.office_location_id,
      officeLocationName: row.office_location_name,
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

router.patch('/users/:id/office-location', requireAdmin, async (req, res) => {
  const { officeLocationId } = req.body || {};
  if (officeLocationId !== null && typeof officeLocationId !== 'number') {
    res.status(400).json({ error: 'officeLocationId must be a number or null' });
    return;
  }

  if (officeLocationId !== null) {
    const [locationRows] = await pool.query('SELECT id FROM office_locations WHERE id = ?', [
      officeLocationId,
    ]);
    if (locationRows.length === 0) {
      res.status(404).json({ error: 'Office location not found' });
      return;
    }
  }

  await pool.query('UPDATE users SET office_location_id = ? WHERE id = ?', [
    officeLocationId,
    req.params.id,
  ]);
  res.status(200).json({ ok: true });
});

router.get('/office-locations', requireAdmin, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT ol.id, ol.name, ol.latitude, ol.longitude, COUNT(u.id) AS employee_count
     FROM office_locations ol
     LEFT JOIN users u ON u.office_location_id = ol.id
     GROUP BY ol.id, ol.name, ol.latitude, ol.longitude
     ORDER BY ol.id`,
  );
  res.status(200).json({
    locations: rows.map((row) => ({
      id: row.id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      employeeCount: row.employee_count,
    })),
  });
});

router.post('/office-locations', requireAdmin, async (req, res) => {
  const { name, latitude, longitude } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (
    (latitude !== undefined && latitude !== null && typeof latitude !== 'number') ||
    (longitude !== undefined && longitude !== null && typeof longitude !== 'number')
  ) {
    res.status(400).json({ error: 'latitude/longitude must be numbers' });
    return;
  }

  const [result] = await pool.query(
    'INSERT INTO office_locations (name, latitude, longitude) VALUES (?, ?, ?)',
    [name.trim(), latitude ?? null, longitude ?? null],
  );
  res.status(200).json({ id: result.insertId });
});

router.patch('/office-locations/:id', requireAdmin, async (req, res) => {
  const { name, latitude, longitude } = req.body || {};
  const updates = [];
  const params = [];

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name must be a non-empty string' });
      return;
    }
    updates.push('name = ?');
    params.push(name.trim());
  }
  if (latitude !== undefined) {
    if (typeof latitude !== 'number') {
      res.status(400).json({ error: 'latitude must be a number' });
      return;
    }
    updates.push('latitude = ?');
    params.push(latitude);
  }
  if (longitude !== undefined) {
    if (typeof longitude !== 'number') {
      res.status(400).json({ error: 'longitude must be a number' });
      return;
    }
    updates.push('longitude = ?');
    params.push(longitude);
  }
  if (updates.length === 0) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }

  params.push(req.params.id);
  const [result] = await pool.query(
    `UPDATE office_locations SET ${updates.join(', ')} WHERE id = ?`,
    params,
  );
  if (result.affectedRows === 0) {
    res.status(404).json({ error: 'Office location not found' });
    return;
  }
  res.status(200).json({ ok: true });
});

router.delete('/office-locations/:id', requireAdmin, async (req, res) => {
  if (Number(req.params.id) === 1) {
    res.status(400).json({ error: 'The default office location cannot be deleted.' });
    return;
  }

  try {
    const [result] = await pool.query('DELETE FROM office_locations WHERE id = ?', [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Office location not found' });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      res.status(409).json({ error: 'Reassign its employees before deleting this location.' });
      return;
    }
    throw err;
  }
});

router.get('/kiosk-offline-support', requireAdmin, async (_req, res) => {
  const [rows] = await pool.query('SELECT offline_enabled FROM kiosk_settings WHERE id = 1');
  res.status(200).json({ enabled: !!rows[0]?.offline_enabled });
});

router.patch('/kiosk-offline-support', requireAdmin, async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }

  await pool.query(
    'INSERT INTO kiosk_settings (id, offline_enabled) VALUES (1, ?) ' +
      'ON DUPLICATE KEY UPDATE offline_enabled = VALUES(offline_enabled)',
    [enabled ? 1 : 0],
  );
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
