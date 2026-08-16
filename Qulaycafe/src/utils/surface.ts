// ---------------------------------------------------------------------------
// Which of the four surfaces is this browser tab? Each one lives on its own
// hostname so the three audiences never see each other's UI:
//
//   qulaycafe.uz          -> landing   (marketing site, served as static
//                                       HTML by the server, not by this SPA)
//   clients.qulaycafe.uz  -> clients   (guests: menu, cart, bookings)
//   kitchen.qulaycafe.uz  -> kitchen   (kitchen display)
//   admin.qulaycafe.uz    -> admin     (restaurant dashboard)
//
// The surface is resolved once, before React renders, and App.tsx renders
// ONLY that surface's component tree. The kitchen/admin trees are behind
// React.lazy(), so a guest on clients.qulaycafe.uz never downloads a single
// byte of staff code — the isolation is in the network tab, not just in the
// UI.
//
// server.ts resolves the same four surfaces from req.hostname and must stay
// in sync with the rules below.
// ---------------------------------------------------------------------------

export type Surface = 'landing' | 'clients' | 'kitchen' | 'admin';

const OVERRIDE_STORAGE_KEY = 'qulaycafe_surface_override';

function envList(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
}

// Exact-hostname overrides, for deployments that don't use the
// <surface>.<domain> convention (a staging box, a custom domain per
// restaurant, ngrok tunnels, ...).
const ADMIN_HOSTS = envList(import.meta.env.VITE_ADMIN_HOSTS);
const KITCHEN_HOSTS = envList(import.meta.env.VITE_KITCHEN_HOSTS);
const CLIENTS_HOSTS = envList(import.meta.env.VITE_CLIENTS_HOSTS);
const LANDING_HOSTS = envList(import.meta.env.VITE_LANDING_HOSTS);

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  );
}

// `?surface=admin` is a development affordance: on a dev box everything is
// served from one hostname (localhost:3000), so there is no subdomain to
// resolve from. It is refused in production unless the deployment explicitly
// opts in with VITE_ALLOW_SURFACE_OVERRIDE=true, because on a real deploy the
// whole point is that a guest cannot reach the staff surfaces.
function overrideAllowed(hostname: string): boolean {
  if (import.meta.env.VITE_ALLOW_SURFACE_OVERRIDE === 'true') return true;
  return import.meta.env.DEV || isLocalHostname(hostname);
}

function parseSurface(value: string | null | undefined): Surface | null {
  switch ((value || '').toLowerCase()) {
    case 'landing': return 'landing';
    case 'clients':
    case 'customer': return 'clients';
    case 'kitchen': return 'kitchen';
    case 'admin': return 'admin';
    default: return null;
  }
}

function readStoredOverride(): Surface | null {
  try {
    return parseSurface(sessionStorage.getItem(OVERRIDE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storeOverride(surface: Surface) {
  try {
    sessionStorage.setItem(OVERRIDE_STORAGE_KEY, surface);
  } catch {
    /* sessionStorage unavailable — the override just won't survive a reload */
  }
}

function resolveFromHostname(hostname: string): Surface {
  const host = hostname.toLowerCase().replace(/\.$/, '');

  if (ADMIN_HOSTS.includes(host)) return 'admin';
  if (KITCHEN_HOSTS.includes(host)) return 'kitchen';
  if (CLIENTS_HOSTS.includes(host)) return 'clients';
  if (LANDING_HOSTS.includes(host)) return 'landing';

  const label = host.split('.')[0];
  if (label === 'admin') return 'admin';
  if (label === 'kitchen') return 'kitchen';
  if (label === 'clients') return 'clients';

  // Anything else (the apex, www, an IP, a preview URL) falls back to the
  // guest surface. The apex normally never reaches this code — the server
  // answers it with the landing site — so treating it as `clients` is the
  // safe failure mode: a misrouted request shows a menu, not a blank page,
  // and never shows staff UI.
  return 'clients';
}

let cached: Surface | null = null;

export function getSurface(): Surface {
  if (cached) return cached;

  let hostname = '';
  try {
    hostname = window.location.hostname || '';
  } catch {
    /* non-browser (tests, SSR) — fall through to the clients default */
  }

  let resolved = resolveFromHostname(hostname);

  if (overrideAllowed(hostname)) {
    let fromQuery: Surface | null = null;
    try {
      fromQuery = parseSurface(new URLSearchParams(window.location.search).get('surface'));
    } catch {
      /* ignore */
    }
    // A legacy ?view=admin|kitchen link (from before the split) is honoured
    // here too, so old bookmarks keep working on a dev box.
    if (!fromQuery) {
      try {
        fromQuery = parseSurface(new URLSearchParams(window.location.search).get('view'));
      } catch {
        /* ignore */
      }
    }
    if (fromQuery) {
      storeOverride(fromQuery);
      resolved = fromQuery;
    } else {
      const stored = readStoredOverride();
      if (stored) resolved = stored;
    }
  }

  cached = resolved;
  return cached;
}

export function isStaffSurface(surface: Surface = getSurface()): boolean {
  return surface === 'admin' || surface === 'kitchen';
}

// Base URL of the guest-facing surface, used for QR codes and shareable
// links generated from inside the admin dashboard: those must point at
// clients.qulaycafe.uz even though the dashboard itself is on
// admin.qulaycafe.uz. Falls back to swapping the leading `admin.`/`kitchen.`
// label for `clients.` when the env var isn't set.
export function getClientsBaseUrl(): string {
  return getSurfaceBaseUrl('clients');
}

// Same idea for the two staff surfaces: the dashboard hands out "open the
// kitchen display on the kitchen iPad" links, and those must carry the
// kitchen hostname — a `?view=kitchen` query on the guest host no longer
// resolves to anything in production, which is the whole point of the split.
export function getKitchenBaseUrl(): string {
  return getSurfaceBaseUrl('kitchen');
}

export function getAdminBaseUrl(): string {
  return getSurfaceBaseUrl('admin');
}

const SURFACE_URL_ENV: Record<'clients' | 'kitchen' | 'admin', unknown> = {
  clients: import.meta.env.VITE_CLIENTS_URL,
  kitchen: import.meta.env.VITE_KITCHEN_URL,
  admin: import.meta.env.VITE_ADMIN_URL
};

export function getSurfaceBaseUrl(target: 'clients' | 'kitchen' | 'admin'): string {
  const configured = SURFACE_URL_ENV[target];
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim().replace(/\/+$/, '');
  }
  try {
    const { protocol, hostname, port, origin } = window.location;
    // A dev box serves all four surfaces from one origin, so the only way to
    // reach another one is the ?surface= override.
    if (isLocalHostname(hostname)) {
      return target === 'clients' ? origin : `${origin}/?surface=${target}`;
    }
    const labels = hostname.toLowerCase().split('.');
    const label = labels[0];
    const suffix = port ? `:${port}` : '';
    if (label === 'admin' || label === 'kitchen' || label === 'clients') {
      return `${protocol}//${target}.${labels.slice(1).join('.')}${suffix}`;
    }
    // Apex/www: every surface lives on its own subdomain of the bare domain.
    const bare = hostname.toLowerCase().replace(/^www\./, '');
    return `${protocol}//${target}.${bare}${suffix}`;
  } catch {
    return '';
  }
}
