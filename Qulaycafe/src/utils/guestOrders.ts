import { Order } from '../types';

// ---------------------------------------------------------------------------
// Which orders belong to THIS guest.
//
// A dine-in guest has no account and no session, so the only thing that ever
// identified them was the table number from the QR code — and a table is shared
// with every customer who ever sat there. "My orders" was therefore built from
// `o.tableNumber === tableNumber`, which meant the person who sat down after
// someone else opened the menu with a stranger's meal, name and phone number
// already on screen. (The fallback `o.customerPhoneOrEmail === phone` was worse:
// an anonymous guest has '' there, so '' === '' matched every phone-less order
// in the restaurant.)
//
// The browser that placed the order is the one piece of per-guest identity that
// actually exists here, so that is what we key on. The guest's own orders are
// kept on the guest's own device: no new endpoint is needed (a public
// GET /api/orders/:id would be enumerable — ids are timestamp + 3 digits), the
// receipts survive a reload, and they are already this person's data.
//
// Nothing stored here is ever trusted by the server; it only narrows what is
// displayed. Entries are pruned after GUEST_SESSION_MS so that the same phone
// scanning the same table tomorrow starts clean.
//
// This list is also the ONLY way an order can enter the guest surface's state.
// The table endpoint and the table SSE channel are shared by everyone who has
// ever scanned that QR, so they are treated as a source of status updates for
// orders already in this list (applyStatusUpdates) and never as a source of
// orders. A guest who has ordered nothing therefore sees nothing, which is what
// "a fresh table for the next customer" actually requires.
// ---------------------------------------------------------------------------

/** How long one visit can plausibly last. The server applies the same window to
    the public table endpoint (TABLE_SESSION_MS in server.ts) — keep them in
    step, or a guest sees an order the server has already stopped serving. */
export const GUEST_SESSION_MS = 4 * 60 * 60 * 1000;

/** Bounded so a tablet left on a counter can't grow its localStorage forever. */
const MAX_REMEMBERED = 20;

/**
 * Is this stored order still part of the visit happening now?
 *
 * The browser's copy of the rule the public table endpoint enforces: settled
 * bills and anything older than one plausible visit are over, so they belong in
 * the history list rather than in the live status card at the bottom of the
 * menu. Applied to this device's OWN orders — which are the only orders the
 * guest surface ever holds — to pick the one worth tracking.
 *
 * Lives beside GUEST_SESSION_MS on purpose — the two windows must not drift.
 */
export function isCurrentTableSession(order: Order): boolean {
  if (order.status === 'paid' || order.status === 'cancelled') return false;
  const created = new Date(order.createdAt).getTime();
  return Number.isNaN(created) ? true : created >= Date.now() - GUEST_SESSION_MS;
}

interface StoredOrder {
  /** When this device saw the order — the basis for pruning, not order.createdAt,
      which a stale clock on the phone could put in the future. */
  savedAt: number;
  order: Order;
}

// Per restaurant: a phone that ordered at two cafes must not show one's
// receipts under the other's brand.
const storageKey = (restaurantId: string) => `qulaycafe_my_orders_${restaurantId}`;

function read(restaurantId: string): StoredOrder[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(restaurantId));
  } catch {
    // Private-mode Safari and "block all cookies" both throw here. Losing the
    // local history is acceptable; crashing the menu is not.
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - GUEST_SESSION_MS;
    return parsed.filter(
      (e: any): e is StoredOrder =>
        e && typeof e.savedAt === 'number' && e.savedAt >= cutoff && e.order && typeof e.order.id === 'string'
    );
  } catch {
    return [];
  }
}

function write(restaurantId: string, entries: StoredOrder[]): Order[] {
  const kept = entries.sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_REMEMBERED);
  try {
    localStorage.setItem(storageKey(restaurantId), JSON.stringify(kept));
  } catch {
    // Quota or blocked storage — the in-memory list returned below still drives
    // this page view, it just won't survive a reload.
  }
  return kept.map(e => e.order);
}

/** This device's own orders, newest first, with anything older than one visit
    already dropped. Safe to call during render. */
export function loadGuestOrders(restaurantId: string): Order[] {
  return read(restaurantId).map(e => e.order);
}

/** Called once per order this device successfully places. */
export function rememberGuestOrder(restaurantId: string, order: Order): Order[] {
  const entries = read(restaurantId).filter(e => e.order.id !== order.id);
  // Prepended, not appended: two orders placed inside the same millisecond share
  // a savedAt, and Array.sort is stable, so whichever sits first stays first.
  // Appending would therefore rank the newest order LAST in the history list and,
  // once MAX_REMEMBERED is reached, make it the first one discarded.
  entries.unshift({ savedAt: Date.now(), order });
  return write(restaurantId, entries);
}

/**
 * The shape the shared table channel and GET /api/orders/table/:n now return —
 * status, not content. See publicOrderView() in server.ts: that channel is read
 * by every browser that has ever scanned the table, so it deliberately carries
 * no name, phone, items or totals.
 */
export interface PublicOrderView {
  id: string;
  status?: Order['status'];
  paymentStatus?: Order['paymentStatus'];
  orderType?: Order['orderType'];
  estimatedMinutes?: number;
  updatedAt?: string;
  courierName?: string;
  tableNumber?: number;
  createdAt?: string;
}

/**
 * Move this device's stored orders along using status-only updates from a shared
 * channel.
 *
 * Ids this device does not already know are ignored outright, and that is the
 * whole point: an update about the previous customer's ticket arrives on the same
 * table channel as the guest's own, and the only thing separating them is that
 * one of them was placed from this browser. Nothing here can ever ADD an order.
 *
 * Returns null when nothing changed, so the caller neither writes storage nor
 * re-renders on every heartbeat.
 */
export function applyStatusUpdates(restaurantId: string, updates: PublicOrderView[]): Order[] | null {
  const entries = read(restaurantId);
  if (entries.length === 0) return null;
  let changed = false;
  const merged = entries.map(entry => {
    const update = updates.find(u => u && u.id === entry.order.id);
    if (!update) return entry;
    // Field by field, not a spread: a spread would let a future field on the
    // public projection overwrite the guest's own copy of their order, and an
    // `undefined` in the payload would erase what is stored.
    const next: Order = { ...entry.order };
    if (update.status) next.status = update.status;
    if (update.paymentStatus) next.paymentStatus = update.paymentStatus;
    if (update.orderType) next.orderType = update.orderType;
    if (typeof update.estimatedMinutes === 'number') next.estimatedMinutes = update.estimatedMinutes;
    if (update.courierName) next.courierName = update.courierName;
    if (update.updatedAt) next.updatedAt = update.updatedAt;
    if (
      next.status === entry.order.status &&
      next.paymentStatus === entry.order.paymentStatus &&
      next.estimatedMinutes === entry.order.estimatedMinutes &&
      next.courierName === entry.order.courierName
    ) {
      return entry;
    }
    changed = true;
    // savedAt is deliberately not bumped: a status update from the kitchen must
    // not extend how long this receipt lives on the device.
    return { savedAt: entry.savedAt, order: next };
  });
  return changed ? write(restaurantId, merged) : null;
}

/**
 * Refresh the stored copies from whatever the live feeds (table fetch, SSE) are
 * showing, so the guest's own history tracks status changes — 'pending' becoming
 * 'served' — instead of freezing at whatever it was when they hit confirm.
 *
 * Used on the order-scoped channel (`/api/events/order/:id`), which still
 * carries the whole order because it is scoped to the one id the guest holds.
 * The shared table channel goes through applyStatusUpdates instead.
 *
 * Returns null when nothing changed, so the caller can skip a pointless write
 * and, more importantly, not loop on its own state update.
 */
export function syncGuestOrders(restaurantId: string, live: Order[]): Order[] | null {
  const entries = read(restaurantId);
  if (entries.length === 0) return null;
  let changed = false;
  const merged = entries.map(entry => {
    const fresh = live.find(o => o.id === entry.order.id);
    if (!fresh || fresh.updatedAt === entry.order.updatedAt) return entry;
    changed = true;
    // savedAt is deliberately not bumped: a status update from the kitchen must
    // not extend how long this receipt lives on the device.
    return { savedAt: entry.savedAt, order: fresh };
  });
  return changed ? write(restaurantId, merged) : null;
}
