import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Guest reviews — integration tests against a real server on a throwaway
// database, same harness as api.test.ts but on its OWN port so the two files
// can run in parallel workers without fighting over one process.
//
// The point of the suite is the auth model of the submit endpoint: the guest
// has no session, so the ONLY thing that request carries is the order id —
// and everything else (what dishes exist on it, whether the meal is over,
// whether it was already rated) must be re-derived server-side from that.
// ---------------------------------------------------------------------------
const PORT = 4127;
const BASE_URL = `http://localhost:${PORT}`;
const DEMO_PHONE = '+998900000000';
let serverProcess: ChildProcess;
let tempDataDir: string;
let adminCookie: string;

// tsx compiles the server on first run, which on a cold start can take ~15s
// before the port is listening — 10s of retries flaked exactly there.
function waitForHealth(retries = 120): Promise<void> {
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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-test-'));
  serverProcess = spawn('npx', ['tsx', 'server.ts'], {
    cwd: process.cwd(),
    detached: true, // kill the whole group: tsx forks the real server
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATABASE_DIR: tempDataDir,
      JWT_SECRET: 'test-secret-at-least-16-chars',
      ADMIN_INITIAL_PASSWORD: 'test-admin-pass',
      KITCHEN_INITIAL_PIN: '9999',
      ALLOWED_ORIGINS: '',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_BOT_USERNAME: '',
      TELEGRAM_WEBHOOK_SECRET: '',
      ORDER_RATE_LIMIT_PER_MINUTE: '500'
    },
    stdio: 'pipe'
  });
  await waitForHealth();
  const loginRes = await fetch(`${BASE_URL}/api/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: DEMO_PHONE, password: 'test-admin-pass' })
  });
  adminCookie = loginRes.headers.get('set-cookie')!;
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

describe('guest reviews', () => {
  let orderId: string;
  let dishId: string;
  let otherDishId: string;

  let menu: any[];

  beforeAll(async () => {
    menu = await fetch(`${BASE_URL}/api/menu`).then(r => r.json());
    expect(menu.length).toBeGreaterThanOrEqual(2);
    dishId = menu[0].id;
    otherDishId = menu[1].id;

    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableNumber: 42,
        customerName: 'Review Guest',
        // The real cart sends the whole menu item object, and the server
        // stores it as-is (it only re-verifies the id/price) — so a nameless
        // placeholder here would come back out of the admin feed nameless.
        items: [
          { cartItemId: 'c1', menuItem: menu[0], quantity: 2, selectedCustomizations: [], itemTotal: menu[0].price * 2 },
          { cartItemId: 'c2', menuItem: menu[1], quantity: 1, selectedCustomizations: [], itemTotal: menu[1].price }
        ],
        subtotal: menu[0].price * 2 + menu[1].price,
        tax: 0,
        serviceCharge: 0,
        totalAmount: menu[0].price * 2 + menu[1].price
      })
    });
    expect(res.status).toBe(201);
    const order = await res.json();
    orderId = order.id;
  });

  // Moving the order along the pipeline is a staff action: without the admin
  // session cookie the PATCH is a 401 and the order never reaches 'served',
  // which cascades into the not-yet-served guard below.
  async function setStatus(status: string) {
    return fetch(`${BASE_URL}/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status })
    });
  }

  it('refuses to rate an order that has not been served yet', async () => {
    await setStatus('preparing');
    const res = await fetch(`${BASE_URL}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, ratings: [{ menuItemId: dishId, rating: 5 }] })
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('ORDER_NOT_SERVED');
  });

  it('rejects a rating for a dish that is not on the order', async () => {
    await setStatus('served');
    const res = await fetch(`${BASE_URL}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, ratings: [{ menuItemId: 'm-not-in-order', rating: 5 }] })
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('DISH_NOT_IN_ORDER');
  });

  it('rejects an out-of-range rating before it touches the database', async () => {
    const res = await fetch(`${BASE_URL}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, ratings: [{ menuItemId: dishId, rating: 9 }] })
    });
    expect(res.status).toBe(400);
  });

  it('accepts a full review once the order is served, with a comment', async () => {
    const res = await fetch(`${BASE_URL}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        ratings: [
          { menuItemId: dishId, rating: 2 },
          { menuItemId: otherDishId, rating: 5 }
        ],
        comment: 'Osh sovuq edi, choy ajoyib'
      })
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.saved).toBe(2);
  });

  it('refuses a second review for the same order', async () => {
    const res = await fetch(`${BASE_URL}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, ratings: [{ menuItemId: dishId, rating: 4 }] })
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('ALREADY_REVIEWED');
  });

  it('returns 404 for an order id that does not exist', async () => {
    const res = await fetch(`${BASE_URL}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'ORD-DOES-NOT-EXIST', ratings: [{ menuItemId: dishId, rating: 5 }] })
    });
    expect(res.status).toBe(404);
  });

  it('requires an admin session for the aggregate endpoint', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/reviews`);
    expect(res.status).toBe(401);
  });

  it('shows the review in the admin aggregates and recent list', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/reviews?days=30`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    const data = await res.json();

    const rated = data.summaries.find((s: any) => s.menuItemId === dishId);
    expect(rated).toBeTruthy();
    expect(rated.totalReviews).toBe(1);
    expect(rated.averageRating).toBe(2);
    expect(rated.ratingCounts[2]).toBe(1);

    const recent = data.recent.find((r: any) => r.orderId === orderId);
    expect(recent).toBeTruthy();
    expect(recent.comment).toBe('Osh sovuq edi, choy ajoyib');
    expect(recent.menuItemName).toBeTruthy();
    expect(recent.tableNumber).toBe(42);
  });

  it('rejects a malformed payload (no ratings, empty dish id)', async () => {
    const noRatings = await fetch(`${BASE_URL}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, ratings: [] })
    });
    expect(noRatings.status).toBe(400);

    // A fresh order so the already-reviewed guard does not mask validation.
    const menu: any[] = await fetch(`${BASE_URL}/api/menu`).then(r => r.json());
    const fresh = await (
      await fetch(`${BASE_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableNumber: 43,
          items: [{ cartItemId: 'c1', menuItem: { id: menu[0].id }, quantity: 1, selectedCustomizations: [], itemTotal: menu[0].price }],
          subtotal: menu[0].price,
          tax: 0,
          serviceCharge: 0,
          totalAmount: menu[0].price
        })
      })
    ).json();

    const emptyDish = await fetch(`${BASE_URL}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: fresh.id, ratings: [{ menuItemId: '', rating: 5 }] })
    });
    expect(emptyDish.status).toBe(400);
  });
});
