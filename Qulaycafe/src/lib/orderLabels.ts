import type { Order, OrderStatus, PaymentStatus } from '../types';

// ---------------------------------------------------------------------------
// Single source of truth for how the order enums are displayed.
//
// These labels used to be re-typed at every call site, which is how one enum
// drifted into four different renderings:
//   - the status chip printed the raw database value ("out_for_delivery")
//   - the order card said "⭐ Ball" where the analytics panel said "⭐ Ballar"
//   - a pay_at_counter order was labelled "💵 Naqd" (cash), because that was
//     the fallback arm of a ternary chain
//   - the order detail fell back to the hardcoded English string "At Table"
//     whenever paymentMethod was unset
//   - the screen said "Table #3" where the printed receipt said "Stol #3"
//
// Everything reads from here now, so the printed check and the screen can no
// longer describe the same order differently.
//
// Uzbek is the canonical language for the kitchen, the orders list, and printed
// receipts, so the labels are Uzbek by design. They are plain text with ASCII
// apostrophes: this module is imported by the server-side ESC/POS builder,
// which writes raw bytes to a thermal printer and cannot rely on emoji or on
// typographic quotes surviving the trip.
// ---------------------------------------------------------------------------

export type PaymentMethod = NonNullable<Order['paymentMethod']>;
export type OrderDestination = NonNullable<Order['orderType']>;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Kutilmoqda',
  preparing: 'Tayyorlanmoqda',
  ready: 'Tayyor',
  out_for_delivery: "Yo'lda",
  served: 'Tortildi',
  paid: "To'landi",
  cancelled: 'Bekor qilindi'
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Naqd',
  card: 'Karta',
  loyalty_points: 'Ballar',
  pay_at_counter: 'Kassada'
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "To'lanmagan",
  paid: "To'langan"
};

/** Emoji belong to the screen only — never sent to a printer. */
export const PAYMENT_METHOD_EMOJI: Record<PaymentMethod, string> = {
  cash: '💵',
  card: '💳',
  loyalty_points: '⭐',
  pay_at_counter: '🏧'
};

export const ORDER_TYPE_EMOJI: Record<OrderDestination, string> = {
  dine_in: '🍽',
  delivery: '🛵',
  pickup: '🥡'
};

/** Shown when an order has no payment method recorded yet. */
export const PAYMENT_METHOD_UNSET = "Ko'rsatilmagan";

const isOrderStatus = (value: string): value is OrderStatus => value in ORDER_STATUS_LABELS;
const isPaymentMethod = (value: string): value is PaymentMethod => value in PAYMENT_METHOD_LABELS;
const isPaymentStatus = (value: string): value is PaymentStatus => value in PAYMENT_STATUS_LABELS;

/**
 * Statuses arrive from the database, an SSE payload, or a client, so an
 * unrecognised value falls back to itself rather than rendering as an empty
 * chip — an unknown status should be visible, not swallowed.
 */
export function orderStatusLabel(status: string): string {
  return isOrderStatus(status) ? ORDER_STATUS_LABELS[status] : status;
}

export function paymentMethodLabel(method?: string | null): string {
  if (!method) return PAYMENT_METHOD_UNSET;
  return isPaymentMethod(method) ? PAYMENT_METHOD_LABELS[method] : method;
}

export function paymentMethodEmoji(method?: string | null): string {
  return method && isPaymentMethod(method) ? PAYMENT_METHOD_EMOJI[method] : '';
}

/** The screen-side variant: emoji plus label, without a stray leading space. */
export function paymentMethodBadge(method?: string | null): string {
  const emoji = paymentMethodEmoji(method);
  return emoji ? `${emoji} ${paymentMethodLabel(method)}` : paymentMethodLabel(method);
}

export function paymentStatusLabel(status: string): string {
  return isPaymentStatus(status) ? PAYMENT_STATUS_LABELS[status] : status;
}

/**
 * Where an order is headed, as plain text.
 *
 * Table 0 is the sentinel the order schema uses for "no physical table", so a
 * pickup order must never be rendered as "Stol #0" — the thermal receipt did
 * exactly that, because it only special-cased delivery.
 */
export function orderDestinationLabel(order: Pick<Order, 'orderType' | 'tableNumber'>): string {
  if (order.orderType === 'delivery') return 'Dostavka';
  if (order.orderType === 'pickup') return 'Olib ketish';
  return `Stol #${order.tableNumber}`;
}

/** The screen-side variant, with the emoji a receipt cannot print. */
export function orderDestinationBadge(order: Pick<Order, 'orderType' | 'tableNumber'>): string {
  const emoji = ORDER_TYPE_EMOJI[order.orderType ?? 'dine_in'];
  return `${emoji} ${orderDestinationLabel(order)}`;
}
