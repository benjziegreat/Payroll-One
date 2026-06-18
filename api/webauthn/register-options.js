const { generateRegistrationOptions } = require('@simplewebauthn/server');
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

  const { data: existingCredentials } = await supabase
    .from('webauthn_credentials')
    .select('credential_id, transports')
    .eq('user_id', user.id);

  const options = await generateRegistrationOptions({
    rpName: 'Payroll One',
    rpID,
    userName: user.email ?? user.id,
    userDisplayName: user.user_metadata?.full_name ?? user.email ?? 'Employee',
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
    excludeCredentials: (existingCredentials ?? []).map((c) => ({
      id: c.credential_id,
      transports: c.transports ?? undefined,
    })),
  });

  await supabase.from('webauthn_challenges').upsert({
    user_id: user.id,
    challenge: options.challenge,
    challenge_type: 'registration',
  });

  res.status(200).json(options);
};
