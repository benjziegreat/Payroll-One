require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const https = require('https');
const path = require('path');
const express = require('express');

const authRoutes = require('./routes/auth.routes');
const faceRoutes = require('./routes/face.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const webauthnRoutes = require('./routes/webauthn.routes');

const app = express();
app.use(express.json());

app.use('/api/local/auth', authRoutes);
app.use('/api/local/face', faceRoutes);
app.use('/api/local/attendance', attendanceRoutes);
app.use('/api/local/webauthn', webauthnRoutes);

const browserDist = path.join(__dirname, '..', 'dist', 'payroll-one', 'browser');
app.use(express.static(browserDist));
app.get(/^\/(?!api\/).*/, (_req, res) => {
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
