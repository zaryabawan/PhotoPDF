/**
 * ╔══════════════════════════════════════════════════════╗
 * ║         Photo→PDF  —  Admin CLI Tool                 ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Manage licenses directly from the command line.
 * Must be run from the server/ directory.
 *
 * USAGE:
 *   node scripts/admin.js <command> [options]
 *
 * COMMANDS:
 *   status                      Show full summary
 *   list-used                   Show all activated keys
 *   list-free                   Show all unused keys
 *   revoke   --key=XXXXX-...    Reset a key so it can be reused
 *   inspect  --key=XXXXX-...    Show details for a specific key
 *   backup                      Backup license_db.json with timestamp
 *   generate --licenses=N       Generate additional license keys
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ROOT    = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'license_db.json');

// ── Helpers ─────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    console.error('  [ERROR] license_db.json not found. Run: node scripts/init.js');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function normalise(k) {
  return String(k || '').trim().toUpperCase();
}

function parseArgs() {
  const result = {};
  process.argv.slice(3).forEach(a => {
    const [k, v] = a.replace('--', '').split('=');
    result[k] = v ?? true;
  });
  return result;
}

const divider = '─'.repeat(60);

// ── Commands ─────────────────────────────────────────────
const commands = {

  status() {
    const db = loadDB();
    const licEntries = Object.entries(db.licenses);
    const devEntries = Object.entries(db.devices);
    const usedLic  = licEntries.filter(([, v]) => v.used).length;
    const boundDev = devEntries.filter(([, v]) => v.bound).length;

    console.log(`\n  Photo→PDF — License Status`);
    console.log(`  ${divider}`);
    console.log(`  LICENSE KEYS`);
    console.log(`    Total : ${licEntries.length}`);
    console.log(`    Used  : ${usedLic}`);
    console.log(`    Free  : ${licEntries.length - usedLic}`);
    console.log(`\n  DEVICE SLOTS`);
    console.log(`    Total : ${devEntries.length}`);
    console.log(`    Bound : ${boundDev}`);
    console.log(`    Free  : ${devEntries.length - boundDev}`);
    console.log(`  ${divider}\n`);
  },

  'list-used'() {
    const db = loadDB();
    const used = Object.entries(db.licenses).filter(([, v]) => v.used);
    const boundDevs = Object.entries(db.devices).filter(([, v]) => v.bound);

    console.log(`\n  ACTIVATED LICENSE KEYS (${used.length})`);
    console.log(`  ${divider}`);
    if (used.length === 0) {
      console.log('  None activated yet.');
    } else {
      used.forEach(([key, val]) => {
        console.log(`  KEY  : ${key}`);
        console.log(`  HW   : ${val.boundTo ? val.boundTo.slice(0, 20) + '…' : 'N/A'}`);
        console.log(`  DATE : ${val.activatedAt || 'N/A'}`);
        console.log(`  ${divider}`);
      });
    }

    console.log(`\n  BOUND DEVICE SLOTS (${boundDevs.length})`);
    console.log(`  ${divider}`);
    if (boundDevs.length === 0) {
      console.log('  None bound yet.');
    } else {
      boundDevs.forEach(([key, val]) => {
        console.log(`  SLOT : ${key}`);
        console.log(`  HW   : ${val.fingerprint ? val.fingerprint.slice(0, 20) + '…' : 'N/A'}`);
        console.log(`  DATE : ${val.activatedAt || 'N/A'}`);
        console.log(`  ${divider}`);
      });
    }
    console.log('');
  },

  'list-free'() {
    const db = loadDB();
    const free    = Object.keys(db.licenses).filter(k => !db.licenses[k].used);
    const freeDevs = Object.keys(db.devices).filter(k => !db.devices[k].bound);

    console.log(`\n  FREE LICENSE KEYS (${free.length})`);
    console.log(`  ${divider}`);
    free.forEach((k, i) => console.log(`  ${String(i + 1).padStart(3)}  ${k}`));

    console.log(`\n  FREE DEVICE SLOTS (${freeDevs.length})`);
    console.log(`  ${divider}`);
    freeDevs.forEach((k, i) => console.log(`  ${String(i + 1).padStart(3)}  ${k}`));
    console.log('');
  },

  revoke() {
    const args = parseArgs();
    const k    = normalise(args.key);
    if (!k) { console.error('\n  Usage: node scripts/admin.js revoke --key=XXXXX-XXXXX-XXXXX-XXXXX\n'); process.exit(1); }

    const db = loadDB();

    if (db.licenses[k]) {
      const was = db.licenses[k].boundTo;
      db.licenses[k] = { used: false, boundTo: null, activatedAt: null };
      saveDB(db);
      console.log(`\n  ✓ License ${k} has been reset.`);
      console.log(`    Was bound to: ${was ? was.slice(0, 20) + '…' : 'N/A'}\n`);
      return;
    }

    if (db.devices[k]) {
      const was = db.devices[k].fingerprint;
      db.devices[k] = { bound: false, fingerprint: null, activatedAt: null };
      saveDB(db);
      console.log(`\n  ✓ Device slot ${k} has been unbound.`);
      console.log(`    Was bound to: ${was ? was.slice(0, 20) + '…' : 'N/A'}\n`);
      return;
    }

    console.error(`\n  [ERROR] Key not found: ${k}\n`);
    process.exit(1);
  },

  inspect() {
    const args = parseArgs();
    const k    = normalise(args.key);
    if (!k) { console.error('\n  Usage: node scripts/admin.js inspect --key=XXXXX-XXXXX-XXXXX-XXXXX\n'); process.exit(1); }

    const db  = loadDB();
    const lic  = db.licenses[k];
    const slot = db.devices[k];
    const entry = lic || slot;

    if (!entry) { console.error(`\n  [ERROR] Key not found: ${k}\n`); process.exit(1); }

    console.log(`\n  KEY    : ${k}`);
    console.log(`  TYPE   : ${lic ? 'License Key' : 'Device Slot'}`);
    if (lic) {
      console.log(`  STATUS : ${lic.used ? '🔴 USED' : '🟢 FREE'}`);
      console.log(`  BOUND  : ${lic.boundTo ? lic.boundTo.slice(0, 32) + '…' : 'N/A'}`);
      console.log(`  DATE   : ${lic.activatedAt || 'N/A'}`);
    } else {
      console.log(`  STATUS : ${slot.bound ? '🔴 BOUND' : '🟢 FREE'}`);
      console.log(`  FINGERPRINT : ${slot.fingerprint ? slot.fingerprint.slice(0, 32) + '…' : 'N/A'}`);
      console.log(`  DATE   : ${slot.activatedAt || 'N/A'}`);
    }
    console.log('');
  },

  backup() {
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(ROOT, `license_db_backup_${ts}.json`);
    fs.copyFileSync(DB_FILE, dest);
    console.log(`\n  ✓ Backup saved to: ${dest}\n`);
  },

  generate() {
    const args = parseArgs();
    const n    = parseInt(args.licenses) || 10;

    const db = loadDB();
    const newKeys = [];

    for (let i = 0; i < n; i++) {
      let key;
      do {
        const parts = Array.from({ length: 4 }, () =>
          crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5)
        );
        key = parts.join('-');
      } while (db.licenses[key]); // ensure unique

      db.licenses[key] = { used: false, boundTo: null, activatedAt: null };
      newKeys.push(key);
    }

    saveDB(db);
    console.log(`\n  ✓ Generated ${n} new license keys:`);
    console.log(`  ${divider}`);
    newKeys.forEach((k, i) => console.log(`  ${String(i + 1).padStart(3)}  ${k}`));
    console.log('');
  },

  help() {
    console.log(`
  Photo→PDF Admin CLI
  ${divider}
  node scripts/admin.js status
  node scripts/admin.js list-used
  node scripts/admin.js list-free
  node scripts/admin.js revoke   --key=XXXXX-XXXXX-XXXXX-XXXXX
  node scripts/admin.js inspect  --key=XXXXX-XXXXX-XXXXX-XXXXX
  node scripts/admin.js backup
  node scripts/admin.js generate --licenses=10
  ${divider}
`);
  },
};

// ── Entry point ──────────────────────────────────────────
const command = process.argv[2];

if (!command || !commands[command]) {
  commands.help();
  if (command) {
    console.error(`  [ERROR] Unknown command: ${command}\n`);
    process.exit(1);
  }
} else {
  commands[command]();
}
