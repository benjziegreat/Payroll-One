require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const https = require('https');
const path = require('path');
const express = require('express');

const authRoutes = require('./routes/auth.routes');
const faceRoutes = require('./routes/face.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const webauthnRoutes = require('./routes/webauthn.routes');
const settingsRoutes = require('./routes/settings.routes');
const adminRoutes = require('./routes/admin.routes');
const accountRoutes = require('./routes/account.routes');
const kioskRoutes = require('./routes/kiosk.routes');

const app = express();
app.use(express.json());

app.use('/api/local/auth', authRoutes);
app.use('/api/local/face', faceRoutes);
app.use('/api/local/attendance', attendanceRoutes);
app.use('/api/local/webauthn', webauthnRoutes);
app.use('/api/local/settings', settingsRoutes);
app.use('/api/local/admin', adminRoutes);
app.use('/api/local/account', accountRoutes);
app.use('/api/local/kiosk', kioskRoutes);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const browserDist = path.join(__dirname, '..', 'dist', 'payroll-one', 'browser');
app.use(express.static(browserDist));
app.get(/^\/(?!api\/).*/, (req, res) => {
  // A request for an actual file (has an extension) that express.static
  // above didn't find is a missing/stale build asset — e.g. a browser tab
  // still holding an old index.html asking for a JS chunk that a newer `ng
  // build` deleted. Serving index.html for that (200, text/html) makes the
  // browser choke with a confusing "expected a JS module" MIME error;
  // a real 404 lets Angular's own chunk-load-failure handling kick in
  // instead. Only extension-less paths are real Angular routes.
  if (path.extname(req.path)) {
    res.status(404).end();
    return;
  }
  res.sendFile(path.join(browserDist, 'index.html'));
});

const certDir = path.join(__dirname, 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('Missing HTTPS certs. Run: npm run local:certs');
  process.exit(1);
}
if (!fs.existsSync(browserDist)) {
  console.error('Missing build output. Run: npm run build');
  process.exit(1);
}

const port = Number(process.env.PORT || 8443);
const server = https.createServer(
  { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
  app,
);

server.listen(port, '0.0.0.0', () => {
  console.log(`Payroll One (local MySQL backend) running at https://localhost:${port}`);
});
