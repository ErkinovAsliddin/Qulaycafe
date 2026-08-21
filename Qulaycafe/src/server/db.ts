import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { INITIAL_MENU_ITEMS, INITIAL_ORDERS, INITIAL_TABLES, INITIAL_LOYALTY_MEMBERS } from '../data/mockData';

// --------------------------------------------------------------------------
// Persistent database (SQLite file on disk). Multi-tenant: every restaurant
// that signs up gets its own row in `restaurants`, and every business table
// (menu_items, orders, tables, loyalty_members, inventory_logs, settings,
// exchange_rates, staff_accounts) is scoped by restaurant_id so one
// restaurant can never see or touch another's data.
// --------------------------------------------------------------------------

const DATA_DIR = process.env.DATABASE_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'restaurant.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // safer/faster concurrent writes, and crash-resistant
db.pragma('foreign_keys = ON');

const LEGACY_RESTAURANT_ID = 'default';

export function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // strip anything that isn't a letter/digit/space/dash
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// Restaurant names are frequently non-Latin (Uzbek/Russian) or generic
// ("Osh markazi"), so a purely name-derived slug collides often and can
// end up empty — falls back to a short id-derived slug in both cases.
function generateUniqueSlug(name: string, restaurantId: string): string {
  const base = slugify(name);
  const fallback = `restoran-${restaurantId.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}`;
  const candidate = base || fallback;

  const existing = db.prepare('SELECT id FROM restaurants WHERE slug = ?').get(candidate) as
    | { id: string }
    | undefined;
  if (!existing || existing.id === restaurantId) return candidate;

  // Collision with a DIFFERENT restaurant — append a short unique suffix.
  return `${candidate}-${crypto.randomBytes(2).toString('hex')}`;
}

function tableExists(name: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  return !!row;
}

function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some(r => r.name === column);
}

// ---------------------------------------------------------------------------
// Base schema: every business table is created multi-tenant from the start
// (restaurant_id baked into the primary key). If this is a brand new
// database file, these CREATE TABLE IF NOT EXISTS calls are all that run.
// ---------------------------------------------------------------------------
function createBaseSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      logo_url TEXT,
      brand_color TEXT,
      admin_telegram_chat_id TEXT,
      admin_telegram_username TEXT,
      delivery_status TEXT NOT NULL DEFAULT 'disabled',
      -- Table reservations are off until the platform owner turns them on for
      -- this restaurant from the owner bot (/reservations_on). Same shape and
      -- same reasoning as delivery_status: an opt-in feature flag Alex
      -- controls, not something a restaurant admin can enable for itself.
      reservation_status TEXT NOT NULL DEFAULT 'disabled',
      -- The loyalty ("ball") program: guests earn points per order and spend
      -- them as a discount. Unlike delivery/reservations this one defaults to
      -- ACTIVE, because it has always been part of the base product — the flag
      -- exists so Alex can switch it OFF for a restaurant that doesn't want to
      -- give points away, not to sell it as an add-on.
      loyalty_status TEXT NOT NULL DEFAULT 'active',
      slug TEXT UNIQUE
    );

    -- One row per restaurant, tracking whether its monthly subscription is
    -- paid. Deliberately has NO payment gateway plumbing: Alex (the owner
    -- of Qulaycafe itself) manages this by hand via the owner Telegram bot
    -- after collecting payment offline.
    CREATE TABLE IF NOT EXISTS subscriptions (
      restaurant_id TEXT PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'trial', -- 'trial' | 'active' | 'suspended'
      current_period_end TEXT, -- ISO date; NULL means no expiry tracked yet
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      restaurant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      restaurant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      table_number INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_restaurant_created ON orders (restaurant_id, created_at);

    CREATE TABLE IF NOT EXISTS tables (
      restaurant_id TEXT NOT NULL,
      table_number INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, table_number)
    );

    CREATE TABLE IF NOT EXISTS loyalty_members (
      restaurant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      phone_or_email TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_loyalty_restaurant_contact ON loyalty_members (restaurant_id, phone_or_email);

    CREATE TABLE IF NOT EXISTS inventory_logs (
      restaurant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, id)
    );

    -- Admin/kitchen accounts, one pair per restaurant. Passwords are always
    -- stored as bcrypt hashes, never plaintext.
    CREATE TABLE IF NOT EXISTS staff_accounts (
      restaurant_id TEXT NOT NULL,
      role TEXT NOT NULL, -- 'admin' | 'kitchen'
      password_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, role)
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      restaurant_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      restaurant_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, key)
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      restaurant_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      rate_to_som REAL NOT NULL,
      updated_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      PRIMARY KEY (restaurant_id, currency)
    );

    -- Telegram bot verification, used for two purposes: (1) a CUSTOMER
    -- proving they control a Telegram account (purpose='customer', no
    -- restaurant tie needed), and (2) a restaurant ADMIN linking their own
    -- Telegram so they can get new-order notifications (purpose=
    -- 'admin_notify', tied to restaurant_id).
    CREATE TABLE IF NOT EXISTS telegram_verifications (
      token TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      telegram_user_id TEXT,
      telegram_username TEXT,
      telegram_first_name TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'customer',
      restaurant_id TEXT
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      restaurant_id TEXT NOT NULL,
      role TEXT NOT NULL,
      failed_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      PRIMARY KEY (restaurant_id, role)
    );

    -- A customer tapping "call waiter" from their table. Persisted (not
    -- just an SSE event) so staff who reload their dashboard still see
    -- pending calls, and so there's a record of response times.
    CREATE TABLE IF NOT EXISTS waiter_calls (
      restaurant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      table_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'resolved'
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      PRIMARY KEY (restaurant_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_waiter_calls_restaurant_status ON waiter_calls (restaurant_id, status);

    -- Table reservations. A booking arrives one of two ways — the customer
    -- Telegram bot (source 'bot'), or the public web form (source 'web') —
    -- and is then confirmed or declined by the restaurant admin, either from
    -- the dashboard or from the inline buttons on the Telegram notification.
    --
    -- telegram_chat_id is the guest's own chat, kept so the bot can tell them
    -- the outcome. It is never exposed to any other restaurant: like every
    -- other table here, every read and write is scoped by restaurant_id.
    -- A web guest has no chat id (it stays NULL unless they later attach
    -- Telegram voluntarily), so public_token is what identifies them instead.
    CREATE TABLE IF NOT EXISTS reservations (
      restaurant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      -- Assigned by the admin when they confirm; NULL means "not seated yet".
      table_number INTEGER,
      reserved_date TEXT NOT NULL, -- YYYY-MM-DD, restaurant-local date
      reserved_time TEXT NOT NULL, -- HH:MM, 24h
      party_size INTEGER NOT NULL,
      guest_name TEXT NOT NULL,
      guest_phone TEXT NOT NULL,
      note TEXT,
      -- 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'seated' | 'no_show'
      status TEXT NOT NULL DEFAULT 'pending',
      source TEXT NOT NULL DEFAULT 'bot', -- 'bot' | 'admin' | 'web'
      telegram_chat_id TEXT,
      telegram_username TEXT,
      -- Unguessable bearer token for web bookings: the guest's only way back
      -- to their own booking (check status, cancel, attach Telegram). NULL for
      -- bot/admin bookings, which are identified by chat id instead. Kept out
      -- of the Reservation shape on purpose so it can never ride along in an
      -- admin list response or an SSE broadcast.
      public_token TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_reservations_restaurant_date
      ON reservations (restaurant_id, reserved_date, reserved_time);
    CREATE INDEX IF NOT EXISTS idx_reservations_restaurant_status
      ON reservations (restaurant_id, status);
    -- Flood control for the bot: counting a chat's recent bookings has to be
    -- cheap, and it crosses restaurants on purpose (one abusive Telegram
    -- account must not be able to spam N restaurants in parallel).
    CREATE INDEX IF NOT EXISTS idx_reservations_chat_created
      ON reservations (telegram_chat_id, created_at);
    -- Flood control for the web form, which has no chat id to key on: the
    -- per-phone caps count one restaurant's recent bookings, so the scan has
    -- to be limited by (restaurant_id, created_at) rather than by phone —
    -- phone matching itself is a suffix comparison and can't use an index.
    CREATE INDEX IF NOT EXISTS idx_reservations_restaurant_created
      ON reservations (restaurant_id, created_at);

    -- Delivery couriers, linked to a restaurant via the shared delivery bot.
    CREATE TABLE IF NOT EXISTS couriers (
      restaurant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      telegram_chat_id TEXT NOT NULL,
      telegram_username TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'inactive'
      created_at TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_couriers_restaurant_status ON couriers (restaurant_id, status);

    -- One-per-courier invite links. The admin names the courier ("Aziz"),
    -- gets a link, and sends it over Telegram/SMS; the courier taps it and is
    -- registered under that name. Deliberately NOT reusing
    -- telegram_verifications: that table's tokens live for 5 minutes, which is
    -- useless for a link a human has to forward and someone else has to open
    -- later. These live for days and are single-use.
    CREATE TABLE IF NOT EXISTS courier_invites (
      restaurant_id TEXT NOT NULL,
      token TEXT PRIMARY KEY,
      courier_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'used' | 'revoked'
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      courier_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_courier_invites_restaurant
      ON courier_invites (restaurant_id, created_at);

    -- Tracks which Telegram message was sent to which courier for which
    -- order, so that when one courier accepts, the bot can edit the other
    -- couriers' messages to "already taken" instead of leaving them stale.
    CREATE TABLE IF NOT EXISTS delivery_notifications (
      restaurant_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      courier_id TEXT NOT NULL,
      telegram_chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      -- Telegram message id of the separate native map-pin location message
      -- sent alongside the text notification, when the customer shared a
      -- precise location. NULL when they only typed an address.
      location_message_id INTEGER,
      PRIMARY KEY (restaurant_id, order_id, courier_id)
    );

    -- One row per (restaurant, calendar date) once the day's cash has been
    -- reconciled/closed. Purely a record — doesn't block anything else.
    CREATE TABLE IF NOT EXISTS daily_closures (
      restaurant_id TEXT NOT NULL,
      date TEXT NOT NULL, -- YYYY-MM-DD
      closed_at TEXT NOT NULL,
      cash_total REAL NOT NULL,
      card_total REAL NOT NULL,
      other_total REAL NOT NULL,
      order_count INTEGER NOT NULL,
      note TEXT,
      PRIMARY KEY (restaurant_id, date)
    );

    -- Menu categories ("Birinchi taom", "Ichimliklar", ...) — admin-editable
    -- per restaurant instead of the hardcoded list the app used to ship with.
    --
    -- id is a stable slug, NOT a random id: menu_items.data is a JSON blob
    -- whose category field holds this string, so the id has to survive a
    -- rename (only the display names change) and has to match the slugs the
    -- old hardcoded list used ('birinchi_taom', 'ichimlik', ...) or every
    -- existing dish would point at a category that no longer exists.
    CREATE TABLE IF NOT EXISTS categories (
      restaurant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name_uz TEXT NOT NULL,
      name_ru TEXT NOT NULL,
      name_en TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '🍽️',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, id)
    );
    -- The only thing that reliably stops two admins creating the same category
    -- at the same time; the API turns the violation into a 409 the UI can show.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_uz
      ON categories (restaurant_id, lower(name_uz));
    CREATE INDEX IF NOT EXISTS idx_categories_sort
      ON categories (restaurant_id, sort_order, id);

    -- Uploaded photos, as bytes, one row per dish photo / restaurant logo.
    --
    -- They used to be kept as base64 data: URIs INSIDE menu_items.data and
    -- restaurants.logo_url, which meant /api/menu served every photo of every
    -- dish inline, in one uncacheable JSON response — a real menu came to
    -- ~4 MB and took 5+ seconds on a phone before the first dish appeared.
    -- Stored separately, the JSON carries a URL (~60 bytes) instead, and each
    -- photo is fetched once and then cached by the browser forever (the URL
    -- carries the content hash, so replacing a photo changes the URL).
    CREATE TABLE IF NOT EXISTS image_blobs (
      restaurant_id TEXT NOT NULL,
      owner TEXT NOT NULL,       -- 'menu_item' | 'logo'
      owner_id TEXT NOT NULL,    -- menu item id; '' for the restaurant logo
      mime TEXT NOT NULL,
      bytes BLOB NOT NULL,
      sha TEXT NOT NULL,         -- content hash, used as the cache-busting URL version
      updated_at TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, owner, owner_id)
    );
  `);
}

// ---------------------------------------------------------------------------
// Upgrade path for a database file created by the OLD single-restaurant
// version of this app (no restaurant_id anywhere). Detected by: the
// `restaurants` table not existing yet, but `staff_accounts` already having
// data in the old shape (role TEXT PRIMARY KEY, no restaurant_id column).
// Everything that already exists gets tagged as restaurant_id='default' so
// an already-running restaurant (e.g. the live restaurant.publicvm.com
// deployment) keeps working exactly as before after this upgrade, just now
// as tenant #1 of a multi-tenant system.
// ---------------------------------------------------------------------------
function migrateLegacySingleTenantData() {
  const hadOldStaffAccounts =
    tableExists('staff_accounts') && !columnExists('staff_accounts', 'restaurant_id');
  if (!hadOldStaffAccounts) return; // fresh DB, or already migrated

  console.log('[db] Detected pre-multi-tenant database — migrating existing data into a "default" restaurant tenant...');

  const now = new Date().toISOString();

  let legacyAdminHash: string | null = null;
  try {
    const row = db.prepare(`SELECT password_hash FROM staff_accounts WHERE role = 'admin'`).get() as
      | { password_hash: string }
      | undefined;
    legacyAdminHash = row?.password_hash || null;
  } catch {
    /* old table may not exist at all — that's fine */
  }

  const placeholderHash = legacyAdminHash || bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

  db.prepare(
    `INSERT INTO restaurants (id, name, phone, password_hash, created_at, updated_at)
     SELECT ?, 'Restoran', ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM restaurants WHERE id = ?)`
  ).run(LEGACY_RESTAURANT_ID, `${LEGACY_RESTAURANT_ID}-legacy`, placeholderHash, now, now, LEGACY_RESTAURANT_ID);

  db.prepare(
    `INSERT INTO subscriptions (restaurant_id, status, current_period_end, note, created_at, updated_at)
     SELECT ?, 'active', NULL, 'Migrated from single-tenant version — always active, manage manually.', ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE restaurant_id = ?)`
  ).run(LEGACY_RESTAURANT_ID, now, now, LEGACY_RESTAURANT_ID);

  // Copy staff_accounts (old shape: role PK) into the new composite-key shape.
  const oldStaff = db.prepare(`SELECT role, password_hash, updated_at FROM staff_accounts`).all() as {
    role: string;
    password_hash: string;
    updated_at: string;
  }[];
  db.exec(`ALTER TABLE staff_accounts RENAME TO staff_accounts_old_legacy;`);
  db.exec(`
    CREATE TABLE staff_accounts (
      restaurant_id TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (restaurant_id, role)
    );
  `);
  const insertStaff = db.prepare(
    'INSERT INTO staff_accounts (restaurant_id, role, password_hash, updated_at) VALUES (?, ?, ?, ?)'
  );
  for (const row of oldStaff) {
    insertStaff.run(LEGACY_RESTAURANT_ID, row.role, row.password_hash, row.updated_at);
  }
  db.exec(`DROP TABLE staff_accounts_old_legacy;`);

  // Copy login_attempts (old shape: role PK).
  if (tableExists('login_attempts') && !columnExists('login_attempts', 'restaurant_id')) {
    const oldAttempts = db.prepare(`SELECT role, failed_count, locked_until FROM login_attempts`).all() as {
      role: string;
      failed_count: number;
      locked_until: string | null;
    }[];
    db.exec(`ALTER TABLE login_attempts RENAME TO login_attempts_old_legacy;`);
    db.exec(`
      CREATE TABLE login_attempts (
        restaurant_id TEXT NOT NULL,
        role TEXT NOT NULL,
        failed_count INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        PRIMARY KEY (restaurant_id, role)
      );
    `);
    const insertAttempt = db.prepare(
      'INSERT INTO login_attempts (restaurant_id, role, failed_count, locked_until) VALUES (?, ?, ?, ?)'
    );
    for (const row of oldAttempts) {
      insertAttempt.run(LEGACY_RESTAURANT_ID, row.role, row.failed_count, row.locked_until);
    }
    db.exec(`DROP TABLE login_attempts_old_legacy;`);
  }

  type Migration = { table: string; oldCols: string; newCreate: string; copyCols: string };
  const migrations: Migration[] = [
    {
      table: 'menu_items',
      oldCols: 'id, data',
      newCreate: `CREATE TABLE menu_items (restaurant_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (restaurant_id, id));`,
      copyCols: 'restaurant_id, id, data'
    },
    {
      table: 'orders',
      oldCols: 'id, table_number, data, created_at',
      newCreate: `CREATE TABLE orders (restaurant_id TEXT NOT NULL, id TEXT NOT NULL, table_number INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (restaurant_id, id));`,
      copyCols: 'restaurant_id, id, table_number, data, created_at'
    },
    {
      table: 'tables',
      oldCols: 'table_number, data',
      newCreate: `CREATE TABLE tables (restaurant_id TEXT NOT NULL, table_number INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (restaurant_id, table_number));`,
      copyCols: 'restaurant_id, table_number, data'
    },
    {
      table: 'loyalty_members',
      oldCols: 'id, phone_or_email, data',
      newCreate: `CREATE TABLE loyalty_members (restaurant_id TEXT NOT NULL, id TEXT NOT NULL, phone_or_email TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (restaurant_id, id));`,
      copyCols: 'restaurant_id, id, phone_or_email, data'
    },
    {
      table: 'inventory_logs',
      oldCols: 'id, data, created_at',
      newCreate: `CREATE TABLE inventory_logs (restaurant_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (restaurant_id, id));`,
      copyCols: 'restaurant_id, id, data, created_at'
    },
    {
      table: 'settings',
      oldCols: 'key, value',
      newCreate: `CREATE TABLE settings (restaurant_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (restaurant_id, key));`,
      copyCols: 'restaurant_id, key, value'
    },
    {
      table: 'exchange_rates',
      oldCols: 'currency, rate_to_som, updated_at, source',
      newCreate: `CREATE TABLE exchange_rates (restaurant_id TEXT NOT NULL, currency TEXT NOT NULL, rate_to_som REAL NOT NULL, updated_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', PRIMARY KEY (restaurant_id, currency));`,
      copyCols: 'restaurant_id, currency, rate_to_som, updated_at, source'
    }
  ];

  for (const m of migrations) {
    if (!tableExists(m.table) || columnExists(m.table, 'restaurant_id')) continue; // already new shape
    const oldRows = db.prepare(`SELECT ${m.oldCols} FROM ${m.table}`).all() as Record<string, unknown>[];
    db.exec(`ALTER TABLE ${m.table} RENAME TO ${m.table}_old_legacy;`);
    db.exec(m.newCreate);
    const placeholders = m.copyCols.split(', ').map(() => '?').join(', ');
    const insert = db.prepare(`INSERT INTO ${m.table} (${m.copyCols}) VALUES (${placeholders})`);
    const oldColNames = m.oldCols.split(', ');
    for (const row of oldRows) {
      insert.run(LEGACY_RESTAURANT_ID, ...oldColNames.map(c => row[c]));
    }
    db.exec(`DROP TABLE ${m.table}_old_legacy;`);
  }

  if (tableExists('idempotency_keys') && !columnExists('idempotency_keys', 'restaurant_id')) {
    db.exec(`ALTER TABLE idempotency_keys ADD COLUMN restaurant_id TEXT NOT NULL DEFAULT '${LEGACY_RESTAURANT_ID}';`);
  }

  console.log('[db] Migration complete. Existing restaurant is now tenant id "default".');
}

// ---------------------------------------------------------------------------
// Additive migration for databases created by earlier versions of this app
// that predate branding, admin Telegram order-notifications, and waiter
// calls. Every one of these is a plain ADD COLUMN (or CREATE TABLE IF NOT
// EXISTS, already handled above) — nothing here can lose data.
// ---------------------------------------------------------------------------
function migrateAddBrandingAndNotifyColumns() {
  if (!columnExists('restaurants', 'logo_url')) {
    db.exec(`ALTER TABLE restaurants ADD COLUMN logo_url TEXT;`);
  }
  if (!columnExists('restaurants', 'brand_color')) {
    db.exec(`ALTER TABLE restaurants ADD COLUMN brand_color TEXT;`);
  }
  if (!columnExists('restaurants', 'admin_telegram_chat_id')) {
    db.exec(`ALTER TABLE restaurants ADD COLUMN admin_telegram_chat_id TEXT;`);
  }
  if (!columnExists('restaurants', 'admin_telegram_username')) {
    db.exec(`ALTER TABLE restaurants ADD COLUMN admin_telegram_username TEXT;`);
  }
  if (!columnExists('restaurants', 'delivery_status')) {
    db.exec(`ALTER TABLE restaurants ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'disabled';`);
  }
  if (!columnExists('restaurants', 'reservation_status')) {
    db.exec(`ALTER TABLE restaurants ADD COLUMN reservation_status TEXT NOT NULL DEFAULT 'disabled';`);
  }
  // Defaults to 'active' so restaurants that already run the points program
  // keep it after this upgrade — see the CREATE TABLE comment.
  if (!columnExists('restaurants', 'loyalty_status')) {
    db.exec(`ALTER TABLE restaurants ADD COLUMN loyalty_status TEXT NOT NULL DEFAULT 'active';`);
  }
  if (!columnExists('restaurants', 'slug')) {
    db.exec(`ALTER TABLE restaurants ADD COLUMN slug TEXT;`);
  }
  // Backfill runs unconditionally, not only when the column was just added:
  // rows can also reach a NULL slug through the legacy single-tenant migration
  // and the dev demo seed, and a NULL slug breaks every share/booking link
  // built from it (…?start=book_<slug>).
  const slugless = db.prepare(`SELECT id, name FROM restaurants WHERE slug IS NULL OR slug = ''`).all() as {
    id: string;
    name: string;
  }[];
  for (const row of slugless) {
    db.prepare(`UPDATE restaurants SET slug = ? WHERE id = ?`).run(generateUniqueSlug(row.name, row.id), row.id);
  }
  // Web bookings: the public token that lets a guest without a Telegram chat
  // come back to their own booking. Added here (not in the CREATE TABLE index
  // block) because the index must never be attempted before the column exists
  // on a database created by an earlier version.
  if (!columnExists('reservations', 'public_token')) {
    db.exec(`ALTER TABLE reservations ADD COLUMN public_token TEXT;`);
  }
  // Partial index: bot/admin bookings all have a NULL token and must not
  // collide with each other, while two web bookings can never share one.
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_public_token
       ON reservations (public_token) WHERE public_token IS NOT NULL;`
  );

  if (tableExists('telegram_verifications')) {
    if (!columnExists('telegram_verifications', 'purpose')) {
      db.exec(`ALTER TABLE telegram_verifications ADD COLUMN purpose TEXT NOT NULL DEFAULT 'customer';`);
    }
    if (!columnExists('telegram_verifications', 'restaurant_id')) {
      db.exec(`ALTER TABLE telegram_verifications ADD COLUMN restaurant_id TEXT;`);
    }
  }
}

function migrateDedupeCouriers() {
  if (!tableExists('couriers')) return;
  const duplicateChatIds = db
    .prepare(
      `SELECT telegram_chat_id FROM couriers WHERE status = 'active' GROUP BY telegram_chat_id HAVING COUNT(*) > 1`
    )
    .all() as { telegram_chat_id: string }[];
  for (const { telegram_chat_id } of duplicateChatIds) {
    const rows = db
      .prepare(`SELECT restaurant_id, id, created_at FROM couriers WHERE telegram_chat_id = ? AND status = 'active' ORDER BY created_at DESC`)
      .all(telegram_chat_id) as { restaurant_id: string; id: string; created_at: string }[];
    // Keep the newest link active, deactivate the rest — matches the same
    // "one active restaurant per courier at a time" rule createCourier
    // now enforces going forward.
    for (const stale of rows.slice(1)) {
      db.prepare(`UPDATE couriers SET status = 'inactive' WHERE restaurant_id = ? AND id = ?`).run(
        stale.restaurant_id,
        stale.id
      );
    }
  }
}

function migrateAddCourierLocationColumn() {
  if (tableExists('delivery_notifications') && !columnExists('delivery_notifications', 'location_message_id')) {
    db.exec(`ALTER TABLE delivery_notifications ADD COLUMN location_message_id INTEGER;`);
  }
}

// ---------------------------------------------------------------------------
// Categories used to be a hardcoded union type in the frontend. They are now
// rows, so every restaurant that existed before this change needs the old
// seven values inserted with their original slugs — otherwise its dishes
// (whose JSON still says category: 'birinchi_taom') would render under a
// category nobody can see or edit.
// ---------------------------------------------------------------------------
export const DEFAULT_CATEGORIES: {
  id: string;
  nameUz: string;
  nameRu: string;
  nameEn: string;
  icon: string;
}[] = [
  { id: 'birinchi_taom', nameUz: 'Birinchi taom', nameRu: 'Первое блюдо', nameEn: 'First Course', icon: '🍲' },
  { id: 'ikkinchi_taom', nameUz: 'Ikkinchi taom', nameRu: 'Второе блюдо', nameEn: 'Main Course', icon: '🍛' },
  { id: 'garnir', nameUz: 'Garnir', nameRu: 'Гарнир', nameEn: 'Side Dish', icon: '🍟' },
  { id: 'salat', nameUz: 'Salat', nameRu: 'Салат', nameEn: 'Salad', icon: '🥗' },
  { id: 'nonushta', nameUz: 'Nonushta', nameRu: 'Завтрак', nameEn: 'Breakfast', icon: '🍳' },
  { id: 'pizza', nameUz: 'Pizza', nameRu: 'Пицца', nameEn: 'Pizza', icon: '🍕' },
  { id: 'ichimlik', nameUz: 'Ichimlik', nameRu: 'Напитки', nameEn: 'Drinks', icon: '🍹' }
];

/**
 * Gives a restaurant the default category set, but only when it has none at
 * all. Never touches a restaurant that already has categories, so an admin
 * who deleted or renamed a default does not get it silently resurrected on the
 * next restart.
 */
export function ensureDefaultCategories(restaurantId: string) {
  const existing = db
    .prepare('SELECT COUNT(*) AS count FROM categories WHERE restaurant_id = ?')
    .get(restaurantId) as { count: number };
  if (existing.count > 0) return;

  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO categories (restaurant_id, id, name_uz, name_ru, name_en, icon, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  const tx = db.transaction(() => {
    DEFAULT_CATEGORIES.forEach((cat, index) => {
      insert.run(restaurantId, cat.id, cat.nameUz, cat.nameRu, cat.nameEn, cat.icon, index, now, now);
    });
  });
  tx();
}

function migrateSeedCategories() {
  const restaurants = db.prepare('SELECT id FROM restaurants').all() as { id: string }[];
  for (const restaurant of restaurants) ensureDefaultCategories(restaurant.id);

  // A dish can reference a category that was never in the default list — e.g.
  // a database restored from a build that had extra slugs. Rather than leave
  // those dishes unreachable from the menu tabs, adopt the slug as a real
  // category the admin can then rename or delete.
  const orphanSlugs = db
    .prepare(
      `SELECT DISTINCT m.restaurant_id AS restaurant_id, json_extract(m.data, '$.category') AS category
         FROM menu_items m
        WHERE json_extract(m.data, '$.category') IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM categories c
                 WHERE c.restaurant_id = m.restaurant_id
                   AND c.id = json_extract(m.data, '$.category')
              )`
    )
    .all() as { restaurant_id: string; category: string }[];

  const now = new Date().toISOString();
  for (const orphan of orphanSlugs) {
    if (!orphan.category) continue;
    const label = orphan.category
      .split('_')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    const next = db
      .prepare('SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM categories WHERE restaurant_id = ?')
      .get(orphan.restaurant_id) as { next: number };
    try {
      db.prepare(
        `INSERT INTO categories (restaurant_id, id, name_uz, name_ru, name_en, icon, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '🍽️', ?, 1, ?, ?)`
      ).run(orphan.restaurant_id, orphan.category, label, label, label, next.next, now, now);
    } catch {
      // A name collision here just means the label is already taken by another
      // category; the dish keeps working, the admin can tidy it up in the UI.
    }
  }
}

// ---------------------------------------------------------------------------
// Uploaded photos: stored as bytes in image_blobs, referenced by URL.
//
// The admin UI uploads a photo as a base64 `data:image/...` URI (it resizes to
// 800px and re-encodes as JPEG in the browser first). Every write path hands
// that string to storeImageBlob, which keeps the decoded bytes here and hands
// back the URL to save in the row instead. Reads therefore stay exactly as
// cheap as any other menu field.
// ---------------------------------------------------------------------------
export const MENU_ITEM_IMAGE_PATH = (itemId: string) => `/api/menu/${encodeURIComponent(itemId)}/image`;
export const LOGO_IMAGE_PATH = '/api/branding/logo';

export interface ImageBlob {
  mime: string;
  bytes: Buffer;
  sha: string;
}

/** True for a value this app serves itself (as opposed to a data: URI or a remote photo). */
export function isInternalImageUrl(value: string): boolean {
  return /^\/api\/(menu\/[^/]+\/image|branding\/logo)(\?|$)/.test(value);
}

/**
 * Splits a `data:image/jpeg;base64,...` URI into mime + bytes. Returns null for
 * anything else (an http(s) URL, one of our own URLs, or junk), which callers
 * treat as "nothing to extract, store the string as-is".
 */
function parseDataUri(value: unknown): { mime: string; bytes: Buffer } | null {
  if (typeof value !== 'string') return null;
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(value.trim());
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) return null;
  return { mime: match[1], bytes };
}

function buildImageUrl(basePath: string, restaurantId: string, sha: string): string {
  // `r` is what makes the URL work in an <img> tag: an image request carries no
  // X-Restaurant-Id header, so the tenant has to travel in the URL. `v` is the
  // content hash, which is what lets the response be cached immutably — a new
  // photo means a new URL rather than a stale one.
  return `${basePath}?r=${encodeURIComponent(restaurantId)}&v=${sha}`;
}

/**
 * If `value` is an uploaded data: URI, store the bytes and return our own URL
 * for it. Otherwise return the value untouched (an http(s) photo URL, one of
 * our URLs from a previous save, or '').
 */
export function storeImageBlob(
  restaurantId: string,
  owner: 'menu_item' | 'logo',
  ownerId: string,
  value: string
): string {
  const parsed = parseDataUri(value);
  if (!parsed) return value;
  const sha = crypto.createHash('sha256').update(parsed.bytes).digest('hex').slice(0, 16);
  db.prepare(
    `INSERT INTO image_blobs (restaurant_id, owner, owner_id, mime, bytes, sha, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (restaurant_id, owner, owner_id)
       DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, sha = excluded.sha,
                     updated_at = excluded.updated_at`
  ).run(restaurantId, owner, ownerId, parsed.mime, parsed.bytes, sha, new Date().toISOString());
  return buildImageUrl(owner === 'logo' ? LOGO_IMAGE_PATH : MENU_ITEM_IMAGE_PATH(ownerId), restaurantId, sha);
}

export function getImageBlob(restaurantId: string, owner: 'menu_item' | 'logo', ownerId: string): ImageBlob | undefined {
  return db
    .prepare('SELECT mime, bytes, sha FROM image_blobs WHERE restaurant_id = ? AND owner = ? AND owner_id = ?')
    .get(restaurantId, owner, ownerId) as ImageBlob | undefined;
}

export function deleteImageBlob(restaurantId: string, owner: 'menu_item' | 'logo', ownerId: string) {
  db.prepare('DELETE FROM image_blobs WHERE restaurant_id = ? AND owner = ? AND owner_id = ?').run(
    restaurantId,
    owner,
    ownerId
  );
}

/** Puts the bytes back inline, for the admin's export file (which has to stay portable). */
export function inlineImageBlob(restaurantId: string, owner: 'menu_item' | 'logo', ownerId: string, url: string): string {
  if (!isInternalImageUrl(url)) return url;
  const blob = getImageBlob(restaurantId, owner, ownerId);
  if (!blob) return '';
  return `data:${blob.mime};base64,${Buffer.from(blob.bytes).toString('base64')}`;
}

/**
 * Moves photos that predate image_blobs out of the JSON/column they were
 * inlined into. Idempotent: once a row holds a URL instead of a data: URI
 * there is nothing left to match.
 */
function migrateExtractInlineImages() {
  const items = db
    .prepare(`SELECT restaurant_id, id, data FROM menu_items WHERE data LIKE '%"image":"data:%'`)
    .all() as { restaurant_id: string; id: string; data: string }[];

  const updateItem = db.prepare('UPDATE menu_items SET data = ? WHERE restaurant_id = ? AND id = ?');
  let movedItems = 0;
  const itemTx = db.transaction(() => {
    for (const row of items) {
      let parsed: any;
      try {
        parsed = JSON.parse(row.data);
      } catch {
        continue; // unreadable row — leave it exactly as it is
      }
      if (typeof parsed?.image !== 'string' || !parsed.image.startsWith('data:')) continue;
      parsed.image = storeImageBlob(row.restaurant_id, 'menu_item', row.id, parsed.image);
      updateItem.run(JSON.stringify(parsed), row.restaurant_id, row.id);
      movedItems += 1;
    }
  });
  itemTx();

  const logos = db
    .prepare(`SELECT id, logo_url FROM restaurants WHERE logo_url LIKE 'data:%'`)
    .all() as { id: string; logo_url: string }[];
  const updateLogo = db.prepare('UPDATE restaurants SET logo_url = ? WHERE id = ?');
  const logoTx = db.transaction(() => {
    for (const row of logos) {
      updateLogo.run(storeImageBlob(row.id, 'logo', '', row.logo_url), row.id);
    }
  });
  logoTx();

  if (movedItems || logos.length) {
    console.log(`[db] Moved ${movedItems} dish photo(s) and ${logos.length} logo(s) out of inline base64 into image_blobs.`);
  }
}

createBaseSchema();
migrateLegacySingleTenantData();
migrateAddBrandingAndNotifyColumns();
migrateDedupeCouriers();
migrateAddCourierLocationColumn();
migrateSeedCategories();
migrateExtractInlineImages();

// ---------------------------------------------------------------------------
// Restaurant / subscription helpers
// ---------------------------------------------------------------------------
export interface RestaurantRow {
  id: string;
  name: string;
  phone: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
  logo_url: string | null;
  brand_color: string | null;
  admin_telegram_chat_id: string | null;
  admin_telegram_username: string | null;
  delivery_status: 'disabled' | 'active' | 'suspended';
  reservation_status: 'disabled' | 'active';
  loyalty_status: 'disabled' | 'active';
  slug: string;
}

export interface SubscriptionRow {
  restaurant_id: string;
  status: 'trial' | 'active' | 'suspended';
  current_period_end: string | null;
  note: string | null;
}

export function getRestaurantByPhone(phone: string): RestaurantRow | undefined {
  return db.prepare('SELECT * FROM restaurants WHERE phone = ?').get(phone) as RestaurantRow | undefined;
}

export function getRestaurantById(id: string): RestaurantRow | undefined {
  return db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id) as RestaurantRow | undefined;
}

export function getRestaurantBySlug(slug: string): RestaurantRow | undefined {
  return db.prepare('SELECT * FROM restaurants WHERE slug = ?').get(slug) as RestaurantRow | undefined;
}

export function getSubscription(restaurantId: string): SubscriptionRow | undefined {
  return db.prepare('SELECT * FROM subscriptions WHERE restaurant_id = ?').get(restaurantId) as
    | SubscriptionRow
    | undefined;
}

export function isSubscriptionUsable(restaurantId: string): boolean {
  const sub = getSubscription(restaurantId);
  if (!sub) return false;
  if (sub.status === 'suspended') return false;
  if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) return false;
  return sub.status === 'trial' || sub.status === 'active';
}

const DEFAULT_TRIAL_DAYS = Number(process.env.DEFAULT_TRIAL_DAYS) || 14;

export function createRestaurant(params: {
  name: string;
  phone: string;
  passwordHash: string;
  deliveryEnabled?: boolean;
}): RestaurantRow {
  const id = genId('rest');
  const now = new Date().toISOString();
  const trialEnd = new Date(Date.now() + DEFAULT_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const slug = generateUniqueSlug(params.name, id);

  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO restaurants (id, name, phone, password_hash, created_at, updated_at, delivery_status, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, params.name, params.phone, params.passwordHash, now, now, params.deliveryEnabled ? 'active' : 'disabled', slug);

    db.prepare(
      'INSERT INTO subscriptions (restaurant_id, status, current_period_end, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, 'trial', trialEnd, `${DEFAULT_TRIAL_DAYS}-day trial from signup`, now, now);

    // The restaurants.password_hash column is kept for reference, but the
    // actual credential CHECKED at login time lives in staff_accounts
    // (restaurant_id, role) — so the admin role must be seeded here too,
    // otherwise a freshly registered restaurant can never log in.
    db.prepare(
      "INSERT INTO staff_accounts (restaurant_id, role, password_hash, updated_at) VALUES (?, 'admin', ?, ?)"
    ).run(id, params.passwordHash, now);

    db.prepare(`INSERT INTO settings (restaurant_id, key, value) VALUES (?, 'taxPercent', '8')`).run(id);
    db.prepare(`INSERT INTO settings (restaurant_id, key, value) VALUES (?, 'serviceFeePercent', '5')`).run(id);
    db.prepare(
      `INSERT INTO exchange_rates (restaurant_id, currency, rate_to_som, updated_at, source) VALUES (?, 'USD', 12000, ?, 'manual')`
    ).run(id, now);
    db.prepare(
      `INSERT INTO exchange_rates (restaurant_id, currency, rate_to_som, updated_at, source) VALUES (?, 'RUB', 150, ?, 'manual')`
    ).run(id, now);

    // A new restaurant needs categories before it can add its first dish.
    // Nested inside this transaction on purpose (better-sqlite3 uses a
    // savepoint), so a restaurant can never exist with an empty category list.
    ensureDefaultCategories(id);
  });
  tx();

  return getRestaurantById(id) as RestaurantRow;
}

export interface RestaurantWithSubscriptionRow extends RestaurantRow {
  sub_status?: 'trial' | 'active' | 'suspended';
  sub_period_end?: string | null;
  sub_note?: string | null;
}

export function listRestaurantsWithSubscriptions(): RestaurantWithSubscriptionRow[] {
  return db
    .prepare(
      `SELECT r.*, s.status as sub_status, s.current_period_end as sub_period_end, s.note as sub_note
       FROM restaurants r LEFT JOIN subscriptions s ON s.restaurant_id = r.id
       ORDER BY r.created_at DESC`
    )
    .all() as RestaurantWithSubscriptionRow[];
}

export function setSubscriptionStatus(
  restaurantId: string,
  status: 'trial' | 'active' | 'suspended',
  periodEndIso: string | null,
  note?: string
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO subscriptions (restaurant_id, status, current_period_end, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(restaurant_id) DO UPDATE SET status = ?, current_period_end = ?, note = COALESCE(?, subscriptions.note), updated_at = ?`
  ).run(restaurantId, status, periodEndIso, note || null, now, now, status, periodEndIso, note || null, now);
}

// Permanently removes a restaurant and every row that belongs to it across
// every table. Used by the owner bot's /delete_confirm — irreversible, so
// the bot requires a two-step confirmation before calling this.
export function deleteRestaurant(restaurantId: string) {
  const tx = db.transaction(() => {
    const tables = [
      'menu_items',
      'categories',
      'orders',
      'tables',
      'loyalty_members',
      'inventory_logs',
      'staff_accounts',
      'waiter_calls',
      'reservations',
      'couriers',
      'courier_invites',
      'delivery_notifications',
      'daily_closures',
      'settings',
      'exchange_rates',
      'login_attempts',
      'idempotency_keys',
      'subscriptions'
    ];
    for (const table of tables) {
      db.prepare(`DELETE FROM ${table} WHERE restaurant_id = ?`).run(restaurantId);
    }
    db.prepare(`DELETE FROM telegram_verifications WHERE restaurant_id = ?`).run(restaurantId);
    db.prepare(`DELETE FROM restaurants WHERE id = ?`).run(restaurantId);
  });
  tx();
}

// ---------------------------------------------------------------------------
// Branding (logo + accent color), shown on the customer-facing menu so each
// restaurant feels like its own product rather than a shared template.
// ---------------------------------------------------------------------------
export function updateRestaurantBranding(
  restaurantId: string,
  params: { logoUrl?: string | null; brandColor?: string | null; displayName?: string }
) {
  const now = new Date().toISOString();
  if (params.logoUrl !== undefined) {
    db.prepare('UPDATE restaurants SET logo_url = ?, updated_at = ? WHERE id = ?').run(params.logoUrl, now, restaurantId);
  }
  if (params.brandColor !== undefined) {
    db.prepare('UPDATE restaurants SET brand_color = ?, updated_at = ? WHERE id = ?').run(
      params.brandColor,
      now,
      restaurantId
    );
  }
  if (params.displayName !== undefined && params.displayName.trim()) {
    db.prepare('UPDATE restaurants SET name = ?, updated_at = ? WHERE id = ?').run(
      params.displayName.trim(),
      now,
      restaurantId
    );
  }
}

// ---------------------------------------------------------------------------
// Admin's own Telegram, linked so they get a message the instant a new
// order comes in — even if they're away from the dashboard.
// ---------------------------------------------------------------------------
export function setAdminTelegramLink(restaurantId: string, chatId: string, username: string | null) {
  db.prepare(
    'UPDATE restaurants SET admin_telegram_chat_id = ?, admin_telegram_username = ?, updated_at = ? WHERE id = ?'
  ).run(chatId, username, new Date().toISOString(), restaurantId);
}

export function unlinkAdminTelegram(restaurantId: string) {
  db.prepare(
    'UPDATE restaurants SET admin_telegram_chat_id = NULL, admin_telegram_username = NULL, updated_at = ? WHERE id = ?'
  ).run(new Date().toISOString(), restaurantId);
}

// ---------------------------------------------------------------------------
// Waiter calls — a customer tapping "call waiter" from their table.
// Persisted (not just an SSE event) so staff who reload their dashboard
// still see pending calls.
// ---------------------------------------------------------------------------
export interface WaiterCall {
  id: string;
  tableNumber: number;
  status: 'pending' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
}

function rowToWaiterCall(row: {
  id: string;
  table_number: number;
  status: string;
  created_at: string;
  resolved_at: string | null;
}): WaiterCall {
  return {
    id: row.id,
    tableNumber: row.table_number,
    status: row.status as 'pending' | 'resolved',
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  };
}

export function createWaiterCall(restaurantId: string, tableNumber: number): WaiterCall {
  const id = genId('call');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO waiter_calls (restaurant_id, id, table_number, status, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(restaurantId, id, tableNumber, 'pending', now);
  return { id, tableNumber, status: 'pending', createdAt: now, resolvedAt: null };
}

export function listWaiterCalls(restaurantId: string, onlyPending = false): WaiterCall[] {
  const rows = (
    onlyPending
      ? db
          .prepare(
            `SELECT id, table_number, status, created_at, resolved_at FROM waiter_calls
             WHERE restaurant_id = ? AND status = 'pending' ORDER BY created_at ASC`
          )
          .all(restaurantId)
      : db
          .prepare(
            `SELECT id, table_number, status, created_at, resolved_at FROM waiter_calls
             WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 100`
          )
          .all(restaurantId)
  ) as { id: string; table_number: number; status: string; created_at: string; resolved_at: string | null }[];
  return rows.map(rowToWaiterCall);
}

export function resolveWaiterCall(restaurantId: string, id: string): boolean {
  const result = db
    .prepare(`UPDATE waiter_calls SET status = 'resolved', resolved_at = ? WHERE restaurant_id = ? AND id = ?`)
    .run(new Date().toISOString(), restaurantId, id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Table reservations. A booking arrives either through the customer Telegram
// bot, through the public web form, or typed in by the restaurant itself; the
// restaurant admin confirms/declines it (from the dashboard or the inline
// buttons on the Telegram message), and the platform owner decides whether a
// restaurant has the feature at all.
// ---------------------------------------------------------------------------
export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'cancelled'
  | 'seated'
  | 'no_show';

export type ReservationSource = 'bot' | 'admin' | 'web';

export interface Reservation {
  id: string;
  tableNumber: number | null;
  reservedDate: string; // YYYY-MM-DD
  reservedTime: string; // HH:MM
  partySize: number;
  guestName: string;
  guestPhone: string;
  note: string | null;
  status: ReservationStatus;
  source: ReservationSource;
  telegramChatId: string | null;
  telegramUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReservationRow {
  id: string;
  table_number: number | null;
  reserved_date: string;
  reserved_time: string;
  party_size: number;
  guest_name: string;
  guest_phone: string;
  note: string | null;
  status: string;
  source: string;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  created_at: string;
  updated_at: string;
}

const RESERVATION_SOURCES: ReservationSource[] = ['bot', 'admin', 'web'];

function toReservationSource(raw: string): ReservationSource {
  return RESERVATION_SOURCES.includes(raw as ReservationSource) ? (raw as ReservationSource) : 'bot';
}

function rowToReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    tableNumber: row.table_number === null ? null : Number(row.table_number),
    reservedDate: row.reserved_date,
    reservedTime: row.reserved_time,
    partySize: Number(row.party_size),
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    note: row.note,
    status: row.status as ReservationStatus,
    source: toReservationSource(row.source),
    telegramChatId: row.telegram_chat_id,
    telegramUsername: row.telegram_username,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const RESERVATION_COLUMNS = `id, table_number, reserved_date, reserved_time, party_size, guest_name,
  guest_phone, note, status, source, telegram_chat_id, telegram_username, created_at, updated_at`;

/** Feature flag for the whole restaurant — toggled by the owner bot only. */
export function setRestaurantReservationStatus(restaurantId: string, status: 'disabled' | 'active') {
  db.prepare('UPDATE restaurants SET reservation_status = ?, updated_at = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    restaurantId
  );
}

export function reservationsEnabled(restaurantId: string): boolean {
  const row = db.prepare('SELECT reservation_status FROM restaurants WHERE id = ?').get(restaurantId) as
    | { reservation_status: string }
    | undefined;
  return row?.reservation_status === 'active';
}

/**
 * Loyalty ("ball") program feature flag — also owner-bot only, so a restaurant
 * admin can never switch its own points economy on or off. Turning it off stops
 * new points being earned, blocks redeeming, and hides the whole thing from the
 * guest app; existing balances are left untouched in loyalty_members so that
 * switching it back on restores every member exactly as they were.
 */
export function setLoyaltyStatus(restaurantId: string, status: 'disabled' | 'active') {
  db.prepare('UPDATE restaurants SET loyalty_status = ?, updated_at = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    restaurantId
  );
}

export function loyaltyEnabled(restaurantId: string): boolean {
  const row = db.prepare('SELECT loyalty_status FROM restaurants WHERE id = ?').get(restaurantId) as
    | { loyalty_status: string }
    | undefined;
  // Absent row (deleted restaurant) means no program; anything other than an
  // explicit 'disabled' on an existing row keeps the default-on behaviour.
  return !!row && row.loyalty_status !== 'disabled';
}

export function createReservation(
  restaurantId: string,
  params: {
    reservedDate: string;
    reservedTime: string;
    partySize: number;
    guestName: string;
    guestPhone: string;
    note?: string | null;
    source?: ReservationSource;
    telegramChatId?: string | null;
    telegramUsername?: string | null;
    /** Web bookings only — the caller generates it so it can hand it to the guest. */
    publicToken?: string | null;
  }
): Reservation {
  const id = genId('resv');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO reservations (restaurant_id, id, table_number, reserved_date, reserved_time, party_size,
       guest_name, guest_phone, note, status, source, telegram_chat_id, telegram_username, public_token,
       created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
  ).run(
    restaurantId,
    id,
    params.reservedDate,
    params.reservedTime,
    params.partySize,
    params.guestName,
    params.guestPhone,
    params.note ?? null,
    params.source || 'bot',
    params.telegramChatId ?? null,
    params.telegramUsername ?? null,
    params.publicToken ?? null,
    now,
    now
  );
  return getReservation(restaurantId, id) as Reservation;
}

export function getReservation(restaurantId: string, id: string): Reservation | undefined {
  const row = db
    .prepare(`SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE restaurant_id = ? AND id = ?`)
    .get(restaurantId, id) as ReservationRow | undefined;
  return row ? rowToReservation(row) : undefined;
}

/**
 * Newest-first list, optionally narrowed to one calendar date or to the
 * bookings that still need a decision. Always capped so a restaurant with
 * years of history can't blow up a dashboard response.
 */
export function listReservations(
  restaurantId: string,
  opts: { date?: string; onlyPending?: boolean; upcomingOnly?: boolean; limit?: number } = {}
): Reservation[] {
  const clauses: string[] = ['restaurant_id = ?'];
  const values: (string | number)[] = [restaurantId];
  if (opts.date) {
    clauses.push('reserved_date = ?');
    values.push(opts.date);
  }
  if (opts.onlyPending) {
    clauses.push(`status = 'pending'`);
  }
  if (opts.upcomingOnly) {
    clauses.push('reserved_date >= ?');
    values.push(new Date().toISOString().slice(0, 10));
  }
  const limit = Math.min(Math.max(opts.limit || 200, 1), 500);
  const rows = db
    .prepare(
      `SELECT ${RESERVATION_COLUMNS} FROM reservations
        WHERE ${clauses.join(' AND ')}
        ORDER BY reserved_date DESC, reserved_time DESC, created_at DESC
        LIMIT ${limit}`
    )
    .all(...values) as ReservationRow[];
  return rows.map(rowToReservation);
}

export function countPendingReservations(restaurantId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM reservations WHERE restaurant_id = ? AND status = 'pending'`)
    .get(restaurantId) as { count: number };
  return Number(row.count);
}

export type UpdateReservationResult =
  | { status: 'ok'; reservation: Reservation }
  | { status: 'not_found' }
  | { status: 'invalid_table' };

/**
 * Single write path for every status change, wherever it comes from (admin
 * dashboard, admin's Telegram buttons, or the guest cancelling their own
 * booking). Serialized in a transaction so two admins tapping "confirm" and
 * "decline" at the same moment can't interleave into a half-updated row.
 */
export function updateReservation(
  restaurantId: string,
  id: string,
  patch: { status?: ReservationStatus; tableNumber?: number | null; note?: string | null }
): UpdateReservationResult {
  const tx = db.transaction((): UpdateReservationResult => {
    const existing = getReservation(restaurantId, id);
    if (!existing) return { status: 'not_found' };

    if (patch.tableNumber !== undefined && patch.tableNumber !== null) {
      const tableRow = db
        .prepare('SELECT table_number FROM tables WHERE restaurant_id = ? AND table_number = ?')
        .get(restaurantId, patch.tableNumber);
      if (!tableRow) return { status: 'invalid_table' };
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE reservations
          SET status = ?, table_number = ?, note = ?, updated_at = ?
        WHERE restaurant_id = ? AND id = ?`
    ).run(
      patch.status || existing.status,
      patch.tableNumber === undefined ? existing.tableNumber : patch.tableNumber,
      patch.note === undefined ? existing.note : patch.note,
      now,
      restaurantId,
      id
    );
    return { status: 'ok', reservation: getReservation(restaurantId, id) as Reservation };
  });
  return tx();
}

/**
 * How many bookings a single Telegram chat has created since `sinceIso`,
 * across every restaurant — the bot's flood control. Deliberately not scoped
 * by restaurant: the limit is per abusive account, not per tenant.
 */
export function countReservationsByChatSince(telegramChatId: string, sinceIso: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM reservations WHERE telegram_chat_id = ? AND created_at >= ?')
    .get(telegramChatId, sinceIso) as { count: number };
  return Number(row.count);
}

// ---------------------------------------------------------------------------
// Web bookings. A guest on the web form has no Telegram chat id, so none of
// the bot's per-chat flood control applies to them. What identifies a web
// guest instead is their phone number (for the caps below, which is why they
// are matched loosely) and, once the booking exists, the unguessable
// public_token they were handed.
// ---------------------------------------------------------------------------

/**
 * Last 9 digits of a phone number, wrapped for a SQL LIKE. Uzbek numbers get
 * typed every which way — +998901234567, 998901234567, 901234567 — and all
 * three are the same person for the purpose of a booking cap, so the caps
 * compare the national part rather than the exact string that was stored.
 * Returns null for anything too short to compare safely, which makes the
 * caller fall back to "no match" rather than to "matches everything".
 */
function phoneSuffixPattern(phone: string): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  return `%${digits.slice(-9)}`;
}

/** How many bookings this phone has made at THIS restaurant since `sinceIso`. */
export function countReservationsByPhoneSince(restaurantId: string, phone: string, sinceIso: string): number {
  const pattern = phoneSuffixPattern(phone);
  if (!pattern) return 0;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM reservations
        WHERE restaurant_id = ? AND created_at >= ? AND guest_phone LIKE ?`
    )
    .get(restaurantId, sinceIso, pattern) as { count: number };
  return Number(row.count);
}

/**
 * Bookings this phone still has open (pending or confirmed) for today or
 * later. The web cap is on THESE rather than on lifetime bookings: a regular
 * who has eaten here fifty times must never be blocked, but nobody needs
 * three unanswered requests queued at once.
 */
export function countOpenReservationsByPhone(restaurantId: string, phone: string, fromDate: string): number {
  const pattern = phoneSuffixPattern(phone);
  if (!pattern) return 0;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM reservations
        WHERE restaurant_id = ? AND reserved_date >= ? AND guest_phone LIKE ?
          AND status IN ('pending', 'confirmed')`
    )
    .get(restaurantId, fromDate, pattern) as { count: number };
  return Number(row.count);
}

/**
 * An open booking this phone already holds for exactly this slot. A guest who
 * double-taps submit, or reloads and fills the form again, gets their existing
 * booking back instead of a second identical row for the restaurant to sort out.
 */
export function findOpenReservationBySlot(
  restaurantId: string,
  phone: string,
  reservedDate: string,
  reservedTime: string
): Reservation | undefined {
  const pattern = phoneSuffixPattern(phone);
  if (!pattern) return undefined;
  const row = db
    .prepare(
      `SELECT ${RESERVATION_COLUMNS} FROM reservations
        WHERE restaurant_id = ? AND reserved_date = ? AND reserved_time = ? AND guest_phone LIKE ?
          AND status IN ('pending', 'confirmed')
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(restaurantId, reservedDate, reservedTime, pattern) as ReservationRow | undefined;
  return row ? rowToReservation(row) : undefined;
}

/**
 * Resolves a web guest's booking from the token they were handed. This is the
 * one reservation read that isn't scoped by restaurant_id up front — the token
 * itself carries the scope, and the restaurant it belongs to is returned so
 * every write the caller then makes can be scoped normally.
 */
export function getReservationByPublicToken(token: string):
  | { restaurantId: string; restaurantName: string; reservation: Reservation }
  | undefined {
  if (!token) return undefined;
  const row = db
    .prepare(
      `SELECT r.id, r.table_number, r.reserved_date, r.reserved_time, r.party_size, r.guest_name,
              r.guest_phone, r.note, r.status, r.source, r.telegram_chat_id, r.telegram_username,
              r.created_at, r.updated_at,
              r.restaurant_id AS restaurant_id, COALESCE(t.name, '') AS restaurant_name
         FROM reservations r LEFT JOIN restaurants t ON t.id = r.restaurant_id
        WHERE r.public_token = ?`
    )
    .get(token) as (ReservationRow & { restaurant_id: string; restaurant_name: string }) | undefined;
  if (!row) return undefined;
  return {
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    reservation: rowToReservation(row)
  };
}

/**
 * Attaches a Telegram chat to an existing web booking, so the guest starts
 * receiving the same confirm/decline messages a bot booking gets. Only ever
 * fills an EMPTY chat id: re-running the deep link must not let a second
 * account hijack the notifications of a booking someone else already claimed.
 */
export function attachTelegramChatToReservation(
  restaurantId: string,
  id: string,
  telegramChatId: string,
  telegramUsername: string | null
): Reservation | undefined {
  db.prepare(
    `UPDATE reservations
        SET telegram_chat_id = ?, telegram_username = ?, updated_at = ?
      WHERE restaurant_id = ? AND id = ? AND telegram_chat_id IS NULL`
  ).run(telegramChatId, telegramUsername, new Date().toISOString(), restaurantId, id);
  return getReservation(restaurantId, id);
}

/** The guest's own upcoming bookings at one restaurant, so the bot can list/cancel them. */
export function listReservationsByChat(restaurantId: string, telegramChatId: string, limit = 10): Reservation[] {
  const rows = db
    .prepare(
      `SELECT ${RESERVATION_COLUMNS} FROM reservations
        WHERE restaurant_id = ? AND telegram_chat_id = ?
        ORDER BY reserved_date DESC, reserved_time DESC
        LIMIT ${Math.min(Math.max(limit, 1), 50)}`
    )
    .all(restaurantId, telegramChatId) as ReservationRow[];
  return rows.map(rowToReservation);
}

/**
 * Which restaurant this Telegram chat last booked at. Lets a returning guest
 * type /book without needing the restaurant's deep link again — they only ever
 * get back a restaurant they themselves already interacted with.
 */
export function getLastBookedRestaurantIdByChat(telegramChatId: string): string | undefined {
  const row = db
    .prepare(
      `SELECT restaurant_id FROM reservations WHERE telegram_chat_id = ?
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(telegramChatId) as { restaurant_id: string } | undefined;
  return row?.restaurant_id;
}

/**
 * Every restaurant whose admin linked THIS Telegram chat. The only
 * authorization check behind the admin's inline reservation buttons: a tap is
 * honoured solely for bookings belonging to one of these restaurants, so one
 * restaurant's admin can never act on another's. Returns a list because the
 * same person may run more than one restaurant from one Telegram account.
 */
export function listRestaurantsByAdminChatId(chatId: string): RestaurantRow[] {
  return db.prepare('SELECT * FROM restaurants WHERE admin_telegram_chat_id = ?').all(chatId) as RestaurantRow[];
}

export interface ReservationWithRestaurant extends Reservation {
  restaurantId: string;
  restaurantName: string;
}

/**
 * A guest's own bookings across every restaurant they've booked at, matched
 * strictly on their Telegram chat id. This is the one read that isn't scoped
 * by restaurant_id — and it's still safe, because the chat id IS the guest's
 * identity: it can only ever return rows they created themselves.
 */
export function listReservationsForChat(telegramChatId: string, limit = 10): ReservationWithRestaurant[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.table_number, r.reserved_date, r.reserved_time, r.party_size, r.guest_name,
              r.guest_phone, r.note, r.status, r.source, r.telegram_chat_id, r.telegram_username,
              r.created_at, r.updated_at,
              r.restaurant_id AS restaurant_id, COALESCE(t.name, '') AS restaurant_name
         FROM reservations r LEFT JOIN restaurants t ON t.id = r.restaurant_id
        WHERE r.telegram_chat_id = ?
        ORDER BY r.reserved_date DESC, r.reserved_time DESC
        LIMIT ${Math.min(Math.max(limit, 1), 50)}`
    )
    .all(telegramChatId) as (ReservationRow & { restaurant_id: string; restaurant_name: string })[];
  return rows.map(row => ({
    ...rowToReservation(row),
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name
  }));
}

/**
 * One booking, resolvable only by the guest who made it (their chat id).
 * Queried directly by id rather than by scanning the (capped, date-ordered)
 * list: a guest with a long booking history would otherwise be unable to
 * cancel a booking that had fallen off the end of that window.
 */
export function findReservationForChat(
  telegramChatId: string,
  id: string
): ReservationWithRestaurant | undefined {
  const row = db
    .prepare(
      `SELECT r.id, r.table_number, r.reserved_date, r.reserved_time, r.party_size, r.guest_name,
              r.guest_phone, r.note, r.status, r.source, r.telegram_chat_id, r.telegram_username,
              r.created_at, r.updated_at,
              r.restaurant_id AS restaurant_id, COALESCE(t.name, '') AS restaurant_name
         FROM reservations r LEFT JOIN restaurants t ON t.id = r.restaurant_id
        WHERE r.telegram_chat_id = ? AND r.id = ?`
    )
    .get(telegramChatId, id) as (ReservationRow & { restaurant_id: string; restaurant_name: string }) | undefined;
  if (!row) return undefined;
  return { ...rowToReservation(row), restaurantId: row.restaurant_id, restaurantName: row.restaurant_name };
}

// ---------------------------------------------------------------------------
// Delivery — restaurants opt in (at signup or later, toggled by Alex via the
// owner bot), and once active, use a single SHARED delivery Telegram bot.
// Couriers link their own Telegram to their restaurant, and are always
// scoped by restaurant_id — one restaurant's couriers/orders are never
// visible to another's, same as everything else in this system.
// ---------------------------------------------------------------------------
export function setDeliveryStatus(restaurantId: string, status: 'disabled' | 'active' | 'suspended') {
  db.prepare('UPDATE restaurants SET delivery_status = ?, updated_at = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    restaurantId
  );
}

export interface Courier {
  id: string;
  restaurantId: string;
  telegramChatId: string;
  telegramUsername: string | null;
  name: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

function rowToCourier(row: {
  restaurant_id: string;
  id: string;
  telegram_chat_id: string;
  telegram_username: string | null;
  name: string;
  status: string;
  created_at: string;
}): Courier {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    telegramChatId: row.telegram_chat_id,
    telegramUsername: row.telegram_username,
    name: row.name,
    status: row.status as 'active' | 'inactive',
    createdAt: row.created_at
  };
}

export function createCourier(
  restaurantId: string,
  telegramChatId: string,
  telegramUsername: string | null,
  name: string
): Courier {
  // A Telegram account must be an active courier for AT MOST one
  // restaurant at a time. Without this, re-linking (even accidentally
  // scanning the same link twice, or having tested with another
  // restaurant before) leaves multiple active rows for the same chat_id,
  // and getCourierByTelegramChatId's lookup becomes ambiguous — it could
  // return a DIFFERENT restaurant's courier row than the one the incoming
  // order actually belongs to, which surfaces to the courier as a
  // confusing "order not found, may have been deleted" error even though
  // the order is completely fine.
  db.prepare(`UPDATE couriers SET status = 'inactive' WHERE telegram_chat_id = ? AND status = 'active'`).run(
    telegramChatId
  );

  const id = genId('courier');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO couriers (restaurant_id, id, telegram_chat_id, telegram_username, name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(restaurantId, id, telegramChatId, telegramUsername, name, 'active', now);
  return { id, restaurantId, telegramChatId, telegramUsername, name, status: 'active', createdAt: now };
}

export function listCouriers(restaurantId: string, onlyActive = false): Courier[] {
  const rows = (
    onlyActive
      ? db
          .prepare(`SELECT * FROM couriers WHERE restaurant_id = ? AND status = 'active' ORDER BY created_at ASC`)
          .all(restaurantId)
      : db.prepare(`SELECT * FROM couriers WHERE restaurant_id = ? ORDER BY created_at ASC`).all(restaurantId)
  ) as any[];
  return rows.map(rowToCourier);
}

// A Telegram user is assumed to be a courier for at most one restaurant at
// a time — simplest model, matches how one person usually works for one
// restaurant. Used by the delivery bot to figure out "who is texting me".
export function getCourierByTelegramChatId(chatId: string): Courier | undefined {
  const row = db
    .prepare(`SELECT * FROM couriers WHERE telegram_chat_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`)
    .get(chatId) as any | undefined;
  return row ? rowToCourier(row) : undefined;
}

export function getCourierById(restaurantId: string, id: string): Courier | undefined {
  const row = db.prepare(`SELECT * FROM couriers WHERE restaurant_id = ? AND id = ?`).get(restaurantId, id) as
    | any
    | undefined;
  return row ? rowToCourier(row) : undefined;
}

export function setCourierStatus(restaurantId: string, id: string, status: 'active' | 'inactive') {
  db.prepare(`UPDATE couriers SET status = ? WHERE restaurant_id = ? AND id = ?`).run(status, restaurantId, id);
}

export function renameCourier(restaurantId: string, id: string, name: string) {
  db.prepare(`UPDATE couriers SET name = ? WHERE restaurant_id = ? AND id = ?`).run(name, restaurantId, id);
}

// --- Courier invite links (one per courier, shareable) ---

export interface CourierInvite {
  token: string;
  restaurantId: string;
  courierName: string;
  status: 'pending' | 'used' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  courierId: string | null;
}

const COURIER_INVITE_TTL_DAYS = 7;

function rowToCourierInvite(row: any): CourierInvite {
  const expired = row.status === 'pending' && new Date(row.expires_at).getTime() < Date.now();
  return {
    token: row.token,
    restaurantId: row.restaurant_id,
    courierName: row.courier_name,
    status: expired ? 'expired' : (row.status as CourierInvite['status']),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at || null,
    courierId: row.courier_id || null
  };
}

export function createCourierInvite(restaurantId: string, courierName: string): CourierInvite {
  const token = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + COURIER_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO courier_invites (restaurant_id, token, courier_name, status, created_at, expires_at) VALUES (?, ?, ?, 'pending', ?, ?)`
  ).run(restaurantId, token, courierName, now.toISOString(), expiresAt.toISOString());
  return {
    token,
    restaurantId,
    courierName,
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    usedAt: null,
    courierId: null
  };
}

export function listCourierInvites(restaurantId: string): CourierInvite[] {
  const rows = db
    .prepare(`SELECT * FROM courier_invites WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 200`)
    .all(restaurantId) as any[];
  return rows.map(rowToCourierInvite);
}

export function getCourierInviteByToken(token: string): CourierInvite | undefined {
  const row = db.prepare(`SELECT * FROM courier_invites WHERE token = ?`).get(token) as any | undefined;
  return row ? rowToCourierInvite(row) : undefined;
}

/** Single-use: only a still-pending, unexpired invite can be claimed. */
export function claimCourierInvite(token: string, courierId: string): boolean {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE courier_invites SET status = 'used', used_at = ?, courier_id = ?
       WHERE token = ? AND status = 'pending' AND expires_at > ?`
    )
    .run(now, courierId, token, now);
  return result.changes > 0;
}

export function revokeCourierInvite(restaurantId: string, token: string): boolean {
  const result = db
    .prepare(`UPDATE courier_invites SET status = 'revoked' WHERE restaurant_id = ? AND token = ? AND status = 'pending'`)
    .run(restaurantId, token);
  return result.changes > 0;
}

export function saveDeliveryNotification(
  restaurantId: string,
  orderId: string,
  courierId: string,
  telegramChatId: string,
  messageId: number,
  locationMessageId?: number
) {
  db.prepare(
    `INSERT INTO delivery_notifications (restaurant_id, order_id, courier_id, telegram_chat_id, message_id, location_message_id) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(restaurant_id, order_id, courier_id) DO UPDATE SET telegram_chat_id = ?, message_id = ?, location_message_id = ?`
  ).run(
    restaurantId,
    orderId,
    courierId,
    telegramChatId,
    messageId,
    locationMessageId ?? null,
    telegramChatId,
    messageId,
    locationMessageId ?? null
  );
}

export function listDeliveryNotifications(
  restaurantId: string,
  orderId: string
): { courierId: string; telegramChatId: string; messageId: number; locationMessageId: number | null }[] {
  return db
    .prepare(
      `SELECT courier_id as courierId, telegram_chat_id as telegramChatId, message_id as messageId, location_message_id as locationMessageId
       FROM delivery_notifications WHERE restaurant_id = ? AND order_id = ?`
    )
    .all(restaurantId, orderId) as any[];
}

// ---------------------------------------------------------------------------
// Daily closure (Z-report) — a record of the day's cash/card/other totals
// at the point the restaurant reconciled the till. Purely informational;
// re-closing the same date just updates the record.
// ---------------------------------------------------------------------------
export interface DailyClosure {
  date: string;
  closedAt: string;
  cashTotal: number;
  cardTotal: number;
  otherTotal: number;
  orderCount: number;
  note: string | null;
}

export function upsertDailyClosure(
  restaurantId: string,
  date: string,
  totals: { cashTotal: number; cardTotal: number; otherTotal: number; orderCount: number },
  note?: string
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO daily_closures (restaurant_id, date, closed_at, cash_total, card_total, other_total, order_count, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(restaurant_id, date) DO UPDATE SET closed_at = ?, cash_total = ?, card_total = ?, other_total = ?, order_count = ?, note = ?`
  ).run(
    restaurantId,
    date,
    now,
    totals.cashTotal,
    totals.cardTotal,
    totals.otherTotal,
    totals.orderCount,
    note || null,
    now,
    totals.cashTotal,
    totals.cardTotal,
    totals.otherTotal,
    totals.orderCount,
    note || null
  );
}

export function getDailyClosure(restaurantId: string, date: string): DailyClosure | undefined {
  const row = db.prepare(`SELECT * FROM daily_closures WHERE restaurant_id = ? AND date = ?`).get(restaurantId, date) as
    | {
        date: string;
        closed_at: string;
        cash_total: number;
        card_total: number;
        other_total: number;
        order_count: number;
        note: string | null;
      }
    | undefined;
  if (!row) return undefined;
  return {
    date: row.date,
    closedAt: row.closed_at,
    cashTotal: row.cash_total,
    cardTotal: row.card_total,
    otherTotal: row.other_total,
    orderCount: row.order_count,
    note: row.note
  };
}

export function getOrderRawJson(restaurantId: string, orderId: string): string | undefined {
  const row = db.prepare('SELECT data FROM orders WHERE restaurant_id = ? AND id = ?').get(restaurantId, orderId) as
    | { data: string }
    | undefined;
  return row?.data;
}

export function updateOrderRawJson(restaurantId: string, orderId: string, data: string) {
  db.prepare('UPDATE orders SET data = ? WHERE restaurant_id = ? AND id = ?').run(data, restaurantId, orderId);
}

// ---------------------------------------------------------------------------
// Menu categories
//
// Everything below is scoped by restaurant_id, and every write that touches
// sort_order runs inside a transaction. better-sqlite3 is synchronous and the
// whole server is one process, so a transaction here really is serialized —
// no advisory locks needed, unlike the Postgres version of this design.
// ---------------------------------------------------------------------------
export interface MenuCategory {
  id: string;
  nameUz: string;
  nameRu: string;
  nameEn: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  dishCount: number;
}

/** Thrown when the unique index on lower(name_uz) rejects a write. */
export class DuplicateCategoryNameError extends Error {
  constructor() {
    super('A category with this Uzbek name already exists.');
    this.name = 'DuplicateCategoryNameError';
  }
}

const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === SQLITE_CONSTRAINT_UNIQUE || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}

interface CategoryRow {
  id: string;
  name_uz: string;
  name_ru: string;
  name_en: string;
  icon: string;
  sort_order: number;
  is_active: number;
  dish_count: number;
}

function rowToCategory(row: CategoryRow): MenuCategory {
  return {
    id: row.id,
    nameUz: row.name_uz,
    nameRu: row.name_ru,
    nameEn: row.name_en,
    icon: row.icon,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    dishCount: row.dish_count
  };
}

// Dish counts come from the menu_items JSON blob, which is where a dish's
// category lives. Counted in SQL so the admin list can show "3 dishes" without
// the client having to load the whole menu first.
const CATEGORY_SELECT = `
  SELECT c.id,
         c.name_uz,
         c.name_ru,
         c.name_en,
         c.icon,
         c.sort_order,
         c.is_active,
         (SELECT COUNT(*)
            FROM menu_items m
           WHERE m.restaurant_id = c.restaurant_id
             AND json_extract(m.data, '$.category') = c.id) AS dish_count
    FROM categories c
`;

export function listCategories(restaurantId: string, includeInactive = false): MenuCategory[] {
  const rows = db
    .prepare(
      `${CATEGORY_SELECT}
        WHERE c.restaurant_id = ?
          AND (? = 1 OR c.is_active = 1)
        ORDER BY c.sort_order ASC, c.id ASC`
    )
    .all(restaurantId, includeInactive ? 1 : 0) as CategoryRow[];
  return rows.map(rowToCategory);
}

export function getCategory(restaurantId: string, id: string, includeInactive = false): MenuCategory | undefined {
  const row = db
    .prepare(`${CATEGORY_SELECT} WHERE c.restaurant_id = ? AND c.id = ? AND (? = 1 OR c.is_active = 1)`)
    .get(restaurantId, id, includeInactive ? 1 : 0) as CategoryRow | undefined;
  return row ? rowToCategory(row) : undefined;
}

/** True when the id is a real category of this restaurant (active or not). */
export function categoryExists(restaurantId: string, id: string): boolean {
  const row = db
    .prepare('SELECT 1 AS ok FROM categories WHERE restaurant_id = ? AND id = ?')
    .get(restaurantId, id) as { ok: number } | undefined;
  return Boolean(row);
}

/**
 * Builds the immutable slug id from the Uzbek name. Menu items store this
 * string, so it must never change afterwards — renaming a category only
 * touches its display names.
 */
function generateCategoryId(restaurantId: string, nameUz: string): string {
  const base = slugify(nameUz.replace(/['’ʻ`]/g, '')) || `cat-${crypto.randomBytes(3).toString('hex')}`;
  let candidate = base;
  let suffix = 2;
  while (categoryExists(restaurantId, candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
    if (suffix > 50) {
      candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`;
      break;
    }
  }
  return candidate;
}

export function createCategory(
  restaurantId: string,
  input: { nameUz: string; nameRu?: string; nameEn?: string; icon?: string; isActive?: boolean }
): MenuCategory {
  const now = new Date().toISOString();
  const nameUz = input.nameUz.trim();
  // Russian/English fall back to Uzbek so an admin in a hurry can type one
  // name and still get a menu that renders in all three languages.
  const nameRu = (input.nameRu || '').trim() || nameUz;
  const nameEn = (input.nameEn || '').trim() || nameUz;
  const icon = (input.icon || '').trim() || '🍽️';
  const isActive = input.isActive === undefined ? true : input.isActive;

  try {
    const created = db.transaction(() => {
      const id = generateCategoryId(restaurantId, nameUz);
      const next = db
        .prepare('SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM categories WHERE restaurant_id = ?')
        .get(restaurantId) as { next: number };
      db.prepare(
        `INSERT INTO categories (restaurant_id, id, name_uz, name_ru, name_en, icon, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(restaurantId, id, nameUz, nameRu, nameEn, icon, next.next, isActive ? 1 : 0, now, now);
      return id;
    })();
    return getCategory(restaurantId, created, true) as MenuCategory;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateCategoryNameError();
    throw err;
  }
}

export function updateCategory(
  restaurantId: string,
  id: string,
  patch: { nameUz?: string; nameRu?: string; nameEn?: string; icon?: string; isActive?: boolean }
): MenuCategory | undefined {
  if (!categoryExists(restaurantId, id)) return undefined;
  const now = new Date().toISOString();
  const nameUz = patch.nameUz?.trim();

  try {
    db.prepare(
      `UPDATE categories
          SET name_uz    = COALESCE(?, name_uz),
              name_ru    = COALESCE(?, name_ru),
              name_en    = COALESCE(?, name_en),
              icon       = COALESCE(?, icon),
              is_active  = COALESCE(?, is_active),
              updated_at = ?
        WHERE restaurant_id = ? AND id = ?`
    ).run(
      nameUz || null,
      patch.nameRu?.trim() || null,
      patch.nameEn?.trim() || null,
      patch.icon?.trim() || null,
      patch.isActive === undefined ? null : patch.isActive ? 1 : 0,
      now,
      restaurantId,
      id
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateCategoryNameError();
    throw err;
  }
  return getCategory(restaurantId, id, true);
}

// Discriminated on a string `status` rather than a boolean `ok`: this project
// compiles without `strict`, and TypeScript will not narrow a union by a
// boolean discriminant when strictNullChecks is off.
export type DeleteCategoryResult =
  | { status: 'deleted'; movedDishes: number }
  | { status: 'not_found' }
  | { status: 'not_empty'; dishCount: number }
  | { status: 'invalid_target' }
  | { status: 'last_category' };

/**
 * Deletes a category. Refuses while dishes still point at it, so menu items
 * can never be silently orphaned into a category that no longer exists —
 * unless the caller names a `moveTo` category to reassign them to first.
 *
 * The count, the reassignment and the delete all run in one transaction; the
 * server is single-process and better-sqlite3 is synchronous, so no dish can
 * be added in between and slip past the guard.
 */
export function deleteCategory(restaurantId: string, id: string, moveTo?: string): DeleteCategoryResult {
  return db.transaction((): DeleteCategoryResult => {
    if (!categoryExists(restaurantId, id)) return { status: 'not_found' };

    const total = db
      .prepare('SELECT COUNT(*) AS count FROM categories WHERE restaurant_id = ?')
      .get(restaurantId) as { count: number };
    // A menu with zero categories cannot accept a new dish, so the last one is
    // not deletable — deactivating it is the intended way to hide a section.
    if (total.count <= 1) return { status: 'last_category' };

    const dishes = db
      .prepare(
        `SELECT id, data FROM menu_items
          WHERE restaurant_id = ? AND json_extract(data, '$.category') = ?`
      )
      .all(restaurantId, id) as { id: string; data: string }[];

    let movedDishes = 0;
    if (dishes.length) {
      if (!moveTo) return { status: 'not_empty', dishCount: dishes.length };
      if (moveTo === id || !categoryExists(restaurantId, moveTo)) return { status: 'invalid_target' };

      const update = db.prepare('UPDATE menu_items SET data = ? WHERE restaurant_id = ? AND id = ?');
      for (const dish of dishes) {
        const parsed = JSON.parse(dish.data) as { category: string };
        parsed.category = moveTo;
        update.run(JSON.stringify(parsed), restaurantId, dish.id);
        movedDishes += 1;
      }
    }

    db.prepare('DELETE FROM categories WHERE restaurant_id = ? AND id = ?').run(restaurantId, id);
    return { status: 'deleted', movedDishes };
  })();
}

export type ReorderCategoriesResult =
  | { status: 'ok' }
  | { status: 'unknown_ids'; unknown: string[] }
  | { status: 'stale'; expectedCount: number; receivedCount: number };

/**
 * Rewrites sort_order from the position of each id in `ids`.
 *
 * The list must contain every category of this restaurant exactly once. A
 * partial list would renumber only the ids it contains while the rest keep
 * their old positions, producing duplicate sort_order values and an order that
 * then depends on the id tiebreak. A mismatch means the admin's page is stale,
 * so it is rejected instead of applied.
 */
export function reorderCategories(restaurantId: string, ids: string[]): ReorderCategoriesResult {
  return db.transaction((): ReorderCategoriesResult => {
    const existing = db
      .prepare('SELECT id FROM categories WHERE restaurant_id = ?')
      .all(restaurantId) as { id: string }[];
    const known = new Set(existing.map(row => row.id));

    const unknown = ids.filter(id => !known.has(id));
    if (unknown.length) return { status: 'unknown_ids', unknown };
    if (ids.length !== known.size) {
      return { status: 'stale', expectedCount: known.size, receivedCount: ids.length };
    }

    const now = new Date().toISOString();
    const update = db.prepare(
      'UPDATE categories SET sort_order = ?, updated_at = ? WHERE restaurant_id = ? AND id = ? AND sort_order IS NOT ?'
    );
    ids.forEach((id, index) => update.run(index, now, restaurantId, id, index));
    return { status: 'ok' };
  })();
}

// ---------------------------------------------------------------------------
// Legacy demo seed data — only used in local dev so the app isn't empty out
// of the box. Real restaurants that sign up via /api/restaurants/register
// start with an empty menu/tables, which is correct — they add their own.
// ---------------------------------------------------------------------------
function seedLegacyDemoDataIfNeeded() {
  if (process.env.NODE_ENV === 'production') return; // never auto-seed demo data in prod
  if (getRestaurantById(LEGACY_RESTAURANT_ID)) return; // already migrated/created

  const now = new Date().toISOString();
  const demoPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!demoPassword) return; // nothing to bootstrap with locally

  db.prepare(
    'INSERT INTO restaurants (id, name, phone, password_hash, created_at, updated_at, slug) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    LEGACY_RESTAURANT_ID,
    'Demo Restoran',
    '+998900000000',
    bcrypt.hashSync(demoPassword, 12),
    now,
    now,
    // The seed runs after the migrations, so it has to produce its own slug —
    // otherwise the demo tenant is the one restaurant whose share and booking
    // links (…?start=book_<slug>) are dead.
    generateUniqueSlug('Demo Restoran', LEGACY_RESTAURANT_ID)
  );
  db.prepare(
    'INSERT INTO subscriptions (restaurant_id, status, current_period_end, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(LEGACY_RESTAURANT_ID, 'active', null, 'Local dev demo tenant', now, now);

  const insertMenu = db.prepare('INSERT INTO menu_items (restaurant_id, id, data) VALUES (?, ?, ?)');
  for (const item of INITIAL_MENU_ITEMS) insertMenu.run(LEGACY_RESTAURANT_ID, item.id, JSON.stringify(item));

  // The demo dishes use the original hardcoded slugs, so the demo tenant needs
  // the matching category rows too (migrateSeedCategories already ran by now).
  ensureDefaultCategories(LEGACY_RESTAURANT_ID);

  const insertOrder = db.prepare(
    'INSERT INTO orders (restaurant_id, id, table_number, data, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const o of INITIAL_ORDERS)
    insertOrder.run(LEGACY_RESTAURANT_ID, o.id, o.tableNumber, JSON.stringify(o), o.createdAt);

  const insertTable = db.prepare('INSERT INTO tables (restaurant_id, table_number, data) VALUES (?, ?, ?)');
  for (const t of INITIAL_TABLES) insertTable.run(LEGACY_RESTAURANT_ID, t.tableNumber, JSON.stringify(t));

  const insertLoyalty = db.prepare(
    'INSERT INTO loyalty_members (restaurant_id, id, phone_or_email, data) VALUES (?, ?, ?, ?)'
  );
  for (const l of INITIAL_LOYALTY_MEMBERS)
    insertLoyalty.run(LEGACY_RESTAURANT_ID, l.id, l.phoneOrEmail.toLowerCase(), JSON.stringify(l));

  const kitchenPin = process.env.KITCHEN_INITIAL_PIN || demoPassword;
  db.prepare(
    "INSERT INTO staff_accounts (restaurant_id, role, password_hash, updated_at) VALUES (?, 'admin', ?, ?)"
  ).run(LEGACY_RESTAURANT_ID, bcrypt.hashSync(demoPassword, 12), now);
  db.prepare(
    "INSERT INTO staff_accounts (restaurant_id, role, password_hash, updated_at) VALUES (?, 'kitchen', ?, ?)"
  ).run(LEGACY_RESTAURANT_ID, bcrypt.hashSync(kitchenPin, 12), now);
}

seedLegacyDemoDataIfNeeded();

export function backupNow(): string {
  const backupDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `restaurant-${stamp}.db`);
  db.backup(backupPath).then(() => {
    // no-op; backup is async under the hood in better-sqlite3's API surface
  });
  return backupPath;
}
