import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { db, isSubscriptionUsable } from './db';

export type StaffRole = 'admin' | 'kitchen';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  throw new Error(
    'JWT_SECRET is not set (or too short). Generate one with: openssl rand -base64 48, and put it in .env'
  );
}

const SESSION_COOKIE_NAME = 'session';
const SESSION_TTL = '8h';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

interface SessionPayload {
  role: StaffRole;
  restaurantId: string;
}

// Augment Express's Request so every handler can read req.restaurantId
// after requireRole has run, without re-decoding the cookie everywhere.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      restaurantId?: string;
      staffRole?: StaffRole;
    }
  }
}

export function signSession(role: StaffRole, restaurantId: string): string {
  return jwt.sign({ role, restaurantId } as SessionPayload, JWT_SECRET as string, { expiresIn: SESSION_TTL });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET as string) as SessionPayload;
    if (!payload || typeof payload.restaurantId !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

function getLockoutRow(restaurantId: string, role: StaffRole) {
  return db
    .prepare('SELECT failed_count, locked_until FROM login_attempts WHERE restaurant_id = ? AND role = ?')
    .get(restaurantId, role) as { failed_count: number; locked_until: string | null } | undefined;
}

export function isLockedOut(restaurantId: string, role: StaffRole): { locked: boolean; retryAfterSeconds?: number } {
  const row = getLockoutRow(restaurantId, role);
  if (!row || !row.locked_until) return { locked: false };
  const until = new Date(row.locked_until).getTime();
  const now = Date.now();
  if (until > now) {
    return { locked: true, retryAfterSeconds: Math.ceil((until - now) / 1000) };
  }
  return { locked: false };
}

export function recordFailedAttempt(restaurantId: string, role: StaffRole) {
  const row = getLockoutRow(restaurantId, role);
  const nextCount = (row?.failed_count || 0) + 1;
  let lockedUntil: string | null = row?.locked_until || null;
  if (nextCount >= MAX_FAILED_ATTEMPTS) {
    lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
  }
  db.prepare(
    `INSERT INTO login_attempts (restaurant_id, role, failed_count, locked_until) VALUES (?, ?, ?, ?)
     ON CONFLICT(restaurant_id, role) DO UPDATE SET failed_count = ?, locked_until = ?`
  ).run(restaurantId, role, nextCount, lockedUntil, nextCount, lockedUntil);
}

export function clearFailedAttempts(restaurantId: string, role: StaffRole) {
  db.prepare(
    `INSERT INTO login_attempts (restaurant_id, role, failed_count, locked_until) VALUES (?, ?, 0, NULL)
     ON CONFLICT(restaurant_id, role) DO UPDATE SET failed_count = 0, locked_until = NULL`
  ).run(restaurantId, role);
}

export function verifyPassword(restaurantId: string, role: StaffRole, password: string): boolean {
  const row = db
    .prepare('SELECT password_hash FROM staff_accounts WHERE restaurant_id = ? AND role = ?')
    .get(restaurantId, role) as { password_hash: string } | undefined;
  if (!row) return false;
  return bcrypt.compareSync(password, row.password_hash);
}

export function setPassword(restaurantId: string, role: StaffRole, newPassword: string) {
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare(
    `INSERT INTO staff_accounts (restaurant_id, role, password_hash, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(restaurant_id, role) DO UPDATE SET password_hash = ?, updated_at = ?`
  ).run(restaurantId, role, hash, new Date().toISOString(), hash, new Date().toISOString());
}

const isProd = process.env.NODE_ENV === 'production';

// Left unset by default, which makes the session cookie host-only: a session
// created on admin.qulaycafe.uz is never sent to kitchen.qulaycafe.uz, and
// never to the guest surface at clients.qulaycafe.uz at all. That is the point
// of splitting the surfaces across hostnames, so the strict behaviour is the
// default and sharing is opt-in.
//
// Set SESSION_COOKIE_DOMAIN='.qulaycafe.uz' only if one login should carry
// across the staff subdomains (an admin walking from the dashboard to the
// kitchen screen without re-entering the kitchen PIN). The trade-off is that
// the cookie then also travels with every guest request.
//
// setSessionCookie and clearSessionCookie must agree on this value: a cookie
// set with a domain cannot be cleared without it, and logout would silently
// leave the session alive.
const sessionCookieDomain = process.env.SESSION_COOKIE_DOMAIN?.trim() || undefined;

export function setSessionCookie(res: Response, role: StaffRole, restaurantId: string) {
  const token = signSession(role, restaurantId);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true, // not readable by client-side JS -> not stealable via XSS
    secure: isProd, // only sent over HTTPS in production
    sameSite: 'lax',
    domain: sessionCookieDomain,
    maxAge: 8 * 60 * 60 * 1000
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    domain: sessionCookieDomain
  });
}

// Express middleware factory: require a valid session cookie for the given
// role(s). Also attaches req.restaurantId/req.staffRole so downstream
// handlers scope every query to the logged-in restaurant, never trusting
// anything the client sends for that.
export function requireRole(...allowed: StaffRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const payload = verifySession(token);
    if (!payload || !allowed.includes(payload.role)) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }
    // Checked on EVERY staff request (not just login) so a suspension takes
    // effect immediately, even for someone already logged in with a
    // still-valid session token — the whole point of suspending is that
    // the restaurant stops working right away, not "next time they log in".
    if (!isSubscriptionUsable(payload.restaurantId)) {
      res.status(402).json({
        error: "Obuna to'xtatilgan yoki muddati tugagan. Administrator bilan bog'laning.",
        code: 'SUBSCRIPTION_INACTIVE'
      });
      return;
    }
    req.restaurantId = payload.restaurantId;
    req.staffRole = payload.role;
    next();
  };
}

// Kept as a separate, explicit middleware for write endpoints where the
// intent should be extra obvious in server.ts — functionally redundant
// with the check now inside requireRole above, which is the actual
// enforcement point, but harmless to keep stacked.
export function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  const restaurantId = req.restaurantId;
  if (!restaurantId || !isSubscriptionUsable(restaurantId)) {
    res.status(402).json({
      error: 'Obuna muddati tugagan yoki to‘xtatilgan. Iltimos, administrator bilan bog‘laning.',
      code: 'SUBSCRIPTION_INACTIVE'
    });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Owner (super-admin) auth — completely separate from restaurant staff
// sessions. This protects the endpoints the owner's Telegram bot calls to
// create restaurants and manage subscriptions. It is a single shared
// secret (not a per-user login) because there is exactly one owner.
// ---------------------------------------------------------------------------
const OWNER_API_SECRET = process.env.OWNER_API_SECRET || '';

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!OWNER_API_SECRET) {
    res.status(503).json({ error: 'Owner API is not configured (OWNER_API_SECRET missing on server).' });
    return;
  }
  const provided = req.header('X-Owner-Secret');
  if (!provided || provided !== OWNER_API_SECRET) {
    res.status(401).json({ error: 'Not authorized' });
    return;
  }
  next();
}
