const { verifyAuthenticationResponse } = require('@simplewebauthn/server');
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
  const responseBody = req.body;

  const { data: challengeRow } = await supabase
    .from('webauthn_challenges')
    .select('challenge')
    .eq('user_id', user.id)
    .eq('challenge_type', 'authentication')
    .maybeSingle();

  if (!challengeRow) {
    res.status(400).json({ error: 'No pending authentication challenge' });
    return;
  }

  const { data: credentialRow } = await supabase
    .from('webauthn_credentials')
    .select('*')
    .eq('credential_id', responseBody.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!credentialRow) {
    res.status(400).json({ error: 'Unknown credential' });
    return;
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: responseBody,
      expectedChallenge: challengeRow.challenge,
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

  await supabase
    .from('webauthn_challenges')
    .delete()
    .eq('user_id', user.id)
    .eq('challenge_type', 'authentication');

  if (!verification.verified) {
    res.status(400).json({ verified: false });
    return;
  }

  await supabase
    .from('webauthn_credentials')
    .update({ counter: verification.authenticationInfo.newCounter })
    .eq('credential_id', credentialRow.credential_id);

  res.status(200).json({ verified: true });
};
