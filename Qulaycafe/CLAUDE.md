# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # tsx server.ts — API + SPA on one port (Vite in middlewareMode)
npm run dev:landing    # marketing site alone, on :5174
npm run lint           # tsc --noEmit — the only static check; there is no ESLint
npm test               # vitest run
npm run build          # app bundle + landing bundle + esbuild server.ts -> dist/server.cjs
npm start              # node dist/server.cjs (requires npm run build first)
```

`npm run dev` needs a `.env` with at least `JWT_SECRET` (≥16 chars) — `src/server/auth.ts`
throws at import time without it. See `.env.example`, which documents every variable
in detail; don't duplicate that here.

Single test file or case:

```bash
npx vitest run tests/publicUrls.test.ts
npx vitest run -t 'prefers the explicit per-surface URL'
```

Three of the four suites are integration tests that `spawn` a **real server** against a
temp SQLite dir, each on its own hard-coded port (`api` 4123, `telegram-webhook` 4124,
`surface-routing` 4125). Consequences worth knowing before touching them:

- A new integration suite needs a **new unused port**, or it will collide when vitest runs
  files in parallel.
- They kill the whole process group (`process.kill(-pid)`) because `tsx` forks the real
  server; a leftover orphan on the port makes the next run silently test a stale build.
- They blank `TELEGRAM_*` and raise the rate limits via env, because the repo's real `.env`
  is on the server's cwd and would otherwise decide the assertions.

## Architecture

### One process, four surfaces

A single Node process serves four audiences, each on its own hostname, and picks which one
by `req.hostname`:

| Hostname | Surface | Served as |
| --- | --- | --- |
| `qulaycafe.uz`, `www.` | landing | static files from `./landing` (separate Vite build) |
| `clients.qulaycafe.uz` | clients | the SPA, guest tree |
| `kitchen.qulaycafe.uz` | kitchen | the SPA, staff tree |
| `admin.qulaycafe.uz` | admin | the SPA, staff tree |

The same hostname rules exist in **three places that must be changed together**:

- `server.ts` (~line 400) — landing-site routing and the 301s for the pre-split
  `app.qulaycafe.uz` hostname.
- `src/utils/surface.ts` — the browser's copy, resolved once before React renders.
- `src/server/publicUrls.ts` — the origins used when the *server* generates a link
  (QR codes, Telegram buttons, owner-bot login links).

`src/App.tsx` renders only the resolved surface's tree, with the staff tree behind
`React.lazy`, so a guest browser never downloads the dashboard chunk. The isolation is at
the network level; **the API never trusts the hostname for authorization** — that stays with
the session cookie and `requireRole`. There is deliberately no in-app view switch; the old
`?view=admin|kitchen` links only survive as redirects. `?surface=` is a dev-only override,
refused in production unless `VITE_ALLOW_SURFACE_OVERRIDE=true`.

The landing site is its own Vite build (`vite.landing.config.ts`) rooted at `src/landing/`,
output to `./landing` — which is **gitignored build output** (as is `dist/`); edit
`src/landing/`, never `landing/`. `server.ts` only mounts the landing site if that directory
exists, so omitting it from a deploy silently downgrades the apex to the guest app.

### Multi-tenancy

Every business table is keyed by `restaurant_id`; the tenant is resolved differently per
audience:

- **Staff** — a JWT session cookie carrying `{role, restaurantId}` (`src/server/auth.ts`),
  attached to `req.restaurantId` by `requireRole('admin' | 'kitchen')`. Login is by the
  restaurant's **phone number** + password: the phone is what picks the tenant.
- **Guests** — no session at all. The tenant comes from the QR/link
  (`/order/<slug>`, `/book/<slug>`, or `?r=<id>`), resolved once in
  `src/utils/restaurantContext.ts` *before* React renders, then sent as an
  `X-Restaurant-Id` header on every call. Both sides fall back to the `default` tenant so
  QR codes printed before the multi-tenant split still work.
- **Platform owner** — `requireOwner` plus a private Telegram bot; there is no payment
  gateway. `requireActiveSubscription` on the guest path is the entire paywall: an unpaid
  restaurant's menu stops answering.

New queries **must** take `restaurantId` and scope on it. The data-access helpers in
`src/server/db.ts` all do, and that is the only thing standing between tenants.

### Real-time (SSE) — three deliberately separate scopes

`/api/events` (staff, session-gated, full order/table/inventory detail),
`/api/events/table/:tableNumber` (public, one table's status only), and
`/api/events/order/:orderId` (public, one order — delivery orders all share the
`tableNumber = 0` sentinel, so a table-scoped stream would leak one delivery customer's
address and phone to every other). Every broadcast is scoped to one `restaurant_id`.
The original build broadcast full orders plus the entire loyalty member list to every
connected browser; keep new events on the narrowest of these three channels.

### Telegram bots (four separate integrations)

`src/server/telegram.ts` (guest phone verification), `ownerBot.ts` (the platform owner's
private admin bot — subscriptions, feature flags), `deliveryBot.ts` (one shared courier
bot for all opted-in restaurants), `reservationBot.ts` (bookings). Each has its own token
and webhook secret, and each registers its webhook against `APP_URL` at startup.

Courier and reservation actions happen entirely inside Telegram, so those modules emit on
`deliveryEvents` / `reservationEvents`, which `server.ts` bridges onto the SSE broadcast at
the bottom of the file. That bridge is the **only** path those changes have onto the
dashboard — a new out-of-band mutation needs the same treatment or the UI won't update.

### Database

`better-sqlite3`, one file under `DATABASE_DIR` (default `./data`), WAL mode, foreign keys
on. Most business tables store a JSON blob in a `data TEXT` column keyed by
`(restaurant_id, id)`, so shape changes usually need no DDL — but reads must tolerate keys
written by older versions (see how `stock` is stripped on the way out). Schema setup is
idempotent `CREATE TABLE IF NOT EXISTS` plus a `migrations` list in `src/server/db.ts`, run
on every boot; add to that list rather than mutating the base schema. `POST /api/orders`
honours an `Idempotency-Key` header.

### Layout notes

All 85 HTTP routes live in `server.ts` (~3.6k lines); `src/server/*` holds the pieces it
composes (db, auth, validation schemas, bots, ESC/POS receipts, URL derivation).
`src/components/admin/AdminDashboard.tsx` is a 4k-line component — expect to work inside
it rather than around it. The `@/*` TS path alias maps to the repo root.

## Conventions

- Comments explain **why**, at length, wherever a decision is non-obvious or was a bug fix —
  including block banners at the top of most modules. Match that when editing; a change that
  invalidates a banner should update it.
- UI strings live in `src/lib/translations.ts` for all three languages (`uz` is the default,
  plus `ru`, `en`). Add every new key to all three.
- Prices are Uzbek so'm (integers, no cents). The loyalty economy is defined once in
  `server.ts` — 1 point per 1,000 so'm spent, 1 point = 100 so'm off — and the cart UI
  mirrors those constants.
- Every mutating endpoint validates its body with a zod schema from
  `src/server/validation.ts` via the `validateBody` middleware before touching the database.

## Deployment

Production runs the Docker image behind nginx behind Cloudflare, one container serving all
four hostnames. Two traps:

- `Host` must be forwarded (`proxy_set_header Host $host`) or surface routing collapses, and
  every new hostname needs its own nginx `server_name` entry — the box has no
  `default_server`, so an unlisted subdomain lands on an unrelated site and looks "down".
- `VITE_*` variables are compiled into the bundle at **build** time, so changing a surface
  URL requires a rebuild, not a restart. `PORT` from `.env` (6000) overrides the Dockerfile's
  default of 3000.

`data/` is the live database and `.env` holds real secrets — neither is tracked; don't add
them. Longer form in `DEPLOYMENT_AND_HARDENING.md` (infra checklist),
`MULTI_TENANT_UPGRADE.md` (the tenant + four-surface split), `SECURITY_AUDIT.md` (what was
wrong originally and what is still open), and `DEPLOYMENT.md`.
