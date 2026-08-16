import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { clientsBaseUrl, adminBaseUrl, kitchenBaseUrl, guestOrderUrl } from '../src/server/publicUrls';

// Pure unit tests — no server, no database. This module decides which
// hostname a link *sent to someone* points at, and getting it wrong is
// silent: a guest who scanned a QR code would be shown an admin login, and a
// restaurant owner would be sent to the guest menu. Both look fine in code
// review, so they are pinned here instead.

const ENV_KEYS = ['APP_URL', 'CLIENTS_URL', 'ADMIN_URL', 'KITCHEN_URL'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));

function clearSurfaceEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

beforeEach(() => {
  // The repo may hold a real .env; whatever the developer's machine has must
  // not decide what these tests assert.
  clearSurfaceEnv();
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('publicUrls: explicit configuration', () => {
  it('prefers the explicit per-surface URL over anything derived from APP_URL', () => {
    process.env.APP_URL = 'https://app.example.com';
    process.env.CLIENTS_URL = 'https://menu.example.net';
    process.env.ADMIN_URL = 'https://dash.example.net';
    process.env.KITCHEN_URL = 'https://kds.example.net';

    expect(clientsBaseUrl()).toBe('https://menu.example.net');
    expect(adminBaseUrl()).toBe('https://dash.example.net');
    expect(kitchenBaseUrl()).toBe('https://kds.example.net');
  });

  it('trims trailing slashes and surrounding whitespace', () => {
    process.env.CLIENTS_URL = '  https://clients.qulaycafe.uz///  ';
    expect(clientsBaseUrl()).toBe('https://clients.qulaycafe.uz');
  });

  it('returns null when neither the surface URL nor APP_URL is configured', () => {
    expect(clientsBaseUrl()).toBeNull();
    expect(adminBaseUrl()).toBeNull();
    expect(kitchenBaseUrl()).toBeNull();
    expect(guestOrderUrl('osh-markazi')).toBeNull();
  });

  it('treats a blank env var as unset rather than as an empty origin', () => {
    process.env.CLIENTS_URL = '   ';
    process.env.APP_URL = 'https://qulaycafe.uz';
    expect(clientsBaseUrl()).toBe('https://clients.qulaycafe.uz');
  });
});

describe('publicUrls: derivation from APP_URL', () => {
  it('prefixes the apex domain with the surface label', () => {
    process.env.APP_URL = 'https://qulaycafe.uz';
    expect(clientsBaseUrl()).toBe('https://clients.qulaycafe.uz');
    expect(adminBaseUrl()).toBe('https://admin.qulaycafe.uz');
    expect(kitchenBaseUrl()).toBe('https://kitchen.qulaycafe.uz');
  });

  it('swaps a leading app. label — the single-domain deployment this replaced', () => {
    process.env.APP_URL = 'https://app.qulaycafe.uz/';
    expect(clientsBaseUrl()).toBe('https://clients.qulaycafe.uz');
    expect(adminBaseUrl()).toBe('https://admin.qulaycafe.uz');
  });

  it('swaps a leading www. label instead of nesting under it', () => {
    process.env.APP_URL = 'https://www.qulaycafe.uz';
    expect(clientsBaseUrl()).toBe('https://clients.qulaycafe.uz');
    expect(kitchenBaseUrl()).toBe('https://kitchen.qulaycafe.uz');
  });

  it('swaps one surface label for another', () => {
    process.env.APP_URL = 'https://admin.qulaycafe.uz';
    expect(clientsBaseUrl()).toBe('https://clients.qulaycafe.uz');
    expect(kitchenBaseUrl()).toBe('https://kitchen.qulaycafe.uz');
    expect(adminBaseUrl()).toBe('https://admin.qulaycafe.uz');
  });

  it('keeps a deeper hostname intact, only prefixing it', () => {
    process.env.APP_URL = 'https://staging.qulaycafe.uz';
    expect(clientsBaseUrl()).toBe('https://clients.staging.qulaycafe.uz');
  });

  it('ignores a path on APP_URL and keeps only the origin', () => {
    process.env.APP_URL = 'https://qulaycafe.uz/some/path';
    expect(clientsBaseUrl()).toBe('https://clients.qulaycafe.uz');
  });

  it('uses ?surface= on localhost, where all four surfaces share one origin', () => {
    process.env.APP_URL = 'http://localhost:3000';
    expect(clientsBaseUrl()).toBe('http://localhost:3000');
    expect(adminBaseUrl()).toBe('http://localhost:3000/?surface=admin');
    expect(kitchenBaseUrl()).toBe('http://localhost:3000/?surface=kitchen');
  });

  it('treats 127.0.0.1 and *.local the same way as localhost', () => {
    process.env.APP_URL = 'http://127.0.0.1:3000';
    expect(adminBaseUrl()).toBe('http://127.0.0.1:3000/?surface=admin');
    process.env.APP_URL = 'http://mac.local:3000';
    expect(kitchenBaseUrl()).toBe('http://mac.local:3000/?surface=kitchen');
  });

  it('hands back an unparseable APP_URL untouched rather than inventing a host', () => {
    process.env.APP_URL = 'qulaycafe.uz';
    expect(clientsBaseUrl()).toBe('qulaycafe.uz');
  });
});

describe('publicUrls: guest order links', () => {
  it('builds the order link on the clients surface, never on admin', () => {
    process.env.APP_URL = 'https://app.qulaycafe.uz';
    expect(guestOrderUrl('osh-markazi')).toBe('https://clients.qulaycafe.uz/order/osh-markazi');
  });

  it('follows an explicit CLIENTS_URL', () => {
    process.env.CLIENTS_URL = 'https://menu.example.net/';
    expect(guestOrderUrl('demo')).toBe('https://menu.example.net/order/demo');
  });
});
