import { describe, it, expect } from 'vitest';
import { buildReceiptBytes } from '../src/server/escpos';
import {
  orderDestinationLabel,
  orderStatusLabel,
  paymentMethodLabel,
  paymentStatusLabel
} from '../src/lib/orderLabels';
import type { CartItem, Order } from '../src/types';

// Pure unit tests — the ESC/POS builder is a pure function returning a Buffer,
// so the payload that goes to the printer can be asserted directly.
//
// A receipt is the one place a wrong value is expensive: it is handed to a
// paying guest, and a slip saying "Stol #0" or "Naqd" for a card payment is
// not something that can be corrected afterwards. Amounts here are all under
// 1000 so the expected text is exact — toLocaleString inserts a grouping
// separator (whose character varies) above that.

const makeItem = (name = 'Osh', quantity = 2, itemTotal = 500): CartItem => ({
  cartItemId: 'ci-1',
  menuItem: {
    id: 'm1',
    name,
    description: '',
    nameUz: name,
    nameRu: name,
    nameEn: name,
    descriptionUz: '',
    descriptionRu: '',
    descriptionEn: '',
    price: 250,
    category: 'ikkinchi_taom',
    image: '',
    isAvailable: true,
    dietary: [],
    prepTimeMinutes: 10
  },
  quantity,
  selectedCustomizations: [],
  itemTotal
});

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
  id: 'ord-1',
  tableNumber: 7,
  customerName: 'Aziz',
  customerPhoneOrEmail: '+998901234567',
  items: [makeItem()],
  subtotal: 500,
  tax: 0,
  serviceCharge: 0,
  discount: 0,
  totalAmount: 500,
  status: 'pending',
  paymentStatus: 'unpaid',
  paymentMethod: 'cash',
  createdAt: '2026-09-25T10:00:00.000Z',
  updatedAt: '2026-09-25T10:00:00.000Z',
  estimatedMinutes: 12,
  loyaltyPointsEarned: 0,
  loyaltyPointsRedeemed: 0,
  orderType: 'dine_in',
  ...overrides
});

const receiptText = (order: Order, restaurantName = 'Osh Markazi') =>
  buildReceiptBytes(order, restaurantName).toString('utf8');

describe('thermal receipt: the restaurant name is real or absent', () => {
  it('prints the actual restaurant name as the header', () => {
    expect(receiptText(makeOrder(), 'Osh Markazi')).toContain('Osh Markazi');
  });

  it.each(['', '   '])('omits the header entirely for %j instead of a placeholder', name => {
    const text = receiptText(makeOrder(), name);
    expect(text).not.toContain('Restoran');
    // The first content line is the destination, not a stand-in name.
    expect(text).toContain('Stol #7');
  });
});

describe('thermal receipt: the destination is a real value', () => {
  it('names the table for a dine-in order', () => {
    expect(receiptText(makeOrder({ tableNumber: 12 }))).toContain('Stol #12');
  });

  it('says Dostavka for a delivery order', () => {
    const text = receiptText(makeOrder({ orderType: 'delivery', tableNumber: 0 }));
    expect(text).toContain('Dostavka');
    expect(text).not.toContain('Stol #');
  });

  it('never prints the table-0 sentinel for a pickup order', () => {
    // Regression: tableNumber 0 means "no physical table", but the receipt only
    // special-cased delivery, so a pickup slip read "Stol #0".
    const text = receiptText(makeOrder({ orderType: 'pickup', tableNumber: 0 }));
    expect(text).toContain('Olib ketish');
    expect(text).not.toContain('Stol #0');
  });
});

describe('thermal receipt: payment details are explicit', () => {
  it('prints the payment method and settlement state', () => {
    const text = receiptText(makeOrder({ paymentMethod: 'card', paymentStatus: 'paid' }));
    expect(text).toContain("To'lov usuli: Karta");
    expect(text).toContain("To'lov holati: To'langan");
  });

  it('does not label a pay-at-counter order as cash', () => {
    // Regression: pay_at_counter fell through a ternary chain into the 'Naqd'
    // arm, so a counter payment printed as cash.
    const text = receiptText(makeOrder({ paymentMethod: 'pay_at_counter' }));
    expect(text).toContain('Kassada');
    expect(text).not.toContain('Naqd');
  });

  it('shows an unset method as unset rather than guessing one', () => {
    const text = receiptText(makeOrder({ paymentMethod: undefined }));
    expect(text).toContain("Ko'rsatilmagan");
    expect(text).not.toContain('Naqd');
  });
});

describe('thermal receipt: items and money', () => {
  it('lists each line item with its quantity and line total', () => {
    const order = makeOrder({
      items: [makeItem('Osh', 2, 500), makeItem('Choy', 3, 150)],
      subtotal: 650,
      totalAmount: 650
    });
    const text = receiptText(order);
    expect(text).toContain('2x Osh');
    expect(text).toContain('3x Choy');
  });

  it('prints the subtotal and grand total', () => {
    const text = receiptText(makeOrder());
    expect(text).toContain('Oraliq: 500');
    expect(text).toContain('JAMI: 500');
  });

  it('shows the discount only when there is one', () => {
    expect(receiptText(makeOrder())).not.toContain('Chegirma');
    expect(receiptText(makeOrder({ discount: 100, totalAmount: 400 }))).toContain('Chegirma: -100');
  });
});

describe('thermal receipt: no unresolved values reach the paper', () => {
  it.each([
    ['a full order', makeOrder({ orderNote: 'piyoz solmang', deliveryAddress: "Ko'cha 1" })],
    ['a delivery order', makeOrder({ orderType: 'delivery', tableNumber: 0, deliveryPhone: '+998901234567' })],
    ['an order with no payment method', makeOrder({ paymentMethod: undefined })]
  ])('contains no undefined, NaN, or placeholder text for %s', (_label, order) => {
    const text = receiptText(order);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('[object Object]');
    expect(text).not.toContain('Restoran');
    expect(text.toLowerCase()).not.toContain('vazirligi');
  });
});

describe('order labels: one mapping for the screen and the printer', () => {
  it('translates every status out of its raw database value', () => {
    expect(orderStatusLabel('preparing')).toBe('Tayyorlanmoqda');
    expect(orderStatusLabel('out_for_delivery')).toBe("Yo'lda");
    expect(orderStatusLabel('paid')).toBe("To'landi");
  });

  it('passes an unrecognised status through instead of blanking it', () => {
    expect(orderStatusLabel('something_new')).toBe('something_new');
  });

  it('keeps each payment method distinct', () => {
    const labels = ['cash', 'card', 'loyalty_points', 'pay_at_counter'].map(m => paymentMethodLabel(m));
    expect(new Set(labels).size).toBe(4);
    expect(labels).toEqual(['Naqd', 'Karta', 'Ballar', 'Kassada']);
  });

  it('reports an unset method as unset', () => {
    expect(paymentMethodLabel(undefined)).toBe("Ko'rsatilmagan");
    expect(paymentMethodLabel(null)).toBe("Ko'rsatilmagan");
  });

  it('labels both payment states', () => {
    expect(paymentStatusLabel('paid')).toBe("To'langan");
    expect(paymentStatusLabel('unpaid')).toBe("To'lanmagan");
  });

  it('describes where an order is going', () => {
    expect(orderDestinationLabel({ orderType: 'dine_in', tableNumber: 3 })).toBe('Stol #3');
    expect(orderDestinationLabel({ orderType: 'delivery', tableNumber: 0 })).toBe('Dostavka');
    expect(orderDestinationLabel({ orderType: 'pickup', tableNumber: 0 })).toBe('Olib ketish');
  });
});
