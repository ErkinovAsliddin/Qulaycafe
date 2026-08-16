# Security Audit — What Was Wrong, What Was Fixed

This documents the actual findings from auditing the original AI-Studio-generated
build, and exactly what changed. Read this before you tell a client "it's secure" —
know what you're vouching for.

## Critical issues found in the original build

1. **Fake authentication.** Admin/kitchen password was stored in plaintext in
   `localStorage` and compared client-side in the browser. Anyone could open
   DevTools, read the password, or simply flip a React state variable to bypass
   login entirely. There was no real login system.

2. **No persistent database.** All orders, menu items, and tables lived in a
   JavaScript array in server memory. Every restart, deploy, or crash wiped
   all data — unusable for a real restaurant's daily operations.

3. **No server-side authorization.** Every mutating API endpoint (`POST
   /api/menu`, `DELETE /api/tables/:id`, etc.) had zero auth checks on the
   server. The login screen was UI theater — anyone who found the API URL
   (trivial, since it's the same origin as the site) could edit the menu or
   delete tables with a single curl command, whether or not they'd ever seen
   the login screen.

4. **Silent fake-success bugs.** If a network request failed (poor wifi,
   server hiccup, validation rejection), the app quietly fabricated a
   success in the browser — showing the customer "Order placed!" or the
   admin "Saved!" when nothing reached the server. In daily use this means
   lost orders the kitchen never sees, and menu edits that silently don't
   persist.

5. **Data exposure via the real-time stream.** The server-sent-events
   broadcast sent every order (all tables) and the entire loyalty member
   list (names, phone numbers, emails, points balances) to every connected
   browser tab — including customers sitting at other tables.

6. **Mocked Google Sign-In.** The Google auth flow fabricated a fake token
   client-side; it never verified anything with Google. See "Known
   limitations" below — this one still needs your input to finish properly.

7. **No input validation.** Any field (price, quantity, name, notes) could
   be sent as any value/type/length, including negative prices or
   megabyte-long strings.

8. **A demo user was hardcoded as the default signed-in customer** ("Alex
   Bek", a fake email) — every first-time visitor would appear pre-signed-in
   as this fake account rather than being asked to actually sign in.

## What was fixed

| Area | Before | After |
|---|---|---|
| Data storage | In-memory array, wiped on restart | SQLite file on disk, survives restarts/crashes/deploys |
| Admin/kitchen login | Plaintext password in localStorage, client-side check | bcrypt-hashed password in the database, verified server-side, real session cookie |
| Session handling | None | Signed JWT in an httpOnly, sameSite cookie (not readable by JS, not stealable via XSS) |
| Authorization | None on the server | Every mutating endpoint requires a valid admin/kitchen session; verified with automated tests |
| Brute force protection | None | Rate limiter (10 attempts/min) + a database-backed lockout after 5 failed attempts (15 min) |
| Input validation | None | Every request body validated against a strict schema (type, range, length) before touching the database |
| Order pricing | Trusted client-submitted totals | Server recomputes/cross-checks totals against actual menu prices before accepting an order |
| Duplicate orders | Possible on retry/double-tap | Idempotency-Key support: a repeated submission returns the original order instead of creating a second one |
| Failed requests | Silently faked as "success" | Real error shown to the user; nothing is faked |
| Real-time updates | Broadcast everything to everyone | Customers only receive their own table's order status + menu updates; full detail (all orders, loyalty list) only streams to authenticated staff sessions |
| Security headers | None | Helmet (CSP, HSTS, clickjacking protection, etc.) |
| CORS | Open (or default-open) | Explicit allowlist of origins from an environment variable |
| Request body size | 50MB limit (from the original scaffold) | 2MB — no legitimate request here needs more |
| Logging | `console.log` only | Structured JSON logs (pino), request logging, secrets redacted from logs |
| Backups | None | On-demand backup endpoint (admin-only) + a cron-ready backup script |
| Google Sign-In | Fully mocked; typing any email in a hidden field logged you in as that identity, no verification | Real Google Identity Services button; ID token cryptographically verified server-side via `google-auth-library`. Requires you to set `GOOGLE_CLIENT_ID` in `.env` — the app clearly refuses (no fake login) until you do |
| Default demo user | Auto-signed-in as a fake "Alex Bek" account | Requires a real sign-in; no default identity |

## Known limitations — still need your input

- **Phone-number sign-in has no verification (no OTP/SMS code sent).**
  Anyone can type any name + phone number and be treated as that identity —
  including viewing/redeeming someone else's loyalty points if they guess or
  know that number. This wasn't part of what you asked me to fix yet, but
  it's the same category of bug as the Google sign-in issue was, so flagging
  it now: fixing this properly needs an SMS provider account (e.g. Eskiz.uz
  for Uzbekistan, or Twilio) since real OTP delivery costs money and needs
  your account credentials — let me know if/when you want this wired in.
- **Automated tests cover the core security paths** (auth, authorization,
  validation, idempotency, rate limiting) but are not exhaustive — treat
  them as a regression safety net, not a substitute for the load/penetration
  testing described in `DEPLOYMENT_AND_HARDENING.md`.
- **This app has one shared admin account and one shared kitchen PIN**, not
  per-staff-member logins. That matches the original design brief, but means
  you can't attribute an action to a specific staff member. Worth knowing if
  you ever need an audit trail of "who confirmed this order."

## Currency: converted from USD-style pricing to Uzbek so'm

The original build displayed every price with a `$` sign and stored menu
prices/order totals as small decimal numbers (e.g. `9.50`) — fine for a US
demo, wrong for a real Uzbekistan deployment. This was changed:

- All price displays now go through `src/utils/currency.ts` (`formatSom`),
  which renders whole-number so'm with thousands separators (e.g.
  `114 000 so'm`) instead of a `$` with cents.
- Seeded menu prices in `src/data/mockData.ts` were converted from
  dollar-scale to realistic so'm-scale figures (~12,000 so'm per implied
  dollar, rounded to the nearest 1,000 so'm) — replace these with the
  client's real menu prices before launch.
- The loyalty points program was recalibrated for so'm amounts: customers
  now earn 1 point per 1,000 so'm spent, and each point is worth 100 so'm
  when redeemed (both in `server.ts` and `CartDrawer.tsx` — kept in sync).
- Tax (8%) and service charge (5%) percentages are unchanged — they're
  currency-agnostic since they're percentage-based.
