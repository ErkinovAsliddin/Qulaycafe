#!/usr/bin/env node
/**
 * Answers "why can't I print?" in one command.
 *
 * Thermal printing has four independent requirements, and a failure in any one
 * of them looks identical from the dashboard — a button that does nothing, or no
 * button at all. This checks the first three from the machine that actually does
 * the printing, because that is the machine whose network access matters (the
 * phone is only the remote control):
 *
 *   1. the restaurant exists and has printer settings saved
 *   2. THIS machine can open a TCP connection to the printer on its port
 *   3. an order exists to print
 *
 * It only reads, and never prints anything.
 *
 * Usage:
 *   node scripts/diagnose-printer.js
 *   node scripts/diagnose-printer.js --db /path/to/restaurant.db
 *   node scripts/diagnose-printer.js --ip 192.168.1.50 --port 9100
 */

import fs from 'fs';
import path from 'path';
import net from 'net';
import Database from 'better-sqlite3';

const args = process.argv.slice(2);
const flag = name => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
};

const dbPath = flag('--db') || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'restaurant.db');
const ipOverride = flag('--ip');
const portOverride = flag('--port') ? Number(flag('--port')) : null;

const ok = message => console.log(`  OK    ${message}`);
const bad = message => console.log(`  FAIL  ${message}`);
const note = message => console.log(`        ${message}`);

if (!fs.existsSync(dbPath)) {
  bad(`no database at ${dbPath}`);
  note('Pass --db <path> or set DATABASE_PATH.');
  process.exit(2);
}

console.log(`database: ${dbPath}\n`);

const db = new Database(dbPath, { readonly: true });

// --- 1. is there a restaurant with printer settings? ------------------------
console.log('1. restaurant + printer settings');

const restaurants = db.prepare('SELECT id, name FROM restaurants').all();
if (!restaurants.length) {
  bad('no restaurant in this database');
  note('This is the wrong database, or the app was never registered.');
  note('Check DATABASE_DIR / DATABASE_PATH on the running server.');
} else {
  ok(`${restaurants.length} restaurant(s): ${restaurants.map(r => `${r.id}=${JSON.stringify(r.name)}`).join(', ')}`);
}

const settingsFor = restaurantId => {
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE restaurant_id = ? AND key IN ('printerIp','printerPort','printerConnectionType')")
    .all(restaurantId);
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
};

const targets = [];

for (const restaurant of restaurants) {
  const settings = settingsFor(restaurant.id);
  const connectionType = settings.printerConnectionType || 'network';
  const ip = ipOverride || settings.printerIp;
  const port = portOverride || Number(settings.printerPort) || 9100;

  if (connectionType === 'usb') {
    console.log(`  ${restaurant.id}: connection type = USB`);
    note('WebUSB prints from the BROWSER, not the server. It needs Chrome or Edge');
    note('on https:// or localhost — it cannot work on a phone over plain http://LAN-IP.');
    note("Use the LAN mode, or the browser-print '\u{1F9FE} Chek' button instead.");
    continue;
  }

  if (!settings.printerIp && !ipOverride) {
    bad(`${restaurant.id}: NO printer IP saved`);
    note("The server refuses with: \"Printer IP manzili sozlanmagan. Avval Sozlamalar bo'limida kiriting.\"");
    note('Save it in the admin dashboard: Settings -> printer -> LAN / Wi-Fi.');
    continue;
  }

  ok(`${restaurant.id}: printerIp=${ip} port=${port}`);
  targets.push({ restaurantId: restaurant.id, ip, port });
}

// --- 2. can THIS machine reach the printer? --------------------------------
console.log('\n2. network reachability (from THIS machine — the one running the server)');
note('This is the machine that opens the printer connection. The phone does not.');

if (!targets.length) {
  note('nothing to test.');
} else {
  for (const target of targets) {
    await new Promise(resolve => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        bad(`${target.restaurantId}: ${target.ip}:${target.port} — timed out after 3s`);
        note('Printer off, wrong IP, or this machine is on a different network/VLAN.');
        resolve();
      }, 3000);

      socket.connect(target.port, target.ip, () => {
        clearTimeout(timer);
        socket.destroy();
        ok(`${target.restaurantId}: ${target.ip}:${target.port} is reachable`);
        resolve();
      });

      socket.on('error', err => {
        clearTimeout(timer);
        socket.destroy();
        bad(`${target.restaurantId}: ${target.ip}:${target.port} — ${err.code || err.message}`);
        if (err.code === 'ECONNREFUSED') note('Host answered but nothing listens on that port — wrong port, or not a raw/JetDirect printer.');
        if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') note('No route to that address — different network, or wrong IP.');
        resolve();
      });
    });
  }
}

// --- 3. is there anything to print? ----------------------------------------
console.log('\n3. orders to print');
const orderCount = db.prepare('SELECT count(*) AS n FROM orders').get().n;
if (orderCount === 0) {
  bad('no orders in this database');
  note('Nothing to print — this is probably the wrong database.');
} else {
  const latest = db
    .prepare('SELECT id, data, created_at FROM orders ORDER BY created_at DESC LIMIT 1')
    .get();
  ok(`${orderCount} order(s); latest ${latest.id}`);
  try {
    const parsed = JSON.parse(latest.data);
    note(`table=${parsed.tableNumber} type=${parsed.orderType || 'dine_in'} total=${parsed.totalAmount} payment=${parsed.paymentMethod || '(unset)'}`);
  } catch {
    note('latest order data is not readable JSON');
  }
}

db.close();

// --- the part the database cannot answer -----------------------------------
console.log('\n4. the dashboard URL (this is the usual cause of "no print button")');
note('The admin UI and the guest menu are different surfaces, chosen by hostname.');
note('A LAN IP such as http://192.168.1.50:6000 resolves to the GUEST MENU,');
note('which has no print button at all. The admin surface needs one of:');
note('  * the admin hostname          https://admin.<your-domain>');
note('  * a .local name + override    http://<host>.local:6000/?surface=admin');
note('  * VITE_ALLOW_SURFACE_OVERRIDE=true (or VITE_ADMIN_HOSTS=<ip>) then rebuild');
console.log('\nDone. Nothing was printed and nothing was changed.');
