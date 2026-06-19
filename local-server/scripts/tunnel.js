#!/usr/bin/env node
'use strict';

// Starts/stops a Cloudflare quick Tunnel (https://<random>.trycloudflare.com)
// pointed at the local HTTPS server, so the app is reachable from a phone
// or anywhere else without relying on router/LAN configuration.
//
// Usage: node local-server/scripts/tunnel.js <start|stop|status>

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PROJECT_ROOT = path.join(ROOT, '..');
const BIN_DIR = path.join(ROOT, 'bin');
const PID_FILE = path.join(ROOT, '.tunnel.pid');
const URL_FILE = path.join(ROOT, '.tunnel-url.txt');
const LOG_FILE = path.join(ROOT, '.tunnel.log');
const SERVER_LOG_FILE = path.join(ROOT, '.server.log');
const TARGET_URL = process.env.TUNNEL_TARGET_URL || 'https://localhost:8443';

const isWindows = process.platform === 'win32';
const binaryPath = path.join(BIN_DIR, isWindows ? 'cloudflared.exe' : 'cloudflared');
const TARGET_PORT = new URL(TARGET_URL).port || '443';

function log(message) {
  console.log(`[tunnel] ${message}`);
}

function isPortListening(port) {
  if (isWindows) {
    const result = spawnSync('netstat', ['-ano']);
    return new RegExp(`:${port}\\s+\\S+\\s+LISTENING`).test(result.stdout.toString());
  }
  const result = spawnSync('lsof', ['-ti', `tcp:${port}`]);
  return result.stdout.toString().trim().length > 0;
}

function waitForPort(port, attempt = 0) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      if (isPortListening(port)) {
        resolve();
        return;
      }
      if (n > 120) {
        reject(new Error(`Timed out waiting for port ${port}.`));
        return;
      }
      setTimeout(() => check(n + 1), 1000);
    };
    check(attempt);
  });
}

async function ensureLocalServer(port) {
  if (isPortListening(port)) {
    log(`Local server already running on port ${port}.`);
    return;
  }

  log('Local server not running — starting "npm run serve:https"...');
  const out = fs.openSync(SERVER_LOG_FILE, 'w');
  // On Windows, "start /B" detaches the process from the console and makes it
  // ignore Ctrl+C, so it isn't taken down by signals sent to whatever console
  // launched this script (unlike a plain shell:true spawn of npm.cmd).
  const child = isWindows
    ? spawn('cmd.exe', ['/c', 'start', '/B', 'npm', 'run', 'serve:https'], {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: ['ignore', out, out],
      })
    : spawn('npm', ['run', 'serve:https'], {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: ['ignore', out, out],
      });
  child.unref();

  log('Waiting for local server to be ready (this may take a while during build)...');
  await waitForPort(port);
  log(`Local server is up on port ${port}.`);
}

function killPort(port) {
  if (isWindows) {
    const result = spawnSync('netstat', ['-ano']);
    const pids = new Set();
    for (const line of result.stdout.toString().split('\n')) {
      const match = line.match(new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`));
      if (match) pids.add(match[1]);
    }
    if (pids.size === 0) {
      log(`No process found listening on port ${port}.`);
      return;
    }
    for (const pid of pids) {
      spawnSync('taskkill', ['/PID', pid, '/T', '/F']);
      log(`Killed process on port ${port} (PID ${pid}).`);
    }
  } else {
    const result = spawnSync('lsof', ['-ti', `tcp:${port}`]);
    const pids = result.stdout.toString().split('\n').filter(Boolean);
    if (pids.length === 0) {
      log(`No process found listening on port ${port}.`);
      return;
    }
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM');
        log(`Killed process on port ${port} (PID ${pid}).`);
      } catch (err) {
        log(`Could not kill PID ${pid}: ${err.message}`);
      }
    }
  }
}

function releaseAssetUrl() {
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
  if (process.platform === 'win32') return `${base}cloudflared-windows-amd64.exe`;
  if (process.platform === 'darwin') {
    return base + (process.arch === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz');
  }
  return base + (process.arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64');
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = (currentUrl) => {
      https
        .get(currentUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            request(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
        })
        .on('error', reject);
    };
    request(url);
  });
}

async function ensureInstalled() {
  if (fs.existsSync(binaryPath)) return;

  log('cloudflared not found — downloading...');
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const assetUrl = releaseAssetUrl();
  const isArchive = assetUrl.endsWith('.tgz');
  const downloadPath = isArchive ? path.join(BIN_DIR, 'cloudflared.tgz') : binaryPath;

  await download(assetUrl, downloadPath);

  if (isArchive) {
    spawnSync('tar', ['-xzf', downloadPath, '-C', BIN_DIR], { stdio: 'inherit' });
    fs.unlinkSync(downloadPath);
  }
  if (!isWindows) {
    fs.chmodSync(binaryPath, 0o755);
  }
  log(`Installed cloudflared at ${binaryPath}`);
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForUrl(attempt = 0) {
  if (attempt > 40) {
    log(`Tunnel started but no URL detected yet — check ${LOG_FILE}.`);
    return;
  }
  const text = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '';
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match) {
    fs.writeFileSync(URL_FILE, match[0]);
    log(`Tunnel ready: ${match[0]}`);
    return;
  }
  setTimeout(() => waitForUrl(attempt + 1), 500);
}

async function start() {
  await ensureInstalled();

  if (fs.existsSync(PID_FILE)) {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (isRunning(pid)) {
      log(`Tunnel already running (PID ${pid}).`);
      if (fs.existsSync(URL_FILE)) log(`URL: ${fs.readFileSync(URL_FILE, 'utf8').trim()}`);
      return;
    }
    fs.unlinkSync(PID_FILE);
  }

  try {
    await ensureLocalServer(TARGET_PORT);
  } catch (err) {
    log(`Could not start local server: ${err.message} — check ${SERVER_LOG_FILE}.`);
    return;
  }

  log(`Starting tunnel to ${TARGET_URL}...`);
  if (fs.existsSync(URL_FILE)) fs.unlinkSync(URL_FILE);
  const out = fs.openSync(LOG_FILE, 'w');
  const child = spawn(binaryPath, ['tunnel', '--url', TARGET_URL, '--no-tls-verify'], {
    detached: true,
    stdio: ['ignore', out, out],
  });
  fs.writeFileSync(PID_FILE, String(child.pid));
  child.unref();

  log(`Tunnel process started (PID ${child.pid}). Waiting for public URL...`);
  waitForUrl();
}

function stop() {
  if (!fs.existsSync(PID_FILE)) {
    log('No tunnel is running (no PID file).');
  } else {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    try {
      if (isWindows) {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
      } else {
        process.kill(pid, 'SIGTERM');
      }
      log(`Stopped tunnel (PID ${pid}).`);
    } catch (err) {
      log(`Could not stop PID ${pid}: ${err.message}`);
    }

    fs.unlinkSync(PID_FILE);
    if (fs.existsSync(URL_FILE)) fs.unlinkSync(URL_FILE);
  }

  killPort(TARGET_PORT);
}

function status() {
  if (!fs.existsSync(PID_FILE)) {
    log('Tunnel is not running.');
    return;
  }

  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  if (isRunning(pid)) {
    log(`Tunnel running (PID ${pid}).`);
    if (fs.existsSync(URL_FILE)) log(`URL: ${fs.readFileSync(URL_FILE, 'utf8').trim()}`);
    else log('URL not detected yet — check the log file.');
  } else {
    log('Tunnel is not running (stale PID file removed).');
    fs.unlinkSync(PID_FILE);
  }
}

const command = process.argv[2];
if (command === 'start') start();
else if (command === 'stop') stop();
else if (command === 'status') status();
else {
  console.log('Usage: node local-server/scripts/tunnel.js <start|stop|status>');
  process.exit(1);
}
