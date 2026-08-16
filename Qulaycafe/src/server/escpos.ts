import net from 'net';
import type { Order } from '../types';

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

export function buildReceiptBytes(order: Order, restaurantName: string): Buffer {
  const b = new ReceiptBuilder().init().align('center').doubleSize(true).bold(true).line(restaurantName);
  b.doubleSize(false).bold(false);
  b.line(order.orderType === 'delivery' ? 'DOSTAVKA' : `Stol #${order.tableNumber}`);
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
