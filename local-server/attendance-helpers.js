const { distanceMeters, formatDistance } = require('./geo');

const GEOFENCE_MIN_RADIUS_METERS = Number(process.env.GEOFENCE_MIN_RADIUS_METERS || 0);
const GEOFENCE_MAX_RADIUS_METERS = Number(process.env.GEOFENCE_MAX_RADIUS_METERS || 10);

async function checkGeofence(pool, userId, latitude, longitude) {
  const [userRows] = await pool.query(
    'SELECT bypass_geofence, office_location_id FROM users WHERE id = ?',
    [userId],
  );
  const bypassGeofence = !!userRows[0]?.bypass_geofence;

  const [officeRows] = await pool.query('SELECT latitude, longitude FROM office_locations WHERE id = ?', [
    userRows[0]?.office_location_id,
  ]);
  const office = officeRows[0];
  const officeIsSet = office && office.latitude !== null && office.longitude !== null;
  if (!officeIsSet || bypassGeofence) return { ok: true };

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { ok: false, status: 400, error: 'Location is required to clock in or out.' };
  }

  const distance = distanceMeters(office.latitude, office.longitude, latitude, longitude);
  if (distance < GEOFENCE_MIN_RADIUS_METERS || distance > GEOFENCE_MAX_RADIUS_METERS) {
    return {
      ok: false,
      status: 403,
      error:
        `You're ${formatDistance(distance)} from the office — must be between ` +
        `${formatDistance(GEOFENCE_MIN_RADIUS_METERS)} and ${formatDistance(GEOFENCE_MAX_RADIUS_METERS)} to clock in or out.`,
      distance: Math.round(distance),
    };
  }

  return { ok: true };
}

async function getNextAction(pool, userId) {
  const [rows] = await pool.query(
    'SELECT action FROM attendance_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId],
  );
  const lastAction = rows[0]?.action ?? null;
  return lastAction === 'login' ? 'logout' : 'login';
}

module.exports = {
  checkGeofence,
  getNextAction,
  GEOFENCE_MIN_RADIUS_METERS,
  GEOFENCE_MAX_RADIUS_METERS,
};
