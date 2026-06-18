export const environment = {
  production: false,
  // 'local' uses the local Express + MySQL API in local-server/ (see README).
  // Switch to 'supabase' once you've added real supabaseUrl/supabaseAnonKey below.
  backend: 'local' as 'supabase' | 'local',
  supabaseUrl: 'YOUR_SUPABASE_URL',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
  localApiBase: '/api/local',
};
