const { distanceMeters, formatDistance } = require('./geo');

const GEOFENCE_MIN_RADIUS_METERS = Number(process.env.GEOFENCE_MIN_RADIUS_METERS || 0);
const GEOFENCE_MAX_RADIUS_METERS = Number(process.env.GEOFENCE_MAX_RADIUS_METERS || 10);

function nearestOffice(offices, latitude, longitude) {
  let best = null;
  let bestDistance = Infinity;
  for (const office of offices) {
    const distance = distanceMeters(office.latitude, office.longitude, latitude, longitude);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = office;
    }
  }
  return best;
}

async function checkGeofence(pool, userId, latitude, longitude, selectedOfficeLocationId) {
  const [userRows] = await pool.query(
    'SELECT bypass_geofence, office_location_id FROM users WHERE id = ?',
    [userId],
  );
  const bypassGeofence = !!userRows[0]?.bypass_geofence;
  if (bypassGeofence) return { ok: true };

  const officeLocationId = userRows[0]?.office_location_id;
  let office = null;

  if (officeLocationId) {
    // A fixed assignment always wins — a client-sent selection only matters
    // for "All locations" users below, never as an override of this.
    const [officeRows] = await pool.query(
      'SELECT name, latitude, longitude FROM office_locations WHERE id = ?',
      [officeLocationId],
    );
    office = officeRows[0] ?? null;
  } else if (selectedOfficeLocationId) {
    // "All locations" — the employee picked which branch they're at,
    // rather than leaving it to an automatic nearest-office guess (GPS can
    // easily be off by more than the geofence radius, especially indoors).
    const [officeRows] = await pool.query(
      'SELECT name, latitude, longitude FROM office_locations WHERE id = ?',
      [selectedOfficeLocationId],
    );
    office = officeRows[0] ?? null;
  } else {
    // "All locations", nothing selected — fall back to whichever office is
    // nearest to where they actually are, instead of skipping the check
    // entirely.
    const [offices] = await pool.query(
      'SELECT name, latitude, longitude FROM office_locations WHERE latitude IS NOT NULL AND longitude IS NOT NULL',
    );
    if (offices.length > 0) {
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return { ok: false, status: 400, error: 'Location is required to clock in or out.' };
      }
      office = nearestOffice(offices, latitude, longitude);
    }
  }

  const officeIsSet = office && office.latitude !== null && office.longitude !== null;
  if (!officeIsSet) return { ok: true };

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { ok: false, status: 400, error: 'Location is required to clock in or out.' };
  }

  const distance = distanceMeters(office.latitude, office.longitude, latitude, longitude);
  if (distance < GEOFENCE_MIN_RADIUS_METERS || distance > GEOFENCE_MAX_RADIUS_METERS) {
    return {
      ok: false,
      status: 403,
      error:
        `You're ${formatDistance(distance)} from ${office.name} — must be between ` +
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
