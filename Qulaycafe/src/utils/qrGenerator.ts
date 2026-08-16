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
