const { getSupabaseAdmin } = require('./supabaseAdmin');

async function requireUser(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }
  return data.user;
}

function getOrigin(req) {
  const origin = req.headers.origin || `https://${req.headers.host}`;
  return origin;
}

function getRpId(req) {
  return new URL(getOrigin(req)).hostname;
}

module.exports = { requireUser, getOrigin, getRpId };
