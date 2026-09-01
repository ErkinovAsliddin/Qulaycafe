// ---------------------------------------------------------------------------
// The restaurant's identity, remembered on the device.
//
// The guest surface renders before /api/settings answers, and every branded
// slot — the splash screen's title and logo, the header, the footer — had a
// literal fallback baked in for that gap. On the splash, that fallback is the
// word "Qulaycafe": the guest scanned a cafe's QR code and watched the platform's
// name and a generic cutlery icon animate in, then get replaced by the cafe's own
// name and photo a moment later. The restaurant's customer should never be shown
// the platform's brand at all, let alone first.
//
// Two things fix that, and both are needed:
//   1. This cache. A returning guest — the normal case, the same phone in the
//      same cafe — has the real name and logo in the very first frame, with no
//      request to wait for and nothing to swap out afterwards.
//   2. CustomerApp holding the splash's reveal until branding resolves, for the
//      first-ever visit where this cache is empty. See brandingState there.
//
// Cached values are display-only and are overwritten by /api/settings seconds
// later, so staleness is harmless; the age cap only stops a logo from an
// abandoned tenant living on a device forever.
// ---------------------------------------------------------------------------

export interface GuestBranding {
  logoUrl: string | null;
  brandColor: string | null;
  restaurantName: string | null;
  contactPhone: string | null;
  contactAddress: string | null;
  contactInstagram: string | null;
  workingHours: string | null;
}

export const EMPTY_BRANDING: GuestBranding = {
  logoUrl: null,
  brandColor: null,
  restaurantName: null,
  contactPhone: null,
  contactAddress: null,
  contactInstagram: null,
  workingHours: null
};

/** Long enough to cover a regular's habits, short enough that a rebrand can't
    haunt a device indefinitely. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Per restaurant: one phone can be a regular at two cafes, and showing one's
// logo over the other's menu is worse than showing none.
const storageKey = (restaurantId: string) => `qulaycafe_branding_${restaurantId}`;

/** Only string-or-null fields are accepted back out, so a corrupted or
    hand-edited entry can't put an object where JSX expects text. */
function sanitize(raw: unknown): GuestBranding | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const out = { ...EMPTY_BRANDING };
  let hasAny = false;
  for (const key of Object.keys(EMPTY_BRANDING) as (keyof GuestBranding)[]) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 4000) {
      out[key] = value;
      hasAny = true;
    }
  }
  return hasAny ? out : null;
}

/**
 * The last known branding for this restaurant, or null. Safe to call during
 * render — a blocked or empty localStorage just means "not known yet", which is
 * the same state a first visit is in.
 */
export function loadCachedBranding(restaurantId: string): GuestBranding | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(restaurantId));
  } catch {
    // Private-mode Safari and "block all cookies" throw on access. The splash
    // then waits for the network instead, which is correct, just slower.
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (parsed.savedAt < Date.now() - MAX_AGE_MS) return null;
    return sanitize(parsed.branding);
  } catch {
    return null;
  }
}

/** Called once /api/settings answers. */
export function cacheBranding(restaurantId: string, branding: GuestBranding): void {
  try {
    localStorage.setItem(storageKey(restaurantId), JSON.stringify({ savedAt: Date.now(), branding }));
  } catch {
    // Quota or blocked storage: the current page view is already correct, the
    // next one just starts from the network again.
  }
}
