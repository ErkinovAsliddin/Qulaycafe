import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Separate server instance with Telegram actually "configured" (fake token,
// since we're not hitting the real Telegram API) so we can verify the
// webhook secret is actually enforced, not just documented.

const PORT = 4124;
const BASE_URL = `http://localhost:${PORT}`;
let serverProcess: ChildProcess;
let tempDataDir: string;

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
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-test-telegram-'));
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
      // Fake but present — enough to make telegramConfigured = true without
      // ever calling the real Telegram API in this test.
      TELEGRAM_BOT_TOKEN: 'fake-token-for-tests',
      TELEGRAM_BOT_USERNAME: 'FakeTestBot',
      TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret-value',
      // Owner bot, same idea: present but fake, so the reservations feature
      // flag can be flipped the only way production allows — from the owner
      // bot — instead of by reaching into the database behind the server.
      OWNER_BOT_TOKEN: 'fake-owner-token-for-tests',
      OWNER_TELEGRAM_IDS: '424242',
      OWNER_BOT_WEBHOOK_SECRET: 'test-owner-webhook-secret'
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

describe('telegram webhook security (with secret configured)', () => {
  it('reports configured: true', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/telegram/config`);
    const body = await res.json();
    expect(body.configured).toBe(true);
  });

  it('issues a real token when starting verification', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/telegram/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.deepLink).toContain('FakeTestBot');
  });

  it('rejects a webhook call with the wrong secret token', async () => {
    const res = await fetch(`${BASE_URL}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
      body: JSON.stringify({ message: { text: '/start faketoken', from: { id: 1, username: 'attacker' } } })
    });
    expect(res.status).toBe(401);
  });

  it('rejects a webhook call with no secret token header at all', async () => {
    const res = await fetch(`${BASE_URL}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { text: '/start faketoken', from: { id: 1, username: 'attacker' } } })
    });
    expect(res.status).toBe(401);
  });

  it('accepts a webhook call with the correct secret and marks the token verified', async () => {
    const startRes = await fetch(`${BASE_URL}/api/auth/telegram/start`, { method: 'POST' });
    const { token } = await startRes.json();

    const webhookRes = await fetch(`${BASE_URL}/api/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret-value'
      },
      body: JSON.stringify({
        message: { text: `/start ${token}`, from: { id: 555, username: 'real_customer', first_name: 'Test' } }
      })
    });
    expect(webhookRes.status).toBe(200);

    const statusRes = await fetch(`${BASE_URL}/api/auth/telegram/status/${token}`);
    const status = await statusRes.json();
    expect(status.status).toBe('verified');
    expect(status.telegramUsername).toBe('real_customer');
  });
});

// ---------------------------------------------------------------------------
// Table reservations. Booking exists ONLY inside the bot, so these tests drive
// the real webhook with the updates Telegram would post, and read the result
// back through the admin HTTP API — the same two halves the feature has in
// production. GUEST_CHAT_ID is deliberately not the admin's chat, so the
// authorization checks are exercised rather than assumed.
// ---------------------------------------------------------------------------
const DEMO_PHONE = '+998900000000';
const GUEST_CHAT_ID = 918273;
const OTHER_GUEST_CHAT_ID = 556677;

function guestUpdate(body: unknown, secret = 'test-webhook-secret-value') {
  return fetch(`${BASE_URL}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify(body)
  });
}

/** One typed message from a guest, exactly as Telegram delivers it. */
function guestSays(text: string, chatId = GUEST_CHAT_ID) {
  return guestUpdate({
    message: { chat: { id: chatId }, text, from: { id: chatId, username: 'guest_tester', first_name: 'Guest' } }
  });
}

function guestTaps(data: string, chatId = GUEST_CHAT_ID) {
  return guestUpdate({
    callback_query: {
      id: `cb-${Date.now()}`,
      data,
      from: { id: chatId, username: 'guest_tester', first_name: 'Guest' },
      message: { chat: { id: chatId }, message_id: 1 }
    }
  });
}

function ownerSays(text: string, chatId = 424242) {
  return fetch(`${BASE_URL}/api/owner-bot/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'test-owner-webhook-secret' },
    body: JSON.stringify({ message: { chat: { id: chatId }, text, from: { id: chatId, username: 'owner' } } })
  });
}

/** A date far enough ahead that "no past bookings" can never make it flaky. */
function futureDate(daysAhead = 3): string {
  const d = new Date(Date.now() + daysAhead * 24 * 3600_000);
  return d.toISOString().slice(0, 10);
}

describe('table reservations (bot-only booking)', () => {
  let adminCookie: string;
  let slug: string;

  beforeAll(async () => {
    const loginRes = await fetch(`${BASE_URL}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: DEMO_PHONE, password: 'test-admin-pass' })
    });
    expect(loginRes.status).toBe(200);
    adminCookie = loginRes.headers.get('set-cookie')!;
    const me = await (await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: adminCookie } })).json();
    slug = me.restaurantSlug;
    // A tenant without a slug has no booking deep link at all, so this is a
    // precondition of the whole feature, not incidental.
    expect(slug).toBeTruthy();
  }, 20_000);

  it('keeps reservations off until the owner bot turns them on', async () => {
    const me = await (await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: adminCookie } })).json();
    expect(me.reservationStatus).toBe('disabled');

    const listRes = await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } });
    expect(listRes.status).toBe(403);
  });

  it('refuses to start a booking while the feature is off', async () => {
    const res = await guestSays(`/start book_${slug}`);
    expect(res.status).toBe(200);
    // No session was created, so the next message is not treated as an answer:
    // it falls through to the verification handler, which is also a 200 — the
    // observable proof is that no reservation exists once the feature is on.
  });

  it('rejects an owner-bot command with the wrong secret', async () => {
    const res = await fetch(`${BASE_URL}/api/owner-bot/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
      body: JSON.stringify({ message: { chat: { id: 424242 }, text: '/reservations_on ' + DEMO_PHONE, from: { id: 424242 } } })
    });
    expect(res.status).toBe(401);
  });

  it('lets the owner bot enable the feature, which opens the admin routes', async () => {
    const res = await ownerSays(`/reservations_on ${DEMO_PHONE}`);
    expect(res.status).toBe(200);

    const me = await (await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: adminCookie } })).json();
    expect(me.reservationStatus).toBe('active');

    const listRes = await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } });
    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    expect(Array.isArray(body.reservations)).toBe(true);
    // The attempt made while the feature was disabled must not have booked.
    expect(body.reservations.length).toBe(0);
  });

  it('walks a guest through the whole booking conversation', async () => {
    const date = futureDate(3);
    expect((await guestSays(`/start book_${slug}`)).status).toBe(200);
    expect((await guestSays(date)).status).toBe(200);
    expect((await guestSays('19:30')).status).toBe(200);
    expect((await guestSays('4')).status).toBe(200);
    expect((await guestSays('Aziz')).status).toBe(200);
    expect((await guestSays('+998901234567')).status).toBe(200);
    // Everything is collected; the last step is the inline confirm button.
    expect((await guestTaps('rconfirm')).status).toBe(200);

    const body = await (
      await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } })
    ).json();
    expect(body.reservations.length).toBe(1);
    const reservation = body.reservations[0];
    expect(reservation.status).toBe('pending');
    expect(reservation.reservedDate).toBe(date);
    expect(reservation.reservedTime).toBe('19:30');
    expect(reservation.partySize).toBe(4);
    expect(reservation.guestName).toBe('Aziz');
    expect(reservation.guestPhone).toBe('+998901234567');
    expect(reservation.source).toBe('bot');
    expect(body.pendingCount).toBe(1);
  });

  it('rejects impossible answers instead of storing them', async () => {
    expect((await guestSays(`/start book_${slug}`, OTHER_GUEST_CHAT_ID)).status).toBe(200);
    // Past date, then a nonsense party size — the session must stay on the
    // failing step, so the booking never completes.
    await guestSays('2020-01-01', OTHER_GUEST_CHAT_ID);
    await guestSays('not-a-date', OTHER_GUEST_CHAT_ID);
    expect((await guestTaps('rconfirm', OTHER_GUEST_CHAT_ID)).status).toBe(200);

    const body = await (
      await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } })
    ).json();
    expect(body.reservations.length).toBe(1); // still only the valid one
  });

  it("does not let a random chat confirm someone else's booking", async () => {
    const list = await (
      await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } })
    ).json();
    const id = list.reservations[0].id;

    // No restaurant has this chat as its linked admin chat, so the tap must
    // be refused — and the booking must stay pending.
    expect((await guestTaps(`resv:confirm:${id}`, OTHER_GUEST_CHAT_ID)).status).toBe(200);

    const after = await (
      await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } })
    ).json();
    expect(after.reservations[0].status).toBe('pending');
  });

  it("does not let another guest's chat cancel a booking", async () => {
    const list = await (
      await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } })
    ).json();
    const id = list.reservations[0].id;

    expect((await guestTaps(`rgcancel:${id}`, OTHER_GUEST_CHAT_ID)).status).toBe(200);

    const after = await (
      await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } })
    ).json();
    expect(after.reservations[0].status).toBe('pending');
  });

  it('lets the admin confirm, assign a table, and reject a bad table number', async () => {
    const list = await (
      await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } })
    ).json();
    const id = list.reservations[0].id;

    const confirmRes = await fetch(`${BASE_URL}/api/admin/reservations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'confirmed', tableNumber: 1 })
    });
    expect(confirmRes.status).toBe(200);
    const confirmed = await confirmRes.json();
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.tableNumber).toBe(1);

    const badTableRes = await fetch(`${BASE_URL}/api/admin/reservations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ tableNumber: 9999 })
    });
    expect(badTableRes.status).toBe(400);

    const badStatusRes = await fetch(`${BASE_URL}/api/admin/reservations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'teleported' })
    });
    expect(badStatusRes.status).toBe(400);
  });

  it('lets the guest cancel their own booking from their own chat', async () => {
    const list = await (
      await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } })
    ).json();
    const id = list.reservations[0].id;

    expect((await guestTaps(`rgcancel:${id}`, GUEST_CHAT_ID)).status).toBe(200);

    const after = await (
      await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } })
    ).json();
    expect(after.reservations[0].status).toBe('cancelled');
    expect(after.pendingCount).toBe(0);
  });

  it('requires an admin session for reservation routes', async () => {
    expect((await fetch(`${BASE_URL}/api/admin/reservations`)).status).toBe(401);
    const patchRes = await fetch(`${BASE_URL}/api/admin/reservations/resv_whatever`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' })
    });
    expect(patchRes.status).toBe(401);
  });

  it('closes bookings again when the owner bot turns the feature off', async () => {
    expect((await ownerSays(`/reservations_off ${DEMO_PHONE}`)).status).toBe(200);
    const listRes = await fetch(`${BASE_URL}/api/admin/reservations`, { headers: { Cookie: adminCookie } });
    expect(listRes.status).toBe(403);
  });
});
