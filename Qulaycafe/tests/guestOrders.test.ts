import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Order } from '../src/types';

// Unlike the other suites here this one spawns nothing: guestOrders.ts is pure
// logic over localStorage, so it gets a stub instead of a browser and no port.
// Worth testing directly because it is what decides whether one customer can see
// another's receipts, and its pruning/merge rules are easy to break silently.
class MemoryStorage {
  private map = new Map<string, string>();
  /** Set to make every access throw, the way private-mode Safari does. */
  throwOnAccess = false;
  getItem(k: string) {
    if (this.throwOnAccess) throw new Error('blocked');
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.throwOnAccess) throw new Error('blocked');
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  raw(k: string) {
    return this.map.get(k);
  }
}

let store: MemoryStorage;
// Imported lazily inside the tests so the stub is in place first.
let mod: typeof import('../src/utils/guestOrders');

beforeEach(async () => {
  store = new MemoryStorage();
  (globalThis as any).localStorage = store;
  mod = await import('../src/utils/guestOrders');
});

afterEach(() => {
  delete (globalThis as any).localStorage;
});

function order(id: string, over: Partial<Order> = {}): Order {
  const now = new Date().toISOString();
  return {
    id,
    tableNumber: 1,
    customerName: 'Guest',
    customerPhoneOrEmail: '+998900000001',
    items: [],
    subtotal: 1000,
    tax: 0,
    serviceCharge: 0,
    discount: 0,
    totalAmount: 1000,
    status: 'pending',
    paymentStatus: 'unpaid',
    createdAt: now,
    updatedAt: now,
    estimatedMinutes: 15,
    loyaltyPointsEarned: 1,
    loyaltyPointsRedeemed: 0,
    ...over
  };
}

describe('guest order memory', () => {
  it('starts empty, so a guest who has ordered nothing sees nothing', () => {
    expect(mod.loadGuestOrders('default')).toEqual([]);
  });

  it('remembers what this device placed and reloads it', () => {
    mod.rememberGuestOrder('default', order('ORD-1'));
    expect(mod.loadGuestOrders('default').map(o => o.id)).toEqual(['ORD-1']);
  });

  it('keeps restaurants apart, so one cafe never shows another cafe receipts', () => {
    mod.rememberGuestOrder('cafe-a', order('ORD-A'));
    expect(mod.loadGuestOrders('cafe-b')).toEqual([]);
  });

  it('drops entries older than one visit, so the same phone starts fresh next time', () => {
    mod.rememberGuestOrder('default', order('ORD-OLD'));
    // Age the stored entry past the window by rewriting savedAt directly — the
    // module prunes on savedAt, not on the order timestamp.
    const key = 'qulaycafe_my_orders_default';
    const aged = JSON.parse(store.raw(key)!).map((e: any) => ({
      ...e,
      savedAt: Date.now() - mod.GUEST_SESSION_MS - 1000
    }));
    store.setItem(key, JSON.stringify(aged));

    expect(mod.loadGuestOrders('default')).toEqual([]);
  });

  it('replaces rather than duplicates when the same order is remembered twice', () => {
    mod.rememberGuestOrder('default', order('ORD-1', { status: 'pending' }));
    const after = mod.rememberGuestOrder('default', order('ORD-1', { status: 'served' }));
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe('served');
  });

  it('newest first', () => {
    mod.rememberGuestOrder('default', order('ORD-1'));
    mod.rememberGuestOrder('default', order('ORD-2'));
    expect(mod.loadGuestOrders('default').map(o => o.id)).toEqual(['ORD-2', 'ORD-1']);
  });

  it('survives corrupt storage instead of blanking the menu', () => {
    store.setItem('qulaycafe_my_orders_default', '{not json');
    expect(mod.loadGuestOrders('default')).toEqual([]);
  });

  it('survives storage that throws on every access', () => {
    store.throwOnAccess = true;
    expect(mod.loadGuestOrders('default')).toEqual([]);
    // The write path still hands back the list so the current page view works.
    expect(mod.rememberGuestOrder('default', order('ORD-1')).map(o => o.id)).toEqual(['ORD-1']);
  });
});

describe('syncing stored receipts with the live feed', () => {
  it('reports no change when the live copy is identical, so no needless re-render', () => {
    const o = order('ORD-1');
    mod.rememberGuestOrder('default', o);
    expect(mod.syncGuestOrders('default', [o])).toBeNull();
  });

  it('picks up a status change from the kitchen', () => {
    const o = order('ORD-1');
    mod.rememberGuestOrder('default', o);
    const updated = { ...o, status: 'served' as const, updatedAt: new Date(Date.now() + 1000).toISOString() };

    const merged = mod.syncGuestOrders('default', [updated]);
    expect(merged?.[0].status).toBe('served');
    expect(mod.loadGuestOrders('default')[0].status).toBe('served');
  });

  it('does not forget an order just because the live feed no longer carries it', () => {
    // Exactly what happens after payment: the table endpoint stops serving the
    // order, but it is still this guest's own receipt.
    mod.rememberGuestOrder('default', order('ORD-1'));
    expect(mod.syncGuestOrders('default', [])).toBeNull();
    expect(mod.loadGuestOrders('default').map(o => o.id)).toEqual(['ORD-1']);
  });

  it('never adds someone else order from the shared table feed', () => {
    mod.rememberGuestOrder('default', order('ORD-MINE'));
    mod.syncGuestOrders('default', [order('ORD-THEIRS')]);
    expect(mod.loadGuestOrders('default').map(o => o.id)).toEqual(['ORD-MINE']);
  });
});

describe('is this order part of the session happening now', () => {
  it('accepts a fresh unsettled order', () => {
    expect(mod.isCurrentTableSession(order('ORD-1'))).toBe(true);
  });

  it('accepts one that is served but unpaid — the guest is still eating', () => {
    expect(mod.isCurrentTableSession(order('ORD-1', { status: 'served' }))).toBe(true);
  });

  it('rejects a settled order: that visit is over', () => {
    expect(mod.isCurrentTableSession(order('ORD-1', { status: 'paid' }))).toBe(false);
    expect(mod.isCurrentTableSession(order('ORD-1', { status: 'cancelled' }))).toBe(false);
  });

  it('rejects a ticket left open from hours ago, which staff simply never closed', () => {
    const stale = order('ORD-1', {
      createdAt: new Date(Date.now() - mod.GUEST_SESSION_MS - 60_000).toISOString()
    });
    expect(mod.isCurrentTableSession(stale)).toBe(false);
  });

  it('does not hide a live ticket over an unreadable timestamp', () => {
    expect(mod.isCurrentTableSession(order('ORD-1', { createdAt: 'not-a-date' }))).toBe(true);
  });
});
