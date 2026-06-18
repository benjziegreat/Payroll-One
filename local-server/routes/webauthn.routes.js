const express = require('express');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { pool } = require('../db');
const { requireUser } = require('../auth');

const router = express.Router();

function getOrigin(req) {
  return req.headers.origin || `https://${req.headers.host}`;
}

function getRpId(req) {
  return new URL(getOrigin(req)).hostname;
}

router.use(requireUser);

router.get('/status', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT credential_id FROM webauthn_credentials WHERE user_id = ? LIMIT 1',
    [req.userId],
  );
  res.status(200).json({ enrolled: rows.length > 0 });
});

router.post('/register-options', async (req, res) => {
  const rpID = getRpId(req);

  const [existingCredentials] = await pool.query(
    'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?',
    [req.userId],
  );

  const options = await generateRegistrationOptions({
    rpName: 'Payroll One',
    rpID,
    userName: req.userEmail ?? req.userId,
    userDisplayName: req.userEmail ?? 'Employee',
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
    excludeCredentials: existingCredentials.map((c) => ({
      id: c.credential_id,
      transports: c.transports ?? undefined,
    })),
  });

  await pool.query(
    'INSERT INTO webauthn_challenges (user_id, challenge, challenge_type) VALUES (?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE challenge = VALUES(challenge), challenge_type = VALUES(challenge_type)',
    [req.userId, options.challenge, 'registration'],
  );

  res.status(200).json(options);
});

router.post('/register-verify', async (req, res) => {
  const origin = getOrigin(req);
  const rpID = getRpId(req);

  const [challengeRows] = await pool.query(
    "SELECT challenge FROM webauthn_challenges WHERE user_id = ? AND challenge_type = 'registration'",
    [req.userId],
  );
  if (challengeRows.length === 0) {
    res.status(400).json({ error: 'No pending registration challenge' });
    return;
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: challengeRows[0].challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }

  await pool.query(
    "DELETE FROM webauthn_challenges WHERE user_id = ? AND challenge_type = 'registration'",
    [req.userId],
  );

  if (!verification.verified || !verification.registrationInfo) {
    res.status(400).json({ verified: false });
    return;
  }

  const { credential } = verification.registrationInfo;
  await pool.query(
    'INSERT INTO webauthn_credentials (credential_id, user_id, public_key, counter, transports) ' +
      'VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE public_key = VALUES(public_key), counter = VALUES(counter), transports = VALUES(transports)',
    [
      credential.id,
      req.userId,
      Buffer.from(credential.publicKey).toString('base64url'),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
    ],
  );

  res.status(200).json({ verified: true });
});

router.post('/login-options', async (req, res) => {
  const rpID = getRpId(req);

  const [credentials] = await pool.query(
    'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?',
    [req.userId],
  );
  if (credentials.length === 0) {
    res.status(404).json({ error: 'No fingerprint credential enrolled' });
    return;
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: credentials.map((c) => ({
      id: c.credential_id,
      transports: c.transports ?? undefined,
    })),
  });

  await pool.query(
    'INSERT INTO webauthn_challenges (user_id, challenge, challenge_type) VALUES (?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE challenge = VALUES(challenge), challenge_type = VALUES(challenge_type)',
    [req.userId, options.challenge, 'authentication'],
  );

  res.status(200).json(options);
});

router.post('/login-verify', async (req, res) => {
  const origin = getOrigin(req);
  const rpID = getRpId(req);
  const responseBody = req.body;

  const [challengeRows] = await pool.query(
    "SELECT challenge FROM webauthn_challenges WHERE user_id = ? AND challenge_type = 'authentication'",
    [req.userId],
  );
  if (challengeRows.length === 0) {
    res.status(400).json({ error: 'No pending authentication challenge' });
    return;
  }

  const [credentialRows] = await pool.query(
    'SELECT * FROM webauthn_credentials WHERE credential_id = ? AND user_id = ?',
    [responseBody.id, req.userId],
  );
  if (credentialRows.length === 0) {
    res.status(400).json({ error: 'Unknown credential' });
    return;
  }
  const credentialRow = credentialRows[0];

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: responseBody,
      expectedChallenge: challengeRows[0].challenge,
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

  await pool.query(
    "DELETE FROM webauthn_challenges WHERE user_id = ? AND challenge_type = 'authentication'",
    [req.userId],
  );

  if (!verification.verified) {
    res.status(400).json({ verified: false });
    return;
  }

  await pool.query('UPDATE webauthn_credentials SET counter = ? WHERE credential_id = ?', [
    verification.authenticationInfo.newCounter,
    credentialRow.credential_id,
  ]);

  res.status(200).json({ verified: true });
});

module.exports = router;
