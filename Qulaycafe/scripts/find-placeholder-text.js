#!/usr/bin/env node
/**
 * Read-only search for placeholder text anywhere in the SQLite database.
 *
 * Receipts and order cards print stored values verbatim (the restaurant name,
 * dish names, guest-entered notes), so text that "appears from nowhere" in the
 * UI is almost always a row in this database rather than a string in the code.
 * This scans every table — including the JSON `data` columns — and reports the
 * table plus a snippet around each match, so the record can be corrected
 * instead of hunted for in the source.
 *
 * Pairs with scripts/purge-placeholder-text.js, which cleans what this finds.
 * Both read their phrases from scripts/placeholder-patterns.js, so a clean
 * database reports clean in both.
 *
 * Usage:
 *   node scripts/find-placeholder-text.js
 *   node scripts/find-placeholder-text.js --db /path/to/restaurant.db
 *   node scripts/find-placeholder-text.js "Moliya vazirligi" "Markaziy Bank"
 *
 * Exits 1 when something matches (usable from cron/CI), 0 when clean, 2 when
 * the database file is missing. It never writes to the database.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { placeholderMatchers } from './placeholder-patterns.js';

const args = process.argv.slice(2);
const dbFlag = args.indexOf('--db');
const dbPath =
  dbFlag !== -1
    ? args[dbFlag + 1]
    : process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'restaurant.db');
const customPhrases = (dbFlag === -1 ? args : [...args.slice(0, dbFlag), ...args.slice(dbFlag + 2)]).filter(
  arg => !arg.startsWith('--')
);

// The regexes are stateful, so every value gets its own lastIndex reset below.
const matchers = placeholderMatchers(customPhrases);

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Pass --db <path> or set DATABASE_PATH.`);
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true });

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map(row => row.name);

let hits = 0;

for (const table of tables) {
  let rows;
  try {
    rows = db.prepare(`SELECT * FROM "${table}"`).all();
  } catch {
    continue; // virtual/FTS tables and the like — nothing to search
  }

  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
      if (!text) continue;

      for (const { label, re } of matchers) {
        re.lastIndex = 0;
        const match = re.exec(text);
        if (!match) continue;

        hits++;
        const from = Math.max(0, match.index - 60);
        const snippet = text.slice(from, match.index + match[0].length + 60);
        console.log(`\n${table}.${column}  —  ${label}`);
        console.log(`  ${from > 0 ? '…' : ''}${snippet}${match.index + match[0].length + 60 < text.length ? '…' : ''}`);
      }
    }
  }
}

db.close();

if (hits) {
  console.log(`\n${hits} match(es) in ${dbPath}.`);
  console.log('Clean them with:  node scripts/purge-placeholder-text.js --apply');
  process.exit(1);
}

console.log(`Clean: no placeholder text found in ${dbPath} (${tables.length} table(s) scanned).`);
