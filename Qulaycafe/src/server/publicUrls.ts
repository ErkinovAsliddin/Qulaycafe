// ---------------------------------------------------------------------------
// Where each surface lives, as seen from the server.
//
// APP_URL stays what it always was: the public origin Telegram registers its
// webhooks against. But a link *sent to a guest* has to open the guest
// surface, so `clientsBaseUrl()` is what every /order/<slug> link is built
// from — a Telegram web_app button pointing at admin.qulaycafe.uz would show
// a login form to someone who just wanted to order lunch.
//
// Set CLIENTS_URL explicitly in production. The derivation below only exists
// so an existing single-domain deployment keeps working after this change.
//
// Keep in sync with src/utils/surface.ts (the browser-side twin).
// ---------------------------------------------------------------------------

function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  );
}

function deriveSurfaceUrl(base: string, surface: 'clients' | 'kitchen' | 'admin'): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    // Not a parseable URL — hand it back untouched rather than inventing one.
    return trimUrl(base);
  }
  const hostname = url.hostname.toLowerCase();
  // A dev box serves every surface from one origin; there is no subdomain to
  // swap, and ?surface= is how the other surfaces are reached there.
  if (isLocalHost(hostname)) {
    return surface === 'clients' ? trimUrl(url.origin) : `${trimUrl(url.origin)}/?surface=${surface}`;
  }
  const labels = hostname.split('.');
  const first = labels[0];
  const bare =
    first === 'clients' || first === 'kitchen' || first === 'admin' || first === 'app' || first === 'www'
      ? labels.slice(1).join('.')
      : hostname;
  url.hostname = `${surface}.${bare}`;
  return trimUrl(url.origin);
}

/**
 * Guest-facing origin, or null when the deployment has not been told any URL
 * at all (in which case a caller must not fabricate a link).
 */
export function clientsBaseUrl(): string | null {
  const explicit = process.env.CLIENTS_URL;
  if (explicit && explicit.trim()) return trimUrl(explicit);
  const appUrl = process.env.APP_URL;
  if (!appUrl || !appUrl.trim()) return null;
  return deriveSurfaceUrl(appUrl.trim(), 'clients');
}

/** Admin dashboard origin — used in messages sent to restaurant owners. */
export function adminBaseUrl(): string | null {
  const explicit = process.env.ADMIN_URL;
  if (explicit && explicit.trim()) return trimUrl(explicit);
  const appUrl = process.env.APP_URL;
  if (!appUrl || !appUrl.trim()) return null;
  return deriveSurfaceUrl(appUrl.trim(), 'admin');
}

/** Kitchen display origin. */
export function kitchenBaseUrl(): string | null {
  const explicit = process.env.KITCHEN_URL;
  if (explicit && explicit.trim()) return trimUrl(explicit);
  const appUrl = process.env.APP_URL;
  if (!appUrl || !appUrl.trim()) return null;
  return deriveSurfaceUrl(appUrl.trim(), 'kitchen');
}

/** Guest link to a restaurant's menu, e.g. https://clients.…/order/osh-markazi */
export function guestOrderUrl(slug: string): string | null {
  const base = clientsBaseUrl();
  return base ? `${base}/order/${slug}` : null;
}
