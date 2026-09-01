import 'dotenv/config';
import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { ZodSchema } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import {
  telegramConfigured,
  createVerificationToken,
  getVerificationStatus,
  markVerified,
  sendTelegramMessage,
  registerWebhook,
  verifyTelegramWebAppInitData,
  escapeTelegramHtml
} from './src/server/telegram';
import { ownerBotConfigured, registerOwnerWebhook, handleOwnerBotMessage, checkExpiringSubscriptionsAndNotifyOwner } from './src/server/ownerBot';
import {
  deliveryBotConfigured,
  registerDeliveryBotWebhook,
  handleDeliveryBotUpdate,
  notifyCouriersOfNewOrder,
  deliveryEvents
} from './src/server/deliveryBot';
import {
  startReservationFlow,
  handleReservationMessage,
  handleReservationCallback,
  notifyGuestOfReservationUpdate,
  notifyAdminOfReservation,
  notifyAdminOfGuestCancellation,
  checkReservationWindow,
  reservationToday,
  reservationCode,
  reservationEvents
} from './src/server/reservationBot';
import { buildReceiptBytes, sendToNetworkPrinter } from './src/server/escpos';
import {
  guestOrderUrl,
  clientsBaseUrl as envClientsUrl,
  adminBaseUrl as envAdminUrl,
  kitchenBaseUrl as envKitchenUrl
} from './src/server/publicUrls';
import { createServer as createViteServer } from 'vite';
import {
  db,
  backupNow,
  getRestaurantById,
  getRestaurantByPhone,
  getRestaurantBySlug,
  createRestaurant,
  isSubscriptionUsable,
  getSubscription,
  listRestaurantsWithSubscriptions,
  setSubscriptionStatus,
  updateRestaurantBranding,
  setAdminTelegramLink,
  unlinkAdminTelegram,
  createWaiterCall,
  listWaiterCalls,
  resolveWaiterCall,
  setDeliveryStatus,
  createCourier,
  listCouriers,
  setCourierStatus,
  getCourierById,
  renameCourier,
  createCourierInvite,
  listCourierInvites,
  revokeCourierInvite,
  upsertDailyClosure,
  getDailyClosure,
  listCategories,
  categoryExists,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  reservationsEnabled,
  loyaltyEnabled,
  listReservations,
  getReservation,
  createReservation,
  updateReservation,
  countPendingReservations,
  countReservationsByPhoneSince,
  countOpenReservationsByPhone,
  findOpenReservationBySlot,
  getReservationByPublicToken,
  attachTelegramChatToReservation,
  storeImageBlob,
  getImageBlob,
  deleteImageBlob,
  inlineImageBlob,
  DuplicateCategoryNameError
} from './src/server/db';
import {
  requireRole,
  requireActiveSubscription,
  requireOwner,
  verifyPassword,
  setPassword,
  setSessionCookie,
  clearSessionCookie,
  verifySession,
  isLockedOut,
  recordFailedAttempt,
  clearFailedAttempts
} from './src/server/auth';
import {
  menuItemCreateSchema,
  menuItemUpdateSchema,
  orderCreateSchema,
  orderStatusUpdateSchema,
  tableCreateSchema,
  loyaltyRegisterSchema,
  loginSchema,
  phoneLoginSchema,
  restaurantRegisterSchema,
  ownerCreateRestaurantSchema,
  ownerSubscriptionUpdateSchema,
  changePasswordSchema,
  googleVerifySchema,
  exchangeRateUpdateSchema,
  settingsUpdateSchema,
  brandingUpdateSchema,
  waiterCallSchema,
  printerSettingsSchema,
  courierNameUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  categoryReorderSchema,
  reservationUpdateSchema,
  reservationPublicCreateSchema,
  reservationTokenSchema
} from './src/server/validation';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { MenuItem, Order, Table, LoyaltyMember, InventoryLog } from './src/types';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const isProd = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Real-time updates via Server-Sent Events, split into two scopes:
//  - Staff stream (admin/kitchen only, session-gated): full order details,
//    inventory, and table state, exactly like a kitchen display needs.
//  - Table-scoped stream (public but narrow): a customer only receives
//    updates for their OWN table's order status and general menu/table
//    availability — never other tables' orders or any loyalty-member data.
//    Narrow in shape as well as in scope: orders go out through
//    publicOrderView() below, because this channel is shared by every browser
//    that has ever scanned that table's QR, including the next customer.
//  - Order-scoped stream (public, one id): the full order, for the one guest
//    who placed it and therefore knows its id.
// The original build broadcast full orders + the entire loyalty member list
// (names/phones/emails/points) to every connected browser tab, including
// customers. That data exposure is fixed by this split.
// ---------------------------------------------------------------------------
type StaffSSEClient = { res: Response; restaurantId: string };
type TableSSEClient = { res: Response; restaurantId: string; tableNumber?: number };
type OrderSSEClient = { res: Response; restaurantId: string; orderId: string };
const staffClients: StaffSSEClient[] = [];
const tableClients: TableSSEClient[] = [];
const orderClients: OrderSSEClient[] = [];

function sseSend(res: Response, type: string, data: unknown) {
  res.write(`data: ${JSON.stringify({ type, data, timestamp: new Date().toISOString() })}\n\n`);
}

// Every broadcast is scoped to ONE restaurant_id — otherwise restaurant A's
// staff dashboard would see restaurant B's live orders, and vice versa.
function broadcastStaff(restaurantId: string, type: string, data: unknown) {
  staffClients
    .filter(c => c.restaurantId === restaurantId)
    .forEach(c => {
      try {
        sseSend(c.res, type, data);
      } catch (e) {
        logger.error({ err: e }, 'SSE staff send error');
      }
    });
}

function broadcastTable(restaurantId: string, tableNumber: number, type: string, data: unknown) {
  tableClients
    .filter(c => c.restaurantId === restaurantId && c.tableNumber === tableNumber)
    .forEach(c => {
      try {
        sseSend(c.res, type, data);
      } catch (e) {
        logger.error({ err: e }, 'SSE table send error');
      }
    });
}

// Delivery orders don't have a real table (they all share the tableNumber=0
// sentinel), so broadcasting by table number would leak one delivery
// customer's order details (address, phone, items) to every OTHER delivery
// customer of the same restaurant watching that same channel. This scopes
// the update to exactly the one order it belongs to instead.
function broadcastOrder(restaurantId: string, orderId: string, type: string, data: unknown) {
  orderClients
    .filter(c => c.restaurantId === restaurantId && c.orderId === orderId)
    .forEach(c => {
      try {
        sseSend(c.res, type, data);
      } catch (e) {
        logger.error({ err: e }, 'SSE order send error');
      }
    });
}

// ---------------------------------------------------------------------------
// What an order looks like to an anonymous guest.
//
// The table channel and the public table endpoint are shared by EVERY browser
// that has ever scanned that table's QR code, so anything put on them is handed
// to the next stranger who sits down. They used to carry the whole order row:
// the previous customer's name, phone number, delivery address, note and full
// bill arrived on the new guest's phone, and the UI filtering it out afterwards
// does nothing about what is already in the network tab.
//
// So the public shape is only what a status display needs: which ticket, where
// it is in the kitchen, and how long. A guest's own copy of their order — items,
// totals, the name they typed — is the one they already have from the POST
// response, kept on their own device (src/utils/guestOrders.ts); this projection
// exists purely to move that copy's status along.
//
// Deliberately omitted: customerName, customerPhoneOrEmail, items, subtotal,
// tax, serviceCharge, discount, totalAmount, paymentMethod, orderNote,
// deliveryAddress, deliveryPhone, deliveryLat/Lng, loyalty point fields.
// The staff stream (session-gated) and the per-order stream (scoped to one id
// the guest already knows) still carry the full row.
// ---------------------------------------------------------------------------
export function publicOrderView(order: Order) {
  return {
    id: order.id,
    tableNumber: order.tableNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    orderType: order.orderType,
    estimatedMinutes: order.estimatedMinutes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    // The courier's first name is shown to the customer waiting for them by
    // design; it is the courier's, not another customer's.
    courierName: order.courierName
  };
}

function broadcastTableAll(restaurantId: string, type: string, data: unknown) {
  tableClients
    .filter(c => c.restaurantId === restaurantId)
    .forEach(c => {
      try {
        sseSend(c.res, type, data);
      } catch (e) {
        logger.error({ err: e }, 'SSE table-all send error');
      }
    });
}

// ---------------------------------------------------------------------------
// Generic request-validation middleware. Every mutating endpoint below runs
// its body through a zod schema before touching the database. Anything that
// doesn't match the schema is rejected with 400 and never reaches business
// logic.
// ---------------------------------------------------------------------------
function validateBody<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid request data', details: result.error.flatten() });
      return;
    }
    req.body = result.data;
    next();
  };
}

// --- Data access helpers (SQLite-backed, replacing the old in-memory arrays) --
// Every one of these takes restaurantId and scopes the query to it — this is
// the core of tenant isolation: no query below ever runs without it.
// Rows written before the numeric stock count was removed still carry a
// `stock` key inside their JSON blob. Strip it on the way out so the API shape
// matches the current MenuItem type, and treat a legacy "0 left" row as simply
// unavailable.
function normalizeMenuItem(raw: any): MenuItem {
  const { stock, ...rest } = raw ?? {};
  const item = rest as MenuItem;
  if (typeof stock === 'number' && stock <= 0) item.isAvailable = false;
  if (typeof item.isAvailable !== 'boolean') item.isAvailable = true;
  return item;
}
function readMenu(restaurantId: string): MenuItem[] {
  return (
    db.prepare('SELECT data FROM menu_items WHERE restaurant_id = ?').all(restaurantId) as { data: string }[]
  ).map(r => normalizeMenuItem(JSON.parse(r.data)));
}
// Onboarding dismissal is a per-restaurant setting rather than client state:
// the wizard must not come back on the next login, or on another device.
function readOnboardingCompleted(restaurantId: string): boolean {
  const row = db
    .prepare(`SELECT value FROM settings WHERE restaurant_id = ? AND key = 'onboardingCompleted'`)
    .get(restaurantId) as { value: string } | undefined;
  return row?.value === '1';
}
function readOrders(restaurantId: string): Order[] {
  return (
    db
      .prepare('SELECT data FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC')
      .all(restaurantId) as { data: string }[]
  ).map(r => JSON.parse(r.data));
}
function readTables(restaurantId: string): Table[] {
  return (
    db
      .prepare('SELECT data FROM tables WHERE restaurant_id = ? ORDER BY table_number ASC')
      .all(restaurantId) as { data: string }[]
  ).map(r => JSON.parse(r.data));
}
function readLoyalty(restaurantId: string): LoyaltyMember[] {
  return (
    db.prepare('SELECT data FROM loyalty_members WHERE restaurant_id = ?').all(restaurantId) as { data: string }[]
  ).map(r => JSON.parse(r.data));
}

// The whole "ball" (points) economy in two numbers, so the order handler and
// anything else that touches points can never drift apart: a guest earns one
// point per 1,000 so'm spent, and one point is worth 100 so'm off a later bill
// (~10% back). The cart UI mirrors these figures.
const SOM_PER_POINT_EARNED = 1000;
const POINT_VALUE_SOM = 100;
function readInventoryLogs(restaurantId: string): InventoryLog[] {
  return (
    db
      .prepare('SELECT data FROM inventory_logs WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 500')
      .all(restaurantId) as { data: string }[]
  ).map(r => JSON.parse(r.data));
}

// Identifies which restaurant a CUSTOMER request belongs to — customers
// have no session cookie, so this comes from the QR code's URL, forwarded
// by the frontend as either an X-Restaurant-Id header or an ?r= query
// param. Falls back to the "default" tenant (the original single-restaurant
// deployment) so existing printed QR codes keep working without a reprint.
// Blocks the request with a friendly message if the restaurant's
// subscription isn't active — this is the ONLY enforcement point needed for
// "stop working if the owner didn't pay", with no payment gateway involved.
function resolvePublicRestaurantId(req: Request): string {
  const headerVal = req.header('X-Restaurant-Id');
  const queryVal = typeof req.query.r === 'string' ? req.query.r : undefined;
  return (headerVal || queryVal || 'default').trim();
}

function requirePublicRestaurant(req: Request, res: Response, next: NextFunction) {
  const restaurantId = resolvePublicRestaurantId(req);
  const restaurant = getRestaurantById(restaurantId);
  if (!restaurant) {
    res.status(404).json({ error: 'Restoran topilmadi.' });
    return;
  }
  if (!isSubscriptionUsable(restaurantId)) {
    res.status(402).json({
      error: "Bu restoran hozircha ishlamayapti. Iltimos, ma'muriyat bilan bog'laning.",
      code: 'SUBSCRIPTION_INACTIVE'
    });
    return;
  }
  req.restaurantId = restaurantId;
  next();
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Trust the first proxy hop (needed on Hostinger/AWS behind Nginx/ALB/Cloudflare)
  // so rate limiting and secure cookies see the real client IP/protocol.
  app.set('trust proxy', 1);

  // --- Security headers ---
  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              // telegram.org/js/telegram-web-app.js is loaded by index.html and
              // is what defines window.Telegram.WebApp — without it in the
              // allow-list the CSP blocks the script, initData is never seen,
              // and a guest arriving from the bot's "Buyurtma berish" button
              // silently loses their verified Telegram identity.
              scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client', 'https://telegram.org'],
              // The landing page pulls its typefaces from Google Fonts: the
              // stylesheet is style-src (the font files themselves fall under
              // helmet's default font-src 'self' https: data:), so without this
              // the marketing site silently renders in fallback fonts.
              // accounts.google.com/gsi/style is the stylesheet Google Sign-In's
              // renderButton() injects. 'unsafe-inline' does NOT cover it (that
              // only allows inline <style>), so without it listed the CSP blocks
              // the sheet and the Google button renders unstyled/collapsed — the
              // sign-in looks "broken" in production while working in dev, where
              // the whole CSP is off.
              styleSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://fonts.googleapis.com',
                'https://accounts.google.com/gsi/style'
              ],
              connectSrc: ["'self'", 'https://accounts.google.com'],
              frameSrc: ["'self'", 'https://accounts.google.com'],
              frameAncestors: ["'none'"]
            }
          }
        : false, // relaxed in dev so Vite HMR keeps working
      // Helmet's default 'same-origin' isolates this page's window from any
      // popup it opens, breaking the postMessage handshake Google Sign-In's
      // popup relies on (this is the exact cause of "Cannot read properties
      // of null (reading 'postMessage')"). 'same-origin-allow-popups' keeps
      // the isolation for framing/Spectre purposes but still lets an opened
      // popup talk back to us.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
    })
  );

  // --- CORS: only allow explicitly configured origins (never "*") ---
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '8mb' })); // uploaded photos are base64-encoded in the request body
  app.use(express.urlencoded({ limit: '8mb', extended: true }));
  app.use(pinoHttp({ logger, redact: ['req.headers.cookie', 'req.headers.authorization'] }));

  // ---------------------------------------------------------------------
  // Surface routing by hostname. One deployment, four faces:
  //
  //   qulaycafe.uz / www.        → the static marketing landing page only
  //   clients.qulaycafe.uz       → the guest menu (SPA)
  //   kitchen.qulaycafe.uz       → the kitchen screen (SPA)
  //   admin.qulaycafe.uz         → the dashboard (SPA)
  //
  // These rules mirror src/utils/surface.ts exactly; if one side changes the
  // other must change with it. The server's job here is only the landing page
  // and the legacy redirects — the SPA decides which app to render, and the API
  // never trusts the hostname for authorization (that stays with the session
  // cookie and requireRole).
  //
  // Every list is overridable by env so a domain change needs no code change.
  // ---------------------------------------------------------------------
  const hostList = (value: string | undefined, fallback: string): string[] =>
    (value || fallback)
      .split(',')
      .map(h => h.trim().toLowerCase())
      .filter(Boolean);

  const landingHostnames = hostList(process.env.LANDING_HOSTNAMES, 'qulaycafe.uz,www.qulaycafe.uz');
  const clientsHostnames = hostList(process.env.CLIENTS_HOSTNAMES, 'clients.qulaycafe.uz');
  // Hostnames that used to serve everything at once. A table QR printed before
  // the split points here, and so do bookmarks and Telegram links already out
  // in the world, so they are redirected rather than broken.
  const legacyAppHostnames = hostList(process.env.LEGACY_APP_HOSTNAMES, 'app.qulaycafe.uz');

  // One derivation for every surface URL (src/server/publicUrls.ts), with the
  // hostname lists above as the last resort so a deployment that set neither
  // CLIENTS_URL nor APP_URL still redirects somewhere sensible.
  const clientsBaseUrl = (envClientsUrl() || `https://${clientsHostnames[0] || 'clients.qulaycafe.uz'}`).replace(/\/$/, '');
  const adminBaseUrl = (envAdminUrl() || clientsBaseUrl.replace(/\/\/clients\./, '//admin.')).replace(/\/$/, '');
  const kitchenBaseUrl = (envKitchenUrl() || clientsBaseUrl.replace(/\/\/clients\./, '//kitchen.')).replace(/\/$/, '');

  // A legacy link is only redirected if it is a page request. API calls,
  // uploads and hashed assets keep working on the old hostname so a tab that
  // was already open when the split shipped does not start failing mid-order.
  const isPageRequest = (req: Request): boolean =>
    req.method === 'GET' &&
    !req.path.startsWith('/api/') &&
    !req.path.startsWith('/uploads/') &&
    !req.path.startsWith('/assets/') &&
    !req.path.startsWith('/@') && // Vite dev client
    !/\.[a-z0-9]+$/i.test(req.path);

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!legacyAppHostnames.includes(req.hostname.toLowerCase()) || !isPageRequest(req)) {
      next();
      return;
    }
    // ?view=admin / ?view=kitchen were the old in-app entry points into the
    // staff screens. They now have their own hostnames, and the parameter is
    // dropped on the way so it can never re-enter the guest app.
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const view = (params.get('view') || '').toLowerCase();
    params.delete('view');
    const query = params.toString();
    if (view === 'admin' || view === 'kitchen') {
      res.redirect(301, `${view === 'admin' ? adminBaseUrl : kitchenBaseUrl}/${query ? `?${query}` : ''}`);
      return;
    }
    res.redirect(301, `${clientsBaseUrl}${req.path}${query ? `?${query}` : ''}`);
  });

  const landingPath = path.join(process.cwd(), 'landing');
  if (fs.existsSync(landingPath)) {
    const landingStatic = express.static(landingPath, {
      extensions: ['html'],
      // Same split as the dist assets below: the shell must be re-checked on
      // every visit so a new deploy is picked up, while the hashed bundles and
      // the photos (whose names are stable but whose bytes never change) are
      // cached for a year. Without this the marketing page re-downloads ~1 MB
      // of WebP on every visit, which is the whole page weight on a phone.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/[/\\](assets|images)[/\\]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=86400');
        }
      }
    });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!landingHostnames.includes(req.hostname.toLowerCase())) {
        next();
        return;
      }
      // The landing page is a page-only surface, but it must not swallow the
      // API: its fallback below answers *every* unmatched path with the
      // marketing HTML, which would turn `GET /api/health` on the apex into a
      // 200 + HTML — an uptime monitor pointed there (as the deploy guide
      // suggests) would then never notice the server failing. Uploads are
      // excluded for the same reason: a legacy link that still hits the apex
      // should get the real file or a real 404, not a marketing page.
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
        next();
        return;
      }
      // A guest-facing deep link that reached the apex belongs to the guest
      // surface, not to the marketing page: send it on instead of showing
      // someone who scanned a QR code a page about pricing.
      if (isPageRequest(req) && /^\/(order|book|table)(\/|$)/.test(req.path)) {
        const query = req.url.split('?')[1];
        res.redirect(301, `${clientsBaseUrl}${req.path}${query ? `?${query}` : ''}`);
        return;
      }
      landingStatic(req, res, () => {
        // A request for a hashed bundle or any other file-looking path has no
        // business being answered with marketing HTML: a browser still holding
        // the pre-split app shell for the apex would fail the module load on a
        // MIME mismatch and show a blank page instead of reloading into the
        // landing site (whose shell is served no-cache).
        if (req.path.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(req.path)) {
          res.status(404).type('txt').send('Not found');
          return;
        }
        // No matching static asset for this path on the landing domain
        // (e.g. a deep link, or a trailing slash variant) — fall back to
        // the landing page itself rather than ever reaching the app.
        // sendFile does not go through the setHeaders above, so the shell's
        // no-cache is set here too.
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(landingPath, 'index.html'));
      });
    });
  }

  // --- Rate limiting ---
  // A stored photo is the one /api response that is safe to cache and must be
  // cached: its URL carries the tenant AND the content hash, so it can never
  // answer for the wrong restaurant and can never go stale — a replaced photo
  // is a different URL. Everything else stays uncacheable.
  const isImageRequest = (req: Request) =>
    req.method === 'GET' && /^\/(menu\/[^/]+\/image|branding\/logo)$/.test(req.path);

  // Which restaurant an /api response describes is decided by a request
  // HEADER (X-Restaurant-Id), not by the URL, so a cache that keys on the URL
  // alone would happily hand restaurant B's browser restaurant A's menu. Vary
  // makes any well-behaved cache key on the tenant, and no-store keeps the
  // browser, the reverse proxy and Cloudflare out of it entirely — a menu the
  // admin just edited must never come back from a cache.
  //
  // This also removed one half of "the menu only appears after refreshing 2-3
  // times": a 304/from-cache empty menu response for the wrong tenant used to
  // stick around until something happened to evict it.
  app.use('/api/', (req: Request, res: Response, next: NextFunction) => {
    if (isImageRequest(req)) {
      next(); // the route sets its own long-lived caching headers
      return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Vary', 'X-Restaurant-Id, Origin');
    next();
  });

  app.use(
    '/api/',
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
      // One menu page opens as many photo requests as it has dishes, and a
      // family sharing one restaurant's Wi-Fi shares one IP: counting photos
      // against a 300/minute budget would rate-limit ordinary browsing. They
      // are served from the browser cache after the first view anyway.
      skip: isImageRequest
    })
  );
  const loginLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please wait a minute and try again.' }
  });
  // Shared by ordering, loyalty and verification routes, so the budget is per
  // guest IP across all of them. Tunable for the same reason the booking
  // limiter is: an integration suite (or a venue behind one NAT) makes far more
  // of these calls per minute than a single guest ever would.
  const orderLimiter = rateLimit({
    windowMs: 60_000,
    limit: Number(process.env.ORDER_RATE_LIMIT_PER_MINUTE) || 20,
    standardHeaders: true,
    legacyHeaders: false
  });

  // Public web bookings have no Telegram chat id to key flood control on, so
  // the browser's IP is the only per-sender signal available before a booking
  // exists. Deliberately low and tunable: a restaurant's own wifi is a single
  // IP, so RESERVATION_WEB_MAX_PER_IP_PER_HOUR is the knob to raise if a venue
  // ever reports guests being turned away. The per-phone caps in the route
  // itself are the real limit; this one only blunts scripted floods.
  const webBookingsPerIpPerHour = Number(process.env.RESERVATION_WEB_MAX_PER_IP_PER_HOUR) || 3;
  const reservationLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: webBookingsPerIpPerHour,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Juda ko'p bron so'rovi yuborildi. Bir soatdan keyin qayta urinib ko'ring yoki restoranga qo'ng'iroq qiling."
    }
  });
  // Reading or cancelling one's own booking is cheap and idempotent, but the
  // token is a bearer secret, so brute-force attempts get a ceiling too.
  const reservationLookupLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Juda ko'p so'rov. Bir daqiqadan keyin urinib ko'ring." }
  });

  // Staff real-time stream: full detail, admin/kitchen session required.
  // restaurantId comes from the session (req.restaurantId), never from the
  // client, so one restaurant's staff can never subscribe to another's feed.
  app.get('/api/events', requireRole('admin', 'kitchen'), (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Tells Nginx (and similar reverse proxies) not to buffer this response.
    // Without this, notifications can sit in a proxy buffer and only
    // arrive once it flushes — which looks exactly like "I have to
    // refresh to see new orders" even though the server sent them instantly.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const client: StaffSSEClient = { res, restaurantId: req.restaurantId as string };
    staffClients.push(client);
    req.on('close', () => {
      const idx = staffClients.indexOf(client);
      if (idx !== -1) staffClients.splice(idx, 1);
    });
  });

  // Customer real-time stream: scoped to one table AND one restaurant, no
  // auth required (a dining guest isn't logged in), but never carries other
  // tables'/restaurants' data.
  app.get('/api/events/table/:tableNumber', requirePublicRestaurant, (req: Request, res: Response) => {
    const tableNumber = Number(req.params.tableNumber);
    if (!Number.isFinite(tableNumber)) {
      res.status(400).end();
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const client: TableSSEClient = { res, restaurantId: req.restaurantId as string, tableNumber };
    tableClients.push(client);
    req.on('close', () => {
      const idx = tableClients.indexOf(client);
      if (idx !== -1) tableClients.splice(idx, 1);
    });
  });

  // Delivery orders don't have a table to scope by, and sharing one channel
  // across every delivery customer of a restaurant would leak one
  // customer's address/phone/items to another watching the same stream —
  // this is scoped to exactly one order instead.
  app.get('/api/events/order/:orderId', requirePublicRestaurant, (req: Request, res: Response) => {
    const orderId = req.params.orderId;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const client: OrderSSEClient = { res, restaurantId: req.restaurantId as string, orderId };
    orderClients.push(client);
    req.on('close', () => {
      const idx = orderClients.indexOf(client);
      if (idx !== -1) orderClients.splice(idx, 1);
    });
  });

  const googleClientId = (process.env.GOOGLE_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
  const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;
  if (googleClientId && !googleClientId.endsWith('.apps.googleusercontent.com')) {
    logger.warn(
      { googleClientId },
      "GOOGLE_CLIENT_ID doesn't look like a real Google OAuth Client ID (should end in .apps.googleusercontent.com) — double-check you copied the Client ID, not the Client Secret, and that there are no stray quotes/spaces in .env"
    );
  }

  // The Client ID is not secret (it's meant to be embedded in frontend JS) —
  // safe to expose here so the frontend doesn't need it hardcoded/rebuilt.
  app.get('/api/auth/google/config', (_req: Request, res: Response) => {
    res.json({ clientId: googleClientId, configured: !!googleClientId });
  });

  // Real verification: the ID token is a signed JWT from Google. We verify
  // its signature, issuer, audience (our Client ID), and expiry server-side
  // via google-auth-library — this cannot be forged by typing an email into
  // a form, unlike the old mocked flow.
  app.post(
    '/api/auth/google/verify',
    orderLimiter,
    validateBody(googleVerifySchema),
    async (req: Request, res: Response) => {
      if (!googleClient || !googleClientId) {
        res.status(503).json({
          error: 'Google Sign-In is not configured on this server yet. Set GOOGLE_CLIENT_ID in .env.'
        });
        return;
      }
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: req.body.credential,
          audience: googleClientId
        });
        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
          res.status(401).json({ error: 'Invalid Google credential' });
          return;
        }
        res.json({
          id: 'google-' + payload.sub,
          email: payload.email,
          name: payload.name || payload.email.split('@')[0],
          picture: payload.picture || '',
          givenName: payload.given_name || (payload.name || '').split(' ')[0]
        });
      } catch (err: any) {
        req.log.warn(
          { err: err?.message, googleClientId },
          'Google ID token verification failed — check that GOOGLE_CLIENT_ID here matches Google Cloud Console exactly, and that your domain is in Authorized JavaScript origins'
        );
        res.status(401).json({ error: 'Could not verify Google credential' });
      }
    }
  );

  // --- TELEGRAM BOT VERIFICATION ---
  // Real verification: the customer taps "Verify with Telegram", we hand
  // them a one-time deep link to YOUR bot, they press Start there (proving
  // they control that Telegram account), and the bot's webhook marks the
  // token verified. The browser polls for that. This replaces a flow that
  // used to accept a universal bypass code and never verified anything.
  const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

  app.get('/api/auth/telegram/config', (_req: Request, res: Response) => {
    res.json({ configured: telegramConfigured });
  });

  app.post('/api/auth/telegram/start', orderLimiter, (_req: Request, res: Response) => {
    if (!telegramConfigured) {
      res.status(503).json({ error: 'Telegram verification is not configured on this server yet.' });
      return;
    }
    const { token, deepLink } = createVerificationToken();
    res.json({ token, deepLink });
  });

  app.get('/api/auth/telegram/status/:token', (req: Request, res: Response) => {
    const status = getVerificationStatus(req.params.token);
    res.json(status);
  });

  // Validates the signed initData a Telegram Mini App launch is handed,
  // proving the person genuinely opened this page from inside Telegram as
  // that specific Telegram account — a legitimate identity-verification
  // path, same trust level as the deep-link bot flow above but instant.
  app.post('/api/auth/telegram/webapp-verify', loginLimiter, (req: Request, res: Response) => {
    const initData = req.body?.initData;
    if (typeof initData !== 'string' || initData.length > 4000) {
      res.status(400).json({ error: 'invalid initData' });
      return;
    }
    const user = verifyTelegramWebAppInitData(initData);
    if (!user) {
      res.status(401).json({ error: 'Could not verify Telegram Mini App identity' });
      return;
    }
    res.json({ verified: true, telegramUserId: user.id, telegramUsername: user.username, telegramFirstName: user.firstName });
  });

  // Telegram calls this endpoint directly when someone messages the bot.
  // The secret_token header (set during setWebhook) proves the request
  // actually came from Telegram and not an attacker hitting this URL
  // directly to fake a verification.
  app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
    if (TELEGRAM_WEBHOOK_SECRET) {
      const incomingSecret = req.header('X-Telegram-Bot-Api-Secret-Token');
      if (incomingSecret !== TELEGRAM_WEBHOOK_SECRET) {
        res.status(401).end();
        return;
      }
    }
    const message = req.body?.message;
    const callbackQuery = req.body?.callback_query;
    const text: string | undefined = message?.text;
    const from = message?.from;

    // Inline-button taps (reservation Confirm/Decline etc.) arrive as
    // callback_query, never as a message.
    // Both reservation entry points are wrapped: Express 4 does not catch
    // rejected promises from an async handler, so an unexpected throw here
    // would leave Telegram without a 200 and make it retry the same update.
    if (callbackQuery) {
      try {
        await handleReservationCallback(callbackQuery);
      } catch (err) {
        req.log.error({ err }, 'reservation callback handling failed');
      }
      res.status(200).end();
      return;
    }

    // Reservation conversation (/book, /mybookings, and any answer the guest
    // types mid-flow). Returns false for anything it doesn't own — including
    // /start — so the verification handling below still runs.
    if (message) {
      let handled = false;
      try {
        handled = await handleReservationMessage(message);
      } catch (err) {
        req.log.error({ err }, 'reservation message handling failed');
        handled = true; // don't fall through into verification with a broken state
      }
      if (handled) {
        res.status(200).end();
        return;
      }
    }

    if (text && text.startsWith('/start') && from) {
      const parts = text.split(' ');
      const payload = parts[1];

      // Booking deep link: …?start=book_<slug>. This is the ONLY way a guest
      // enters the reservation flow cold — it's what pins the conversation to
      // one restaurant, since a bot chat carries no tenant of its own.
      if (payload && payload.startsWith('book_')) {
        const slug = payload.slice('book_'.length);
        const restaurant = getRestaurantBySlug(slug);
        if (!restaurant) {
          await sendTelegramMessage(from.id, "Bu restoran topilmadi. Havola noto'g'ri bo'lishi mumkin.");
        } else {
          await startReservationFlow(String(message.chat?.id ?? from.id), restaurant.id, from);
        }
        res.status(200).end();
        return;
      }

      // Web booking follow-up: …?start=resv_<token>. A guest who booked on the
      // website and wants Telegram updates opens this link, and it attaches
      // THIS chat to THAT booking — so every later confirm/decline reaches them
      // exactly as it would a booking made in the bot. Optional by design: the
      // booking already works without it.
      if (payload && payload.startsWith('resv_')) {
        const token = payload.slice('resv_'.length);
        const chatId = String(message.chat?.id ?? from.id);
        const found = /^[a-f0-9]{48}$/.test(token) ? getReservationByPublicToken(token) : undefined;
        if (!found) {
          await sendTelegramMessage(chatId, "Bu bron havolasi eskirgan yoki topilmadi.");
        } else if (found.reservation.telegramChatId && found.reservation.telegramChatId !== chatId) {
          // Someone else already claimed the notifications for this booking —
          // attachTelegramChatToReservation would refuse anyway, but say so
          // rather than silently pretending it worked.
          await sendTelegramMessage(chatId, "Bu bron boshqa Telegram akkauntga ulangan.");
        } else {
          const updated = attachTelegramChatToReservation(
            found.restaurantId,
            found.reservation.id,
            chatId,
            from.username || null
          );
          const restaurant = getRestaurantById(found.restaurantId);
          await sendTelegramMessage(
            chatId,
            `✅ <b>Ulandi!</b>\n\n🍽 ${escapeTelegramHtml(restaurant?.name || 'Restoran')}\n🗓 ${
              found.reservation.reservedDate
            } — ${found.reservation.reservedTime}\n👥 ${
              found.reservation.partySize
            } kishi\n\nBron holati o'zgarganda shu yerga xabar yuboraman.`,
            undefined,
            { parseMode: 'HTML' }
          );
          // Already decided while they were linking? Then the outcome itself is
          // the news — send it through the same formatter the bot uses.
          if (updated && updated.status !== 'pending') {
            try {
              await notifyGuestOfReservationUpdate(found.restaurantId, updated);
            } catch (err) {
              req.log.error({ err }, 'failed to send current reservation status after telegram link');
            }
          }
        }
        res.status(200).end();
        return;
      }

      if (payload && payload.startsWith('order_')) {
        const slug = payload.slice('order_'.length);
        const restaurant = getRestaurantBySlug(slug);
        // The button has to open the guest surface, not whatever host the
        // webhook happens to be registered on.
        const orderUrl = restaurant ? guestOrderUrl(slug) : null;
        if (!restaurant) {
          await sendTelegramMessage(from.id, "Bu restoran topilmadi. Havola noto'g'ri bo'lishi mumkin.");
        } else if (!orderUrl) {
          await sendTelegramMessage(from.id, "Ilova hali to'liq sozlanmagan. Iltimos, veb-saytdan foydalaning.");
        } else {
          // parse_mode has to be asked for explicitly, otherwise the guest
          // sees the literal <b> tags around the restaurant name.
          await sendTelegramMessage(
            from.id,
            `🍽 <b>${escapeTelegramHtml(restaurant.name)}</b>\n\nMenyu va buyurtma berish uchun quyidagi tugmani bosing.`,
            [{ text: '🛵 Buyurtma berish', web_app: { url: orderUrl } }],
            { parseMode: 'HTML' }
          );
        }
        res.status(200).end();
        return;
      }

      const token = payload;
      if (token) {
        const result = markVerified(token, from);
        if (result.ok && result.purpose === 'admin_notify' && result.restaurantId) {
          setAdminTelegramLink(result.restaurantId, String(from.id), from.username || null);
          await sendTelegramMessage(
            from.id,
            "✅ Ulandi! Endi yangi buyurtma kelganda shu yerga xabar yuboraman."
          );
        } else {
          await sendTelegramMessage(
            from.id,
            result.ok
              ? '✅ Verified! You can return to the browser now — your table is ready to order.'
              : '⚠️ This verification link has expired or was already used. Please request a new one from the website.'
          );
        }
      } else {
        await sendTelegramMessage(from.id, 'Hi! Open this bot from the restaurant website to verify your account.');
      }
    }
    res.status(200).end(); // Telegram just needs a 200; content is ignored
  });

  // --- OWNER BOT WEBHOOK (Alex's private subscription-management bot) ---
  const OWNER_BOT_WEBHOOK_SECRET = process.env.OWNER_BOT_WEBHOOK_SECRET || '';
  app.post('/api/owner-bot/webhook', async (req: Request, res: Response) => {
    if (OWNER_BOT_WEBHOOK_SECRET) {
      const incomingSecret = req.header('X-Telegram-Bot-Api-Secret-Token');
      if (incomingSecret !== OWNER_BOT_WEBHOOK_SECRET) {
        res.status(401).end();
        return;
      }
    }
    await handleOwnerBotMessage(req.body?.message);
    res.status(200).end();
  });

  // --- RESTAURANT SELF-REGISTRATION ---
  // OFF by default. Alex sells this system by hand — a restaurant contacts
  // him, pays, and he creates their login via the owner Telegram bot. Set
  // ENABLE_SELF_REGISTRATION=true in .env if you ever want restaurants to
  // sign themselves up directly instead.
  const selfRegistrationEnabled = process.env.ENABLE_SELF_REGISTRATION === 'true';

  // Lets the frontend know whether to show a "register" form or an
  // "contact the admin" card, without hardcoding it into the built assets.
  // Resolves a restaurant's shareable link (qulaycafe.uz/order/<slug>) to
  // its internal id. Public and deliberately minimal — a slug is not
  // secret (it's meant to be shared on Instagram etc.), so this only
  // returns what's needed to render the ordering page, nothing sensitive.
  app.get('/api/restaurants/by-slug/:slug', (req: Request, res: Response) => {
    const restaurant = getRestaurantBySlug(req.params.slug);
    if (!restaurant) {
      res.status(404).json({ error: 'Restoran topilmadi.' });
      return;
    }
    res.json({
      restaurantId: restaurant.id,
      name: restaurant.name,
      deliveryStatus: restaurant.delivery_status,
      // Whether this tenant takes table bookings at all. The web form and the
      // bot deep link are both gated on it; the bot username is returned so a
      // guest who prefers Telegram still gets that route offered.
      reservationStatus: restaurant.reservation_status || 'disabled',
      loyaltyStatus: restaurant.loyalty_status === 'disabled' ? 'disabled' : 'active',
      reservationBotUsername: process.env.TELEGRAM_BOT_USERNAME || null
    });
  });

  app.get('/api/registration-info', (_req: Request, res: Response) => {
    res.json({
      selfRegistrationEnabled,
      contactPhone: process.env.OWNER_CONTACT_PHONE || null,
      contactTelegram: process.env.OWNER_CONTACT_TELEGRAM || null
    });
  });

  // App-wide, non-secret config the frontend needs regardless of which
  // restaurant is active — currently just which Telegram bot customers use
  // to open a restaurant's ordering page as a Mini App.
  app.get('/api/app-config', (_req: Request, res: Response) => {
    res.json({ telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || null });
  });

  app.post(
    '/api/restaurants/register',
    loginLimiter,
    validateBody(restaurantRegisterSchema),
    (req: Request, res: Response) => {
      if (!selfRegistrationEnabled) {
        res.status(403).json({ error: "Ro'yxatdan o'tish yopiq. Administrator bilan bog'laning." });
        return;
      }
      const { name, phone, password, deliveryEnabled } = req.body;
      if (getRestaurantByPhone(phone)) {
        res.status(409).json({ error: 'Bu telefon raqam bilan restoran allaqachon ro\'yxatdan o\'tgan.' });
        return;
      }
      const passwordHash = bcrypt.hashSync(password, 12);
      const restaurant = createRestaurant({ name, phone, passwordHash, deliveryEnabled });
      setSessionCookie(res, 'admin', restaurant.id);
      req.log.info({ restaurantId: restaurant.id, deliveryEnabled: !!deliveryEnabled }, 'restaurant self-registered');
      res.status(201).json({ success: true, restaurantId: restaurant.id, name: restaurant.name, slug: restaurant.slug, deliveryEnabled: !!deliveryEnabled });
    }
  );

  // --- OWNER (SUPER-ADMIN) ENDPOINTS ---
  // Protected by a single shared secret (X-Owner-Secret header), not a
  // session — only the owner bot and Alex himself call these directly.
  app.get('/api/owner/restaurants', requireOwner, (_req: Request, res: Response) => {
    res.json(listRestaurantsWithSubscriptions());
  });

  app.post(
    '/api/owner/restaurants',
    requireOwner,
    validateBody(ownerCreateRestaurantSchema),
    (req: Request, res: Response) => {
      const { name, phone } = req.body;
      if (getRestaurantByPhone(phone)) {
        res.status(409).json({ error: 'Restaurant with this phone already exists' });
        return;
      }
      const password = crypto.randomBytes(6).toString('hex').slice(0, 8);
      const restaurant = createRestaurant({ name, phone, passwordHash: bcrypt.hashSync(password, 12) });
      res.status(201).json({ success: true, restaurant, password });
    }
  );

  app.post(
    '/api/owner/subscription',
    requireOwner,
    validateBody(ownerSubscriptionUpdateSchema),
    (req: Request, res: Response) => {
      const { restaurantId, status, extendDays } = req.body;
      if (!getRestaurantById(restaurantId)) {
        res.status(404).json({ error: 'Restaurant not found' });
        return;
      }
      const periodEnd = extendDays ? new Date(Date.now() + extendDays * 24 * 60 * 60 * 1000).toISOString() : null;
      setSubscriptionStatus(restaurantId, status, periodEnd, 'Updated via owner API');
      res.json({ success: true });
    }
  );

  // --- KITCHEN TELEGRAM ORDER NOTIFICATIONS ---
  // Reuses the same bot/token as customer verification, just a different
  // "purpose" on the token so the webhook knows to link a restaurant's
  // admin_telegram_chat_id instead of a customer's loyalty identity.
  // Kitchen staff are the ones who need these alerts, so the kitchen role can
  // connect and disconnect the chat itself without going through the admin.
  app.post('/api/admin/telegram/link-token', requireRole('admin', 'kitchen'), (req: Request, res: Response) => {
    if (!telegramConfigured) {
      res.status(503).json({ error: 'Telegram is not configured on this server yet.' });
      return;
    }
    const { token, deepLink } = createVerificationToken({ purpose: 'admin_notify', restaurantId: req.restaurantId });
    res.json({ token, deepLink });
  });

  app.get('/api/admin/telegram/link-status/:token', requireRole('admin', 'kitchen'), (req: Request, res: Response) => {
    res.json(getVerificationStatus(req.params.token));
  });

  app.post('/api/admin/telegram/unlink', requireRole('admin', 'kitchen'), (req: Request, res: Response) => {
    unlinkAdminTelegram(req.restaurantId as string);
    res.json({ success: true });
  });

  // --- WAITER CALLS ---
  app.post(
    '/api/waiter-call',
    requirePublicRestaurant,
    orderLimiter,
    validateBody(waiterCallSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const call = createWaiterCall(restaurantId, req.body.tableNumber);
      broadcastStaff(restaurantId, 'WAITER_CALL', call);
      res.status(201).json(call);
    }
  );

  app.get('/api/admin/waiter-calls', requireRole('admin', 'kitchen'), (req: Request, res: Response) => {
    const onlyPending = req.query.pending === 'true';
    res.json(listWaiterCalls(req.restaurantId as string, onlyPending));
  });

  app.post('/api/admin/waiter-calls/:id/resolve', requireRole('admin', 'kitchen'), (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const resolved = resolveWaiterCall(restaurantId, req.params.id);
    if (!resolved) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }
    broadcastStaff(restaurantId, 'WAITER_CALL_RESOLVED', { id: req.params.id });
    res.json({ success: true });
  });

  // --- TABLE RESERVATIONS ---
  // Two guest-facing entry points, one restaurant-facing side:
  //   * the customer Telegram bot (src/server/reservationBot.ts)
  //   * the public web form, POST /api/reservations below — for the guest who
  //     has no Telegram, or is a tourist who just wants a table without
  //     installing anything. Both land in the same table with the same shape;
  //     only `source` differs, and both notify the same admin the same way.
  // The restaurant then sees the queue, decides, and assigns a table.

  /**
   * Reservations are an opt-in feature the platform owner switches on per
   * restaurant from the owner bot (/reservations_on). Until then every
   * reservation route answers 403, so a dashboard that somehow shows the tab
   * still can't read or write anything.
   */
  function requireReservationsEnabled(req: Request, res: Response, next: NextFunction) {
    if (!reservationsEnabled(req.restaurantId as string)) {
      res.status(403).json({ error: "Stol broni xizmati yoqilmagan." });
      return;
    }
    next();
  }

  // A web guest is identified by this token and nothing else — there is no
  // account to log into — so it is generated server-side, is long enough not to
  // be guessable, and is only ever handed to the browser that created the
  // booking (or to the Telegram chat that opens the guest's own deep link).
  function newReservationToken(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  /** Short human reference the guest can read out on the phone ("booking A7F2"). */
  // (shared with the Telegram notification, so both show the same code)

  const telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME || '';

  /**
   * Optional "get updates in Telegram" link for a web booking. Opening it runs
   * the resv_<token> branch of the /start handler, which attaches the chat to
   * the booking so the guest gets the same confirm/decline messages a bot
   * booking gets. Null when this deployment has no bot configured.
   */
  function reservationTelegramDeepLink(token: string): string | null {
    if (!telegramBotUsername || !telegramConfigured) return null;
    return `https://t.me/${telegramBotUsername}?start=resv_${token}`;
  }

  // How many bookings one phone number may hold open (pending or confirmed,
  // today or later) at a single restaurant, and how many it may create there
  // per day. Mirrors the bot's per-chat caps: the point is to stop one person
  // reserving the whole floor, not to inconvenience a regular.
  const MAX_OPEN_BOOKINGS_PER_PHONE = 2;
  const MAX_WEB_BOOKINGS_PER_PHONE_PER_DAY = 5;

  /**
   * The public web booking form. Every gate the bot applies is applied here in
   * the same order — restaurant exists, subscription usable
   * (requirePublicRestaurant), feature switched on (requireReservationsEnabled),
   * shape valid (shared zod schema), clock valid (shared with the bot) — and
   * then the per-phone caps that stand in for the bot's per-chat ones.
   *
   * The booking is created as 'pending', exactly like a bot booking: nothing
   * here confirms a table. The restaurant decides, from the dashboard or from
   * the Telegram buttons, and that decision path is entirely unchanged.
   */
  app.post(
    '/api/reservations',
    requirePublicRestaurant,
    requireReservationsEnabled,
    validateBody(reservationPublicCreateSchema),
    // After validateBody on purpose: a guest who mistypes their phone twice
    // must not burn their hourly allowance on requests that never reached the
    // database.
    reservationLimiter,
    async (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const { reservedDate, reservedTime, partySize, guestName, guestPhone, note } = req.body as {
        reservedDate: string;
        reservedTime: string;
        partySize: number;
        guestName: string;
        guestPhone: string;
        note?: string;
      };

      const windowError = checkReservationWindow(reservedDate, reservedTime);
      if (windowError) {
        res.status(400).json({ error: windowError });
        return;
      }

      // Same phone, same slot, still open: hand back a 409 rather than a second
      // identical row. Deliberately NOT the existing booking's token — knowing
      // a phone number and a time must never be enough to obtain the secret
      // that can cancel someone else's table.
      if (findOpenReservationBySlot(restaurantId, guestPhone, reservedDate, reservedTime)) {
        res.status(409).json({
          error: "Bu vaqtga sizning nomingizda bron allaqachon mavjud.",
          code: 'DUPLICATE_RESERVATION'
        });
        return;
      }

      if (countOpenReservationsByPhone(restaurantId, guestPhone, reservationToday()) >= MAX_OPEN_BOOKINGS_PER_PHONE) {
        res.status(429).json({
          error:
            "Sizda javob kutayotgan bronlar bor. Avvalgi bron hal bo'lgach yangisini yuborishingiz mumkin, yoki restoranga qo'ng'iroq qiling.",
          code: 'TOO_MANY_OPEN_RESERVATIONS'
        });
        return;
      }

      const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
      if (countReservationsByPhoneSince(restaurantId, guestPhone, dayAgo) >= MAX_WEB_BOOKINGS_PER_PHONE_PER_DAY) {
        res.status(429).json({
          error: "Bugun juda ko'p bron qildingiz. Ertaga urinib ko'ring yoki restoranga qo'ng'iroq qiling.",
          code: 'DAILY_LIMIT_REACHED'
        });
        return;
      }

      const publicToken = newReservationToken();
      const reservation = createReservation(restaurantId, {
        reservedDate,
        reservedTime,
        partySize,
        guestName,
        guestPhone,
        note: note ? note : null,
        source: 'web',
        publicToken
      });

      // The dashboard's live queue and the admin's Telegram both react exactly
      // as they do to a bot booking — the web form adds no second code path.
      broadcastStaff(restaurantId, 'RESERVATION_UPDATED', reservation);
      try {
        await notifyAdminOfReservation(restaurantId, reservation);
      } catch (err) {
        // The booking is already committed and visible in the dashboard;
        // failing to push a Telegram message must not fail the guest's request.
        req.log.error({ err }, 'failed to notify admin of web reservation');
      }

      const restaurant = getRestaurantById(restaurantId);
      res.status(201).json({
        token: publicToken,
        code: reservationCode(reservation.id),
        status: reservation.status,
        reservedDate: reservation.reservedDate,
        reservedTime: reservation.reservedTime,
        partySize: reservation.partySize,
        guestName: reservation.guestName,
        tableNumber: reservation.tableNumber,
        restaurantName: restaurant?.name || null,
        telegramDeepLink: reservationTelegramDeepLink(publicToken)
      });
    }
  );

  /**
   * Status of one web booking, resolved from the guest's token. POST rather
   * than GET so the token travels in a request body instead of a URL — request
   * URLs end up in access logs, and this one is a bearer secret.
   *
   * Not scoped by restaurant: the token carries its own scope (it resolves to
   * exactly one booking of one restaurant, or to nothing at all).
   */
  app.post(
    '/api/reservations/lookup',
    reservationLookupLimiter,
    validateBody(reservationTokenSchema),
    (req: Request, res: Response) => {
      const found = getReservationByPublicToken(req.body.token);
      if (!found) {
        res.status(404).json({ error: 'Bron topilmadi.' });
        return;
      }
      const { reservation, restaurantName } = found;
      res.json({
        code: reservationCode(reservation.id),
        status: reservation.status,
        reservedDate: reservation.reservedDate,
        reservedTime: reservation.reservedTime,
        partySize: reservation.partySize,
        guestName: reservation.guestName,
        tableNumber: reservation.tableNumber,
        note: reservation.note,
        restaurantName,
        // Whether the guest already linked Telegram, so the UI can stop
        // offering it. The chat id itself never leaves the server.
        telegramLinked: !!reservation.telegramChatId,
        telegramDeepLink: reservation.telegramChatId ? null : reservationTelegramDeepLink(req.body.token),
        canCancel: reservation.status === 'pending' || reservation.status === 'confirmed'
      });
    }
  );

  /**
   * A web guest cancelling their own booking — the counterpart of the bot's
   * /mybookings cancel button, and just as important: a table nobody frees is
   * a table the restaurant loses.
   */
  app.post(
    '/api/reservations/cancel',
    reservationLookupLimiter,
    validateBody(reservationTokenSchema),
    async (req: Request, res: Response) => {
      const found = getReservationByPublicToken(req.body.token);
      if (!found) {
        res.status(404).json({ error: 'Bron topilmadi.' });
        return;
      }
      const { restaurantId, reservation } = found;
      if (reservation.status !== 'pending' && reservation.status !== 'confirmed') {
        res.status(409).json({ error: "Bu bronni bekor qilib bo'lmaydi.", status: reservation.status });
        return;
      }
      const result = updateReservation(restaurantId, reservation.id, { status: 'cancelled' });
      if (result.status !== 'ok') {
        res.status(404).json({ error: 'Bron topilmadi.' });
        return;
      }
      broadcastStaff(restaurantId, 'RESERVATION_UPDATED', result.reservation);
      try {
        await notifyAdminOfGuestCancellation(restaurantId, result.reservation);
      } catch (err) {
        req.log.error({ err }, 'failed to notify admin of web reservation cancellation');
      }
      res.json({ status: result.reservation.status });
    }
  );

  app.get(
    '/api/admin/reservations',
    requireRole('admin'),
    requireReservationsEnabled,
    (req: Request, res: Response) => {
      const rawDate = typeof req.query.date === 'string' ? req.query.date.trim() : '';
      // Anything that isn't an exact YYYY-MM-DD is ignored rather than passed
      // through to the query — the value reaches a bound parameter either way,
      // but a silently-mistyped filter shouldn't look like "no bookings".
      const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;
      const reservations = listReservations(req.restaurantId as string, {
        date,
        onlyPending: req.query.pending === 'true',
        upcomingOnly: req.query.upcoming === 'true'
      });
      res.json({ reservations, pendingCount: countPendingReservations(req.restaurantId as string) });
    }
  );

  app.patch(
    '/api/admin/reservations/:id',
    requireRole('admin'),
    requireActiveSubscription,
    requireReservationsEnabled,
    validateBody(reservationUpdateSchema),
    async (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const before = getReservation(restaurantId, req.params.id);
      if (!before) {
        res.status(404).json({ error: 'Bron topilmadi.' });
        return;
      }
      const result = updateReservation(restaurantId, req.params.id, {
        status: req.body.status,
        tableNumber: req.body.tableNumber,
        note: req.body.note
      });
      if (result.status === 'not_found') {
        res.status(404).json({ error: 'Bron topilmadi.' });
        return;
      }
      if (result.status === 'invalid_table') {
        res.status(400).json({ error: "Bunday stol raqami mavjud emas." });
        return;
      }
      broadcastStaff(restaurantId, 'RESERVATION_UPDATED', result.reservation);
      // Only ping the guest when the decision itself changed — an admin
      // silently attaching a table number or an internal note is not news
      // worth a Telegram message.
      if (req.body.status && req.body.status !== before.status) {
        // Express 4 does not catch rejected promises from async handlers, so a
        // failure here would leave the admin's request hanging with no reply.
        // The decision is already committed either way — telling the guest is
        // best-effort.
        try {
          await notifyGuestOfReservationUpdate(restaurantId, result.reservation);
        } catch (err) {
          req.log.error({ err }, 'failed to notify guest of reservation update');
        }
      }
      res.json(result.reservation);
    }
  );

  // The admin always works in so'm — these rates only power an optional
  // "show me this in USD/RUB" conversion for customers. Nothing about the
  // actual amount charged/recorded changes based on this.
  // --- DELIVERY BOT WEBHOOK ---
  const DELIVERY_BOT_WEBHOOK_SECRET = process.env.DELIVERY_BOT_WEBHOOK_SECRET || '';
  app.post('/api/delivery-bot/webhook', async (req: Request, res: Response) => {
    if (DELIVERY_BOT_WEBHOOK_SECRET) {
      const incomingSecret = req.header('X-Telegram-Bot-Api-Secret-Token');
      if (incomingSecret !== DELIVERY_BOT_WEBHOOK_SECRET) {
        res.status(401).end();
        return;
      }
    }
    await handleDeliveryBotUpdate(req.body);
    res.status(200).end();
  });

  // --- COURIER MANAGEMENT (delivery) ---
  app.post('/api/admin/couriers/link-token', requireRole('admin'), (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const restaurant = getRestaurantById(restaurantId);
    if (!restaurant || restaurant.delivery_status !== 'active') {
      res.status(403).json({ error: "Dostavka xizmati yoqilmagan." });
      return;
    }
    if (!deliveryBotConfigured) {
      res.status(503).json({ error: 'Delivery bot is not configured on this server yet.' });
      return;
    }
    const { token, deepLink } = createVerificationToken({ purpose: 'courier_link', restaurantId });
    // The delivery bot has its own username, separate from the customer bot
    const botUsername = process.env.TELEGRAM_DELIVERY_BOT_USERNAME || '';
    res.json({ token, deepLink: botUsername ? `https://t.me/${botUsername}?start=${token}` : deepLink });
  });

  app.get('/api/admin/couriers', requireRole('admin'), (req: Request, res: Response) => {
    res.json(listCouriers(req.restaurantId as string));
  });

  app.post('/api/admin/couriers/:id/toggle', requireRole('admin'), (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const courier = getCourierById(restaurantId, req.params.id);
    if (!courier) {
      res.status(404).json({ error: 'Courier not found' });
      return;
    }
    setCourierStatus(restaurantId, courier.id, courier.status === 'active' ? 'inactive' : 'active');
    res.json({ success: true });
  });

  app.patch(
    '/api/admin/couriers/:id',
    requireRole('admin'),
    validateBody(courierNameUpdateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const courier = getCourierById(restaurantId, req.params.id);
      if (!courier) {
        res.status(404).json({ error: 'Courier not found' });
        return;
      }
      renameCourier(restaurantId, courier.id, req.body.name);
      res.json({ success: true, ...getCourierById(restaurantId, courier.id) });
    }
  );

  // --- COURIER INVITE LINKS (one per courier, sent by the admin) ---
  // The old flow handed out a single short-lived link the courier could only
  // use if they were standing next to the admin. These invites are named,
  // single-use and valid for days, so the admin can just copy one and send it
  // to each courier in Telegram.
  function courierInviteLink(token: string): string {
    const botUsername = process.env.TELEGRAM_DELIVERY_BOT_USERNAME || '';
    return botUsername ? `https://t.me/${botUsername}?start=${token}` : '';
  }

  app.post(
    '/api/admin/couriers/invites',
    requireRole('admin'),
    validateBody(courierNameUpdateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const restaurant = getRestaurantById(restaurantId);
      if (!restaurant || restaurant.delivery_status !== 'active') {
        res.status(403).json({ error: "Dostavka xizmati yoqilmagan." });
        return;
      }
      if (!deliveryBotConfigured) {
        res.status(503).json({ error: 'Delivery bot is not configured on this server yet.' });
        return;
      }
      const invite = createCourierInvite(restaurantId, req.body.name);
      res.status(201).json({ ...invite, link: courierInviteLink(invite.token) });
    }
  );

  app.get('/api/admin/couriers/invites', requireRole('admin'), (req: Request, res: Response) => {
    const invites = listCourierInvites(req.restaurantId as string).map(invite => ({
      ...invite,
      link: courierInviteLink(invite.token)
    }));
    res.json(invites);
  });

  app.delete('/api/admin/couriers/invites/:token', requireRole('admin'), (req: Request, res: Response) => {
    const revoked = revokeCourierInvite(req.restaurantId as string, req.params.token);
    if (!revoked) {
      res.status(404).json({ error: 'Invite not found or already used' });
      return;
    }
    res.json({ success: true });
  });

  // --- THERMAL PRINTER (ESC/POS over network, port 9100 style) ---
  app.get('/api/admin/printer-settings', requireRole('admin'), (req: Request, res: Response) => {
    const s = readSettings(req.restaurantId as string) as any;
    const rows = db
      .prepare(`SELECT key, value FROM settings WHERE restaurant_id = ? AND key IN ('printerIp','printerPort')`)
      .all(req.restaurantId) as { key: string; value: string }[];
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    res.json({ printerIp: map.printerIp || '', printerPort: Number(map.printerPort) || 9100 });
  });

  app.post(
    '/api/admin/printer-settings',
    requireRole('admin'),
    validateBody(printerSettingsSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const { printerIp, printerPort } = req.body;
      if (printerIp !== undefined) {
        db.prepare(
          `INSERT INTO settings (restaurant_id, key, value) VALUES (?, 'printerIp', ?) ON CONFLICT(restaurant_id, key) DO UPDATE SET value = ?`
        ).run(restaurantId, printerIp, printerIp);
      }
      if (printerPort !== undefined) {
        db.prepare(
          `INSERT INTO settings (restaurant_id, key, value) VALUES (?, 'printerPort', ?) ON CONFLICT(restaurant_id, key) DO UPDATE SET value = ?`
        ).run(restaurantId, String(printerPort), String(printerPort));
      }
      res.json({ success: true });
    }
  );

  app.post('/api/admin/print-receipt/:orderId', requireRole('admin'), async (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const row = db
      .prepare('SELECT data FROM orders WHERE restaurant_id = ? AND id = ?')
      .get(restaurantId, req.params.orderId) as { data: string } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const printerRow = db
      .prepare(`SELECT key, value FROM settings WHERE restaurant_id = ? AND key IN ('printerIp','printerPort')`)
      .all(restaurantId) as { key: string; value: string }[];
    const map: Record<string, string> = {};
    for (const r of printerRow) map[r.key] = r.value;
    if (!map.printerIp) {
      res.status(400).json({ error: "Printer IP manzili sozlanmagan. Avval Sozlamalar bo'limida kiriting." });
      return;
    }
    const restaurant = getRestaurantById(restaurantId);
    try {
      const bytes = buildReceiptBytes(JSON.parse(row.data), restaurant?.name || 'Restoran');
      await sendToNetworkPrinter(map.printerIp, Number(map.printerPort) || 9100, bytes);
      res.json({ success: true });
    } catch (err: any) {
      res.status(502).json({ error: `Printerga ulanib bo'lmadi: ${err?.message || 'unknown error'}` });
    }
  });

  // --- Z-REPORT (daily cash reconciliation) ---
  function computeDailyTotals(restaurantId: string, dateStr: string) {
    const orders = readOrders(restaurantId).filter(
      o => o.createdAt.slice(0, 10) === dateStr && o.status !== 'cancelled'
    );
    const cashTotal = orders
      .filter(o => o.paymentMethod === 'cash' || o.paymentMethod === 'pay_at_counter')
      .reduce((s, o) => s + o.totalAmount, 0);
    const cardTotal = orders.filter(o => o.paymentMethod === 'card').reduce((s, o) => s + o.totalAmount, 0);
    const otherTotal = orders
      .filter(o => o.paymentMethod === 'loyalty_points')
      .reduce((s, o) => s + o.totalAmount, 0);
    return { cashTotal, cardTotal, otherTotal, orderCount: orders.length, totalRevenue: cashTotal + cardTotal + otherTotal };
  }

  app.get('/api/admin/z-report', requireRole('admin'), (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const totals = computeDailyTotals(restaurantId, dateStr);
    const closure = getDailyClosure(restaurantId, dateStr);
    res.json({ date: dateStr, ...totals, closure: closure || null });
  });

  app.post('/api/admin/z-report/close', requireRole('admin'), (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const dateStr = (req.body?.date as string) || new Date().toISOString().slice(0, 10);
    const totals = computeDailyTotals(restaurantId, dateStr);
    upsertDailyClosure(
      restaurantId,
      dateStr,
      { cashTotal: totals.cashTotal, cardTotal: totals.cardTotal, otherTotal: totals.otherTotal, orderCount: totals.orderCount },
      req.body?.note
    );
    res.json({ success: true, date: dateStr, ...totals });
  });

  // --- EXCHANGE RATES (for customer-facing currency display only) ---
  function readExchangeRates(restaurantId: string): Record<string, { rateToSom: number; updatedAt: string; source: string }> {
    const rows = db
      .prepare('SELECT currency, rate_to_som, updated_at, source FROM exchange_rates WHERE restaurant_id = ?')
      .all(restaurantId) as {
      currency: string;
      rate_to_som: number;
      updated_at: string;
      source: string;
    }[];
    const result: Record<string, { rateToSom: number; updatedAt: string; source: string }> = {};
    for (const row of rows) {
      result[row.currency] = { rateToSom: row.rate_to_som, updatedAt: row.updated_at, source: row.source };
    }
    return result;
  }

  // --- RESTAURANT SETTINGS (tax % and service fee %, admin-editable) ---
  function readSettings(restaurantId: string): { taxPercent: number; serviceFeePercent: number } {
    const rows = db.prepare('SELECT key, value FROM settings WHERE restaurant_id = ?').all(restaurantId) as {
      key: string;
      value: string;
    }[];
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return {
      taxPercent: Number(map.taxPercent ?? 8),
      serviceFeePercent: Number(map.serviceFeePercent ?? 5)
    };
  }

  app.get('/api/settings', requirePublicRestaurant, (req: Request, res: Response) => {
    const restaurant = getRestaurantById(req.restaurantId as string);
    const contactRows = db
      .prepare(`SELECT key, value FROM settings WHERE restaurant_id = ? AND key IN ('contactPhone','contactAddress','contactInstagram','workingHours')`)
      .all(req.restaurantId) as { key: string; value: string }[];
    const contactMap: Record<string, string> = {};
    for (const r of contactRows) contactMap[r.key] = r.value;
    res.json({
      ...readSettings(req.restaurantId as string),
      restaurantName: restaurant?.name || null,
      logoUrl: restaurant?.logo_url || null,
      brandColor: restaurant?.brand_color || null,
      contactPhone: contactMap.contactPhone || null,
      contactAddress: contactMap.contactAddress || null,
      contactInstagram: contactMap.contactInstagram || null,
      workingHours: contactMap.workingHours || null,
      deliveryStatus: restaurant?.delivery_status || 'disabled',
      // Drives the "Book a table" entry point in the customer app. Also needed
      // for a guest who arrived by scanning a table QR (…?r=<id>), where no
      // /api/restaurants/by-slug call ever happens.
      reservationStatus: restaurant?.reservation_status || 'disabled',
      // Off means the guest app hides points entirely: no balance in the
      // header, no "pay with points" switch, no "you will earn N points".
      loyaltyStatus: restaurant?.loyalty_status === 'disabled' ? 'disabled' : 'active',
      // The restaurant's own share slug, so the app can build the guest's
      // /book/<slug>?b=<token> link back to their booking even when they
      // arrived by a table QR rather than through the slug URL.
      slug: restaurant?.slug || null
    });
  });

  // --- BRANDING (logo, accent color, display name, contact info) ---
  app.post(
    '/api/admin/branding',
    requireRole('admin'),
    requireActiveSubscription,
    validateBody(brandingUpdateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const { logoUrl, brandColor, displayName, contactPhone, contactAddress, contactInstagram, workingHours } = req.body;
      // The logo is on every page of every surface, so it gets the same
      // treatment as a dish photo: bytes in image_blobs, a cacheable URL in the
      // row. Inline base64 here meant /api/settings alone was ~400 KB, re-sent
      // uncached on every single page load.
      let storedLogo: string | null | undefined = logoUrl;
      if (logoUrl === '') {
        storedLogo = null;
        deleteImageBlob(restaurantId, 'logo', '');
      } else if (typeof logoUrl === 'string') {
        storedLogo = storeImageBlob(restaurantId, 'logo', '', logoUrl);
      }
      updateRestaurantBranding(restaurantId, { logoUrl: storedLogo, brandColor, displayName });

      const contactFields: Record<string, string | undefined> = { contactPhone, contactAddress, contactInstagram, workingHours };
      for (const [key, value] of Object.entries(contactFields)) {
        if (value === undefined) continue;
        db.prepare(
          `INSERT INTO settings (restaurant_id, key, value) VALUES (?, ?, ?) ON CONFLICT(restaurant_id, key) DO UPDATE SET value = ?`
        ).run(restaurantId, key, value, value);
      }

      const restaurant = getRestaurantById(restaurantId);
      const settingsRows = db
        .prepare(`SELECT key, value FROM settings WHERE restaurant_id = ? AND key IN ('contactPhone','contactAddress','contactInstagram','workingHours')`)
        .all(restaurantId) as { key: string; value: string }[];
      const map: Record<string, string> = {};
      for (const r of settingsRows) map[r.key] = r.value;

      const updated = {
        restaurantName: restaurant?.name || null,
        logoUrl: restaurant?.logo_url || null,
        brandColor: restaurant?.brand_color || null,
        contactPhone: map.contactPhone || null,
        contactAddress: map.contactAddress || null,
        contactInstagram: map.contactInstagram || null,
        workingHours: map.workingHours || null
      };
      broadcastTableAll(restaurantId, 'BRANDING_UPDATED', updated);
      res.json({ success: true, ...updated });
    }
  );

  app.post(
    '/api/admin/settings',
    requireRole('admin'),
    requireActiveSubscription,
    validateBody(settingsUpdateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const { taxPercent, serviceFeePercent } = req.body;
      if (taxPercent !== undefined) {
        db.prepare(
          `INSERT INTO settings (restaurant_id, key, value) VALUES (?, 'taxPercent', ?) ON CONFLICT(restaurant_id, key) DO UPDATE SET value = ?`
        ).run(restaurantId, String(taxPercent), String(taxPercent));
      }
      if (serviceFeePercent !== undefined) {
        db.prepare(
          `INSERT INTO settings (restaurant_id, key, value) VALUES (?, 'serviceFeePercent', ?) ON CONFLICT(restaurant_id, key) DO UPDATE SET value = ?`
        ).run(restaurantId, String(serviceFeePercent), String(serviceFeePercent));
      }
      const updated = readSettings(restaurantId);
      broadcastTableAll(restaurantId, 'SETTINGS_UPDATED', updated);
      broadcastStaff(restaurantId, 'SETTINGS_UPDATED', updated);
      res.json({ success: true, ...updated });
    }
  );

  app.get('/api/exchange-rates', requirePublicRestaurant, (req: Request, res: Response) => {
    res.json(readExchangeRates(req.restaurantId as string));
  });

  app.post(
    '/api/admin/exchange-rates',
    requireRole('admin'),
    requireActiveSubscription,
    validateBody(exchangeRateUpdateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const { currency, rateToSom } = req.body;
      db.prepare(
        `INSERT INTO exchange_rates (restaurant_id, currency, rate_to_som, updated_at, source) VALUES (?, ?, ?, ?, 'manual')
         ON CONFLICT(restaurant_id, currency) DO UPDATE SET rate_to_som = ?, updated_at = ?, source = 'manual'`
      ).run(restaurantId, currency, rateToSom, new Date().toISOString(), rateToSom, new Date().toISOString());
      broadcastTableAll(restaurantId, 'EXCHANGE_RATES_UPDATED', readExchangeRates(restaurantId));
      res.json({ success: true, rates: readExchangeRates(restaurantId) });
    }
  );

  // Best-effort daily auto-refresh from a free public rate API, applied to
  // EVERY restaurant tenant. If this fails for any reason (no internet
  // egress, API down, etc.) the existing rates just stay as they are — this
  // never blocks or breaks anything.
  async function refreshExchangeRatesFromLiveSource() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return;
      const data: any = await res.json();
      const usdToUzs = data?.rates?.UZS;
      const usdToRub = data?.rates?.RUB;
      if (typeof usdToUzs !== 'number' || usdToUzs <= 0) return;

      const now = new Date().toISOString();
      const rubToUzs = typeof usdToRub === 'number' && usdToRub > 0 ? usdToUzs / usdToRub : null;
      const restaurantIds = (db.prepare('SELECT id FROM restaurants').all() as { id: string }[]).map(r => r.id);

      for (const restaurantId of restaurantIds) {
        db.prepare(
          `INSERT INTO exchange_rates (restaurant_id, currency, rate_to_som, updated_at, source) VALUES (?, 'USD', ?, ?, 'auto')
           ON CONFLICT(restaurant_id, currency) DO UPDATE SET rate_to_som = ?, updated_at = ?, source = 'auto'`
        ).run(restaurantId, usdToUzs, now, usdToUzs, now);

        if (rubToUzs) {
          db.prepare(
            `INSERT INTO exchange_rates (restaurant_id, currency, rate_to_som, updated_at, source) VALUES (?, 'RUB', ?, ?, 'auto')
             ON CONFLICT(restaurant_id, currency) DO UPDATE SET rate_to_som = ?, updated_at = ?, source = 'auto'`
          ).run(restaurantId, rubToUzs, now, rubToUzs, now);
        }
        broadcastTableAll(restaurantId, 'EXCHANGE_RATES_UPDATED', readExchangeRates(restaurantId));
      }
      logger.info({ usdToUzs, usdToRub, restaurantCount: restaurantIds.length }, 'exchange rates auto-refreshed');
    } catch (err) {
      logger.warn({ err }, 'exchange rate auto-refresh failed — keeping existing rates');
    }
  }

  app.get('/api/health', (_req: Request, res: Response) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'error', error: 'database unavailable' });
    }
  });

  // --- AUTH ENDPOINTS (real, server-side, hashed) ---
  // Staff now log in with their RESTAURANT'S phone number + password/PIN —
  // the phone number is what identifies which restaurant's dashboard they
  // land in. Lockout tracking is per (restaurant, role), so a bad-actor
  // hammering one restaurant's login never locks out another restaurant.
  app.post('/api/auth/admin/login', loginLimiter, validateBody(phoneLoginSchema), (req: Request, res: Response) => {
    const { phone, password } = req.body;
    const restaurant = getRestaurantByPhone(phone);
    if (!restaurant) {
      res.status(401).json({ error: 'Telefon raqam yoki parol xato' });
      return;
    }
    const lockout = isLockedOut(restaurant.id, 'admin');
    if (lockout.locked) {
      res.status(429).json({ error: 'Ko\'p urinish. Biroz kutib qayta urinib ko\'ring.', retryAfterSeconds: lockout.retryAfterSeconds });
      return;
    }
    if (!verifyPassword(restaurant.id, 'admin', password)) {
      recordFailedAttempt(restaurant.id, 'admin');
      res.status(401).json({ error: 'Telefon raqam yoki parol xato' });
      return;
    }
    // Password is correct, but a suspended/expired subscription blocks
    // login ENTIRELY — this is the real enforcement point for "if the
    // owner hasn't paid, the whole restaurant stops working", not just
    // specific write endpoints.
    if (!isSubscriptionUsable(restaurant.id)) {
      const sub = getSubscription(restaurant.id);
      res.status(402).json({
        error:
          sub?.status === 'suspended'
            ? "Obunangiz to'xtatilgan. Davom etish uchun administrator bilan bog'laning."
            : "Obunangiz muddati tugagan. Davom etish uchun administrator bilan bog'laning.",
        code: 'SUBSCRIPTION_INACTIVE'
      });
      return;
    }
    clearFailedAttempts(restaurant.id, 'admin');
    setSessionCookie(res, 'admin', restaurant.id);
    res.json({
      success: true,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      subscriptionPeriodEnd: getSubscription(restaurant.id)?.current_period_end || null,
      deliveryStatus: restaurant.delivery_status,
      reservationStatus: restaurant.reservation_status || 'disabled',
      loyaltyStatus: restaurant.loyalty_status === 'disabled' ? 'disabled' : 'active'
    });
  });

  app.post('/api/auth/kitchen/login', loginLimiter, validateBody(phoneLoginSchema), (req: Request, res: Response) => {
    const { phone, password } = req.body;
    const restaurant = getRestaurantByPhone(phone);
    if (!restaurant) {
      res.status(401).json({ error: 'Telefon raqam yoki PIN xato' });
      return;
    }
    const lockout = isLockedOut(restaurant.id, 'kitchen');
    if (lockout.locked) {
      res.status(429).json({ error: 'Ko\'p urinish. Biroz kutib qayta urinib ko\'ring.', retryAfterSeconds: lockout.retryAfterSeconds });
      return;
    }
    if (!verifyPassword(restaurant.id, 'kitchen', password) && !verifyPassword(restaurant.id, 'admin', password)) {
      recordFailedAttempt(restaurant.id, 'kitchen');
      res.status(401).json({ error: 'Telefon raqam yoki PIN xato' });
      return;
    }
    if (!isSubscriptionUsable(restaurant.id)) {
      const sub = getSubscription(restaurant.id);
      res.status(402).json({
        error:
          sub?.status === 'suspended'
            ? "Obunangiz to'xtatilgan. Davom etish uchun administrator bilan bog'laning."
            : "Obunangiz muddati tugagan. Davom etish uchun administrator bilan bog'laning.",
        code: 'SUBSCRIPTION_INACTIVE'
      });
      return;
    }
    clearFailedAttempts(restaurant.id, 'kitchen');
    setSessionCookie(res, 'kitchen', restaurant.id);
    res.json({
      success: true,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      subscriptionPeriodEnd: getSubscription(restaurant.id)?.current_period_end || null,
      deliveryStatus: restaurant.delivery_status,
      reservationStatus: restaurant.reservation_status || 'disabled',
      loyaltyStatus: restaurant.loyalty_status === 'disabled' ? 'disabled' : 'active'
    });
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ success: true });
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    const token = req.cookies?.session;
    if (!token) {
      res.json({ role: null });
      return;
    }
    const payload = verifySession(token);
    if (!payload) {
      res.json({ role: null });
      return;
    }
    const restaurant = getRestaurantById(payload.restaurantId);
    const subscriptionOk = isSubscriptionUsable(payload.restaurantId);
    const subscription = getSubscription(payload.restaurantId);
    const reservationStatus = restaurant?.reservation_status || 'disabled';
    res.json({
      role: payload.role,
      restaurantId: payload.restaurantId,
      restaurantName: restaurant?.name || null,
      restaurantSlug: restaurant?.slug || null,
      subscriptionActive: subscriptionOk,
      subscriptionPeriodEnd: subscription?.current_period_end || null,
      deliveryStatus: restaurant?.delivery_status || 'disabled',
      reservationStatus,
      loyaltyStatus: restaurant?.loyalty_status === 'disabled' ? 'disabled' : 'active',
      // Whether a Telegram chat is already receiving order alerts, so the
      // kitchen screen renders the connected state on first paint.
      telegramLinked: !!restaurant?.admin_telegram_chat_id,
      // Persisted so the setup wizard is shown once and never again — it used
      // to reappear on every single login because dismissal lived only in
      // React state.
      onboardingCompleted: readOnboardingCompleted(payload.restaurantId),
      // Lets the dashboard show a badge on the Reservations tab without a
      // second request. Skipped entirely when the feature is off.
      pendingReservations: reservationStatus === 'active' ? countPendingReservations(payload.restaurantId) : 0
    });
  });

  // The wizard calls this when it is finished OR skipped. Either way the
  // restaurant has answered the question, so we never ask again.
  app.post('/api/admin/onboarding/complete', requireRole('admin'), (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    db.prepare(
      `INSERT INTO settings (restaurant_id, key, value) VALUES (?, 'onboardingCompleted', '1') ON CONFLICT(restaurant_id, key) DO UPDATE SET value = '1'`
    ).run(restaurantId);
    res.json({ success: true });
  });

  // Changing the password requires an active, valid admin session cookie
  // (requireRole('admin')) — that's the identity proof. Scoped to the
  // logged-in restaurant only.
  app.post(
    '/api/auth/admin/change-password',
    requireRole('admin'),
    validateBody(changePasswordSchema),
    (req: Request, res: Response) => {
      setPassword(req.restaurantId as string, 'admin', req.body.newPassword);
      res.json({ success: true });
    }
  );

  app.post(
    '/api/auth/kitchen/change-pin',
    requireRole('admin'),
    validateBody(changePasswordSchema),
    (req: Request, res: Response) => {
      setPassword(req.restaurantId as string, 'kitchen', req.body.newPassword);
      res.json({ success: true });
    }
  );

  // --- CATEGORY ENDPOINTS (menu sections, admin-managed) ---
  // Reads split into two routes rather than one route with an
  // `includeInactive` flag: customers get only active sections, and there is
  // no query parameter an anonymous caller could flip to enumerate the
  // sections an admin deliberately switched off.
  function broadcastCategories(restaurantId: string) {
    broadcastTableAll(restaurantId, 'CATEGORIES_UPDATED', listCategories(restaurantId));
    broadcastStaff(restaurantId, 'CATEGORIES_UPDATED', listCategories(restaurantId, true));
  }

  app.get('/api/categories', requirePublicRestaurant, (req: Request, res: Response) => {
    res.json(listCategories(req.restaurantId as string));
  });

  app.get('/api/admin/categories', requireRole('admin'), (req: Request, res: Response) => {
    res.json(listCategories(req.restaurantId as string, true));
  });

  app.post(
    '/api/admin/categories',
    requireRole('admin'),
    requireActiveSubscription,
    validateBody(categoryCreateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      try {
        const created = createCategory(restaurantId, req.body);
        req.log.info({ categoryId: created.id }, 'category created');
        broadcastCategories(restaurantId);
        res.status(201).json(created);
      } catch (err) {
        if (err instanceof DuplicateCategoryNameError) {
          res.status(409).json({ error: 'Bu nomli kategoriya allaqachon mavjud.', code: 'CATEGORY_NAME_TAKEN' });
          return;
        }
        throw err;
      }
    }
  );

  app.patch(
    '/api/admin/categories/reorder',
    requireRole('admin'),
    requireActiveSubscription,
    validateBody(categoryReorderSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const ids: string[] = req.body.ids;
      if (new Set(ids).size !== ids.length) {
        res.status(400).json({ error: 'ids must not contain duplicates', code: 'CATEGORY_IDS_DUPLICATED' });
        return;
      }

      const staleMessage = "Kategoriyalar ro'yxati o'zgargan. Sahifani yangilab, qaytadan urinib ko'ring.";
      const result = reorderCategories(restaurantId, ids);
      if (result.status === 'unknown_ids') {
        res.status(422).json({
          error: `Noma'lum kategoriya: ${result.unknown.join(', ')}.`,
          code: 'CATEGORY_NOT_FOUND',
          message: staleMessage
        });
        return;
      }
      if (result.status === 'stale') {
        res.status(409).json({
          error: staleMessage,
          code: 'CATEGORY_LIST_STALE',
          expectedCount: result.expectedCount,
          receivedCount: result.receivedCount
        });
        return;
      }

      broadcastCategories(restaurantId);
      res.json(listCategories(restaurantId, true));
    }
  );

  app.put(
    '/api/admin/categories/:id',
    requireRole('admin'),
    requireActiveSubscription,
    validateBody(categoryUpdateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      try {
        const updated = updateCategory(restaurantId, req.params.id, req.body);
        if (!updated) {
          res.status(404).json({ error: 'Kategoriya topilmadi.' });
          return;
        }
        req.log.info({ categoryId: updated.id }, 'category updated');
        broadcastCategories(restaurantId);
        res.json(updated);
      } catch (err) {
        if (err instanceof DuplicateCategoryNameError) {
          res.status(409).json({ error: 'Bu nomli kategoriya allaqachon mavjud.', code: 'CATEGORY_NAME_TAKEN' });
          return;
        }
        throw err;
      }
    }
  );

  // Deleting a category that still holds dishes is refused (409) unless the
  // caller passes ?moveTo=<categoryId> to reassign those dishes first — a menu
  // item must never be left pointing at a section that no longer exists.
  app.delete(
    '/api/admin/categories/:id',
    requireRole('admin'),
    requireActiveSubscription,
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const moveTo = typeof req.query.moveTo === 'string' ? req.query.moveTo.trim() : undefined;
      const result = deleteCategory(restaurantId, req.params.id, moveTo || undefined);

      if (result.status === 'not_found') {
        res.status(404).json({ error: 'Kategoriya topilmadi.' });
        return;
      }
      if (result.status === 'last_category') {
        res.status(409).json({
          error: "Oxirgi kategoriyani o'chirib bo'lmaydi. Uni o'chirish o'rniga faolsizlantiring.",
          code: 'CATEGORY_LAST'
        });
        return;
      }
      if (result.status === 'invalid_target') {
        res.status(400).json({
          error: "Taomlarni ko'chirish uchun tanlangan kategoriya topilmadi.",
          code: 'CATEGORY_MOVE_TARGET_INVALID'
        });
        return;
      }
      if (result.status === 'not_empty') {
        res.status(409).json({
          error: `Bu kategoriyada ${result.dishCount} ta taom bor. Avval ularni boshqa kategoriyaga ko'chiring yoki o'chiring.`,
          code: 'CATEGORY_NOT_EMPTY',
          dishCount: result.dishCount
        });
        return;
      }

      req.log.info({ categoryId: req.params.id, movedDishes: result.movedDishes }, 'category deleted');
      broadcastCategories(restaurantId);
      if (result.movedDishes > 0) {
        broadcastTableAll(restaurantId, 'MENU_UPDATED', readMenu(restaurantId));
        broadcastStaff(restaurantId, 'MENU_UPDATED', readMenu(restaurantId));
      }
      res.status(200).json({ success: true, movedDishes: result.movedDishes });
    }
  );

  // --- MENU ENDPOINTS (reads public, writes admin-only) ---
  app.get('/api/menu', requirePublicRestaurant, (req: Request, res: Response) => {
    res.json(readMenu(req.restaurantId as string));
  });

  /**
   * Serves one stored photo. The tenant travels in `?r=` because an <img> tag
   * cannot send the X-Restaurant-Id header, and `?v=` is the content hash, which
   * is what makes an immutable cache correct here: a replaced photo is served
   * from a different URL, so a cached response can never be the wrong one.
   */
  function serveImageBlob(owner: 'menu_item' | 'logo') {
    return (req: Request, res: Response) => {
      const blob = getImageBlob(req.restaurantId as string, owner, owner === 'logo' ? '' : req.params.id);
      if (!blob) {
        res.status(404).json({ error: 'Rasm topilmadi.' });
        return;
      }
      const etag = `"${blob.sha}"`;
      res.setHeader('Content-Type', blob.mime);
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.removeHeader('Pragma');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.setHeader('Content-Length', String(blob.bytes.length));
      res.end(blob.bytes);
    };
  }

  app.get('/api/menu/:id/image', requirePublicRestaurant, serveImageBlob('menu_item'));
  app.get('/api/branding/logo', requirePublicRestaurant, serveImageBlob('logo'));

  app.post(
    '/api/menu',
    requireRole('admin'),
    requireActiveSubscription,
    validateBody(menuItemCreateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const body = req.body;
      // The schema can only check the SHAPE of a category id; whether it is a
      // real section of THIS restaurant is a per-tenant question, so it is
      // answered here. Without it a typo would create a dish that shows up
      // under no menu tab at all.
      if (!categoryExists(restaurantId, body.category)) {
        res.status(400).json({ error: 'Bunday kategoriya mavjud emas.', code: 'CATEGORY_NOT_FOUND' });
        return;
      }
      const newItem: MenuItem = {
        id: 'm-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
        name: body.nameUz, // canonical field — kitchen/orders/receipts always show Uzbek
        description: body.descriptionUz,
        nameUz: body.nameUz,
        nameRu: body.nameRu,
        nameEn: body.nameEn,
        descriptionUz: body.descriptionUz,
        descriptionRu: body.descriptionRu,
        descriptionEn: body.descriptionEn,
        price: body.price,
        category: body.category,
        image: body.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80',
        isAvailable: body.isAvailable !== false,
        dietary: body.dietary,
        prepTimeMinutes: body.prepTimeMinutes,
        customizations: body.customizations
      };
      // An uploaded photo arrives as base64 and is stored as bytes, so the row
      // (and every /api/menu response built from it) carries a URL, not a 100 KB
      // string. A pasted http(s) photo URL passes straight through.
      newItem.image = storeImageBlob(restaurantId, 'menu_item', newItem.id, newItem.image);
      db.prepare('INSERT INTO menu_items (restaurant_id, id, data) VALUES (?, ?, ?)').run(
        restaurantId,
        newItem.id,
        JSON.stringify(newItem)
      );
      req.log.info({ menuItemId: newItem.id }, 'menu item created');
      broadcastTableAll(restaurantId, 'MENU_UPDATED', readMenu(restaurantId));
      broadcastStaff(restaurantId, 'MENU_UPDATED', readMenu(restaurantId));
      res.status(201).json(newItem);
    }
  );

  app.put(
    '/api/menu/:id',
    requireRole('admin'),
    requireActiveSubscription,
    validateBody(menuItemUpdateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const { id } = req.params;
      if (req.body.category !== undefined && !categoryExists(restaurantId, req.body.category)) {
        res.status(400).json({ error: 'Bunday kategoriya mavjud emas.', code: 'CATEGORY_NOT_FOUND' });
        return;
      }
      const row = db.prepare('SELECT data FROM menu_items WHERE restaurant_id = ? AND id = ?').get(restaurantId, id) as
        | { data: string }
        | undefined;
      if (!row) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }
      const existing: MenuItem = normalizeMenuItem(JSON.parse(row.data));
      const patch = { ...req.body };
      if (patch.image === '') delete patch.image; // empty string means "no change", not "clear the photo"
      const updated: MenuItem = { ...existing, ...patch, id: existing.id };
      // Keep the canonical name/description (used by kitchen/orders/receipts)
      // in sync whenever the Uzbek fields are edited.
      if (patch.nameUz !== undefined) updated.name = patch.nameUz;
      if (patch.descriptionUz !== undefined) updated.description = patch.descriptionUz;
      // A newly uploaded photo (base64) becomes bytes + URL; an unchanged one
      // arrives as the URL it already had and is left alone.
      updated.image = storeImageBlob(restaurantId, 'menu_item', updated.id, updated.image);

      db.prepare('UPDATE menu_items SET data = ? WHERE restaurant_id = ? AND id = ?').run(
        JSON.stringify(updated),
        restaurantId,
        id
      );

      broadcastTableAll(restaurantId, 'MENU_UPDATED', readMenu(restaurantId));
      broadcastStaff(restaurantId, 'MENU_UPDATED', readMenu(restaurantId));
      res.json(updated);
    }
  );

  app.delete('/api/menu/:id', requireRole('admin'), requireActiveSubscription, (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const { id } = req.params;
    db.prepare('DELETE FROM menu_items WHERE restaurant_id = ? AND id = ?').run(restaurantId, id);
    deleteImageBlob(restaurantId, 'menu_item', id); // don't leave the photo bytes behind
    broadcastTableAll(restaurantId, 'MENU_UPDATED', readMenu(restaurantId));
    broadcastStaff(restaurantId, 'MENU_UPDATED', readMenu(restaurantId));
    res.json({ success: true, id });
  });


  // --- MENU BACKUP: EXPORT / IMPORT ---
  // Restaurants arrive here carrying a menu they exported from another system,
  // and a strict importer silently drops most of it (a dish whose category does
  // not exist yet, a price written as "25 000 so'm", a field called `title`
  // instead of `nameUz`). This importer is deliberately tolerant: it accepts
  // several payload shapes, creates missing categories, coerces what it can,
  // and reports every row it could not use instead of failing the whole file.

  app.get('/api/admin/menu/export', requireRole('admin'), (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const restaurant = getRestaurantById(restaurantId);
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      restaurantName: restaurant?.name || '',
      categories: listCategories(restaurantId, true).map(c => ({
        id: c.id,
        nameUz: c.nameUz,
        nameRu: c.nameRu,
        nameEn: c.nameEn,
        icon: c.icon,
        sortOrder: c.sortOrder,
        isActive: c.isActive
      })),
      // The export file has to survive being imported somewhere else, so photos
      // go back inline as base64 here rather than as URLs only this deployment
      // (and only this tenant) could resolve.
      items: readMenu(restaurantId).map(item => ({
        ...item,
        image: inlineImageBlob(restaurantId, 'menu_item', item.id, item.image || '')
      }))
    });
  });

  /** Pull the item list out of whichever wrapper the source system used. */
  function extractImportItems(payload: any): any[] | null {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return null;
    const keys = ['items', 'menu', 'menuItems', 'menu_items', 'dishes', 'products', 'foods', 'rows'];
    for (const key of keys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    // Some backups nest everything one level deeper: { data: { menu: [...] } }.
    for (const key of ['data', 'menu', 'backup', 'payload', 'result']) {
      if (payload[key] && typeof payload[key] === 'object') {
        const nested = extractImportItems(payload[key]);
        if (nested) return nested;
      }
    }
    // Last resort: a category-keyed object, { "Salatlar": [ ...dishes ] }.
    const grouped: any[] = [];
    for (const [key, value] of Object.entries(payload)) {
      if (Array.isArray(value) && value.every(v => v && typeof v === 'object')) {
        for (const dish of value) grouped.push({ category: key, ...dish });
      }
    }
    return grouped.length > 0 ? grouped : null;
  }

  function extractImportCategories(payload: any): any[] {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    for (const key of ['categories', 'menuCategories', 'menu_categories', 'sections', 'groups']) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    for (const key of ['data', 'backup', 'payload', 'result']) {
      if (payload[key] && typeof payload[key] === 'object') {
        const nested = extractImportCategories(payload[key]);
        if (nested.length > 0) return nested;
      }
    }
    return [];
  }

  const firstString = (...values: any[]): string => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
  };

  // ---------------------------------------------------------------------
  // One field, three languages, many possible shapes. Another system stores a
  // dish name as any of:
  //
  //   { nameUz: 'Osh' }                      // flat, already our shape
  //   { name_uz: 'Osh' }
  //   { name: 'Osh' }                        // single language
  //   { name: { uz: 'Osh', ru: 'Плов' } }    // nested per language
  //   { name: { 'uz-UZ': 'Osh' } }
  //   { translations: { uz: { name: 'Osh' } } }
  //   { translations: { name: { uz: 'Osh' } } }
  //   { i18n: { uz: { name: 'Osh' } } }
  //
  // Reading only the flat shapes is why an import arrived incomplete: a nested
  // name is not a string, so the old firstString() returned '' and the row was
  // dropped as "no name" — silently, and for whole categories at a time when
  // the export had been written by a system that nests its translations.
  // ---------------------------------------------------------------------
  const LANG_ALIASES: Record<'uz' | 'ru' | 'en', string[]> = {
    uz: ['uz', 'uzb', 'uz_UZ', 'uz-UZ', 'uzLatn', 'uz_Latn', 'oz', 'ozbek'],
    ru: ['ru', 'rus', 'ru_RU', 'ru-RU'],
    en: ['en', 'eng', 'en_US', 'en-US', 'en_GB', 'en-GB']
  };
  const TRANSLATION_BAGS = ['translations', 'translation', 'i18n', 'locales', 'localizations', 'langs', 'lang'];

  /** Read `container[<any alias for lang>]` as a string. */
  const pickLangValue = (container: any, lang: 'uz' | 'ru' | 'en'): string => {
    if (!container || typeof container !== 'object' || Array.isArray(container)) return '';
    for (const alias of LANG_ALIASES[lang]) {
      const value = container[alias];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
  };

  /** The `lang` variant of any of `fields`, from whichever shape holds it. */
  function localizedValue(raw: any, fields: string[], lang: 'uz' | 'ru' | 'en'): string {
    if (!raw || typeof raw !== 'object') return '';
    const suffix = lang === 'uz' ? 'Uz' : lang === 'ru' ? 'Ru' : 'En';
    // 1. Flat, suffixed: nameUz / name_uz / name-uz / nameUZ.
    for (const field of fields) {
      const flat = firstString(
        raw[`${field}${suffix}`],
        raw[`${field}${suffix.toUpperCase()}`],
        raw[`${field}_${lang}`],
        raw[`${field}-${lang}`]
      );
      if (flat) return flat;
    }
    // 2. Nested under the field: name: { uz: … }.
    for (const field of fields) {
      const nested = pickLangValue(raw[field], lang);
      if (nested) return nested;
    }
    // 3. A translation bag, keyed either by language or by field.
    for (const bag of TRANSLATION_BAGS) {
      const container = raw[bag];
      if (!container || typeof container !== 'object') continue;
      for (const alias of LANG_ALIASES[lang]) {
        const perLang = container[alias];
        if (perLang && typeof perLang === 'object') {
          for (const field of fields) {
            const value = firstString(perLang[field], perLang[`${field}${suffix}`]);
            if (value) return value;
          }
        }
      }
      for (const field of fields) {
        const byField = pickLangValue(container[field], lang);
        if (byField) return byField;
      }
    }
    return '';
  }

  const NAME_FIELDS = ['name', 'title', 'label', 'productName', 'product_name', 'dish', 'dishName'];
  const DESCRIPTION_FIELDS = ['description', 'desc', 'details', 'about', 'summary', 'ingredients'];
  const CATEGORY_FIELDS = ['category', 'categoryName', 'category_name', 'section', 'group'];

  /**
   * The dish/category name in all three languages. Uzbek is the required one,
   * so it falls back to any other language rather than leaving the row nameless
   * and skipped — an imported dish written only in Russian is still a dish.
   */
  function localizedNames(raw: any, fields: string[]): { uz: string; ru: string; en: string } {
    const uz = localizedValue(raw, fields, 'uz');
    const ru = localizedValue(raw, fields, 'ru');
    const en = localizedValue(raw, fields, 'en');
    // A plain, unsuffixed string value belongs to no particular language.
    const plain = firstString(...fields.map(field => raw?.[field]));
    const primary = uz || plain || ru || en;
    return { uz: primary, ru: ru || primary, en: en || primary };
  }

  /** "25 000 so'm", "25,000.50", 25000 → 25000 / 25000.5. */
  function coercePrice(...values: any[]): number | null {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
      if (typeof value === 'string') {
        const cleaned = value.replace(/[^\d.,-]/g, '').replace(/\s/g, '');
        if (!cleaned) continue;
        // Treat a comma as a thousands separator unless it is clearly decimal.
        const normalized =
          cleaned.includes(',') && cleaned.includes('.')
            ? cleaned.replace(/,/g, '')
            : cleaned.replace(/,(\d{3})(?!\d)/g, '$1').replace(',', '.');
        const parsed = Number(normalized);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
      }
    }
    return null;
  }

  function coerceAvailability(raw: any): boolean {
    const candidates = [raw?.isAvailable, raw?.available, raw?.is_available, raw?.inStock, raw?.in_stock, raw?.active];
    for (const value of candidates) {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (['false', '0', 'no', 'tugadi', 'out', 'sold_out', 'soldout', 'unavailable'].includes(lowered)) return false;
        if (['true', '1', 'yes', 'mavjud', 'in', 'available'].includes(lowered)) return true;
      }
    }
    // Legacy exports carry a numeric stock count instead of a switch.
    const stock = raw?.stock ?? raw?.quantity ?? raw?.qty;
    if (typeof stock === 'number') return stock > 0;
    return true;
  }

  const IMPORT_MAX_ITEMS = 2000;

  app.post(
    '/api/admin/menu/import',
    requireRole('admin'),
    requireActiveSubscription,
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const payload = req.body;
      const rawItems = extractImportItems(payload);
      if (!rawItems) {
        res.status(400).json({
          error: "Fayl tanilmadi. Ichida taomlar ro'yxati bo'lgan JSON faylni yuklang.",
          code: 'IMPORT_SHAPE_UNKNOWN'
        });
        return;
      }
      if (rawItems.length === 0) {
        res.status(400).json({ error: "Faylda birorta ham taom topilmadi.", code: 'IMPORT_EMPTY' });
        return;
      }
      if (rawItems.length > IMPORT_MAX_ITEMS) {
        res.status(413).json({
          error: `Juda katta fayl: ${rawItems.length} taom. Bir marotabada ${IMPORT_MAX_ITEMS} tagacha yuklash mumkin.`,
          code: 'IMPORT_TOO_LARGE'
        });
        return;
      }

      const replaceExisting = payload?.mode === 'replace' || req.query.mode === 'replace';
      const skipped: { row: number; name: string; reason: string }[] = [];
      let createdCategories = 0;
      let updatedCategories = 0;
      let createdItems = 0;
      let updatedItems = 0;

      // Category lookup by id AND by name in all three languages, so a backup
      // that only stored the display name ("Salatlar") still lands correctly.
      const categoryIndex = new Map<string, string>();
      const categoriesById = new Map<string, ReturnType<typeof listCategories>[number]>();
      const rememberCategoryKey = (key: string, id: string) => {
        const normalized = key.trim().toLowerCase();
        if (normalized) categoryIndex.set(normalized, id);
      };
      const indexCategory = (category: ReturnType<typeof listCategories>[number]) => {
        categoriesById.set(category.id, category);
        rememberCategoryKey(category.id, category.id);
        for (const name of [category.nameUz, category.nameRu, category.nameEn]) {
          if (name) rememberCategoryKey(name, category.id);
        }
      };
      for (const category of listCategories(restaurantId, true)) indexCategory(category);

      /** Find the category, creating it when the backup mentions a new one. */
      const resolveCategory = (label: string): string | null => {
        const key = label.trim().toLowerCase();
        if (!key) return null;
        const existing = categoryIndex.get(key);
        if (existing) return existing;
        try {
          const created = createCategory(restaurantId, { nameUz: label.trim().slice(0, 60) });
          createdCategories += 1;
          indexCategory(created);
          return created.id;
        } catch {
          // A duplicate here means another name maps to the same generated id;
          // re-read the list and try the index once more.
          for (const category of listCategories(restaurantId, true)) indexCategory(category);
          return categoryIndex.get(key) || null;
        }
      };

      // ---------------------------------------------------------------------
      // Categories first, from the file's own category list — extracted but,
      // until now, never used. The item loop below can conjure a category out of
      // a bare label, but only with an Uzbek name and the default icon, so
      // importing items alone silently discarded every Russian and English
      // category name and every icon in the file: a Russian-speaking guest then
      // browsed a menu whose section headings were all Uzbek.
      // ---------------------------------------------------------------------
      const rawCategories = extractImportCategories(payload);
      const declaredOrder = (raw: any): number => {
        const value = Number(raw?.sortOrder ?? raw?.sort_order ?? raw?.order ?? raw?.position ?? raw?.index);
        return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
      };
      // createCategory appends (sort_order = MAX + 1), so creating them in the
      // file's declared order is what carries that order over.
      for (const rawCategory of [...rawCategories].sort((a, b) => declaredOrder(a) - declaredOrder(b))) {
        if (!rawCategory || typeof rawCategory !== 'object') continue;
        const names = localizedNames(rawCategory, NAME_FIELDS);
        const sourceId = firstString(rawCategory.id, rawCategory.slug, rawCategory.key, rawCategory.code);
        const icon = firstString(rawCategory.icon, rawCategory.emoji, rawCategory.symbol);
        // The file's own id matters as much as the name: it is what this file's
        // items use in their `categoryId`, so it has to resolve to our id too.
        const aliases = [sourceId, names.uz, names.ru, names.en].filter(Boolean);
        if (aliases.length === 0) continue;
        const matchedId = aliases.map(alias => categoryIndex.get(alias.trim().toLowerCase())).find(Boolean);

        if (matchedId) {
          // Fill in what the existing category is missing instead of
          // overwriting a name or icon the restaurant may have edited by hand.
          const current = categoriesById.get(matchedId);
          const patch: { nameRu?: string; nameEn?: string; icon?: string } = {};
          if (current) {
            // Only fill a gap, and only when the file actually says something
            // different — re-importing our own export must be a no-op.
            if (names.ru && names.ru !== current.nameRu && (!current.nameRu || current.nameRu === current.nameUz)) {
              patch.nameRu = names.ru.slice(0, 60);
            }
            if (names.en && names.en !== current.nameEn && (!current.nameEn || current.nameEn === current.nameUz)) {
              patch.nameEn = names.en.slice(0, 60);
            }
            if (icon && icon !== current.icon && (!current.icon || current.icon === '🍽️')) patch.icon = icon;
          }
          if (Object.keys(patch).length > 0) {
            try {
              const updated = updateCategory(restaurantId, matchedId, patch);
              if (updated) {
                indexCategory(updated);
                updatedCategories += 1;
              }
            } catch {
              // A name clash leaves the existing category exactly as it was.
            }
          }
          for (const alias of aliases) rememberCategoryKey(alias, matchedId);
          continue;
        }

        if (!names.uz) continue; // an id with no name anywhere is not a category
        const activeRaw = rawCategory.isActive ?? rawCategory.is_active ?? rawCategory.active ?? rawCategory.enabled;
        try {
          const created = createCategory(restaurantId, {
            nameUz: names.uz.slice(0, 60),
            nameRu: names.ru.slice(0, 60),
            nameEn: names.en.slice(0, 60),
            icon: icon || undefined,
            isActive: !(activeRaw === false || activeRaw === 0 || activeRaw === '0' || activeRaw === 'false')
          });
          createdCategories += 1;
          indexCategory(created);
          for (const alias of aliases) rememberCategoryKey(alias, created.id);
        } catch {
          // Duplicate name: re-read, then point every alias in this file at
          // whichever category already owns that name.
          for (const category of listCategories(restaurantId, true)) indexCategory(category);
          const fallback = aliases.map(alias => categoryIndex.get(alias.trim().toLowerCase())).find(Boolean);
          if (fallback) for (const alias of aliases) rememberCategoryKey(alias, fallback);
        }
      }

      /** The category a row claims, in whatever field and language it used. */
      const importCategoryLabel = (raw: any): string =>
        firstString(
          raw.category,
          raw.categoryId,
          raw.category_id,
          raw.categoryName,
          raw.category_name,
          raw.section,
          raw.group,
          raw.type
        ) ||
        localizedValue(raw, CATEGORY_FIELDS, 'uz') ||
        localizedValue(raw, CATEGORY_FIELDS, 'ru') ||
        localizedValue(raw, CATEGORY_FIELDS, 'en');

      // Existing dishes, keyed by id and by "category|name", so re-importing the
      // same backup updates rows instead of duplicating the whole menu.
      //
      // The name alone is not always unique: a menu can legitimately hold two
      // "Lavash" rows in one category that differ only in price (small/large).
      // Matching those on the name made the second row overwrite the first, so
      // the import reported "updated" for a dish it had actually just lost. A
      // name the file itself uses twice in one category gets the price folded
      // into its key; every other name keeps the plain key, which is what lets a
      // re-imported backup still recognise a dish whose price has changed.
      const dishNameCounts = new Map<string, number>();
      const ambiguityKey = (label: string, name: string) => `${label.trim().toLowerCase()}|${name.trim().toLowerCase()}`;
      for (const raw of rawItems) {
        if (!raw || typeof raw !== 'object') continue;
        const name = localizedNames(raw, NAME_FIELDS).uz;
        if (!name) continue;
        const key = ambiguityKey(importCategoryLabel(raw), name);
        dishNameCounts.set(key, (dishNameCounts.get(key) || 0) + 1);
      }
      const nameKeyFor = (label: string, categoryId: string, name: string, price: number): string => {
        const lower = name.trim().toLowerCase();
        return (dishNameCounts.get(ambiguityKey(label, name)) || 0) > 1
          ? `${categoryId}|${lower}|${price}`
          : `${categoryId}|${lower}`;
      };

      const existingItems = readMenu(restaurantId);
      const byId = new Map(existingItems.map(item => [item.id, item]));
      const byName = new Map<string, MenuItem>();
      for (const item of existingItems) {
        const name = (item.nameUz || item.name || '').trim().toLowerCase();
        if (!name) continue;
        // Both spellings of the key, because whether the incoming file treats
        // this name as ambiguous is not knowable from the stored menu.
        byName.set(`${item.category}|${name}`, item);
        byName.set(`${item.category}|${name}|${item.price}`, item);
      }

      const insertStmt = db.prepare('INSERT INTO menu_items (restaurant_id, id, data) VALUES (?, ?, ?)');
      const updateStmt = db.prepare('UPDATE menu_items SET data = ? WHERE restaurant_id = ? AND id = ?');

      if (replaceExisting) {
        db.prepare('DELETE FROM menu_items WHERE restaurant_id = ?').run(restaurantId);
        db.prepare(`DELETE FROM image_blobs WHERE restaurant_id = ? AND owner = 'menu_item'`).run(restaurantId);
        byId.clear();
        byName.clear();
      }

      rawItems.forEach((raw: any, index: number) => {
        const row = index + 1;
        if (!raw || typeof raw !== 'object') {
          skipped.push({ row, name: '', reason: "Yozuv o'qilmadi." });
          return;
        }

        const names = localizedNames(raw, NAME_FIELDS);
        const nameUz = names.uz;
        if (!nameUz) {
          skipped.push({ row, name: '', reason: 'Nomi yo’q.' });
          return;
        }
        const price = coercePrice(raw.price, raw.cost, raw.amount, raw.priceUzs, raw.price_uzs, raw.sellPrice);
        if (price === null) {
          skipped.push({ row, name: nameUz, reason: "Narxi noto'g'ri." });
          return;
        }

        // The category can be named in any language too, and the id the file
        // uses was registered as an alias by the category pass above.
        const categoryLabel = importCategoryLabel(raw);
        const categoryId = resolveCategory(categoryLabel) || resolveCategory('Boshqa');
        if (!categoryId) {
          skipped.push({ row, name: nameUz, reason: 'Kategoriya yaratilmadi.' });
          return;
        }

        const nameRu = names.ru;
        const nameEn = names.en;
        const descriptions = localizedNames(raw, DESCRIPTION_FIELDS);
        const descriptionUz = descriptions.uz;
        const descriptionRu = descriptions.ru;
        const descriptionEn = descriptions.en;
        const image = firstString(raw.image, raw.imageUrl, raw.image_url, raw.photo, raw.picture, raw.img);
        const prepTime = Number(raw.prepTimeMinutes ?? raw.prep_time_minutes ?? raw.prepTime ?? raw.cookingTime);

        const existingId = typeof raw.id === 'string' ? raw.id : '';
        const nameKey = nameKeyFor(categoryLabel, categoryId, nameUz, price);
        const existing = (existingId && byId.get(existingId)) || byName.get(nameKey) || undefined;

        const item: MenuItem = {
          id: existing ? existing.id : 'm-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
          name: nameUz.slice(0, 120),
          description: descriptionUz.slice(0, 500),
          nameUz: nameUz.slice(0, 120),
          nameRu: nameRu.slice(0, 120),
          nameEn: nameEn.slice(0, 120),
          descriptionUz: descriptionUz.slice(0, 500),
          descriptionRu: descriptionRu.slice(0, 500),
          descriptionEn: descriptionEn.slice(0, 500),
          price,
          category: categoryId as MenuItem['category'],
          image:
            image && /^(https?:\/\/|data:image\/)/i.test(image)
              ? image
              : existing?.image ||
                'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80',
          isAvailable: coerceAvailability(raw),
          dietary: Array.isArray(raw.dietary) ? raw.dietary : existing?.dietary,
          prepTimeMinutes: Number.isFinite(prepTime) && prepTime > 0 ? prepTime : existing?.prepTimeMinutes,
          customizations: Array.isArray(raw.customizations) ? raw.customizations : existing?.customizations
        };

        try {
          // A backup file carries its photos inline as base64; keep them out of
          // the row the same way the normal write paths do.
          item.image = storeImageBlob(restaurantId, 'menu_item', item.id, item.image || '');
          if (existing) {
            updateStmt.run(JSON.stringify(item), restaurantId, item.id);
            updatedItems += 1;
          } else {
            insertStmt.run(restaurantId, item.id, JSON.stringify(item));
            createdItems += 1;
          }
          byId.set(item.id, item);
          byName.set(nameKey, item);
        } catch (err) {
          skipped.push({ row, name: nameUz, reason: 'Saqlanmadi.' });
        }
      });

      req.log.info(
        { createdCategories, updatedCategories, createdItems, updatedItems, skipped: skipped.length },
        'menu imported'
      );
      broadcastCategories(restaurantId);
      broadcastTableAll(restaurantId, 'MENU_UPDATED', readMenu(restaurantId));
      broadcastStaff(restaurantId, 'MENU_UPDATED', readMenu(restaurantId));

      res.json({
        success: true,
        totalRows: rawItems.length,
        createdCategories,
        updatedCategories,
        createdItems,
        updatedItems,
        skipped: skipped.slice(0, 50),
        skippedCount: skipped.length
      });
    }
  );

  // --- ORDERS ENDPOINTS ---
  app.get('/api/orders', requireRole('admin', 'kitchen'), (req: Request, res: Response) => {
    res.json(readOrders(req.restaurantId as string));
  });

  // ---------------------------------------------------------------------------
  // What an anonymous guest at a table may read. This is deliberately NOT every
  // order ever placed at table N: a table is reused all evening, so returning
  // the full history handed each new person who scanned that QR the previous
  // customer's dishes, name and phone number — a privacy leak, and the reason
  // the menu used to open with a stranger's bill already on screen.
  //
  // A table session ends when the bill is settled, so `paid` and `cancelled`
  // orders are never public. Staff forgetting to close a ticket must not extend
  // the session forever either — cash handed over at the counter routinely never
  // gets marked paid — so an unsettled order also drops out once it is older
  // than one plausible visit.
  //
  // Nothing is deleted and staff still see every order (GET /api/orders above,
  // and the admin dashboard); this only bounds what an unauthenticated scanner
  // is served. The guest's own receipts are kept on the guest's own device
  // instead — src/utils/guestOrders.ts, whose GUEST_SESSION_MS must match the
  // window below.
  // ---------------------------------------------------------------------------
  const TABLE_SESSION_MS = 4 * 60 * 60 * 1000;

  app.get('/api/orders/table/:tableNumber', requirePublicRestaurant, (req: Request, res: Response) => {
    const tableNumber = Number(req.params.tableNumber);
    if (!Number.isFinite(tableNumber)) {
      res.status(400).json({ error: 'Invalid table number' });
      return;
    }
    const sessionStart = Date.now() - TABLE_SESSION_MS;
    res.json(
      readOrders(req.restaurantId as string)
        .filter(o => {
          if (o.tableNumber !== tableNumber) return false;
          // Settled = that visit is over, whoever is holding the phone now.
          if (o.status === 'paid' || o.status === 'cancelled') return false;
          const created = new Date(o.createdAt).getTime();
          // A missing/unparseable timestamp shouldn't hide a live ticket from the
          // guest waiting on it; the server always writes createdAt, so this is
          // only a guard against rows written by some older build.
          return Number.isNaN(created) ? true : created >= sessionStart;
        })
        // Status only — see publicOrderView. The guest's own items/totals/name
        // live on their own device; this endpoint exists so that copy can catch
        // up on what the kitchen did while the page was closed.
        .map(publicOrderView)
    );
  });

  app.post(
    '/api/orders',
    requirePublicRestaurant,
    orderLimiter,
    validateBody(orderCreateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const idempotencyKey = req.header('Idempotency-Key');

      if (idempotencyKey) {
        const existing = db
          .prepare('SELECT order_id FROM idempotency_keys WHERE key = ? AND restaurant_id = ?')
          .get(idempotencyKey, restaurantId) as { order_id: string } | undefined;
        if (existing) {
          const row = db
            .prepare('SELECT data FROM orders WHERE restaurant_id = ? AND id = ?')
            .get(restaurantId, existing.order_id) as { data: string } | undefined;
          if (row) {
            res.status(200).json(JSON.parse(row.data));
            return;
          }
        }
      }

      const {
        tableNumber,
        customerName,
        customerPhoneOrEmail,
        items,
        subtotal,
        // `discount` is the so'm figure the cart asked for; `loyaltyPointsRedeemed`
        // from the body is deliberately ignored — the points actually spent are
        // derived from the discount the server allows.
        discount,
        paymentMethod,
        orderNote,
        orderType,
        deliveryAddress,
        deliveryPhone,
        deliveryLat,
        deliveryLng
      } = req.body;

      // Pickup ("olib ketish") never touches the courier fleet, so it
      // doesn't need the delivery service to be active for this restaurant
      // — only real courier-delivered orders are gated on that.
      if (orderType === 'delivery') {
        const restaurant = getRestaurantById(restaurantId);
        if (!restaurant || restaurant.delivery_status !== 'active') {
          res.status(403).json({ error: "Dostavka xizmati ushbu restoran uchun yoqilmagan." });
          return;
        }
      }

      // Server-side recompute/sanity-check against authoritative menu prices,
      // instead of trusting client-submitted totals outright.
      const menu = readMenu(restaurantId);
      let recomputedSubtotal = 0;
      for (const cartItem of items) {
        const menuItem = menu.find(m => m.id === cartItem.menuItem.id);
        if (!menuItem) {
          res.status(400).json({ error: `Menu item ${cartItem.menuItem.id} does not exist` });
          return;
        }
        if (!menuItem.isAvailable) {
          res.status(409).json({ error: `${menuItem.name} is not available right now` });
          return;
        }
        recomputedSubtotal += cartItem.itemTotal;
      }
      if (Math.abs(recomputedSubtotal - subtotal) > 0.5) {
        res.status(400).json({ error: 'Order total does not match menu pricing' });
        return;
      }

      // Tax and service charge are ALWAYS computed here from the current
      // settings, never trusted from the client — otherwise a customer could
      // tamper with these values in the request to pay less. The discount
      // (from loyalty points) is capped server-side at 50% of subtotal,
      // matching the same rule the cart UI uses, AND at what this guest's own
      // points are actually worth — a client asking for a discount it has no
      // balance to back gets nothing, and neither does anyone if the owner has
      // switched the whole points program off for this restaurant.
      const { taxPercent, serviceFeePercent } = readSettings(restaurantId);
      const authoritativeTax = Math.round((recomputedSubtotal * taxPercent) / 100);
      const authoritativeServiceCharge = Math.round((recomputedSubtotal * serviceFeePercent) / 100);

      const loyaltyOn = loyaltyEnabled(restaurantId);
      const loyaltyKey = customerPhoneOrEmail ? String(customerPhoneOrEmail).toLowerCase() : null;
      const existingMemberRow = loyaltyKey
        ? (db
            .prepare('SELECT id, data FROM loyalty_members WHERE restaurant_id = ? AND phone_or_email = ?')
            .get(restaurantId, loyaltyKey) as { id: string; data: string } | undefined)
        : undefined;
      const memberBalance = existingMemberRow
        ? Math.max(0, Number((JSON.parse(existingMemberRow.data) as LoyaltyMember).pointsBalance) || 0)
        : 0;

      const requestedDiscount = loyaltyOn ? Math.max(0, Number(discount) || 0) : 0;
      const maxDiscount = Math.min(recomputedSubtotal * 0.5, memberBalance * POINT_VALUE_SOM);
      // Kept an exact multiple of a point's value so the points actually
      // deducted below always match the so'm taken off the bill.
      const authoritativeDiscount =
        Math.floor(Math.min(requestedDiscount, maxDiscount) / POINT_VALUE_SOM) * POINT_VALUE_SOM;
      const authoritativePointsRedeemed = authoritativeDiscount / POINT_VALUE_SOM;
      const authoritativeTotal = Math.max(
        0,
        recomputedSubtotal + authoritativeTax + authoritativeServiceCharge - authoritativeDiscount
      );

      // The suffix is crypto-random, not Math.random()x900. GET
      // /api/events/order/:id is public by necessity (the guest has no session),
      // so a guessable id is a subscription to somebody else's order: the
      // timestamp half is knowable within a second, which left only 900
      // possibilities to try. 5 base32 characters is ~1.7 million per
      // millisecond, and the id stays short enough to read off a receipt.
      const orderId =
        'ORD-' +
        Date.now().toString(36).toUpperCase() +
        '-' +
        Array.from(crypto.randomBytes(5), b => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[b & 31]).join('');
      // Loyalty economics, calibrated for so'm-scale totals: earn 1 point per
      // 1,000 so'm spent, each point worth 100 so'm when redeemed (~10% back).
      // Both halves are off when the program is disabled for this restaurant.
      const pointsEarned = loyaltyOn ? Math.round(authoritativeTotal / SOM_PER_POINT_EARNED) : 0;

      const newOrder: Order = {
        id: orderId,
        tableNumber: Number(tableNumber),
        customerName:
          customerName ||
          (orderType === 'delivery'
            ? 'Dostavka mijozi'
            : orderType === 'pickup'
            ? 'Olib ketish mijozi'
            : `Table ${tableNumber} Guest`),
        customerPhoneOrEmail: customerPhoneOrEmail || '',
        items,
        subtotal: recomputedSubtotal,
        tax: authoritativeTax,
        serviceCharge: authoritativeServiceCharge,
        discount: authoritativeDiscount,
        totalAmount: authoritativeTotal,
        status: 'pending',
        paymentStatus: paymentMethod === 'card' ? 'paid' : 'unpaid',
        paymentMethod: paymentMethod || 'cash',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        estimatedMinutes: 15,
        loyaltyPointsEarned: pointsEarned,
        loyaltyPointsRedeemed: authoritativePointsRedeemed,
        orderNote,
        orderType: orderType || 'dine_in',
        deliveryAddress: orderType === 'delivery' ? deliveryAddress : undefined,
        // Pickup orders still carry a contact phone (reusing the same
        // field) so the kitchen/admin can call the customer when their
        // order is ready — they just never get an address or courier.
        deliveryPhone: orderType === 'delivery' || orderType === 'pickup' ? deliveryPhone : undefined,
        deliveryLat: orderType === 'delivery' && typeof deliveryLat === 'number' ? deliveryLat : undefined,
        deliveryLng: orderType === 'delivery' && typeof deliveryLng === 'number' ? deliveryLng : undefined
      };

      const tx = db.transaction(() => {
        db.prepare('INSERT INTO orders (restaurant_id, id, table_number, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
          restaurantId,
          newOrder.id,
          newOrder.tableNumber,
          JSON.stringify(newOrder),
          newOrder.createdAt
        );

        if (idempotencyKey) {
          db.prepare('INSERT INTO idempotency_keys (key, order_id, restaurant_id, created_at) VALUES (?, ?, ?, ?)').run(
            idempotencyKey,
            newOrder.id,
            restaurantId,
            new Date().toISOString()
          );
        }

        // Dishes are no longer counted down: availability is the manual
        // "mavjud / tugadi" switch the kitchen flips, so placing an order
        // leaves the menu untouched.

        const tableRow = db
          .prepare('SELECT data FROM tables WHERE restaurant_id = ? AND table_number = ?')
          .get(restaurantId, Number(tableNumber)) as { data: string } | undefined;
        if (tableRow) {
          const t: Table = JSON.parse(tableRow.data);
          t.status = 'eating';
          t.currentOrderId = orderId;
          t.activeItemsCount = items.length;
          db.prepare('UPDATE tables SET data = ? WHERE restaurant_id = ? AND table_number = ?').run(
            JSON.stringify(t),
            restaurantId,
            t.tableNumber
          );
        }

        // Re-read inside the transaction: the balance used for the discount cap
        // above was read before it began, and two orders from the same guest
        // must not both spend the same points.
        if (loyaltyKey) {
          const loyaltyRow = db
            .prepare('SELECT id, data FROM loyalty_members WHERE restaurant_id = ? AND phone_or_email = ?')
            .get(restaurantId, loyaltyKey) as { id: string; data: string } | undefined;
          if (loyaltyRow) {
            const member: LoyaltyMember = JSON.parse(loyaltyRow.data);
            member.pointsBalance = Math.max(0, member.pointsBalance + pointsEarned - authoritativePointsRedeemed);
            member.totalSpent += authoritativeTotal;
            member.ordersCount += 1;
            if (member.totalSpent > 500) member.tier = 'Platinum';
            else if (member.totalSpent > 200) member.tier = 'Gold';
            db.prepare('UPDATE loyalty_members SET data = ? WHERE restaurant_id = ? AND id = ?').run(
              JSON.stringify(member),
              restaurantId,
              member.id
            );
          }
        }
      });
      tx();

      req.log.info({ orderId, tableNumber, restaurantId }, 'order created');
      broadcastStaff(restaurantId, 'ORDER_CREATED', { order: newOrder });
      broadcastTable(restaurantId, Number(tableNumber), 'ORDER_CREATED', { order: publicOrderView(newOrder) });
      broadcastOrder(restaurantId, newOrder.id, 'ORDER_CREATED', { order: newOrder });
      broadcastTableAll(restaurantId, 'MENU_UPDATED', readMenu(restaurantId));

      // Best-effort — if the admin hasn't linked their Telegram, or the
      // message fails to send, the order itself is already saved and the
      // dashboard/SSE stream still shows it live.
      const owningRestaurant = getRestaurantById(restaurantId);
      if (owningRestaurant?.admin_telegram_chat_id) {
        const itemsSummary = items
          .map((ci: { menuItem: { name: string }; quantity: number }) => `${ci.quantity}x ${ci.menuItem.name}`)
          .join(', ');
        const adminMessage =
          orderType === 'delivery'
            ? `🛵 Yangi DOSTAVKA buyurtmasi\n${itemsSummary}\nJami: ${authoritativeTotal.toLocaleString('uz-UZ')} so'm`
            : orderType === 'pickup'
            ? `🥡 Yangi OLIB KETISH buyurtmasi\n${itemsSummary}\nJami: ${authoritativeTotal.toLocaleString('uz-UZ')} so'm\nMijoz tayyor bo'lganda o'zi keladi.`
            : `🔔 Yangi buyurtma — Stol #${tableNumber}\n${itemsSummary}\nJami: ${authoritativeTotal.toLocaleString('uz-UZ')} so'm`;
        sendTelegramMessage(owningRestaurant.admin_telegram_chat_id, adminMessage).catch(() => {});
      }

      // Only real courier-delivered orders page the courier fleet — pickup
      // orders are picked up by the customer themselves, so the kitchen
      // just prepares them like any other ticket and no courier is ever
      // notified.
      if (orderType === 'delivery') {
        notifyCouriersOfNewOrder(restaurantId, newOrder).catch(err => {
          logger.warn({ err, orderId }, 'failed to notify couriers of new delivery order');
        });
      }

      res.status(201).json(newOrder);
    }
  );

  app.patch(
    '/api/orders/:id/status',
    requireRole('admin', 'kitchen'),
    validateBody(orderStatusUpdateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const { id } = req.params;
      const { status, paymentStatus } = req.body;

      const row = db.prepare('SELECT data FROM orders WHERE restaurant_id = ? AND id = ?').get(restaurantId, id) as
        | { data: string }
        | undefined;
      if (!row) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      const order: Order = JSON.parse(row.data);
      if (status) order.status = status;
      if (paymentStatus) order.paymentStatus = paymentStatus;
      order.updatedAt = new Date().toISOString();

      db.prepare('UPDATE orders SET data = ? WHERE restaurant_id = ? AND id = ?').run(
        JSON.stringify(order),
        restaurantId,
        id
      );

      if (status === 'paid') {
        const tableRow = db
          .prepare('SELECT data FROM tables WHERE restaurant_id = ? AND table_number = ?')
          .get(restaurantId, order.tableNumber) as { data: string } | undefined;
        if (tableRow) {
          const t: Table = JSON.parse(tableRow.data);
          t.status = 'available';
          t.currentOrderId = undefined;
          t.activeItemsCount = 0;
          db.prepare('UPDATE tables SET data = ? WHERE restaurant_id = ? AND table_number = ?').run(
            JSON.stringify(t),
            restaurantId,
            t.tableNumber
          );
          broadcastStaff(restaurantId, 'TABLES_UPDATED', readTables(restaurantId));
        }
      }

      broadcastStaff(restaurantId, 'ORDER_UPDATED', { order });
      broadcastTable(restaurantId, order.tableNumber, 'ORDER_UPDATED', { order: publicOrderView(order) });
      broadcastOrder(restaurantId, order.id, 'ORDER_UPDATED', { order });
      res.json(order);
    }
  );

  // --- LOYALTY ENDPOINTS ---
  app.get('/api/loyalty', requireRole('admin', 'kitchen'), (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const query = String(req.query.q || '').toLowerCase().trim();
    if (!query) {
      res.json(readLoyalty(restaurantId));
      return;
    }
    const member = readLoyalty(restaurantId).find(
      l => l.phoneOrEmail.toLowerCase() === query || l.name.toLowerCase().includes(query)
    );
    res.json(member || null);
  });

  // Public, narrow: a customer can look up ONLY their own record by exact
  // phone/email match — never a general search, never the full list. Returns
  // 403 (not an empty body) while the program is switched off, so the guest app
  // can tell "no account yet" apart from "this restaurant has no points".
  app.get('/api/loyalty/lookup', requirePublicRestaurant, orderLimiter, (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    if (!loyaltyEnabled(restaurantId)) {
      res.status(403).json({ error: 'Bonus ballar tizimi bu restoranda yoqilmagan.', code: 'LOYALTY_DISABLED' });
      return;
    }
    const identifier = String(req.query.identifier || '').toLowerCase().trim();
    if (!identifier) {
      res.status(400).json({ error: 'identifier is required' });
      return;
    }
    const row = db
      .prepare('SELECT data FROM loyalty_members WHERE restaurant_id = ? AND phone_or_email = ?')
      .get(restaurantId, identifier) as { data: string } | undefined;
    res.json(row ? JSON.parse(row.data) : null);
  });

  app.post(
    '/api/loyalty',
    requirePublicRestaurant,
    orderLimiter,
    validateBody(loyaltyRegisterSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      if (!loyaltyEnabled(restaurantId)) {
        res.status(403).json({ error: 'Bonus ballar tizimi bu restoranda yoqilmagan.', code: 'LOYALTY_DISABLED' });
        return;
      }
      const { name, phoneOrEmail, confirmationCode } = req.body;
      const key = String(phoneOrEmail).toLowerCase();
      const existingRow = db
        .prepare('SELECT data FROM loyalty_members WHERE restaurant_id = ? AND phone_or_email = ?')
        .get(restaurantId, key) as { data: string } | undefined;
      if (existingRow) {
        res.json(JSON.parse(existingRow.data));
        return;
      }
      const newMember: LoyaltyMember = {
        id: 'loy-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
        name,
        phoneOrEmail,
        confirmationCode: confirmationCode || Math.floor(1000 + Math.random() * 9000).toString(),
        pointsBalance: 100,
        tier: 'Silver',
        totalSpent: 0,
        ordersCount: 0,
        joinedDate: new Date().toISOString().split('T')[0]
      };
      db.prepare('INSERT INTO loyalty_members (restaurant_id, id, phone_or_email, data) VALUES (?, ?, ?, ?)').run(
        restaurantId,
        newMember.id,
        key,
        JSON.stringify(newMember)
      );
      res.status(201).json(newMember);
    }
  );

  // --- TABLES ENDPOINTS ---
  app.get('/api/tables', requirePublicRestaurant, (req: Request, res: Response) => {
    res.json(readTables(req.restaurantId as string));
  });

  app.post(
    '/api/tables',
    requireRole('admin'),
    requireActiveSubscription,
    validateBody(tableCreateSchema),
    (req: Request, res: Response) => {
      const restaurantId = req.restaurantId as string;
      const { tableNumber, capacity, comment } = req.body;
      const existing = db
        .prepare('SELECT data FROM tables WHERE restaurant_id = ? AND table_number = ?')
        .get(restaurantId, tableNumber) as { data: string } | undefined;
      if (existing) {
        const t: Table = JSON.parse(existing.data);
        t.capacity = capacity;
        t.comment = comment ?? t.comment ?? '';
        db.prepare('UPDATE tables SET data = ? WHERE restaurant_id = ? AND table_number = ?').run(
          JSON.stringify(t),
          restaurantId,
          tableNumber
        );
        broadcastStaff(restaurantId, 'TABLES_UPDATED', readTables(restaurantId));
        broadcastTableAll(restaurantId, 'TABLE_INFO_UPDATED', { tableNumber, comment: t.comment });
        res.json(t);
        return;
      }
      const newTable: Table = { tableNumber, capacity, status: 'available', activeItemsCount: 0, comment: comment || '' };
      db.prepare('INSERT INTO tables (restaurant_id, table_number, data) VALUES (?, ?, ?)').run(
        restaurantId,
        tableNumber,
        JSON.stringify(newTable)
      );
      broadcastStaff(restaurantId, 'TABLES_UPDATED', readTables(restaurantId));
      res.status(201).json(newTable);
    }
  );

  app.delete('/api/tables/:tableNumber', requireRole('admin'), requireActiveSubscription, (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const tableNum = Number(req.params.tableNumber);
    db.prepare('DELETE FROM tables WHERE restaurant_id = ? AND table_number = ?').run(restaurantId, tableNum);
    broadcastStaff(restaurantId, 'TABLES_UPDATED', readTables(restaurantId));
    res.json({ success: true, tableNumber: tableNum });
  });

  app.get('/api/inventory-logs', requireRole('admin'), (req: Request, res: Response) => {
    res.json(readInventoryLogs(req.restaurantId as string));
  });

  // --- ANALYTICS ---
  // Computed in JS (not SQL aggregates), since each order's line items live
  // inside its JSON `data` blob rather than a separate rows-per-item table.
  // Fine at restaurant scale (hundreds to low thousands of orders) — this
  // is a per-tenant read scoped to one restaurant's own order history.
  app.get('/api/admin/analytics', requireRole('admin'), (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const rangeDays = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    const previousCutoff = Date.now() - rangeDays * 2 * 24 * 60 * 60 * 1000;

    const allOrders = readOrders(restaurantId).filter(o => o.status !== 'cancelled');
    const orders = allOrders.filter(o => new Date(o.createdAt).getTime() >= cutoff);
    const previousPeriodOrders = allOrders.filter(o => {
      const t = new Date(o.createdAt).getTime();
      return t >= previousCutoff && t < cutoff;
    });

    const revenueByDay: Record<string, number> = {};
    const dishCounts: Record<string, { name: string; quantity: number; revenue: number }> = {};
    const categoryRevenue: Record<string, number> = {};
    const paymentTotals: Record<string, { count: number; revenue: number }> = {
      cash: { count: 0, revenue: 0 },
      card: { count: 0, revenue: 0 },
      loyalty_points: { count: 0, revenue: 0 }
    };
    let deliveryCount = 0;
    let pickupCount = 0;
    let dineInCount = 0;
    let totalRevenue = 0;

    for (const order of orders) {
      const day = order.createdAt.slice(0, 10); // YYYY-MM-DD
      revenueByDay[day] = (revenueByDay[day] || 0) + order.totalAmount;
      totalRevenue += order.totalAmount;

      const method = order.paymentMethod === 'pay_at_counter' ? 'cash' : order.paymentMethod || 'cash';
      if (!paymentTotals[method]) paymentTotals[method] = { count: 0, revenue: 0 };
      paymentTotals[method].count += 1;
      paymentTotals[method].revenue += order.totalAmount;

      if (order.orderType === 'delivery') deliveryCount += 1;
      else if (order.orderType === 'pickup') pickupCount += 1;
      else dineInCount += 1;

      for (const item of order.items) {
        const key = item.menuItem.id;
        if (!dishCounts[key]) dishCounts[key] = { name: item.menuItem.name, quantity: 0, revenue: 0 };
        dishCounts[key].quantity += item.quantity;
        dishCounts[key].revenue += item.itemTotal;

        const category = item.menuItem.category || 'boshqa';
        categoryRevenue[category] = (categoryRevenue[category] || 0) + item.itemTotal;
      }
    }

    const topDishes = Object.values(dishCounts)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    const revenueTimeline = Object.entries(revenueByDay)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, revenue]) => ({ date, revenue }));

    const categoryBreakdown = Object.entries(categoryRevenue)
      .sort(([, a], [, b]) => b - a)
      .map(([category, revenue]) => ({ category, revenue }));

    const paymentMethodBreakdown = Object.entries(paymentTotals)
      .filter(([, v]) => v.count > 0)
      .map(([method, v]) => ({ method, ...v }));

    const previousRevenue = previousPeriodOrders.reduce((s, o) => s + o.totalAmount, 0);
    const revenueChangePercent =
      previousRevenue > 0 ? Math.round(((totalRevenue - previousRevenue) / previousRevenue) * 100) : null;

    res.json({
      rangeDays,
      totalRevenue,
      totalOrders: orders.length,
      averageOrderValue: orders.length > 0 ? Math.round(totalRevenue / orders.length) : 0,
      revenueChangePercent,
      previousPeriodRevenue: previousRevenue,
      revenueTimeline,
      topDishes,
      categoryBreakdown,
      paymentMethodBreakdown,
      orderTypeBreakdown: { dineIn: dineInCount, delivery: deliveryCount, pickup: pickupCount }
    });
  });

  // --- EXCEL EXPORT ---
  app.get('/api/admin/orders/export', requireRole('admin'), async (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const restaurant = getRestaurantById(restaurantId);
    const orders = readOrders(restaurantId);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Qulaycafe';
    const sheet = workbook.addWorksheet('Buyurtmalar');

    sheet.columns = [
      { header: 'Sana', key: 'date', width: 20 },
      { header: 'Buyurtma ID', key: 'id', width: 22 },
      { header: 'Stol', key: 'table', width: 8 },
      { header: 'Mijoz', key: 'customer', width: 20 },
      { header: 'Taomlar', key: 'items', width: 50 },
      { header: 'Oraliq summa', key: 'subtotal', width: 14 },
      { header: 'Soliq', key: 'tax', width: 12 },
      { header: 'Xizmat haqi', key: 'service', width: 12 },
      { header: 'Chegirma', key: 'discount', width: 12 },
      { header: 'Jami', key: 'total', width: 14 },
      { header: "To'lov usuli", key: 'paymentMethod', width: 16 },
      { header: 'Holati', key: 'status', width: 14 }
    ];
    sheet.getRow(1).font = { bold: true };

    for (const order of orders) {
      sheet.addRow({
        date: new Date(order.createdAt).toLocaleString('uz-UZ'),
        id: order.id,
        table: order.tableNumber,
        customer: order.customerName,
        items: order.items.map(i => `${i.quantity}x ${i.menuItem.name}`).join(', '),
        subtotal: order.subtotal,
        tax: order.tax,
        service: order.serviceCharge,
        discount: order.discount,
        total: order.totalAmount,
        paymentMethod: order.paymentMethod,
        status: order.status
      });
    }

    const filename = `${(restaurant?.name || 'restoran').replace(/[^a-zA-Z0-9]/g, '_')}-buyurtmalar.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  });

  app.delete('/api/orders/:id', requireRole('admin'), (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const { id } = req.params;
    const result = db.prepare('DELETE FROM orders WHERE restaurant_id = ? AND id = ?').run(restaurantId, id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    req.log.info({ orderId: id }, 'order deleted by admin');
    broadcastStaff(restaurantId, 'ORDER_DELETED', { id });
    res.json({ success: true, id });
  });

  // Data retention: deletes orders (and related stale rows) older than N
  // days, scoped to ONE restaurant so one tenant's cleanup never touches
  // another's data. Runs automatically once a day for every restaurant (see
  // runInitialCleanup below) and can also be triggered on demand from the
  // admin dashboard.
  function runRetentionCleanup(restaurantId: string, olderThanDays: number) {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const ordersDeleted = db
      .prepare('DELETE FROM orders WHERE restaurant_id = ? AND created_at < ?')
      .run(restaurantId, cutoff).changes;
    const logsDeleted = db
      .prepare('DELETE FROM inventory_logs WHERE restaurant_id = ? AND created_at < ?')
      .run(restaurantId, cutoff).changes;
    const idempotencyDeleted = db
      .prepare('DELETE FROM idempotency_keys WHERE restaurant_id = ? AND created_at < ?')
      .run(restaurantId, cutoff).changes;
    // Reservations age out by the date they were BOOKED FOR, not by when they
    // were created — a booking made months in advance for next week is still
    // live data.
    const reservationsDeleted = db
      .prepare('DELETE FROM reservations WHERE restaurant_id = ? AND reserved_date < ?')
      .run(restaurantId, cutoff.slice(0, 10)).changes;
    return { ordersDeleted, logsDeleted, idempotencyDeleted, reservationsDeleted, cutoff };
  }

  app.post('/api/admin/orders/cleanup', requireRole('admin'), (req: Request, res: Response) => {
    const restaurantId = req.restaurantId as string;
    const days = Number(req.body?.olderThanDays) || 30;
    if (days < 1 || days > 3650) {
      res.status(400).json({ error: 'olderThanDays must be between 1 and 3650' });
      return;
    }
    const result = runRetentionCleanup(restaurantId, days);
    req.log.info(result, 'manual retention cleanup run');
    broadcastStaff(restaurantId, 'ORDERS_CLEANED_UP', result);
    res.json({ success: true, ...result });
  });

  app.post('/api/admin/backup', requireRole('admin'), (_req: Request, res: Response) => {
    const backupPath = backupNow();
    res.json({ success: true, path: backupPath });
  });

  // --- Static assets / SPA serving ---
  if (isProd) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        }
      })
    );
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) {
        next(); // let Express's default handler return a proper 404 JSON-less response for a mistyped/missing API route
        return;
      }
      // A hashed bundle that no longer exists must 404, not fall through to the
      // SPA shell. A browser holding a cached index.html from the previous
      // deploy asks for the old /assets/index-<hash>.js; answering that with
      // HTML makes the module load fail on a MIME mismatch and the tab renders
      // nothing at all — the "blank page after deploy" that looks like the
      // whole site is down. A 404 makes the reload fetch the new shell.
      if (req.path.startsWith('/assets/') || /\.(js|mjs|css|map|json|webmanifest|png|jpe?g|svg|ico|woff2?)$/i.test(req.path)) {
        res.status(404).type('txt').send('Not found');
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  // --- Centralized error handler: never leak stack traces to the client ---
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    req.log?.error({ err }, 'unhandled error');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Restaurant QR System listening on http://localhost:${PORT} (env=${process.env.NODE_ENV || 'development'})`);
  });

  // Automatic data retention: keeps the last N days of orders by default
  // (30, configurable via ORDER_RETENTION_DAYS) so the database doesn't
  // grow forever with tickets nobody needs anymore, run separately for
  // EVERY restaurant tenant. Admin can also trigger this manually (for
  // their own restaurant only) from the dashboard.
  const retentionDays = Number(process.env.ORDER_RETENTION_DAYS) || 30;
  const runInitialCleanup = () => {
    try {
      const restaurantIds = (db.prepare('SELECT id FROM restaurants').all() as { id: string }[]).map(r => r.id);
      for (const restaurantId of restaurantIds) {
        const result = runRetentionCleanup(restaurantId, retentionDays);
        if (result.ordersDeleted > 0) {
          logger.info({ restaurantId, ...result }, 'automatic retention cleanup ran');
        }
      }
    } catch (err) {
      logger.error({ err }, 'automatic retention cleanup failed');
    }
  };
  runInitialCleanup();
  setInterval(runInitialCleanup, 24 * 60 * 60 * 1000);

  refreshExchangeRatesFromLiveSource();
  setInterval(refreshExchangeRatesFromLiveSource, 24 * 60 * 60 * 1000);

  checkExpiringSubscriptionsAndNotifyOwner();
  setInterval(checkExpiringSubscriptionsAndNotifyOwner, 24 * 60 * 60 * 1000);

  if (telegramConfigured && process.env.APP_URL) {
    registerWebhook(process.env.APP_URL, TELEGRAM_WEBHOOK_SECRET);
    logger.info('Telegram webhook registration attempted');
  } else if (telegramConfigured) {
    logger.warn('TELEGRAM_BOT_TOKEN is set but APP_URL is missing — webhook was not registered');
  }

  if (ownerBotConfigured && process.env.APP_URL) {
    registerOwnerWebhook(process.env.APP_URL, OWNER_BOT_WEBHOOK_SECRET);
    logger.info('Owner bot webhook registration attempted');
  } else if (ownerBotConfigured) {
    logger.warn('OWNER_BOT_TOKEN is set but APP_URL is missing — owner bot webhook was not registered');
  }

  if (deliveryBotConfigured && process.env.APP_URL) {
    registerDeliveryBotWebhook(process.env.APP_URL, DELIVERY_BOT_WEBHOOK_SECRET);
    logger.info('Delivery bot webhook registration attempted');
  } else if (deliveryBotConfigured) {
    logger.warn('TELEGRAM_DELIVERY_BOT_TOKEN is set but APP_URL is missing — delivery bot webhook was not registered');
  }

  // A courier accepting/updating a delivery order happens entirely inside
  // Telegram (button taps), not through an HTTP request from the admin's
  // browser — this forwards those changes onto the normal SSE broadcast so
  // the admin dashboard still updates live without a page refresh.
  deliveryEvents.on('orderUpdated', (restaurantId: string, order: Order) => {
    broadcastStaff(restaurantId, 'ORDER_UPDATED', { order });
    broadcastOrder(restaurantId, order.id, 'ORDER_UPDATED', { order });
  });

  // Same idea for reservations: a guest booking or cancelling, or the admin
  // tapping Confirm/Decline on the Telegram notification, all happen outside
  // the browser. This is the only path those changes have onto the dashboard.
  reservationEvents.on('reservationChanged', (restaurantId: string, reservation: unknown) => {
    broadcastStaff(restaurantId, 'RESERVATION_UPDATED', reservation);
  });
}

startServer().catch(err => {
  logger.error(err, 'Fatal startup error');
  process.exit(1);
});
