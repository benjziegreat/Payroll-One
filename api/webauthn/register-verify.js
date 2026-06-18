const { verifyRegistrationResponse } = require('@simplewebauthn/server');
const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { requireUser, getOrigin, getRpId } = require('../_lib/requireUser');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const supabase = getSupabaseAdmin();
  const origin = getOrigin(req);
  const rpID = getRpId(req);

  const { data: challengeRow } = await supabase
    .from('webauthn_challenges')
    .select('challenge')
    .eq('user_id', user.id)
    .eq('challenge_type', 'registration')
    .maybeSingle();

  if (!challengeRow) {
    res.status(400).json({ error: 'No pending registration challenge' });
    return;
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }

  await supabase
    .from('webauthn_challenges')
    .delete()
    .eq('user_id', user.id)
    .eq('challenge_type', 'registration');

  if (!verification.verified || !verification.registrationInfo) {
    res.status(400).json({ verified: false });
    return;
  }

  const { credential } = verification.registrationInfo;

  await supabase.from('webauthn_credentials').upsert({
    credential_id: credential.id,
    user_id: user.id,
    public_key: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ?? [],
  });

  res.status(200).json({ verified: true });
};
