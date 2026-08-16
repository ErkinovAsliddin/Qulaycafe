// ---------------------------------------------------------------------------
// Reliable one-tap location capture for delivery orders.
//
// A plain navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true,
// timeout: 10000 }) is why "send my location" needed to be tapped twice: on a
// phone the first call has to wake the GPS chip from cold, which routinely
// takes longer than the timeout, so the error callback fires even though the
// device was seconds away from a fix. The second tap then succeeds instantly
// because the radio is already warm and the OS has a cached position.
//
// This module fixes that by never giving up on the first attempt:
//   1. watchPosition (not getCurrentPosition) so every fix the OS produces is
//      delivered as it arrives, instead of one all-or-nothing shot.
//   2. A coarse fix is accepted immediately as a provisional answer, and
//      upgraded if a more accurate one lands before the refine window closes.
//      For handing a courier a map pin, ~100 m is already useful.
//   3. A separate low-accuracy getCurrentPosition runs in parallel, which is
//      what returns the OS's cached / wifi-derived position on the devices
//      where the GPS watch stays silent.
// Whichever path answers first wins; the caller gets one clear outcome.
// ---------------------------------------------------------------------------

export type LocationFailure =
  | 'unsupported' // no Geolocation API in this browser at all
  | 'insecure' // page is not https — browsers refuse to geolocate
  | 'denied' // permission explicitly refused
  | 'unavailable'; // hardware/OS could not produce a fix in time

// The `?: undefined` siblings are deliberate: this project compiles without
// `strictNullChecks`, and without them TypeScript refuses to narrow the union
// on `result.ok`, so reading `result.reason` in the failure branch errors out.
export type LocationResult =
  | { ok: true; lat: number; lng: number; accuracy: number; reason?: undefined }
  | { ok: false; reason: LocationFailure; lat?: undefined; lng?: undefined; accuracy?: undefined };

/** Good enough to drop a courier pin — stop waiting for the GPS to sharpen. */
const GOOD_ACCURACY_METERS = 100;
/** How long to keep waiting for a better fix after a coarse one arrives. */
const REFINE_WINDOW_MS = 4_000;
/** Absolute deadline before reporting failure. Generous on purpose: a cold
 *  GPS on a cheap Android phone can legitimately need this long. */
const HARD_DEADLINE_MS = 25_000;

export function isGeolocationAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.geolocation;
}

export async function acquireLocation(): Promise<LocationResult> {
  if (!isGeolocationAvailable()) {
    return { ok: false, reason: 'unsupported' };
  }
  // Chrome/Safari silently reject geolocation on plain http (localhost is
  // exempt). Detected up front so the customer gets a real reason instead of
  // a generic "could not get your location".
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return { ok: false, reason: 'insecure' };
  }

  return new Promise<LocationResult>(resolve => {
    let settled = false;
    let best: GeolocationPosition | null = null;
    let watchId: number | null = null;
    let refineTimer: number | null = null;
    let deadlineTimer: number | null = null;
    // Only a hard denial should surface as "denied" — a timeout on one of the
    // two parallel attempts must not overwrite that verdict.
    let sawDenial = false;
    let pendingAttempts = 2;

    const cleanup = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (refineTimer !== null) window.clearTimeout(refineTimer);
      if (deadlineTimer !== null) window.clearTimeout(deadlineTimer);
    };

    const succeed = (position: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        ok: true,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy
      });
    };

    const fail = (reason: LocationFailure) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, reason });
    };

    const consider = (position: GeolocationPosition) => {
      if (settled) return;
      if (!best || position.coords.accuracy < best.coords.accuracy) {
        best = position;
      }
      if (best.coords.accuracy <= GOOD_ACCURACY_METERS) {
        succeed(best);
        return;
      }
      // Coarse fix in hand: hold it briefly in case a sharper one follows,
      // then send it rather than waiting out the full deadline.
      if (refineTimer === null) {
        refineTimer = window.setTimeout(() => {
          if (best) succeed(best);
        }, REFINE_WINDOW_MS);
      }
    };

    const attemptFailed = (error: GeolocationPositionError) => {
      if (settled) return;
      if (error.code === error.PERMISSION_DENIED) {
        sawDenial = true;
        // Permission is a page-wide verdict: neither attempt can succeed.
        fail('denied');
        return;
      }
      pendingAttempts -= 1;
      // Both paths exhausted. A coarse fix that arrived meanwhile still counts
      // as a success — better a 500 m pin than nothing for the courier.
      if (pendingAttempts <= 0) {
        if (best) succeed(best);
        else fail(sawDenial ? 'denied' : 'unavailable');
      }
    };

    // Path 1 — live GPS watch, upgraded as fixes sharpen.
    try {
      watchId = navigator.geolocation.watchPosition(consider, attemptFailed, {
        enableHighAccuracy: true,
        timeout: HARD_DEADLINE_MS,
        maximumAge: 0
      });
    } catch {
      pendingAttempts -= 1;
    }

    // Path 2 — coarse/cached position. On many phones this is the one that
    // answers, and it answers fast.
    try {
      navigator.geolocation.getCurrentPosition(consider, attemptFailed, {
        enableHighAccuracy: false,
        timeout: HARD_DEADLINE_MS,
        maximumAge: 120_000
      });
    } catch {
      pendingAttempts -= 1;
    }

    if (pendingAttempts <= 0) {
      fail('unavailable');
      return;
    }

    deadlineTimer = window.setTimeout(() => {
      if (best) succeed(best);
      else fail(sawDenial ? 'denied' : 'unavailable');
    }, HARD_DEADLINE_MS);
  });
}
