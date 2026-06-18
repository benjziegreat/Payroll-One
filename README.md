# Payroll One — Biometric Attendance

Angular app where each employee signs in with their own account, then confirms
clock-in/clock-out with **face recognition** (webcam, via face-api.js) or their
**device's fingerprint/Face ID/Windows Hello** (via WebAuthn). Every event is
recorded as an attendance log. Deployed as a static SPA + serverless API on
Vercel, with a **local MySQL fallback** for offline/local development.

Live deployment: https://payroll-one-sigma.vercel.app

## Two backends, one frontend

The Angular code never talks to Supabase or MySQL directly from pages/components
— `AuthService`, `FaceService`, `WebauthnService`, and `AttendanceService` in
`src/app/core/` each branch internally on `environment.backend`:

| `environment.backend` | Auth + data | Used by |
|---|---|---|
| `'supabase'` (prod default, `environment.ts`) | Supabase Auth + Postgres + RLS | Vercel deployment |
| `'local'` (dev default, `environment.development.ts`) | Local Express API + MySQL (`local-server/`) | `npm run serve:https` |

Switch a build between them by editing the `backend` field in the relevant
`src/environments/environment*.ts` file.

## How it works

- **Accounts**: email + password. Supabase Auth in `'supabase'` mode; a small
  JWT-based auth route (`local-server/routes/auth.routes.js`, bcrypt +
  `jsonwebtoken`) in `'local'` mode. Each user enrolls their own biometrics —
  there's no cross-user face search.
- **Face recognition**: `face-api.js` runs entirely in the browser. On
  enrollment it stores a 128-value face descriptor; on login/logout it
  captures a fresh descriptor and compares distance against the stored one
  (lazy-loaded, so it doesn't bloat the initial bundle). In `'local'` mode the
  comparison happens server-side in `local-server/routes/face.routes.js`.
- **Fingerprint**: real WebAuthn, not just a client-side check. The browser
  talks to `/api/webauthn/*` (Vercel) or `/api/local/webauthn/*`
  (`local-server/routes/webauthn.routes.js`) — both using
  `@simplewebauthn/server` to generate/verify challenges and store the
  credential's public key + counter. The client never sees or trusts a raw
  "verified" flag from itself — verification happens server-side.
- **Attendance log**: every successful clock-in/out inserts a row into
  `attendance_logs` (RLS-scoped to `auth.uid()` in Supabase; scoped to the JWT
  user in the local MySQL API).

## One-time setup

### 1. Supabase

1. Create a project at supabase.com (or use an existing one).
2. Open **SQL Editor** and run [supabase/schema.sql](supabase/schema.sql).
3. In **Project Settings → API**, copy the **Project URL**, **anon public
   key**, and **service_role key**.
4. In **Authentication → Settings**, you can disable "Confirm email" while
   testing so sign-up logs straight in (re-enable for real use).

### 2. Frontend environment

Edit `src/environments/environment.ts` and
`src/environments/environment.development.ts`, replacing the placeholders:

```ts
export const environment = {
  production: true,
  supabaseUrl: 'https://xxxxx.supabase.co',
  supabaseAnonKey: 'eyJ...',
};
```

The anon key is safe to ship to the browser — Row Level Security in
`supabase/schema.sql` is what actually restricts access.

### 3. Serverless function environment (Vercel)

The `/api/webauthn/*` functions need the **service role** key (never expose
this to the browser). Set these in Vercel → Project → Settings →
Environment Variables:

| Name | Value |
|---|---|
| `SUPABASE_URL` | same Project URL as above |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role key (secret) |

Or via CLI:

```bash
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
```

## Local development

```bash
npm install
npm start          # ng serve, http://localhost:4200 (Supabase mode only)
```

`ng serve` only serves the Angular app — no `/api` routes — so it only works
end-to-end if `environment.development.ts` is set to `backend: 'supabase'`
with real credentials filled in. To test the fingerprint flow against
Supabase locally instead of MySQL, use the Vercel CLI, which runs the Angular
build and the serverless functions together:

```bash
vercel dev
```

### Local MySQL backend + HTTPS (no Supabase needed)

`environment.development.ts` defaults to `backend: 'local'`, which talks to a
small Express + MySQL API in `local-server/`. Camera access and WebAuthn both
require a secure context, so this is served over **HTTPS** (via `mkcert`),
not plain `ng serve`.

**One-time setup:**

1. Create a MySQL database + dedicated app user (don't use root at runtime):
   ```sql
   CREATE DATABASE payroll_one CHARACTER SET utf8mb4;
   CREATE USER 'payroll_one_app'@'localhost' IDENTIFIED BY 'choose-a-password';
   GRANT ALL PRIVILEGES ON payroll_one.* TO 'payroll_one_app'@'localhost';
   ```
2. Copy `local-server/.env.example` to `local-server/.env` and fill in
   `DB_USER`/`DB_PASSWORD` (matching above) and a random `JWT_SECRET`
   (e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
3. Create the tables:
   ```bash
   npm run local:db:init
   ```
4. Generate a locally-trusted HTTPS cert with `mkcert` (installs a local root
   CA the first time, then issues a cert):
   ```bash
   npm run local:certs
   ```
   This covers `localhost`/`127.0.0.1` only. To also test from a **phone on
   the same WiFi**, regenerate including your machine's LAN IP, e.g.:
   ```bash
   mkcert -key-file local-server/certs/key.pem -cert-file local-server/certs/cert.pem localhost 127.0.0.1 ::1 192.168.1.50
   ```
   (find your LAN IP with `ipconfig`). The desktop browser trusts it
   automatically (mkcert's root CA is installed system-wide). On the phone
   you'll either see a "connection not private" warning you can click through
   (camera/WebAuthn still work — the connection is still HTTPS), or for no
   warning at all, copy the root CA from `mkcert -CAROOT` onto the phone and
   install it as a trusted certificate.

   **Note:** WebAuthn's `rpID` must be a real domain — browsers generally
   reject raw IP addresses for it. So fingerprint enrollment/login will work
   over `https://localhost:8443` on the desktop, but likely **won't** work
   when the phone connects via the LAN IP (face recognition still will,
   since the camera doesn't care). This is a browser/spec limitation, not a
   bug in this app.

**Run it:**

```bash
npm run serve:https
```

This builds the app with the `development` config (`backend: 'local'`) and
starts the HTTPS server at `https://localhost:8443` (and
`https://<your-LAN-IP>:8443` if your firewall allows inbound on that port —
Windows usually already permits Node, since it prompts the first time).

### Reaching it from a phone (if LAN access is blocked)

Some routers isolate WiFi clients from wired ones, or a phone's WiFi may be on
a different VLAN/guest network than expected — in either case the LAN IP
above won't be reachable even with the right firewall rules. A Cloudflare
quick Tunnel sidesteps this entirely by exposing the local HTTPS server
through a public, trusted `https://<random>.trycloudflare.com` URL (no
account/signup needed). It also happens to fix WebAuthn over a phone, since
unlike a LAN IP it's a real domain name.

```bash
npm run tunnel:start   # auto-installs cloudflared into local-server/bin/ if missing, then starts it
npm run tunnel:status  # prints the current public URL, if running
npm run tunnel:stop    # tears it down
```

The server (`npm run serve:https`) must already be running — the tunnel just
forwards to `https://localhost:8443`. The printed URL changes every time you
start the tunnel, and it's reachable by anyone who has the link for as long
as it's running, so stop it when you're done testing.

## Deploying

```bash
vercel --prod
```

`vercel.json` builds with `npm run build` and serves
`dist/payroll-one/browser`, with a SPA fallback rewrite for client-side
routing (excluding `/api/*`).

## Notes / limitations

- Face matching threshold is tuned in `src/app/core/face.service.ts`
  (`MATCH_THRESHOLD = 0.55`, mirrored server-side in
  `local-server/routes/face.routes.js`). Lower = stricter.
- WebAuthn's `rpID`/origin are derived from the request host, so credentials
  registered on one Vercel preview URL won't authenticate on a different
  preview URL (expected WebAuthn behavior) — production/custom domains stay
  stable. Same goes for `localhost` vs a LAN IP locally — see above.
- This is a personal-device flow (each person signs into their own account
  first). It is not a shared-kiosk attendance terminal.
- `local-server/.env` and `local-server/certs/` are gitignored — they hold
  your DB password, JWT signing secret, and private key, and are specific to
  your machine.
