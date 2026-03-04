/**
 * ╔══════════════════════════════════════════════════════╗
 * ║         Photo→PDF  —  Database Initializer           ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Run this ONCE before starting the server for the first time.
 * Generates:
 *   - config.json        (server settings + admin secret)
 *   - license_db.json    (50 license keys + 100 device slots)
 *   - LICENSE_KEYS.txt   (human-readable key list for you to keep)
 *
 * USAGE:
 *   node scripts/init.js
 *
 * OPTIONS:
 *   --licenses=N    Number of license keys to generate (default: 50)
 *   --devices=N     Number of device slots to generate (default: 100)
 *   --port=N        Server port (default: 3000)
 *   --force         Overwrite existing files
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ── Parse CLI args ─────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace('--', '').split('=');
    return [k, v ?? true];
  })
);

const NUM_LICENSES = parseInt(args.licenses) || 50;
const NUM_DEVICES  = parseInt(args.devices)  || 100;
const PORT         = parseInt(args.port)     || 3000;
const FORCE        = !!args.force;

const ROOT        = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const DB_FILE     = path.join(ROOT, 'license_db.json');
const KEYS_FILE   = path.join(ROOT, 'LICENSE_KEYS.txt');

// ── Guard against accidental overwrite ─────────────────
if (!FORCE && (fs.existsSync(CONFIG_FILE) || fs.existsSync(DB_FILE))) {
  console.error('\n  [ERROR] config.json or license_db.json already exists.');
  console.error('  Use --force to overwrite.\n');
  process.exit(1);
}

// ── Key generators ──────────────────────────────────────
function generateLicenseKey() {
  const parts = Array.from({ length: 4 }, () =>
    crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5)
  );
  return parts.join('-');
}

function generateDeviceSlot(index) {
  const num   = String(index + 1).padStart(3, '0');
  const parts = Array.from({ length: 3 }, () =>
    crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5)
  );
  return `DEV${num}-${parts.join('-')}`;
}

// ── Generate keys ───────────────────────────────────────
console.log('\n  Photo→PDF — Initializing...\n');

const adminSecret = crypto.randomBytes(32).toString('hex');

const licenseKeys = Array.from({ length: NUM_LICENSES }, generateLicenseKey);
const deviceSlots = Array.from({ length: NUM_DEVICES  }, (_, i) => generateDeviceSlot(i));

// ── Build config ────────────────────────────────────────
const config = {
  port: PORT,
  adminSecret,
  allowedOrigin: '*',
  _note: "Change allowedOrigin to your domain in production e.g. https://yourdomain.com",
};

// ── Build DB ────────────────────────────────────────────
const db = { licenses: {}, devices: {} };
licenseKeys.forEach(k => { db.licenses[k] = { used: false, boundTo: null, activatedAt: null }; });
deviceSlots.forEach(k => { db.devices[k]  = { bound: false, fingerprint: null, activatedAt: null }; });

// ── Write files ─────────────────────────────────────────
fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
console.log(`  ✓ config.json written`);

fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
console.log(`  ✓ license_db.json written`);

// ── Write human-readable key list ───────────────────────
const divider = '─'.repeat(62);
let txt = '';
txt += `╔${'═'.repeat(62)}╗\n`;
txt += `║         PHOTO → PDF  —  LICENSE KEYS MASTER LIST            ║\n`;
txt += `║                  !! KEEP THIS FILE SECURE !!                 ║\n`;
txt += `╚${'═'.repeat(62)}╝\n\n`;
txt += `Generated : ${new Date().toISOString()}\n`;
txt += `Admin Secret : ${adminSecret}\n`;
txt += `  (Required for /api/admin/* endpoints — never share publicly)\n\n`;

txt += `${divider}\n`;
txt += `  ${NUM_LICENSES} ONE-TIME LICENSE KEYS\n`;
txt += `  Each key activates on ONE machine only, permanently.\n`;
txt += `${divider}\n\n`;
licenseKeys.forEach((k, i) => {
  txt += `  ${String(i + 1).padStart(3, ' ')}  ${k}\n`;
});

txt += `\n${divider}\n`;
txt += `  ${NUM_DEVICES} DEVICE SLOT IDs\n`;
txt += `  Assign one slot per machine you manage directly.\n`;
txt += `${divider}\n\n`;
deviceSlots.forEach((k, i) => {
  txt += `  ${String(i + 1).padStart(3, ' ')}  ${k}\n`;
});

fs.writeFileSync(KEYS_FILE, txt, 'utf8');
console.log(`  ✓ LICENSE_KEYS.txt written`);

// ── Summary ─────────────────────────────────────────────
console.log(`\n  ${divider}`);
console.log(`  License keys  : ${NUM_LICENSES}`);
console.log(`  Device slots  : ${NUM_DEVICES}`);
console.log(`  Server port   : ${PORT}`);
console.log(`  Admin secret  : ${adminSecret}`);
console.log(`  ${divider}`);
console.log(`\n  Next step: node server.js\n`);
