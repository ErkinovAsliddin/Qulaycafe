// ---------------------------------------------------------------------------
// Multi-tenant support for the CUSTOMER-facing app. A customer reaches a
// restaurant's page one of three ways:
//   1. Scanning a table QR code: ?table=5&r=rest-abc123 (or the newer
//      /order/<slug>?table=5 form)
//   2. Visiting the restaurant's own shareable link directly — e.g. from
//      their Instagram bio — at qulaycafe.uz/order/<slug>, with no table
//      number, which means they're ordering delivery, not sitting at a
//      table.
//   3. Visiting the table-booking link, qulaycafe.uz/book/<slug>, which
//      resolves the same tenant but opens straight into the reservation
//      form instead of the menu. A guest can also return to an existing
//      booking with /book/<slug>?b=<token>.
// Since a dining/delivery guest has no login session, the server has no
// other way to know which restaurant's menu/orders/tables to show them —
// this file resolves that once on page load (awaited before the app
// renders, so every subsequent fetch already has the right context) and
// quietly attaches it to every API call from then on via a header, so none
// of the existing components need to be rewritten to pass it around
// manually.
//
// Falls back to "default" (the original single-restaurant deployment) if
// neither a slug path nor a ?r= param is present, so existing printed QR
// codes keep working exactly as before until they're reprinted.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'primeweb_restaurant_id';
const DEFAULT_RESTAURANT_ID = 'default';

// Set once during initRestaurantContext if the person arrived via a bare
// restaurant link (no ?table=) — App.tsx reads this once at startup to
// decide whether to default straight into delivery-ordering mode.
let initialOrderModeHint: 'dine_in' | 'delivery' | null = null;
export function getInitialOrderModeHint() {
  return initialOrderModeHint;
}

// Set when the visitor landed on /book/<slug>: App.tsx opens the booking
// modal immediately in that case, and `token` (from ?b=) makes it open on
// an existing booking's status instead of a blank form.
let bookingIntent: { slug: string; token: string | null } | null = null;
export function getBookingIntent() {
  return bookingIntent;
}

// Whether this restaurant accepts bookings at all, as reported by
// /api/restaurants/by-slug — resolved here because that call already
// happens during startup. Null when the visitor arrived some other way
// (a table QR, ?r=...); App.tsx then falls back to /api/settings.
let reservationHint: { status: string; botUsername: string | null } | null = null;
export function getReservationHint() {
  return reservationHint;
}

export function getRestaurantId(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || DEFAULT_RESTAURANT_ID;
  } catch {
    return DEFAULT_RESTAURANT_ID;
  }
}

export function setRestaurantId(id: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* sessionStorage unavailable (e.g. some in-app browsers) — the default
       tenant fallback still keeps the app functional */
  }
}

// Appends the restaurant id as a query param to a URL that's about to be
// opened as an EventSource (which can't carry custom headers).
export function withRestaurantParam(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}r=${encodeURIComponent(getRestaurantId())}`;
}

export async function initRestaurantContext() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('r');
    const hasTableParam = params.has('table');

    // /order/<slug> or /book/<slug> (optionally with a trailing slash) — the
    // shareable links a restaurant puts on Instagram, their website, etc.
    const slugMatch = window.location.pathname.match(/^\/(order|book)\/([a-zA-Z0-9-]+)\/?$/);

    if (slugMatch) {
      const isBookingPath = slugMatch[1] === 'book';
      const slug = slugMatch[2];
      try {
        const res = await fetch(`/api/restaurants/by-slug/${encodeURIComponent(slug)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.restaurantId) {
            setRestaurantId(data.restaurantId);
            reservationHint = {
              status: data.reservationStatus || 'disabled',
              botUsername: data.reservationBotUsername || null
            };
            if (isBookingPath) {
              // A booking token is read from the query string here, but it is
              // only ever sent to the server in a POST body — never as part of
              // an API URL — so it stays out of server access logs.
              const token = params.get('b');
              bookingIntent = { slug, token: token && /^[a-f0-9]{48}$/.test(token) ? token : null };
            }
            // No table number in the URL means they came from a general
            // link (Instagram bio, Google, etc.), not a table QR scan —
            // delivery is the sensible default; they can switch back to
            // "at a table" from the in-app toggle if that's wrong.
            if (!hasTableParam) initialOrderModeHint = 'delivery';
          }
        }
      } catch {
        /* couldn't resolve the slug — fall through to default tenant */
      }
    } else if (fromUrl) {
      setRestaurantId(fromUrl);
    }
  } catch {
    /* ignore */
  }

  // Every existing fetch('/api/...') call in the app keeps working
  // unmodified — this just adds one header before the request goes out.
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url && url.startsWith('/api/')) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('X-Restaurant-Id')) {
        headers.set('X-Restaurant-Id', getRestaurantId());
      }
      return originalFetch(input, { ...init, headers });
    }
    return originalFetch(input, init);
  };
}
