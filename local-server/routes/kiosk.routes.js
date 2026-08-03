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

async function isOfflineSupportEnabled() {
  const [rows] = await pool.query('SELECT offline_enabled FROM kiosk_settings WHERE id = 1');
  return !!rows[0]?.offline_enabled;
}

async function matchFace(descriptor) {
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

  return bestUserId && bestDistance <= FACE_MATCH_THRESHOLD ? bestUserId : null;
}

// Shared by face and fingerprint identification (both live and offline-sync):
// once we know *who* it is, run the same login/logout-flip + insert logic the
// authenticated /attendance endpoint uses, then report back who it was.
async function identifyAndLog(res, userId, method, latitude, longitude, clientEventId, options = {}) {
  const { occurredAt = null, skipGeofence = false } = options;

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

  // Offline-synced entries were captured while the kiosk couldn't reach the
  // server at all — there's no live geolocation-vs-office check to run
  // retroactively, and the kiosk hardware being fixed in place at the office
  // is the trust anchor in that case, same as it is for the live path.
  if (!skipGeofence) {
    const geofence = await checkGeofence(pool, userId, latitude, longitude);
    if (!geofence.ok) {
      res.status(geofence.status).json({ error: geofence.error, distance: geofence.distance });
      return;
    }
  }

  const action = await getNextAction(pool, userId);
  await pool.query(
    'INSERT INTO attendance_logs (id, user_id, action, method, latitude, longitude, occurred_at, client_event_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      crypto.randomUUID(),
      userId,
      action,
      method,
      latitude ?? null,
      longitude ?? null,
      occurredAt,
      clientEventId ?? null,
    ],
  );

  res.status(200).json({ fullName: user.full_name, photoUrl: user.photo_url, action });
}

router.post('/face', async (req, res) => {
  const { descriptor, latitude, longitude, clientEventId } = req.body || {};
  if (!Array.isArray(descriptor) || descriptor.length === 0) {
    res.status(400).json({ error: 'descriptor array is required' });
    return;
  }

  const userId = await matchFace(descriptor);
  if (!userId) {
    res.status(401).json({ error: 'Face not recognized.' });
    return;
  }

  await identifyAndLog(res, userId, 'face', latitude, longitude, clientEventId);
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

// Whether the kiosk is allowed to cache the employee directory (face
// descriptors + WebAuthn public keys) for offline identification. Public —
// the kiosk has no session — but read-only, and the directory/sync endpoints
// below re-check it server-side so a client can't just skip asking.
router.get('/offline-support', async (_req, res) => {
  res.status(200).json({ enabled: await isOfflineSupportEnabled() });
});

// The offline directory: every enrolled employee's face descriptor and
// WebAuthn public keys, plus their last known clock action so the kiosk can
// compute login-vs-logout locally. Only served when an admin has opted in
// (see /admin/kiosk-offline-support) — this is the actual data exposure that
// setting gates.
router.get('/directory', async (_req, res) => {
  if (!(await isOfflineSupportEnabled())) {
    res.status(403).json({ error: 'Offline kiosk mode is not enabled.' });
    return;
  }

  const [users] = await pool.query(
    `SELECT u.id, u.full_name, u.photo_url, fe.descriptor AS face_descriptor,
            l.action AS last_action
     FROM users u
     LEFT JOIN face_enrollments fe ON fe.user_id = u.id
     LEFT JOIN attendance_logs l ON l.id = (
       SELECT id FROM attendance_logs WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
     )`,
  );

  const [credentialRows] = await pool.query(
    'SELECT user_id, credential_id, transports FROM webauthn_credentials',
  );
  const credentialsByUser = new Map();
  for (const row of credentialRows) {
    const list = credentialsByUser.get(row.user_id) ?? [];
    list.push({ credentialId: row.credential_id, transports: row.transports ?? [] });
    credentialsByUser.set(row.user_id, list);
  }

  res.status(200).json({
    users: users.map((row) => ({
      userId: row.id,
      fullName: row.full_name,
      photoUrl: row.photo_url,
      faceDescriptor: row.face_descriptor ?? null,
      credentials: credentialsByUser.get(row.id) ?? [],
      lastAction: row.last_action ?? null,
    })),
  });
});

// Authoritative re-identification for events the kiosk matched locally while
// it couldn't reach the server. The kiosk's own on-device match only drove
// its immediate UI feedback — this is the real, server-verified write, using
// the same face-matching / WebAuthn-signature-verification logic as the live
// endpoints above, just replayed against the raw descriptor/assertion that
// was captured (and against occurredAt, to keep the record accurately timed).
router.post('/sync', async (req, res) => {
  if (!(await isOfflineSupportEnabled())) {
    res.status(403).json({ error: 'Offline kiosk mode is not enabled.' });
    return;
  }

  const { type, latitude, longitude, occurredAt, clientEventId } = req.body || {};

  let occurredAtDate = null;
  if (occurredAt !== undefined) {
    occurredAtDate = new Date(occurredAt);
    if (Number.isNaN(occurredAtDate.getTime())) {
      res.status(400).json({ error: 'Invalid occurredAt' });
      return;
    }
  }

  if (type === 'face') {
    const { descriptor } = req.body || {};
    if (!Array.isArray(descriptor) || descriptor.length === 0) {
      res.status(400).json({ error: 'descriptor array is required' });
      return;
    }

    const userId = await matchFace(descriptor);
    if (!userId) {
      res.status(401).json({ error: 'Face not recognized.' });
      return;
    }

    await identifyAndLog(res, userId, 'face', latitude, longitude, clientEventId, {
      occurredAt: occurredAtDate,
      skipGeofence: true,
    });
    return;
  }

  if (type === 'fingerprint') {
    const { assertion } = req.body || {};
    if (!assertion || typeof assertion !== 'object') {
      res.status(400).json({ error: 'assertion is required' });
      return;
    }

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
        // Offline-originated: the challenge was generated on the kiosk
        // itself (no server round trip was possible when it was captured),
        // so there's no server-issued nonce to check for freshness against.
        // Everything else — signature, origin, rpID, and the anti-clone
        // counter — is still fully verified against the credential's stored
        // public key, exactly like the live /fingerprint/verify path.
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

    await identifyAndLog(
      res,
      credentialRow.user_id,
      'fingerprint',
      latitude,
      longitude,
      clientEventId,
      { occurredAt: occurredAtDate, skipGeofence: true },
    );
    return;
  }

  res.status(400).json({ error: 'type must be "face" or "fingerprint"' });
});

module.exports = router;
