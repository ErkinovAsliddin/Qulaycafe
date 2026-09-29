#!/usr/bin/env node
/**
 * Search-and-purge for placeholder / official-document text stored in the
 * database.
 *
 * Receipts and order cards render stored values verbatim, so text that shows up
 * "from nowhere" on a printed check is a row, not a string in the code. This
 * walks every table and every column — including the JSON `data` blobs, nested
 * arrays and all — finds the phrases, and removes them.
 *
 * Dry-run by default; only --apply writes, and it takes a consistent backup
 * first.
 *
 * Usage:
 *   node scripts/purge-placeholder-text.js                       # report only
 *   node scripts/purge-placeholder-text.js --db data/restaurant.db
 *   node scripts/purge-placeholder-text.js --apply --replacement "Osh Markazi"
 *   node scripts/purge-placeholder-text.js --apply "Custom Phrase"
 *
 * Three policies, because a name, a sentence, and the business's own name each
 * need different treatment:
 *   - the restaurant's OWN name is set to --replacement. It is the one value
 *     the script cannot invent, and it is the line printed at the top of every
 *     receipt, so pass the real name if this row is a live restaurant;
 *   - any other name-shaped field (dish, category, guest name) is blanked, not
 *     filled with the cafe name — a dish labelled with the restaurant's name
 *     would be a new bug rather than a fix;
 *   - everything else (addresses, notes, descriptions) has only the offending
 *     phrase removed, so real content around it survives. An address that
 *     happens to mention the country keeps its street.
 *
 * Exit codes: 0 = clean, 1 = matches found (dry run) / changes applied,
 * 2 = no database at the given path.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
// Shared with scripts/find-placeholder-text.js, so the scanner and this purge
// script can never disagree about what counts as placeholder text.
import { placeholderMatchers } from './placeholder-patterns.js';

/** Keys that hold the restaurant's own name, wherever they appear. */
const RESTAURANT_NAME_KEY = /^(restaurant_?name|display_?name)$/i;

// Never touched, however they are spelled: these are credentials, not content.
const PROTECTED_COLUMN = /(password|secret|token|hash|api_?key|confirmation_code)/i;

// A stored image is a base64 blob; "cleaning" inside one would corrupt it.
const MAX_SCANNABLE = 200_000;

const args = process.argv.slice(2);
const flag = name => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
};
const apply = args.includes('--apply');
const dbPath = flag('--db') || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'restaurant.db');
const replacement = flag('--replacement') ?? '';

const consumed = new Set();
for (const name of ['--db', '--replacement']) {
  const at = args.indexOf(name);
  if (at !== -1) {
    consumed.add(at);
    consumed.add(at + 1);
  }
}
const customPhrases = args.filter((arg, index) => !arg.startsWith('--') && !consumed.has(index));

const patterns = placeholderMatchers(customPhrases);

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Pass --db <path> or set DATABASE_PATH.`);
  process.exit(2);
}

/** A name-shaped key: its value is a label, not a sentence. */
const isNameField = field => /name|title/i.test(field);

/**
 * Removes every offending phrase. `substitute` is the whole-value substitute
 * when the field is a name (the entire value is replaced); null means surgical
 * removal of just the phrase.
 */
function scrub(value, substitute) {
  let out = value;
  const found = [];
  for (const { label, re } of patterns) {
    re.lastIndex = 0;
    if (re.test(out)) {
      if (!found.includes(label)) found.push(label);
      re.lastIndex = 0;
      out = out.replace(re, ' ');
    }
  }
  if (!found.length) return null;

  if (substitute !== null) return { cleaned: substitute, found, policy: substitute ? 'restaurant-name' : 'blanked' };

  const tidied = out
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.·•|/\\-]+|[\s,;:.·•|/\\-]+$/g, '')
    .trim();
  return { cleaned: tidied, found, policy: 'phrase-removed' };
}

/** The whole-value substitute for a name key, or null when it is not a name. */
const substituteFor = field => (RESTAURANT_NAME_KEY.test(field) ? replacement : isNameField(field) ? '' : null);

/** Walks a parsed JSON value, collecting every string that needs cleaning. */
function scrubJson(node, trail, hits, substitute) {
  if (typeof node === 'string') {
    const result = scrub(node, substitute);
    if (result) {
      hits.push({ path: trail || '(root)', before: node, after: result.cleaned, found: result.found, policy: result.policy });
      return result.cleaned;
    }
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => scrubJson(child, `${trail}[${i}]`, hits, substitute));
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(node)) {
      out[key] = scrubJson(child, trail ? `${trail}.${key}` : key, hits, substituteFor(key));
    }
    return out;
  }
  return node;
}

const db = new Database(dbPath, { readonly: !apply });

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map(row => row.name);

const planned = [];

for (const table of tables) {
  const columns = db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map(col => col.name);

  let rows;
  try {
    rows = db.prepare(`SELECT rowid AS __rowid, * FROM "${table}"`).all();
  } catch {
    continue;
  }

  for (const row of rows) {
    for (const column of columns) {
      if (PROTECTED_COLUMN.test(column)) continue;

      const value = row[column];
      if (typeof value !== 'string' || !value || value.length > MAX_SCANNABLE) continue;
      if (value.startsWith('data:')) continue;

      const trimmed = value.trim();
      const looksJson =
        (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));

      if (looksJson) {
        let parsed;
        try {
          parsed = JSON.parse(value);
        } catch {
          continue; // not actually JSON — nothing sensible to rewrite
        }
        const hits = [];
        const rewritten = scrubJson(parsed, '', hits, null);
        if (hits.length) {
          planned.push({
            table,
            rowid: row.__rowid,
            column,
            set: JSON.stringify(rewritten),
            changes: hits.map(h => ({ label: `${column}.${h.path}`, ...h }))
          });
        }
        continue;
      }

      // The restaurant's own name lives in restaurants.name, and in a settings
      // row whose KEY is a name (settings.key = 'restaurantName') — where the
      // column is the generic `value`, so the column name alone cannot decide.
      const settingsKey = table === 'settings' && typeof row.key === 'string' ? row.key : '';
      const ownRestaurantName =
        (table === 'restaurants' && column === 'name') || RESTAURANT_NAME_KEY.test(settingsKey);
      const substitute = ownRestaurantName
        ? replacement
        : isNameField(column) || isNameField(settingsKey)
          ? ''
          : null;

      const result = scrub(value, substitute);
      if (result) {
        planned.push({
          table,
          rowid: row.__rowid,
          column,
          set: result.cleaned,
          changes: [{ label: column, before: value, after: result.cleaned, found: result.found, policy: result.policy }]
        });
      }
    }
  }
}

db.close();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${dbPath}`);
console.log(`${tables.length} table(s) scanned, ${planned.length} row(s) with placeholder text.\n`);

if (!planned.length) {
  console.log('Nothing to clean. No tracked placeholder phrase exists anywhere in this database.');
  process.exit(0);
}

const POLICY_NOTE = {
  'restaurant-name': 'restaurant name — set to --replacement',
  blanked: 'name field — blanked, review this row',
  'phrase-removed': 'phrase removed, surrounding text kept'
};

for (const item of planned) {
  console.log(`${item.table}  (rowid ${item.rowid})`);
  for (const change of item.changes) {
    console.log(`  ${change.label}   [${POLICY_NOTE[change.policy] ?? change.policy}]`);
    console.log(`    matched: ${change.found.map(f => JSON.stringify(f)).join(', ')}`);
    console.log(`    before:  ${JSON.stringify(change.before)}`);
    console.log(`    after:   ${JSON.stringify(change.after)}`);
  }
  console.log();
}

if (!apply) {
  console.log('Nothing was written. Re-run with --apply to make these changes');
  console.log('(a backup of the database is taken first).');
  if (!replacement) {
    console.log('\nNo --replacement given, so a restaurant name will be blanked. That is safe');
    console.log('for a printed receipt (the header is simply omitted), but pass the real');
    console.log('name if this row is a live restaurant.');
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Apply: guaranteed backup, then one transaction
// ---------------------------------------------------------------------------
const backupDir = path.join(path.dirname(dbPath), 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `pre-purge-${stamp}.db`);

const writable = new Database(dbPath);
writable.prepare('VACUUM INTO ?').run(backupPath);
console.log(`Backup written to ${backupPath}\n`);

const runAll = writable.transaction(items => {
  for (const item of items) {
    writable
      .prepare(`UPDATE "${item.table}" SET "${item.column}" = ? WHERE rowid = ?`)
      .run(item.set, item.rowid);
  }
});
runAll(planned);
writable.close();

console.log(
  `Updated ${planned.length} row(s) — ${planned.reduce((n, i) => n + i.changes.length, 0)} field(s).`
);
console.log('Re-run without --apply to confirm the database is clean, then restart the app.');
