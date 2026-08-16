# Deployment & Hardening Guide

Your 25-item list, mapped honestly to what's done in code vs. what only
exists once you have a real domain/server — those items need YOUR
decisions (which host, which domain) so they can't be pre-built here.

## ✅ Done in code (already in this build)

**1. Authentication** — bcrypt-hashed passwords, JWT session cookies,
brute-force lockout. See `src/server/auth.ts`.

**11. Input validation and sanitization** — every endpoint validated with
zod schemas (`src/server/validation.ts`) before touching the database.

**12. Rate limiting** — global (300 req/min), auth endpoints (10/min),
order placement (20/min). See `server.ts`.

**18. Network security (app-level)** — Helmet security headers, explicit
CORS allowlist, cookies are httpOnly/sameSite/secure-in-production.

**20. Idempotency** — order creation accepts an `Idempotency-Key` header;
a retried request returns the original order instead of duplicating it.

**21. Automated testing** — `tests/api.test.ts` covers auth, authorization,
validation, and idempotency. Run with `npm test`.

**23. Secrets management (app-level)** — all secrets read from environment
variables, never hardcoded; `.env` is git-ignored; `.env.example`
documents every required value.

**9. Scalable database design (initial)** — moved from in-memory arrays to
SQLite with WAL mode (safe concurrent writes). This is the right choice for
a single restaurant's traffic. See "When to upgrade to Postgres" below.

**7. Fault tolerance (partial)** — real errors are surfaced instead of
silently faking success; the server validates and rejects bad input instead
of crashing on it.

**8. Backups (mechanism)** — `scripts/backup.sh` + an admin-only on-demand
backup endpoint. You still need to schedule it and ship backups off-server
(below).

---

## 🔧 Needs your setup (infrastructure-level — can't be done from code alone)

These only make sense once you've picked a host and a domain. Here's
exactly what to do for each.

### 3. DNS configuration
1. Buy a domain (Namecheap, GoDaddy, or via Hostinger directly).
2. Point an **A record** at your server's IP address (Hostinger VPS or AWS
   EC2/Elastic IP).
3. Add a `www` **CNAME** pointing to the root domain.
4. Add one record per surface — `clients`, `kitchen` and `admin` — all
   pointing at the same server. The app serves a different audience on each
   hostname (see MULTI_TENANT_UPGRADE.md), so all four must resolve, and the
   TLS certificate must cover all four (a wildcard `*.yourdomain` plus the
   apex is simplest). Keep the old `app` record if you ever served
   everything from it: page requests there are redirected to the right
   surface so printed QR codes keep working.
5. If you use Cloudflare (recommended, see CDN/DDoS below), point your
   domain's nameservers at Cloudflare instead, and manage DNS there.

### 16. CDN configuration & 14. Edge computing
- Put **Cloudflare** (free tier is enough) in front of your server. This
  single step also covers most of DDoS protection and a chunk of
  performance optimization.
- Steps: create a Cloudflare account → add your domain → update your
  domain's nameservers to Cloudflare's → enable the orange-cloud proxy on
  your DNS A record → turn on "Always Use HTTPS" and "Auto Minify" under
  Speed settings.
- Set `app.set('trust proxy', 1)` (already done in `server.ts`) so rate
  limiting sees the real visitor IP through Cloudflare's proxy.

### 10. DDoS protection
- Cloudflare's free tier absorbs the vast majority of DDoS traffic before
  it reaches your server — this is the single highest-value step here.
- On your VPS/EC2, also restrict which ports are open (see Network
  Security below) so nothing besides 80/443 is internet-facing.

### 6. Scalability and load management
- For one restaurant, a single small VPS (Hostinger's cheapest VPS tier, or
  an AWS `t3.small`) comfortably handles the expected traffic (a few dozen
  concurrent diners scanning QR codes).
- If you later sell this to multiple restaurants, plan to run one instance
  (one SQLite file) per restaurant rather than one shared instance — it's
  simpler to scale and keeps each restaurant's data cleanly isolated. At
  that point, also consider migrating to Postgres (see below).

### 9. Scalable database design — when to upgrade to Postgres
SQLite (current setup) is genuinely fine for a single restaurant. Upgrade
to Postgres (e.g. via a managed instance on AWS RDS, or Hostinger's
database hosting) once any of these become true:
- You're running multiple restaurants off one shared server/instance.
- You need multiple app server instances behind a load balancer (SQLite is
  single-writer; it doesn't support that).
- Order volume exceeds a few thousand orders/day.

### 4. Stress testing
Install [k6](https://k6.io) (free, open source) and run something like:
```bash
# save as load-test.js
import http from 'k6/http';
export const options = { vus: 50, duration: '30s' };
export default function () {
  http.get('https://yourrestaurant.com/api/menu');
}
```
```bash
k6 run load-test.js
```
Run this against your real deployed URL (not this sandbox) and watch
response times and error rates in the output. Start with 50 virtual users,
then try 200+ to see where it breaks.

### 5. Penetration testing
- Run **OWASP ZAP** (free) in baseline scan mode against your live URL:
  `docker run -t zaproxy/zap-stable zap-baseline.py -t https://yourrestaurant.com`
- This checks for the OWASP Top 10 (injection, broken auth, XSS, etc.) and
  gives you a report. Fix anything it flags as High/Medium before handing
  the app to a real client.
- A true professional pentest engagement is worth commissioning once you're
  charging multiple clients — not necessary for a single small restaurant
  launch.

### 17. Monitoring and alerting
- **UptimeRobot** (free tier): point it at `https://yourrestaurant.com/api/health`
  (already implemented) and it'll text/email you if the server goes down.
- For error tracking, consider **Sentry**'s free tier — a few lines of SDK
  setup will catch and alert on server exceptions in production.

### 18. Network security (server-level, beyond app headers)
- On your VPS/EC2, only open ports 80 (HTTP, redirect to HTTPS) and 443
  (HTTPS) to the public internet. SSH (22) should be restricted to your own
  IP or use a VPN/bastion.
- Use a firewall: `ufw allow 80,443/tcp` and `ufw enable` on a Hostinger
  VPS, or Security Groups on AWS EC2.
- Get a free TLS certificate via **Let's Encrypt** (`certbot`) if you're not
  using Cloudflare's proxy (which provides HTTPS automatically).

### 19. API integrations
Covered in the earlier build guide (Telegram bot for order alerts). If you
add Payme/Click for payments later, their sandbox/test credentials should
go through the same `.env` secrets pattern already set up here — never
hardcode API keys in the source.

### 22. Webhooks
Not currently needed (no third-party service calls into this app yet). If
you add a payment provider later, their webhook endpoint should verify the
provider's signature header before trusting the payload — ask me to add
this when you pick a payment provider, since the exact signature scheme
differs per provider.

### 24. Security and code audits
- `SECURITY_AUDIT.md` in this repo documents the audit already performed
  and what was fixed.
- Re-run `npm run lint` (TypeScript check) and `npm test` before every
  deploy — both are already wired up and passing.
- Consider a fresh OWASP ZAP scan (see Penetration Testing above)
  periodically, especially after adding new features.

### 25. Stateless deployments
- The app itself is stateless (no in-memory session storage — sessions are
  JWTs, verified fresh on each request). The one piece of state is the
  SQLite file, which must live on a **persistent volume**, not the
  container's ephemeral filesystem.
- On Docker/AWS: mount a volume at `/app/data` (already set up in the
  Dockerfile via `VOLUME ["/app/data"]`) — e.g. an EBS volume on EC2, or a
  bind mount to the VPS's disk on Hostinger.
- This means you CAN redeploy/restart the container freely without losing
  data, as long as that volume persists across deploys.

### 2. Analytics & 13. Caching & 15. Web performance optimization
- Static asset caching is already configured in `server.ts` (1-year
  cache for hashed build files, no-cache for `index.html` so deploys are
  picked up immediately).
- Cloudflare's CDN (above) caches static assets at edge locations globally,
  which is the biggest performance win available without further app changes.
- For business analytics beyond what's in the admin dashboard already,
  consider a lightweight, privacy-respecting tool like Plausible or
  Cloudflare Web Analytics (both simple to add later).

---

## Quick-start deploy checklist

1. Generate a real `JWT_SECRET`: `openssl rand -base64 48`
2. Set `ADMIN_INITIAL_PASSWORD` and `KITCHEN_INITIAL_PIN` to strong,
   restaurant-specific values (not the defaults used in testing).
3. Set `ALLOWED_ORIGINS` to every surface that calls the API
   (`https://clients.…,https://kitchen.…,https://admin.…`), and
   `SESSION_COOKIE_DOMAIN=.yourdomain` so one staff login covers the admin
   and kitchen hostnames. Set `CLIENTS_URL` / `KITCHEN_URL` / `ADMIN_URL`
   and their `VITE_` copies **before** `npm run build` — the `VITE_` ones are
   compiled into the bundle.
4. Set `DATABASE_DIR` to a path on a persistent volume.
5. `npm run build && npm start` (or `docker build` + `docker run` with the
   volume mounted).
6. Put Cloudflare in front of it (DNS + CDN + DDoS protection in one step).
7. Point UptimeRobot at `/api/health`.
8. Schedule `scripts/backup.sh` via cron, and copy backups off-server
   periodically (e.g. to a cheap S3 bucket or Google Drive).
9. Run the k6 load test and the ZAP baseline scan against the live URL
   before handing off to the client.
10. After first boot, log into the admin dashboard and change the admin
    password / kitchen PIN from the Security settings tab (don't leave the
    bootstrap values in place).
