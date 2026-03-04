/**
 * ╔══════════════════════════════════════════════════════╗
 * ║         Photo→PDF  —  License Validation Server      ║
 * ║                     v1.0.0                           ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Zero-dependency Node.js license server.
 * Uses only Node built-ins — no npm install needed.
 *
 * USAGE:
 *   node server.js
 *
 * ENVIRONMENT VARIABLES:
 *   PORT          Server port (default: 3000)
 *   ADMIN_SECRET  Admin API secret (default: read from config.json)
 *
 * ENDPOINTS:
 *   POST /api/activate          Activate a key on a device
 *   POST /api/verify            Verify a stored session token
 *   GET  /api/admin/status      View all key states (admin)
 *   POST /api/admin/revoke      Revoke / reset a key (admin)
 *   GET  /api/health            Health check (public)
 */

'use strict';

const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ─────────────────────────────────────────────────────────
//  Bootstrap — load config and database
// ─────────────────────────────────────────────────────────
const ROOT       = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');
const DB_FILE     = path.join(ROOT, 'license_db.json');

if (!fs.existsSync(CONFIG_FILE)) {
  console.error('\n  [ERROR] config.json not found.');
  console.error('  Run:  node scripts/init.js  to generate it.\n');
  process.exit(1);
}

if (!fs.existsSync(DB_FILE)) {
  console.error('\n  [ERROR] license_db.json not found.');
  console.error('  Run:  node scripts/init.js  to generate it.\n');
  process.exit(1);
}

const CONFIG       = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const PORT         = process.env.PORT || CONFIG.port || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || CONFIG.adminSecret;

if (!ADMIN_SECRET) {
  console.error('\n  [ERROR] No adminSecret found in config.json.\n');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────
//  Database helpers (atomic JSON file reads/writes)
// ─────────────────────────────────────────────────────────
function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

// ─────────────────────────────────────────────────────────
//  HTTP helpers
// ─────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', CONFIG.allowedOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret');
}

function respond(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 16384) reject(new Error('Request body too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function normalise(k) {
  return String(k || '').trim().toUpperCase();
}

// ─────────────────────────────────────────────────────────
//  Token signing (HMAC-SHA256, base64 encoded)
// ─────────────────────────────────────────────────────────
function issueToken(key, fingerprint) {
  const payload = `${key}:${fingerprint}:${Date.now()}`;
  const sig = crypto
    .createHmac('sha256', ADMIN_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

function verifyToken(token, key, fingerprint) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts   = decoded.split(':');
    const sig     = parts.pop();
    const payload = parts.join(':');
    const expected = crypto
      .createHmac('sha256', ADMIN_SECRET)
      .update(payload)
      .digest('hex');
    return sig === expected && payload.startsWith(`${key}:${fingerprint}:`);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────
//  Route: POST /api/activate
// ─────────────────────────────────────────────────────────
async function handleActivate(req, res) {
  const { key, fingerprint } = await readBody(req);
  const k  = normalise(key);
  const fp = normalise(fingerprint);

  if (!k || !fp) {
    return respond(res, 400, { ok: false, error: 'Missing key or fingerprint.' });
  }

  const db = loadDB();

  // ── Device Slot (DEVxxx-...) ──────────────────────────
  if (db.devices[k] !== undefined) {
    const slot = db.devices[k];

    if (slot.bound) {
      if (slot.fingerprint === fp) {
        // Same machine re-activating (e.g. cleared localStorage)
        log(`[RE-ACTIVATE] Device slot ${k} → same machine`);
        return respond(res, 200, {
          ok: true,
          token: issueToken(k, fp),
          mode: 'device',
        });
      }
      // Different machine — blocked
      log(`[BLOCKED] Device slot ${k} → fingerprint mismatch`);
      return respond(res, 403, {
        ok: false,
        error: 'This device slot is already registered to a different machine.',
      });
    }

    // First activation — bind permanently
    slot.bound       = true;
    slot.fingerprint = fp;
    slot.activatedAt = new Date().toISOString();
    saveDB(db);
    log(`[ACTIVATE] Device slot ${k} → ${fp.slice(0, 16)}… at ${slot.activatedAt}`);
    return respond(res, 200, {
      ok: true,
      token: issueToken(k, fp),
      mode: 'device',
      firstActivation: true,
    });
  }

  // ── License Key (XXXXX-...) ───────────────────────────
  if (db.licenses[k] !== undefined) {
    const lic = db.licenses[k];

    if (lic.used) {
      if (lic.boundTo === fp) {
        // Same machine re-activating
        log(`[RE-ACTIVATE] License ${k} → same machine`);
        return respond(res, 200, {
          ok: true,
          token: issueToken(k, fp),
          mode: 'license',
        });
      }
      // Already used on a different machine — blocked
      log(`[BLOCKED] License ${k} → already bound to different machine`);
      return respond(res, 403, {
        ok: false,
        error: 'This license key has already been used on another machine.',
      });
    }

    // First use — consume and bind permanently
    lic.used        = true;
    lic.boundTo     = fp;
    lic.activatedAt = new Date().toISOString();
    saveDB(db);
    log(`[ACTIVATE] License ${k} → ${fp.slice(0, 16)}… at ${lic.activatedAt}`);
    return respond(res, 200, {
      ok: true,
      token: issueToken(k, fp),
      mode: 'license',
      firstActivation: true,
    });
  }

  // Key not found at all
  log(`[INVALID] Unknown key attempted: ${k}`);
  return respond(res, 404, {
    ok: false,
    error: 'Invalid key. Please check and try again.',
  });
}

// ─────────────────────────────────────────────────────────
//  Route: POST /api/verify
// ─────────────────────────────────────────────────────────
async function handleVerify(req, res) {
  const { key, fingerprint, token } = await readBody(req);
  const k  = normalise(key);
  const fp = normalise(fingerprint);

  if (!k || !fp || !token) {
    return respond(res, 400, { ok: false, error: 'Missing fields.' });
  }

  if (!verifyToken(token, k, fp)) {
    log(`[TAMPER] Token verification failed for key ${k}`);
    return respond(res, 401, { ok: false, error: 'Invalid or tampered session.' });
  }

  const db  = loadDB();
  const lic  = db.licenses[k];
  const slot = db.devices[k];

  if (lic) {
    if (!lic.used || lic.boundTo !== fp) {
      return respond(res, 403, { ok: false, error: 'License revoked or bound to different machine.' });
    }
    return respond(res, 200, { ok: true });
  }

  if (slot) {
    if (!slot.bound || slot.fingerprint !== fp) {
      return respond(res, 403, { ok: false, error: 'Device slot revoked or bound to different machine.' });
    }
    return respond(res, 200, { ok: true });
  }

  return respond(res, 404, { ok: false, error: 'Key not found.' });
}

// ─────────────────────────────────────────────────────────
//  Route: GET /api/admin/status
// ─────────────────────────────────────────────────────────
async function handleAdminStatus(req, res) {
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return respond(res, 403, { ok: false, error: 'Forbidden.' });
  }

  const db = loadDB();
  const licenses = Object.entries(db.licenses);
  const devices  = Object.entries(db.devices);

  const usedLicenses = licenses.filter(([, v]) => v.used).length;
  const boundDevices = devices.filter(([, v]) => v.bound).length;

  return respond(res, 200, {
    ok: true,
    summary: {
      licenses: {
        total: licenses.length,
        used:  usedLicenses,
        free:  licenses.length - usedLicenses,
      },
      devices: {
        total: devices.length,
        bound: boundDevices,
        free:  devices.length - boundDevices,
      },
    },
    licenses: db.licenses,
    devices:  db.devices,
  });
}

// ─────────────────────────────────────────────────────────
//  Route: POST /api/admin/revoke
// ─────────────────────────────────────────────────────────
async function handleAdminRevoke(req, res) {
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return respond(res, 403, { ok: false, error: 'Forbidden.' });
  }

  const { key } = await readBody(req);
  const k = normalise(key);
  const db = loadDB();

  if (db.licenses[k]) {
    const was = db.licenses[k].boundTo;
    db.licenses[k] = { used: false, boundTo: null, activatedAt: null };
    saveDB(db);
    log(`[REVOKE] License ${k} unbound (was: ${(was || 'unbound').slice(0, 16)}…)`);
    return respond(res, 200, { ok: true, message: `License ${k} has been reset and can be re-used.` });
  }

  if (db.devices[k]) {
    const was = db.devices[k].fingerprint;
    db.devices[k] = { bound: false, fingerprint: null, activatedAt: null };
    saveDB(db);
    log(`[REVOKE] Device slot ${k} unbound (was: ${(was || 'unbound').slice(0, 16)}…)`);
    return respond(res, 200, { ok: true, message: `Device slot ${k} has been unbound and can be re-used.` });
  }

  return respond(res, 404, { ok: false, error: 'Key not found.' });
}

// ─────────────────────────────────────────────────────────
//  Route: GET /api/health
// ─────────────────────────────────────────────────────────
function handleHealth(res) {
  const db = loadDB();
  const usedLicenses = Object.values(db.licenses).filter(v => v.used).length;
  return respond(res, 200, {
    ok: true,
    status: 'running',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()) + 's',
    licenses: {
      used: usedLicenses,
      total: Object.keys(db.licenses).length,
    },
  });
}

// ─────────────────────────────────────────────────────────
//  Logger
// ─────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  const line = `${ts}  ${msg}`;
  console.log(line);

  // Append to log file
  const logFile = path.join(ROOT, 'server.log');
  fs.appendFileSync(logFile, line + '\n', 'utf8');
}

// ─────────────────────────────────────────────────────────
//  HTTP server
// ─────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = req.url.split('?')[0];

  try {
    if (req.method === 'POST' && url === '/api/activate')     return await handleActivate(req, res);
    if (req.method === 'POST' && url === '/api/verify')       return await handleVerify(req, res);
    if (req.method === 'GET'  && url === '/api/admin/status') return await handleAdminStatus(req, res);
    if (req.method === 'POST' && url === '/api/admin/revoke') return await handleAdminRevoke(req, res);
    if (req.method === 'GET'  && url === '/api/health')       return handleHealth(res);

    return respond(res, 404, { ok: false, error: 'Endpoint not found.' });
  } catch (err) {
    log(`[ERROR] ${err.message}`);
    return respond(res, 500, { ok: false, error: 'Internal server error.' });
  }
});

server.listen(PORT, () => {
  const divider = '─'.repeat(50);
  console.log(`\n  Photo→PDF License Server  v1.0.0`);
  console.log(`  ${divider}`);
  console.log(`  Port         : ${PORT}`);
  console.log(`  DB file      : ${DB_FILE}`);
  console.log(`  Admin secret : ${ADMIN_SECRET}`);
  console.log(`  ${divider}`);
  console.log(`  Endpoints:`);
  console.log(`    POST http://localhost:${PORT}/api/activate`);
  console.log(`    POST http://localhost:${PORT}/api/verify`);
  console.log(`    GET  http://localhost:${PORT}/api/health`);
  console.log(`    GET  http://localhost:${PORT}/api/admin/status  [admin]`);
  console.log(`    POST http://localhost:${PORT}/api/admin/revoke  [admin]`);
  console.log(`  ${divider}\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  [ERROR] Port ${PORT} is already in use.`);
    console.error(`  Change the port in config.json or set the PORT env variable.\n`);
  } else {
    console.error(`\n  [ERROR] ${err.message}\n`);
  }
  process.exit(1);
});
