import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// The whole point of the four-surface split is that a guest can never land on
// a staff screen and a scanned QR code can never land on the marketing page.
// That guarantee lives in one hostname-routing middleware stack in server.ts,
// and nothing else in this suite exercised it — every other test talks to
// localhost, which is a single surface by design.
//
// `trust proxy` is on (the app runs behind Nginx/Cloudflare in production), so
// X-Forwarded-Host is what req.hostname reads — the same mechanism a real
// reverse proxy uses, which is why these tests can drive four hostnames
// against one local port.

const PORT = 4125;
const BASE_URL = `http://localhost:${PORT}`;

const LANDING_HOST = 'qulaycafe.test';
const CLIENTS_HOST = 'clients.qulaycafe.test';
const LEGACY_HOST = 'app.qulaycafe.test';
const CLIENTS_URL = `https://${CLIENTS_HOST}`;
const KITCHEN_URL = 'https://kitchen.qulaycafe.test';
const ADMIN_URL = 'https://admin.qulaycafe.test';

let serverProcess: ChildProcess;
let tempDataDir: string;

/** GET as if a reverse proxy forwarded it for `host`, without following redirects. */
function getAs(host: string, urlPath: string) {
  return fetch(`${BASE_URL}${urlPath}`, {
    headers: { 'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https' },
    redirect: 'manual'
  });
}

function waitForHealth(retries = 40): Promise<void> {
  return new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      fetch(`${BASE_URL}/api/health`)
        .then(res => (res.ok ? resolve() : retry(n)))
        .catch(() => retry(n));
    };
    const retry = (n: number) => {
      if (n <= 0) return reject(new Error('Server did not become healthy in time'));
      setTimeout(() => attempt(n - 1), 250);
    };
    attempt(retries);
  });
}

beforeAll(async () => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-test-surface-'));
  serverProcess = spawn('npx', ['tsx', 'server.ts'], {
    cwd: process.cwd(),
    // Own process group — see the note in api.test.ts: `tsx` forks the real
    // server, so only a group kill actually frees this port.
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATABASE_DIR: tempDataDir,
      JWT_SECRET: 'test-secret-at-least-16-chars',
      ADMIN_INITIAL_PASSWORD: 'test-admin-pass',
      KITCHEN_INITIAL_PIN: '9999',
      ALLOWED_ORIGINS: '',
      // Test hostnames, so a developer's real .env can't decide the assertions.
      LANDING_HOSTNAMES: `${LANDING_HOST},www.${LANDING_HOST}`,
      CLIENTS_HOSTNAMES: CLIENTS_HOST,
      LEGACY_APP_HOSTNAMES: LEGACY_HOST,
      CLIENTS_URL,
      KITCHEN_URL,
      ADMIN_URL,
      // Blank (but present, so dotenv can't fill them in): no outbound
      // Telegram webhook registration from a test run.
      APP_URL: '',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_BOT_USERNAME: '',
      TELEGRAM_WEBHOOK_SECRET: '',
      OWNER_BOT_TOKEN: '',
      OWNER_TELEGRAM_IDS: ''
    },
    stdio: 'pipe'
  });
  await waitForHealth();
}, 30_000);

afterAll(() => {
  if (serverProcess?.pid) {
    try {
      process.kill(-serverProcess.pid, 'SIGKILL');
    } catch {
      serverProcess.kill('SIGKILL');
    }
  }
  if (tempDataDir) fs.rmSync(tempDataDir, { recursive: true, force: true });
});

describe('landing hostname serves only the marketing site', () => {
  // Both documents are React roots since the marketing page moved to
  // src/landing, so `id="root"` no longer tells them apart — the
  // <meta name="qulaycafe-surface"> marker in each index.html does.
  const LANDING_MARKER = 'name="qulaycafe-surface" content="landing"';
  const APP_MARKER = 'name="qulaycafe-surface" content="app"';

  it('serves the landing page, not the app shell', async () => {
    const res = await getAs(LANDING_HOST, '/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(LANDING_MARKER);
    expect(html).not.toContain(APP_MARKER);
  });

  it('serves the landing page for an unknown path instead of falling through to the app', async () => {
    const res = await getAs(LANDING_HOST, '/nothing-here');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(LANDING_MARKER);
    expect(html).not.toContain(APP_MARKER);
  });

  it('redirects a scanned QR deep link to the guest surface', async () => {
    for (const deepLink of ['/order/demo', '/book/demo', '/table/5']) {
      const res = await getAs(LANDING_HOST, deepLink);
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe(`${CLIENTS_URL}${deepLink}`);
    }
  });

  it('keeps the table query string when redirecting a deep link', async () => {
    const res = await getAs(LANDING_HOST, '/table/5?table=5');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${CLIENTS_URL}/table/5?table=5`);
  });

  it('still answers API calls on the landing hostname', async () => {
    const res = await getAs(LANDING_HOST, '/api/health');
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBeTruthy();
  });
});

describe('guest hostname serves the app', () => {
  it('serves the SPA shell, not the landing page', async () => {
    const res = await getAs(CLIENTS_HOST, '/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="qulaycafe-surface" content="app"');
    expect(html).not.toContain('name="qulaycafe-surface" content="landing"');
  });
});

describe('legacy single-domain hostname redirects instead of breaking', () => {
  it('sends a printed table QR to the guest surface', async () => {
    const res = await getAs(LEGACY_HOST, '/table/7?table=7');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${CLIENTS_URL}/table/7?table=7`);
  });

  it('sends ?view=admin to the admin hostname and drops the parameter', async () => {
    const res = await getAs(LEGACY_HOST, '/?view=admin');
    expect(res.status).toBe(301);
    const location = res.headers.get('location') as string;
    expect(location).toBe(`${ADMIN_URL}/`);
    // If this parameter survived the redirect it could re-enter the guest app.
    expect(location).not.toContain('view=');
  });

  it('sends ?view=kitchen to the kitchen hostname', async () => {
    const res = await getAs(LEGACY_HOST, '/?view=kitchen');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${KITCHEN_URL}/`);
  });

  it('keeps unrelated query parameters while dropping view=', async () => {
    const res = await getAs(LEGACY_HOST, '/?view=admin&tab=orders');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ADMIN_URL}/?tab=orders`);
  });

  it('does not redirect API calls — a tab open mid-order must keep working', async () => {
    const res = await getAs(LEGACY_HOST, '/api/health');
    expect(res.status).toBe(200);
  });

  it('does not redirect hashed asset requests', async () => {
    const res = await getAs(LEGACY_HOST, '/assets/nonexistent-abc123.js');
    expect(res.status).not.toBe(301);
  });

  it('does not redirect a POST', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Host': LEGACY_HOST },
      body: JSON.stringify({ phone: '+998900000000', password: 'wrong-password' }),
      redirect: 'manual'
    });
    expect(res.status).not.toBe(301);
  });
});

describe('hostname never grants authorization', () => {
  it('refuses an admin endpoint on the admin hostname without a session', async () => {
    const res = await getAs('admin.qulaycafe.test', '/api/admin/analytics');
    expect(res.status).toBe(401);
  });

  it('refuses a kitchen endpoint on the kitchen hostname without a session', async () => {
    const res = await getAs('kitchen.qulaycafe.test', '/api/orders');
    expect(res.status).toBe(401);
  });
});
