# Qulaycafe — Multi-Tenant Upgrade

This turns Qulaycafe from a single-restaurant app into a system where many
restaurants can each run their own menu/orders/tables/staff under one
deployment, with you (Alex) managing subscriptions by hand through a private
Telegram bot — no payment gateway involved.

## What changed

- **Database**: every table (menu, orders, tables, loyalty, staff accounts,
  settings, exchange rates) is now scoped by `restaurant_id`. Your existing
  live database migrates automatically on first boot — your current
  restaurant becomes tenant `"default"` and keeps working with its existing
  printed QR codes, admin password, and kitchen PIN.
- **Login**: admin/kitchen now log in with the restaurant's **phone number +
  password**, since the phone number is what identifies which restaurant's
  dashboard to open.
- **Registration**: `/api/restaurants/register` lets a new restaurant sign
  itself up (name, phone, password) and get a 14-day free trial.
- **Owner bot**: a second, private Telegram bot only you can talk to.
  Commands: `/new`, `/list`, `/extend`, `/activate`, `/suspend`. This is how
  you create restaurants and turn their access on/off after they pay you
  (cash, Click, Payme, transfer — however you collect it).
- **QR codes**: now encode which restaurant a table belongs to
  (`?table=5&r=rest-abc123`). Your existing printed QR codes still work
  (they fall back to the `default` tenant) — reprint them from the Admin →
  QR tab once you're on the new version to get the explicit restaurant id.

## New environment variables (add to your `.env` on the server)

```
DEFAULT_TRIAL_DAYS=14
OWNER_API_SECRET=<openssl rand -hex 24>
OWNER_BOT_TOKEN=<from @BotFather — make a NEW bot, separate from your customer verification bot>
OWNER_TELEGRAM_IDS=<your numeric Telegram user id, comma-separated if more than one person>
OWNER_BOT_WEBHOOK_SECRET=<openssl rand -hex 24>
```

To get your numeric Telegram ID, message a bot like @userinfobot.

## Deploying

Same as before — `npm install`, `npm run build`, run `dist/server.cjs` (or
`npm run dev` locally). The database migration runs automatically the first
time the new code starts against your existing `data/restaurant.db`.

**Back up `data/restaurant.db` before deploying this**, as always with any
schema change — though the migration only adds data, it never deletes
anything.

## Using the owner bot day-to-day

1. Message your owner bot `/new +998901234567 Some Restaurant Name`
2. It replies with a login (the phone number) and an auto-generated
   password — send those to the client
3. They log in at `yourdomain.com?view=admin`, add their tables/menu, and
   get their own QR codes to print from the Admin → QR tab
4. When their 14-day trial is up (or whenever they pay you), message
   `/extend +998901234567 30` (or however many days) to keep them active
5. If someone doesn't pay, `/suspend +998901234567` — their app immediately
   stops serving customers/staff until you `/activate` or `/extend` again

## What's still worth doing next

- Per-restaurant branding (logo/colors) if you want to sell this as a
  white-label product rather than everyone seeing "Qulaycafe" styling
- Usage-based pricing tiers (e.g. limit menu items or tables on a free
  trial) if you want to upsell paid plans beyond a flat monthly fee

## Four surfaces, four hostnames (one server)

The three audiences must never land on each other's screens: a guest who
scans a table QR should not see a dashboard login, and the kitchen iPad
should not be one tap away from the price editor. Each audience therefore
has its own hostname, and the split is enforced twice — once by the server
and once by the bundle:

| Hostname | Surface | What it serves |
| --- | --- | --- |
| `qulaycafe.uz`, `www.qulaycafe.uz` | landing | the static marketing site in `landing/` |
| `clients.qulaycafe.uz` | clients | the guest app: menu, cart, delivery, booking |
| `kitchen.qulaycafe.uz` | kitchen | the kitchen display |
| `admin.qulaycafe.uz` | admin | the restaurant dashboard |

### DNS and TLS (one-time)

Add `clients`, `kitchen` and `admin` A records pointing at the same server
as `qulaycafe.uz`. Keep the old `app` record pointing there too — it is
still used for the legacy redirects below. The certificate has to cover
every hostname; a wildcard `*.qulaycafe.uz` plus the apex is simplest.

No new hosting and no second server: one process answers all of them.

### How the isolation works

`server.ts` resolves the surface from `req.hostname` before any session or
restaurant logic runs (`LANDING_HOSTNAMES` / `CLIENTS_HOSTNAMES` override
the defaults). The landing hostnames get `landing/` and never touch the
app. Guest deep links (`/order/…`, `/book/…`, `/table/…`) that arrive at the
apex are redirected to `clients.…` so a scanned QR never shows a pricing
page.

`src/utils/surface.ts` resolves the same four surfaces in the browser, and
`App.tsx` renders only that surface's tree. The admin and kitchen screens
live behind `React.lazy()` in a separate chunk (`StaffApp`), so a guest on
`clients.qulaycafe.uz` never downloads a byte of staff code — the isolation
shows up in the network tab, not just in the UI. `?surface=admin` exists for
development, where all four share `localhost:3000`; in production it is
refused unless `VITE_ALLOW_SURFACE_OVERRIDE=true`.

Authorization never depends on the hostname. It stays where it was: the
session cookie plus `requireRole` on every `/api` route.

### Links already out in the world

Table QR codes printed before the split, bookmarks and Telegram messages
point at `app.qulaycafe.uz`. Page requests there are 301-redirected to the
right surface — including the old `?view=admin` / `?view=kitchen` entry
points, whose query parameter is dropped on the way so it can never
re-enter the guest app. API calls and hashed assets keep answering on the
old hostname, so a tab that was open mid-order does not break. Set
`LEGACY_APP_HOSTNAMES` if the old hostname was something else.

Newly generated links always use the split hostnames: the dashboard builds
QR codes from `getClientsBaseUrl()`, and the bots build guest links from
`clientsBaseUrl()` in `src/server/publicUrls.ts`.

### Env vars to set at launch

`CLIENTS_URL`, `KITCHEN_URL`, `ADMIN_URL` (and the `VITE_` copies, which are
compiled in at build time — set them before `npm run build`),
`ALLOWED_ORIGINS` listing every surface that calls the API, and
`SESSION_COOKIE_DOMAIN=.qulaycafe.uz` so one staff login works across the
admin and kitchen hostnames. `.env.example` documents each one; `APP_URL`
keeps its old job as the origin Telegram registers webhooks against.

