const { generateAuthenticationOptions } = require('@simplewebauthn/server');
const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { requireUser, getRpId } = require('../_lib/requireUser');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const supabase = getSupabaseAdmin();
  const rpID = getRpId(req);

  const { data: credentials } = await supabase
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', user.id);

  if (!credentials || credentials.length === 0) {
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

  await supabase.from('webauthn_challenges').upsert({
    user_id: user.id,
    challenge: options.challenge,
    challenge_type: 'authentication',
  });

  res.status(200).json(options);
};
