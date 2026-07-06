const express = require('express');
const crypto = require('crypto');
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { pool } = require('../db');
const { checkGeofence, getNextAction } = require('../attendance-helpers');

const FACE_MATCH_THRESHOLD = 0.55;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;

const router = express.Router();

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function getOrigin(req) {
  return req.headers.origin || `https://${req.headers.host}`;
}

function getRpId(req) {
  return new URL(getOrigin(req)).hostname;
}

// Shared by both face and fingerprint identification: once we know *who* it
// is, run the same geofence + login/logout-flip + insert logic the
// authenticated /attendance endpoint uses, then report back who it was.
async function identifyAndLog(res, userId, method, latitude, longitude, clientEventId) {
  const [userRows] = await pool.query('SELECT full_name, photo_url FROM users WHERE id = ?', [
    userId,
  ]);
  const user = userRows[0];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (clientEventId) {
    const [existing] = await pool.query(
      'SELECT action FROM attendance_logs WHERE client_event_id = ?',
      [clientEventId],
    );
    if (existing.length > 0) {
      res.status(200).json({
        fullName: user.full_name,
        photoUrl: user.photo_url,
        action: existing[0].action,
      });
      return;
    }
  }

  const geofence = await checkGeofence(pool, userId, latitude, longitude);
  if (!geofence.ok) {
    res.status(geofence.status).json({ error: geofence.error, distance: geofence.distance });
    return;
  }

  const action = await getNextAction(pool, userId);
  await pool.query(
    'INSERT INTO attendance_logs (id, user_id, action, method, latitude, longitude, occurred_at, client_event_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)',
    [crypto.randomUUID(), userId, action, method, latitude ?? null, longitude ?? null, clientEventId ?? null],
  );

  res.status(200).json({ fullName: user.full_name, photoUrl: user.photo_url, action });
}

router.post('/face', async (req, res) => {
  const { descriptor, latitude, longitude, clientEventId } = req.body || {};
  if (!Array.isArray(descriptor) || descriptor.length === 0) {
    res.status(400).json({ error: 'descriptor array is required' });
    return;
  }

  const [rows] = await pool.query('SELECT user_id, descriptor FROM face_enrollments');

  let bestUserId = null;
  let bestDistance = Infinity;
  for (const row of rows) {
    const distance = euclideanDistance(row.descriptor, descriptor);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestUserId = row.user_id;
    }
  }

  if (!bestUserId || bestDistance > FACE_MATCH_THRESHOLD) {
    res.status(401).json({ error: 'Face not recognized.' });
    return;
  }

  await identifyAndLog(res, bestUserId, 'face', latitude, longitude, clientEventId);
});

router.post('/fingerprint/options', async (req, res) => {
  const rpID = getRpId(req);

  // Empty allowCredentials triggers the "usernameless" / discoverable-
  // credential flow — the platform shows a picker of whichever credentials
  // it has for this rpID instead of us having to say who to expect.
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: [],
  });

  await pool.query('DELETE FROM webauthn_kiosk_challenges WHERE created_at < ?', [
    new Date(Date.now() - CHALLENGE_TTL_MS),
  ]);
  await pool.query('INSERT INTO webauthn_kiosk_challenges (challenge) VALUES (?)', [
    options.challenge,
  ]);

  res.status(200).json(options);
});

router.post('/fingerprint/verify', async (req, res) => {
  const { latitude, longitude, clientEventId, ...assertion } = req.body || {};
  const origin = getOrigin(req);
  const rpID = getRpId(req);

  let expectedChallenge;
  try {
    const clientData = JSON.parse(
      Buffer.from(assertion.response.clientDataJSON, 'base64url').toString('utf8'),
    );
    expectedChallenge = clientData.challenge;
  } catch {
    res.status(400).json({ error: 'Malformed assertion' });
    return;
  }

  const [challengeRows] = await pool.query(
    'SELECT challenge FROM webauthn_kiosk_challenges WHERE challenge = ? AND created_at > ?',
    [expectedChallenge, new Date(Date.now() - CHALLENGE_TTL_MS)],
  );
  if (challengeRows.length === 0) {
    res.status(400).json({ error: 'No pending or expired challenge' });
    return;
  }
  await pool.query('DELETE FROM webauthn_kiosk_challenges WHERE challenge = ?', [
    expectedChallenge,
  ]);

  const [credentialRows] = await pool.query(
    'SELECT * FROM webauthn_credentials WHERE credential_id = ?',
    [assertion.id],
  );
  if (credentialRows.length === 0) {
    res.status(401).json({ error: 'Fingerprint not recognized.' });
    return;
  }
  const credentialRow = credentialRows[0];

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credentialRow.credential_id,
        publicKey: new Uint8Array(Buffer.from(credentialRow.public_key, 'base64url')),
        counter: Number(credentialRow.counter),
        transports: credentialRow.transports ?? undefined,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }

  if (!verification.verified) {
    res.status(401).json({ error: 'Fingerprint not recognized.' });
    return;
  }

  await pool.query('UPDATE webauthn_credentials SET counter = ? WHERE credential_id = ?', [
    verification.authenticationInfo.newCounter,
    credentialRow.credential_id,
  ]);

  await identifyAndLog(res, credentialRow.user_id, 'fingerprint', latitude, longitude, clientEventId);
});

module.exports = router;
