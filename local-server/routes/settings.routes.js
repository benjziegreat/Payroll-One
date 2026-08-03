const express = require('express');
const { pool } = require('../db');
const { requireUser } = require('../auth');

const router = express.Router();

router.use(requireUser);

// Returns the office location the caller is assigned to (set by an admin —
// see /admin/office-locations and /admin/users/:id/office-location).
router.get('/office-location', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT ol.id, ol.name, ol.latitude, ol.longitude
     FROM users u
     JOIN office_locations ol ON ol.id = u.office_location_id
     WHERE u.id = ?`,
    [req.userId],
  );
  const row = rows[0];
  const location =
    row && row.latitude !== null && row.longitude !== null
      ? { id: row.id, name: row.name, latitude: row.latitude, longitude: row.longitude }
      : null;
  res.status(200).json({ location });
});

// All office locations with coordinates set — lets a user assigned to "All
// locations" (office_location_id null) figure out which branch is nearest
// to them client-side, to mirror what checkGeofence does server-side.
router.get('/office-locations', async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, latitude, longitude FROM office_locations ' +
      'WHERE latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY id',
  );
  res.status(200).json({ locations: rows });
});

module.exports = router;
