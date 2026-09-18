import QRCode from 'qrcode';

/**
 * Builds the URL a table's QR code should point to. Prefers the
 * human-readable slug form (/order/<slug>?table=N) when a slug is known —
 * this is the same link a restaurant would share on Instagram, just with a
 * table number appended — and falls back to the older ?r=<restaurantId>
 * form for the legacy "default" tenant or if a slug isn't available yet.
 */
export function getTableFullUrl(tableNumber: number, appUrl: string, restaurantId?: string, restaurantSlug?: string): string {
  const base = appUrl.replace(/\/$/, '');
  if (restaurantSlug) {
    return `${base}/order/${restaurantSlug}?table=${tableNumber}`;
  }
  const fallback = `${base}?table=${tableNumber}`;
  if (restaurantId && restaurantId !== 'default') {
    return `${fallback}&r=${encodeURIComponent(restaurantId)}`;
  }
  return fallback;
}

/**
 * Builds the plain shareable ordering link (no table number) — the one a
 * restaurant puts in their Instagram bio, website, etc. for delivery
 * orders. Requires a slug; there's no dignified fallback for this one
 * since a bare link with no slug and no table would just point at
 * whatever the "default" tenant happens to be.
 */
export function getShareableOrderUrl(appUrl: string, restaurantSlug: string): string {
  return `${appUrl.replace(/\/$/, '')}/order/${restaurantSlug}`;
}

/**
 * The shareable table-booking link — the one that belongs on Google Maps,
 * Instagram and TripAdvisor. It opens the booking form directly, without
 * loading the menu first, so a guest (or a tourist with no Telegram) can
 * reserve a table in a few taps. Same slug as the ordering link.
 */
export function getShareableBookingUrl(appUrl: string, restaurantSlug: string): string {
  return `${appUrl.replace(/\/$/, '')}/book/${restaurantSlug}`;
}

/**
 * The other half of getTableFullUrl: reads a scanned QR back into a table
 * number. Kept beside the builder on purpose — the two must agree on the
 * payload format, and a printer/reader pair that drifts apart produces QR
 * codes that scan "successfully" and then do nothing.
 *
 * A QR code is just text a stranger can print, so nothing here is trusted:
 * the table has to exist at THIS restaurant, and if the payload names a
 * restaurant (either form — ?r=<id> or /order/<slug>) it has to be this one.
 * Without that check, a QR printed for another cafe would silently move the
 * guest to a table number here, and their order would land in the wrong
 * kitchen.
 */
export type TableQrResult =
  | { ok: true; tableNumber: number }
  | { ok: false; reason: 'not_table_qr' | 'other_restaurant' | 'unknown_table'; tableNumber?: number };

export function parseTableQrPayload(
  text: string,
  options: {
    currentRestaurantId?: string;
    currentSlug?: string | null;
    /** Table numbers this restaurant actually has. Null/empty means "unknown", not "none". */
    knownTableNumbers?: number[] | null;
  }
): TableQrResult {
  const raw = (text || '').trim();
  if (!raw) return { ok: false, reason: 'not_table_qr' };

  let tableParam: string | null = null;
  let restaurantParam: string | null = null;
  let slug: string | null = null;

  try {
    // A base is only there so relative payloads parse instead of throwing; the
    // origin is never used, and an unparseable payload falls through below.
    const url = new URL(raw, 'https://qr.invalid');
    tableParam = url.searchParams.get('table');
    restaurantParam = url.searchParams.get('r');
    slug = url.pathname.match(/^\/order\/([a-zA-Z0-9-]+)\/?$/)?.[1] ?? null;
  } catch {
    const match = raw.match(/[?&]table=(\d+)/);
    tableParam = match ? match[1] : null;
  }

  const tableNumber = tableParam === null ? NaN : parseInt(tableParam, 10);
  if (!Number.isFinite(tableNumber) || tableNumber <= 0) {
    return { ok: false, reason: 'not_table_qr' };
  }

  if (restaurantParam && options.currentRestaurantId && restaurantParam !== options.currentRestaurantId) {
    return { ok: false, reason: 'other_restaurant', tableNumber };
  }
  if (slug && options.currentSlug && slug !== options.currentSlug) {
    return { ok: false, reason: 'other_restaurant', tableNumber };
  }

  const known = options.knownTableNumbers;
  if (known && known.length > 0 && !known.includes(tableNumber)) {
    return { ok: false, reason: 'unknown_table', tableNumber };
  }

  return { ok: true, tableNumber };
}

/**
 * Generates a real, standard, 100% camera-scannable QR code Data URL for a table.
 */
export async function generateTableQRDataUrlAsync(
  tableNumber: number,
  appUrl: string,
  restaurantId?: string,
  restaurantSlug?: string
): Promise<string> {
  const fullUrl = getTableFullUrl(tableNumber, appUrl, restaurantId, restaurantSlug);
  try {
    return await QRCode.toDataURL(fullUrl, {
      width: 400,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M'
    });
  } catch (e) {
    console.error('Error generating QR code:', e);
    return '';
  }
}
