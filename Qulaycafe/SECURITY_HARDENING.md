# Security Hardening Report — Qulaycafe

> Performed: October 2026  
> Methodology: White-box code review + attacker simulation (pentester review of all attack surfaces)

---

## Summary

Nine vulnerabilities were found during a full-stack security audit. All have been fixed in code.
Two require **manual action on your server** (rotating exposed secrets and resetting the default
password). Those are marked ⚠️ ACTION REQUIRED.

| Severity | Finding | Status |
|----------|---------|--------|
| 🔴 CRITICAL | Weak default passwords (`1234`) in `.env` | ⚠️ ACTION REQUIRED |
| 🔴 CRITICAL | All secrets (bot tokens, webhook secrets, owner API key) exposed in `.env` | ⚠️ ACTION REQUIRED |
| 🟠 HIGH | CORS allowed ALL origins when `ALLOWED_ORIGINS` env var was empty | ✅ Fixed in code |
| 🟡 MEDIUM | JSON body size limit was 8MB (DoS vector) | ✅ Fixed in code |
| 🟡 MEDIUM | No HTTPS enforcement / HSTS header | ✅ Fixed in code |
| 🟡 MEDIUM | SSE client arrays unbounded (memory exhaustion DoS) | ✅ Fixed in code |
| 🟢 LOW | `changePasswordSchema` allowed 4-character passwords | ✅ Fixed in code |
| 🟢 LOW | CSP allowed entire `telegram.org` / `accounts.google.com` domains as script sources | ✅ Fixed in code |

---

## Finding 1 — CRITICAL: Weak default passwords

**File:** `.env`

**What an attacker could do:**

```bash
# Owns the entire admin dashboard in one request:
curl -X POST https://admin.qulaycafe.uz/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"1234"}'
# → 200 OK + session cookie
```

From there: read all orders, export all customer phone numbers and loyalty balances,
delete the menu, cancel orders — full admin access.

**Fix (manual — do this NOW):**

1. Log into the admin dashboard.
2. Go to Settings → Change Password.
3. Set a new password of at least 12 random characters.
4. Update `.env`:
   ```
   ADMIN_INITIAL_PASSWORD=<strong-random-16-chars>
   KITCHEN_INITIAL_PIN=<strong-random-12-chars>
   ```
5. Restart the server to pick up the new seed values (only matters for fresh deployments).

**Code change:** `changePasswordSchema` now enforces minimum 8 characters (`src/server/validation.ts`).

---

## Finding 2 — CRITICAL: Exposed secrets in `.env`

**File:** `.env`

The following live production secrets were in plaintext in a file that could be accessed
by anyone with shell access to the server, or accidentally committed to a repository:

| Variable | Risk if compromised |
|----------|-------------------|
| `TELEGRAM_BOT_TOKEN` | Attacker hijacks your customer-facing bot, sends fake messages to customers |
| `OWNER_BOT_TOKEN` | Attacker impersonates you to yourself, can trigger owner commands |
| `TELEGRAM_DELIVERY_BOT_TOKEN` | Attacker hijacks delivery notifications, redirects couriers |
| `TELEGRAM_WEBHOOK_SECRET` | Attacker can send fake Telegram webhook updates (fake order updates, fake reservations) |
| `OWNER_BOT_WEBHOOK_SECRET` | Same for owner bot |
| `DELIVERY_BOT_WEBHOOK_SECRET` | Same for delivery bot |
| `OWNER_API_SECRET` | Attacker can call `/api/owner/*` endpoints: create free restaurants, suspend competitors |

**Fix (manual — do this NOW, in order):**

1. **Revoke Telegram bot tokens** — open Telegram → @BotFather → select each bot → `/revoke`
   - `Primeresturant_bot` (customer bot)
   - Owner bot
   - `dostavvvvkaaaa_bot` (delivery bot)

2. **Generate new webhook secrets:**
   ```bash
   openssl rand -hex 24  # run 3 times for the 3 webhook secrets
   openssl rand -hex 24  # for OWNER_API_SECRET
   ```

3. **Update `.env`** with the new bot tokens (from BotFather) and new secrets.

4. **Re-register webhooks** by restarting the server (registration happens at startup via
   `registerWebhook()` calls in `server.ts`).

5. **Ensure `.env` is not committed:**
   ```bash
   grep '\.env' .gitignore   # should show: .env
   git log --all --full-history -- .env   # confirm it was never committed
   ```

---

## Finding 3 — HIGH: CORS allowed all origins on misconfiguration

**File:** `server.ts`

**Vulnerable code:**
```typescript
// OLD — BROKEN:
if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
  callback(null, true);  // ← empty allowlist = wildcard!
}
```

An empty `ALLOWED_ORIGINS` env var (misconfiguration, new deployment, typo) silently
opened CORS to every website on the internet. Any malicious website could make
cross-origin authenticated requests with the victim's session cookie — classic CSRF.

**Fixed code:**
```typescript
// NEW — SECURE:
if (!origin) {
  callback(null, true);           // same-origin always allowed
} else if (allowedOrigins.includes(origin)) {
  callback(null, true);           // explicitly whitelisted origin
} else {
  callback(new Error('Not allowed by CORS'));  // everything else blocked
}
// + startup warning if ALLOWED_ORIGINS is empty
```

---

## Finding 4 — MEDIUM: 8MB body limit (DoS vector)

**File:** `server.ts`

`express.json({ limit: '8mb' })` — an attacker could send thousands of 8MB POST requests
to any endpoint, forcing full JSON parse on every one. At 8MB × many connections, this
is enough to spike CPU and memory to OOM-kill the Node process.

**Fix:** Reduced to `2mb`. A 1MB photo encodes to ~1.37MB in base64 — well within 2MB.
No legitimate API payload needs more than that.

---

## Finding 5 — MEDIUM: No HTTPS enforcement

**File:** `server.ts`

Two defenses added:

**1. HTTP → HTTPS redirect middleware (production only):**
```typescript
if (isProd) {
  app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
    res.redirect(301, `https://${req.headers.host}${req.url}`);
  });
}
```

**2. HSTS header via Helmet (production only):**
```typescript
hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
```

- `maxAge: 31536000` = 1 year (browsers cache this and refuse HTTP for the whole year)
- `includeSubDomains: true` = admin/kitchen/clients subdomains all forced to HTTPS
- `preload: true` = can be submitted to browser HSTS preload lists for permanent enforcement

---

## Finding 6 — MEDIUM: Unbounded SSE client arrays (memory DoS)

**File:** `server.ts`

The three SSE client arrays (`staffClients`, `tableClients`, `orderClients`) had no maximum
size. An attacker from many IPs (or with spoofed IPs) could open tens of thousands of
`/api/events/table/:n` connections, growing the arrays until the process was OOM-killed.

**Fix:** Hard caps enforced before any connection is accepted:

| Array | Global cap | Per-restaurant cap | Env var to override |
|-------|-----------|-------------------|---------------------|
| `staffClients` | 200 | 30 | `SSE_MAX_STAFF_TOTAL` / `SSE_MAX_STAFF_PER_RESTAURANT` |
| `tableClients` | 2000 | 500 | `SSE_MAX_TABLE_TOTAL` / `SSE_MAX_TABLE_PER_RESTAURANT` |
| `orderClients` | 2000 | 500 | `SSE_MAX_ORDER_TOTAL` / `SSE_MAX_ORDER_PER_RESTAURANT` |

Requests over the cap receive `503 Service Unavailable` instead of opening a stream.

---

## Finding 7 — LOW: Weak password policy

**File:** `src/server/validation.ts`

`changePasswordSchema` enforced `min(4)`, meaning `"1234"` was a valid new password.
This combined with Finding 1 (the default password IS `"1234"`) made the system
trivially exploitable even after a password change.

**Fix:** Minimum raised to 8 characters with a clear user-facing error message.

```typescript
// BEFORE:
newPassword: z.string().min(4).max(200)

// AFTER:
newPassword: z.string().min(8, 'Password must be at least 8 characters').max(200)
```

---

## Finding 8 — LOW: CSP allowed entire script-host domains

**File:** `server.ts` (Helmet CSP config)

The Content Security Policy listed full origins as script sources:
```
scriptSrc: ["'self'", 'https://accounts.google.com', 'https://telegram.org']
```

This permitted **any script** hosted anywhere on `accounts.google.com` or `telegram.org`
to execute on your site — not just the specific SDKs you use. If either domain ever
hosts user-controlled content or is compromised, attacker scripts could run.

**Fix:** Pinned to exact script paths:
```typescript
scriptSrc: [
  "'self'",
  'https://accounts.google.com/gsi/client',        // exact path
  'https://telegram.org/js/telegram-web-app.js'    // exact path
]
```

**Additional headers added:**
- `X-Content-Type-Options: nosniff` — prevents MIME-type sniffing attacks
- `Referrer-Policy: strict-origin-when-cross-origin` — limits referer leakage
- `X-Frame-Options: DENY` (frameguard) — redundant with CSP `frame-ancestors 'none'`,
  but kept as a fallback for older browsers that don't support CSP Level 2

---

## Remaining known issues (not fixed — require external accounts)

### Phone sign-in has no OTP verification

Any customer can type any name + phone number and be treated as that identity.
This means someone who knows another customer's phone number could view their
loyalty point balance and potentially redeem points on their behalf.

**To fix properly:** Integrate an SMS OTP provider:
- Uzbekistan: [Eskiz.uz](https://eskiz.uz) — native, affordable
- International: Twilio, AWS SNS

This requires purchasing an account, which is why it's not included here.

---

## What was NOT found

- **SQL injection:** All database queries use parameterised prepared statements throughout
  `db.ts` and `auth.ts`. No string concatenation was found in runtime query paths.
- **Path traversal:** File operations in the server use `path.join` with `process.cwd()`,
  not user-supplied paths. No user input flows into `readFileSync`/`writeFileSync`.
- **XSS via stored content:** All user-supplied text is stored as JSON and rendered by React,
  which escapes HTML by default. The only place user text goes to a non-React context
  (Telegram bot messages) uses `escapeTelegramHtml()` explicitly.
- **IDOR on orders/tables:** Every query is scoped to `req.restaurantId`, which comes from
  the verified session token — never from the client request body.
- **Brute force:** Already protected — 5 failed attempts triggers a 15-minute lockout
  (database-backed in `login_attempts` table), plus a 10 req/min IP-based rate limiter.

---

## Deployment checklist before going live

- [ ] Rotate all Telegram bot tokens (Finding 2)
- [ ] Generate and set new webhook secrets and OWNER_API_SECRET (Finding 2)
- [ ] Change admin password from `1234` to something strong (Finding 1)
- [ ] Change kitchen PIN from `1234` to something strong (Finding 1)
- [ ] Verify `ALLOWED_ORIGINS` lists all your hostnames in `.env`
- [ ] Verify `NODE_ENV=production` is set (enables HSTS + HTTPS redirect)
- [ ] Confirm `.env` is in `.gitignore` and was never committed
- [ ] Run `bun test` — all tests should pass
