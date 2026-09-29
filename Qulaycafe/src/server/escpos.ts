import net from 'net';
import type { Order } from '../types';
import { orderDestinationLabel, paymentMethodLabel, paymentStatusLabel } from '../lib/orderLabels';

// ---------------------------------------------------------------------------
// Minimal ESC/POS command builder — no external dependency needed. Targets
// network thermal printers (the overwhelming majority of restaurant receipt
// printers support "raw ASCII over TCP port 9100", sometimes called
// JetDirect/AppSocket mode — the same protocol printers from Epson, Xprinter,
// Rongta, etc. all support out of the box once given a static IP).
// USB/Bluetooth-only printers are out of scope here since a browser/Node
// server can't talk to those directly without extra native drivers — the
// admin's "🧾 Chek" browser-print button already covers that case as a
// software fallback (print to any locally-connected/shared printer via the
// OS print dialog).
// ---------------------------------------------------------------------------

const ESC = 0x1b;
const GS = 0x1d;

class ReceiptBuilder {
  private chunks: Buffer[] = [];

  private push(...bytes: number[]) {
    this.chunks.push(Buffer.from(bytes));
  }

  init() {
    this.push(ESC, 0x40); // ESC @ — initialize printer
    return this;
  }

  align(mode: 'left' | 'center' | 'right') {
    const n = mode === 'left' ? 0 : mode === 'center' ? 1 : 2;
    this.push(ESC, 0x61, n);
    return this;
  }

  bold(on: boolean) {
    this.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  doubleSize(on: boolean) {
    this.push(GS, 0x21, on ? 0x11 : 0x00);
    return this;
  }

  text(str: string) {
    // Printers vary in codepage support for non-Latin scripts; falling back
    // to plain UTF-8 bytes works on modern printers configured for UTF-8,
    // which covers Cyrillic/Uzbek text used throughout this app.
    this.chunks.push(Buffer.from(str, 'utf8'));
    return this;
  }

  line(str = '') {
    this.text(str);
    this.push(0x0a);
    return this;
  }

  divider() {
    this.line('--------------------------------');
    return this;
  }

  feed(lines = 3) {
    this.push(0x0a);
    for (let i = 0; i < lines; i++) this.push(0x0a);
    return this;
  }

  cut() {
    this.push(GS, 0x56, 0x00); // full cut
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/**
 * The printed check, in the order a person reads it: who they paid, where the
 * order belongs, when it was placed, what was ordered, and the money.
 *
 * Deliberately limited to those fields. The order record carries much more
 * (loyalty accounting, courier ids, internal delivery flags); none of it is
 * printed, because a slip of paper is read by the guest and the cashier, not by
 * the system. Every line below is either order data or a label from the shared
 * order-label map — there is no literal placeholder text in the payload.
 */
export function buildReceiptBytes(order: Order, restaurantName: string): Buffer {
  const b = new ReceiptBuilder().init().align('center');

  // The header is the restaurant's own name, or nothing at all. It is never a
  // stand-in like "Restoran" — a guest reads the header as the name of the
  // business they are paying, so a placeholder there is worse than a blank.
  const header = restaurantName.trim();
  if (header) {
    b.doubleSize(true).bold(true).line(header);
    b.doubleSize(false).bold(false);
  }

  // Shared with the on-screen order card. A pickup order previously printed
  // "Stol #0" here, because only delivery was special-cased and 0 is the
  // "no physical table" sentinel rather than a real table number.
  b.line(orderDestinationLabel(order));
  b.line(new Date(order.createdAt).toLocaleString('uz-UZ'));
  b.line(`Buyurtma: ${order.id}`);
  b.align('left').divider();

  for (const item of order.items) {
    b.line(`${item.quantity}x ${item.menuItem.name}`);
    b.align('right').line(`${item.itemTotal.toLocaleString('uz-UZ')} so'm`).align('left');
  }

  b.divider();
  b.align('right');
  b.line(`Oraliq: ${order.subtotal.toLocaleString('uz-UZ')} so'm`);
  b.line(`Soliq: ${order.tax.toLocaleString('uz-UZ')} so'm`);
  b.line(`Xizmat haqi: ${order.serviceCharge.toLocaleString('uz-UZ')} so'm`);
  if (order.discount > 0) b.line(`Chegirma: -${order.discount.toLocaleString('uz-UZ')} so'm`);
  b.bold(true).doubleSize(true).line(`JAMI: ${order.totalAmount.toLocaleString('uz-UZ')} so'm`);
  b.doubleSize(false).bold(false);

  // How the order was paid, and whether it is settled — the two things a
  // cashier reconciles the slip against. Read from the shared label map, so
  // the receipt and the order card can never disagree about a payment method.
  b.divider().align('left');
  b.line(`To'lov usuli: ${paymentMethodLabel(order.paymentMethod)}`);
  b.line(`To'lov holati: ${paymentStatusLabel(order.paymentStatus)}`);

  b.align('center').feed(1).line('Xaridingiz uchun rahmat!').feed(3).cut();

  return b.build();
}

export function sendToNetworkPrinter(ip: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Printer connection timed out'));
    }, 5000);

    socket.connect(port, ip, () => {
      socket.write(data, err => {
        clearTimeout(timeout);
        if (err) {
          socket.destroy();
          reject(err);
          return;
        }
        socket.end();
        resolve();
      });
    });

    socket.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** Check that a raw-print TCP port is reachable without sending print data. */
export function checkNetworkPrinter(ip: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port });
    const timeout = setTimeout(() => {
      const error = Object.assign(new Error('Printer connection timed out'), { code: 'ETIMEDOUT' });
      socket.destroy();
      reject(error);
    }, 5000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve();
    });

    socket.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
