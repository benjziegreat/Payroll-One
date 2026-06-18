-- Payroll One: biometric attendance schema
-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).

create extension if not exists pgcrypto;

-- One enrolled face descriptor (128-float face-api.js embedding) per user.
create table if not exists public.face_enrollments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  descriptor double precision[] not null,
  created_at timestamptz not null default now()
);

alter table public.face_enrollments enable row level security;

create policy "Users manage their own face enrollment"
  on public.face_enrollments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- WebAuthn (platform fingerprint / Face ID / Windows Hello) credentials.
-- Only the server (service role, via the /api/webauthn functions) writes here,
-- because registering/verifying a credential requires cryptographic checks
-- that must not be trusted to the client.
create table if not exists public.webauthn_credentials (
  credential_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  public_key text not null,
  counter bigint not null default 0,
  transports text[],
  created_at timestamptz not null default now()
);

alter table public.webauthn_credentials enable row level security;

create policy "Users read their own credentials"
  on public.webauthn_credentials
  for select
  using (auth.uid() = user_id);

-- Short-lived WebAuthn challenge storage, bridging the options/verify request pair.
-- Only the server reads/writes this table (no client policies).
create table if not exists public.webauthn_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  challenge text not null,
  challenge_type text not null check (challenge_type in ('registration', 'authentication')),
  created_at timestamptz not null default now()
);

alter table public.webauthn_challenges enable row level security;

-- Every login/logout event, tagged with which biometric method confirmed it.
create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('login', 'logout')),
  method text not null check (method in ('face', 'fingerprint')),
  created_at timestamptz not null default now()
);

alter table public.attendance_logs enable row level security;

create policy "Users read their own attendance logs"
  on public.attendance_logs
  for select
  using (auth.uid() = user_id);

create policy "Users insert their own attendance logs"
  on public.attendance_logs
  for insert
  with check (auth.uid() = user_id);

create index if not exists attendance_logs_user_created_idx
  on public.attendance_logs (user_id, created_at desc);
