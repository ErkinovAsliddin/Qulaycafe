import { EventEmitter } from 'events';
import {
  createReservation,
  getReservation,
  updateReservation,
  listReservationsForChat,
  findReservationForChat,
  countReservationsByChatSince,
  getLastBookedRestaurantIdByChat,
  listRestaurantsByAdminChatId,
  getRestaurantById,
  reservationsEnabled,
  isSubscriptionUsable,
  type Reservation,
  type RestaurantRow
} from './db';
import {
  sendTelegramMessage,
  editTelegramMessage,
  answerTelegramCallback,
  telegramConfigured,
  type TelegramButton
} from './telegram';
import { reservationCreateSchema } from './validation';

// ---------------------------------------------------------------------------
// Table reservations, driven from the customer Telegram bot. A guest opens the
// restaurant's booking deep link (…?start=book_<slug>), answers five
// questions, and the restaurant's admin gets the request with Confirm /
// Decline buttons.
//
// The public web form (POST /api/reservations) is the second entry point and
// deliberately reuses this module rather than reimplementing it: the same
// booking-window rules (checkReservationWindow), the same admin notification
// (notifyAdminOfReservation), and the same guest notification once a web guest
// attaches Telegram (notifyGuestOfReservationUpdate).
//
// Two hard rules everything below follows:
//   1. A restaurant only takes bookings while the platform owner has the
//      feature switched on for it (restaurants.reservation_status = 'active')
//      AND its subscription is usable.
//   2. Every action is scoped to one restaurant_id. A guest can only touch
//      their own booking (matched on their Telegram chat id) and an admin can
//      only touch bookings of a restaurant whose linked admin chat is theirs.
// ---------------------------------------------------------------------------

// Emits 'reservationChanged' with (restaurantId, reservation) whenever a
// booking is created or its status changes from the bot side. server.ts
// listens once at startup and forwards it onto the existing SSE broadcast, so
// the admin dashboard updates live without this module knowing about SSE.
export const reservationEvents = new EventEmitter();

const SESSION_TTL_MS = 15 * 60_000;
const MAX_SESSIONS = 5000; // hard memory cap; oldest are evicted first
const BOOKING_HORIZON_DAYS = 60;
const MAX_BOOKINGS_PER_CHAT_PER_DAY = 5;
const FLOOD_WINDOW_MS = 60_000;
const MAX_MESSAGES_PER_WINDOW = 25;

// Restaurant-local clock. Uzbekistan is UTC+5 and has no DST, so a fixed
// offset is honest here — it stops "today at 21:00" being rejected as past
// just because the server happens to run in UTC.
const LOCAL_UTC_OFFSET_HOURS = Number(process.env.RESERVATION_UTC_OFFSET_HOURS ?? 5);

function localNow(): Date {
  return new Date(Date.now() + LOCAL_UTC_OFFSET_HOURS * 3600_000);
}

/** YYYY-MM-DD in restaurant-local time, `daysAhead` days from today. */
function localDateIso(daysAhead = 0): string {
  const d = localNow();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function localMinutesOfDay(): number {
  const d = localNow();
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function minutesFromHhMm(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}

// Every guest-supplied string is escaped before it goes anywhere near a
// parse_mode: 'HTML' message — a name of "<b>x" must never become markup, and
// must never be able to break the admin's notification apart.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const WEEKDAYS_UZ = ['Yak', 'Du', 'Se', 'Cho', 'Pay', 'Ju', 'Sha'];

function fmtDateLabel(iso: string): string {
  const [, month, day] = iso.split('-');
  const today = localDateIso();
  if (iso === today) return `${day}.${month} (Bugun)`;
  if (iso === localDateIso(1)) return `${day}.${month} (Ertaga)`;
  const weekday = WEEKDAYS_UZ[new Date(`${iso}T12:00:00Z`).getUTCDay()];
  return `${day}.${month} (${weekday})`;
}

const TIME_SLOTS = [
  '10:00', '11:00', '12:00', '13:00',
  '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00'
];

// ---------------------------------------------------------------------------
// Conversation state. In-memory on purpose: a half-finished booking is worth
// nothing after a restart, and keeping it out of SQLite means a flood of
// abandoned conversations can never grow the database file.
// ---------------------------------------------------------------------------
type BookingStep = 'date' | 'time' | 'party' | 'name' | 'phone' | 'confirm';

interface BookingSession {
  restaurantId: string;
  step: BookingStep;
  reservedDate?: string;
  reservedTime?: string;
  partySize?: number;
  guestName?: string;
  guestPhone?: string;
  note?: string;
  updatedAt: number;
}

const sessions = new Map<string, BookingSession>();
const floodCounters = new Map<string, { count: number; windowStart: number }>();

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [chatId, session] of sessions) {
    if (session.updatedAt < cutoff) sessions.delete(chatId);
  }
  // Still over the cap after pruning (i.e. a flood of live conversations):
  // drop the least recently touched ones rather than grow without bound.
  if (sessions.size > MAX_SESSIONS) {
    const oldestFirst = [...sessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [chatId] of oldestFirst.slice(0, sessions.size - MAX_SESSIONS)) sessions.delete(chatId);
  }
}

function getSession(chatId: string): BookingSession | undefined {
  const session = sessions.get(chatId);
  if (!session) return undefined;
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(chatId);
    return undefined;
  }
  return session;
}

function saveSession(chatId: string, session: BookingSession) {
  session.updatedAt = Date.now();
  sessions.set(chatId, session);
  if (sessions.size > MAX_SESSIONS) pruneSessions();
}

/** Cheap per-chat sliding window, so one account can't hammer the webhook. */
function isFlooding(chatId: string): boolean {
  const now = Date.now();
  const entry = floodCounters.get(chatId);
  if (!entry || now - entry.windowStart > FLOOD_WINDOW_MS) {
    floodCounters.set(chatId, { count: 1, windowStart: now });
    if (floodCounters.size > MAX_SESSIONS) {
      for (const [key, value] of floodCounters) {
        if (now - value.windowStart > FLOOD_WINDOW_MS) floodCounters.delete(key);
      }
    }
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_MESSAGES_PER_WINDOW;
}

// ---------------------------------------------------------------------------
// Prompts — one per step of the conversation.
// ---------------------------------------------------------------------------
function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

const ABORT_BUTTON: TelegramButton = { text: '❌ Bekor qilish', callback_data: 'rabort' };

async function promptDate(chatId: string) {
  const dates = Array.from({ length: 7 }, (_, i) => localDateIso(i));
  const rows = chunk(
    dates.map<TelegramButton>(iso => ({ text: fmtDateLabel(iso), callback_data: `rdate:${iso}` })),
    2
  );
  rows.push([ABORT_BUTTON]);
  await sendTelegramMessage(
    chatId,
    "📅 <b>Qaysi kunga bron qilamiz?</b>\n\nTugmadan tanlang yoki sanani yozing (masalan: 2026-08-20).",
    undefined,
    { parseMode: 'HTML', rows }
  );
}

async function promptTime(chatId: string, reservedDate: string) {
  // On today's date, slots that have already passed are pointless — and the
  // validator would reject them anyway, so don't offer them at all.
  const isToday = reservedDate === localDateIso();
  const nowMinutes = localMinutesOfDay();
  const slots = TIME_SLOTS.filter(slot => !isToday || minutesFromHhMm(slot) > nowMinutes);
  const rows = chunk(
    slots.map<TelegramButton>(slot => ({ text: slot, callback_data: `rtime:${slot}` })),
    4
  );
  rows.push([ABORT_BUTTON]);
  const hint = slots.length
    ? 'Tugmadan tanlang yoki vaqtni yozing (masalan: 19:30).'
    : "Bugun uchun tayyor vaqt qolmadi — vaqtni o'zingiz yozing (masalan: 22:30) yoki boshqa kunni tanlang.";
  await sendTelegramMessage(chatId, `🕒 <b>Soat nechchiga?</b>\n\n${hint}`, undefined, {
    parseMode: 'HTML',
    rows
  });
}

async function promptParty(chatId: string) {
  const rows = chunk(
    [1, 2, 3, 4, 5, 6, 8, 10].map<TelegramButton>(n => ({ text: String(n), callback_data: `rparty:${n}` })),
    4
  );
  rows.push([ABORT_BUTTON]);
  await sendTelegramMessage(
    chatId,
    '👥 <b>Nechchi kishi bo\'lasiz?</b>\n\nTugmadan tanlang yoki sonini yozing.',
    undefined,
    { parseMode: 'HTML', rows }
  );
}

async function promptName(chatId: string, suggestedName?: string) {
  const rows: TelegramButton[][] = [];
  if (suggestedName) {
    rows.push([{ text: `✅ ${suggestedName.slice(0, 40)}`, callback_data: 'rname:tg' }]);
  }
  rows.push([ABORT_BUTTON]);
  await sendTelegramMessage(chatId, "🙋 <b>Ismingiz?</b>\n\nBron kimning nomiga yozilsin?", undefined, {
    parseMode: 'HTML',
    rows
  });
}

async function promptPhone(chatId: string) {
  await sendTelegramMessage(
    chatId,
    "📞 <b>Telefon raqamingiz?</b>\n\nMasalan: +998901234567 — restoran kerak bo'lsa shu raqamga qo'ng'iroq qiladi.",
    undefined,
    { parseMode: 'HTML', rows: [[ABORT_BUTTON]] }
  );
}

function fmtSessionSummary(session: BookingSession, restaurantName: string): string {
  return [
    `🍽 <b>${escapeHtml(restaurantName)}</b>`,
    `📅 Sana: <b>${session.reservedDate}</b>`,
    `🕒 Vaqt: <b>${session.reservedTime}</b>`,
    `👥 Kishi: <b>${session.partySize}</b>`,
    `🙋 Ism: <b>${escapeHtml(session.guestName || '')}</b>`,
    `📞 Telefon: <b>${escapeHtml(session.guestPhone || '')}</b>`
  ].join('\n');
}

async function promptConfirm(chatId: string, session: BookingSession, restaurantName: string) {
  await sendTelegramMessage(
    chatId,
    `✅ <b>Bronni tasdiqlaysizmi?</b>\n\n${fmtSessionSummary(session, restaurantName)}`,
    undefined,
    {
      parseMode: 'HTML',
      rows: [[{ text: '✅ Tasdiqlash', callback_data: 'rconfirm' }, ABORT_BUTTON]]
    }
  );
}

// ---------------------------------------------------------------------------
// Gate: is this restaurant taking bookings at all right now?
// ---------------------------------------------------------------------------
type BookingGate =
  | { status: 'ok'; restaurant: RestaurantRow }
  | { status: 'unavailable'; message: string };

function checkBookingGate(restaurantId: string): BookingGate {
  const restaurant = getRestaurantById(restaurantId);
  if (!restaurant) return { status: 'unavailable', message: 'Restoran topilmadi.' };
  if (!reservationsEnabled(restaurantId)) {
    return { status: 'unavailable', message: 'Bu restoran hozircha stol broni qabul qilmaydi.' };
  }
  if (!isSubscriptionUsable(restaurantId)) {
    return { status: 'unavailable', message: 'Bu restoran hozircha faol emas. Iltimos, keyinroq urinib ko\'ring.' };
  }
  return { status: 'ok', restaurant };
}

/**
 * Entry point for the booking conversation. Called from the customer bot's
 * /start handler when the deep-link payload is `book_<slug>`, and from /book.
 */
export async function startReservationFlow(
  chatId: string,
  restaurantId: string,
  from?: { first_name?: string; username?: string }
): Promise<void> {
  const gate = checkBookingGate(restaurantId);
  if (gate.status === 'unavailable') {
    await sendTelegramMessage(chatId, `⚠️ ${gate.message}`);
    return;
  }
  const recent = countReservationsByChatSince(chatId, new Date(Date.now() - 24 * 3600_000).toISOString());
  if (recent >= MAX_BOOKINGS_PER_CHAT_PER_DAY) {
    await sendTelegramMessage(
      chatId,
      "⚠️ Siz bugun juda ko'p bron qildingiz. Ertaga qaytadan urinib ko'ring yoki restoranga qo'ng'iroq qiling."
    );
    return;
  }
  saveSession(chatId, { restaurantId, step: 'date', updatedAt: Date.now() });
  await sendTelegramMessage(
    chatId,
    `🍽 <b>${escapeHtml(gate.restaurant.name)}</b> — stol broni.\n\nBir necha savolga javob bering, so'ng restoran tasdiqlaydi.`,
    undefined,
    { parseMode: 'HTML' }
  );
  void from; // the guest's Telegram name is only offered at the name step
  await promptDate(chatId);
}

// ---------------------------------------------------------------------------
// Step handlers. Buttons and typed answers funnel through exactly the same
// code, so a typed "19:30" is validated identically to a tapped slot.
// ---------------------------------------------------------------------------
type StepResult = { status: 'ok' } | { status: 'error'; message: string };

function telegramDisplayName(from?: { first_name?: string; username?: string }): string | undefined {
  // Button labels are plain text (never parsed as HTML), so this is only
  // stripped of line breaks — escaping here would show literal &amp; to the
  // guest. Escaping happens where the name goes into an HTML message body.
  const name = (from?.first_name || from?.username || '').replace(/\s+/g, ' ').trim();
  return name ? name : undefined;
}

/** Accepts 2026-08-20, 20.08, 20.08.2026 and 20/08 — all common ways to type a date here. */
function normalizeDate(raw: string): string | null {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dotted = value.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/);
  if (!dotted) return null;
  const day = Number(dotted[1]);
  const month = Number(dotted[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let year = dotted[3] ? Number(dotted[3]) : Number(localDateIso().slice(0, 4));
  const pad = (n: number) => String(n).padStart(2, '0');
  let iso = `${year}-${pad(month)}-${pad(day)}`;
  // A bare "20.01" typed in December means next January, not last one.
  if (!dotted[3] && iso < localDateIso()) {
    year += 1;
    iso = `${year}-${pad(month)}-${pad(day)}`;
  }
  return iso;
}

/** Accepts 19:30, 9:30, 19.30 and 1930. */
function normalizeTime(raw: string): string | null {
  const value = raw.trim();
  const match = value.match(/^(\d{1,2})[:.\s]?(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function isRealDate(iso: string): boolean {
  const parsed = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}

// ---------------------------------------------------------------------------
// Shared with the public web form. The rules about WHEN a table can be booked
// live here, in the module that owns the restaurant-local clock, so the web
// route can never drift from the bot: same UTC offset, same 60-day horizon,
// same "that time already passed today" rule.
// ---------------------------------------------------------------------------
export const RESERVATION_HORIZON_DAYS = BOOKING_HORIZON_DAYS;

/** Today's date (YYYY-MM-DD) in restaurant-local time. */
export function reservationToday(): string {
  return localDateIso();
}

/**
 * Is this date/time still bookable? Assumes the values already passed the
 * shared zod field schemas (shape), and checks only the clock: not in the
 * past, a real calendar date, and inside the booking horizon.
 *
 * Returns the reason as a string, or null when the slot is fine — a plain
 * nullable rather than a tagged union because this project compiles without
 * strictNullChecks, where narrowing on a boolean discriminant does not hold.
 */
export function checkReservationWindow(reservedDate: string, reservedTime: string): string | null {
  if (!isRealDate(reservedDate)) {
    return "Sana noto'g'ri.";
  }
  const today = localDateIso();
  if (reservedDate < today) {
    return "O'tgan kunga bron qilib bo'lmaydi.";
  }
  if (reservedDate > localDateIso(BOOKING_HORIZON_DAYS)) {
    return `Faqat ${BOOKING_HORIZON_DAYS} kun ichida bron qilish mumkin.`;
  }
  if (reservedDate === today && minutesFromHhMm(reservedTime) <= localMinutesOfDay()) {
    return "Bu vaqt allaqachon o'tib ketdi. Boshqa vaqt tanlang.";
  }
  return null;
}

async function applyDate(chatId: string, session: BookingSession, raw: string): Promise<StepResult> {
  const iso = normalizeDate(raw);
  if (!iso || !isRealDate(iso)) {
    return { status: 'error', message: "Sanani tushunmadim. Masalan: 2026-08-20 yoki 20.08" };
  }
  const today = localDateIso();
  if (iso < today) return { status: 'error', message: "O'tgan kunga bron qilib bo'lmaydi." };
  if (iso > localDateIso(BOOKING_HORIZON_DAYS)) {
    return { status: 'error', message: `Faqat ${BOOKING_HORIZON_DAYS} kun ichida bron qilish mumkin.` };
  }
  session.reservedDate = iso;
  session.step = 'time';
  saveSession(chatId, session);
  await promptTime(chatId, iso);
  return { status: 'ok' };
}

async function applyTime(chatId: string, session: BookingSession, raw: string): Promise<StepResult> {
  const time = normalizeTime(raw);
  if (!time) return { status: 'error', message: 'Vaqtni tushunmadim. Masalan: 19:30' };
  if (session.reservedDate === localDateIso() && minutesFromHhMm(time) <= localMinutesOfDay()) {
    return { status: 'error', message: "Bu vaqt allaqachon o'tib ketdi. Boshqa vaqt yozing." };
  }
  session.reservedTime = time;
  session.step = 'party';
  saveSession(chatId, session);
  await promptParty(chatId);
  return { status: 'ok' };
}

async function applyParty(
  chatId: string,
  session: BookingSession,
  raw: string,
  from?: { first_name?: string; username?: string }
): Promise<StepResult> {
  const size = Number(String(raw).trim().replace(/[^0-9]/g, ''));
  if (!Number.isInteger(size) || size < 1 || size > 50) {
    return { status: 'error', message: "Nechchi kishi? 1 dan 50 gacha son yozing." };
  }
  session.partySize = size;
  session.step = 'name';
  saveSession(chatId, session);
  await promptName(chatId, telegramDisplayName(from));
  return { status: 'ok' };
}

async function applyName(chatId: string, session: BookingSession, raw: string): Promise<StepResult> {
  const name = raw.trim().slice(0, 80);
  if (name.length < 2) return { status: 'error', message: 'Ismingizni yozing (kamida 2 harf).' };
  session.guestName = name;
  session.step = 'phone';
  saveSession(chatId, session);
  await promptPhone(chatId);
  return { status: 'ok' };
}

async function applyPhone(chatId: string, session: BookingSession, raw: string): Promise<StepResult> {
  const phone = raw.trim().replace(/[\s()-]/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(phone)) {
    return { status: 'error', message: "Telefon raqamni to'g'ri yozing. Masalan: +998901234567" };
  }
  session.guestPhone = phone;
  session.step = 'confirm';
  saveSession(chatId, session);
  const restaurant = getRestaurantById(session.restaurantId);
  await promptConfirm(chatId, session, restaurant?.name || 'Restoran');
  return { status: 'ok' };
}

// ---------------------------------------------------------------------------
// Creating the booking and telling the restaurant about it.
// ---------------------------------------------------------------------------
const ADMIN_STATUS_TEXT: Record<string, string> = {
  confirmed: 'Tasdiqlangan',
  declined: 'Rad etilgan',
  cancelled: 'Bekor qilingan',
  seated: 'Keldi',
  no_show: 'Kelmadi'
};

/**
 * Short human reference for a booking, shown to a web guest and repeated in
 * the restaurant's notification so a phone call ("I'm booking A7F2") matches a
 * row without anyone reading out a full internal id.
 */
export function reservationCode(reservationId: string): string {
  return reservationId.slice(-4).toUpperCase();
}

export function fmtReservationForAdmin(reservation: Reservation): string {
  const lines = [
    // The same formatter redraws a message after a decision, so the heading
    // has to stop claiming "new" once the booking has been acted on.
    reservation.status === 'pending' ? '📅 <b>Yangi stol broni</b>' : '📅 <b>Stol broni</b>',
    '',
    `🗓 ${reservation.reservedDate} — ${reservation.reservedTime}`,
    `👥 ${reservation.partySize} kishi`,
    `🙋 ${escapeHtml(reservation.guestName)}`,
    `📞 ${escapeHtml(reservation.guestPhone)}`
  ];
  if (reservation.tableNumber) lines.push(`🪑 Stol: ${reservation.tableNumber}`);
  if (reservation.telegramUsername) lines.push(`💬 @${escapeHtml(reservation.telegramUsername)}`);
  if (reservation.note) lines.push(`📝 ${escapeHtml(reservation.note)}`);
  // A web guest may have no Telegram at all, so the restaurant needs to know
  // that calling the phone number is the only way to reach them — and needs the
  // same code the guest is looking at on their screen.
  if (reservation.source === 'web') {
    lines.push(`🌐 Veb orqali · kod: ${reservationCode(reservation.id)}`);
  }
  if (ADMIN_STATUS_TEXT[reservation.status]) {
    lines.push(`ℹ️ Holat: ${ADMIN_STATUS_TEXT[reservation.status]}`);
  }
  return lines.join('\n');
}

/** Sends the request to the restaurant's linked admin chat with decision buttons. */
export async function notifyAdminOfReservation(restaurantId: string, reservation: Reservation) {
  if (!telegramConfigured) return;
  const restaurant = getRestaurantById(restaurantId);
  if (!restaurant?.admin_telegram_chat_id) return;
  await sendTelegramMessage(restaurant.admin_telegram_chat_id, fmtReservationForAdmin(reservation), undefined, {
    parseMode: 'HTML',
    rows: [
      [
        { text: '✅ Tasdiqlash', callback_data: `resv:confirm:${reservation.id}` },
        { text: '❌ Rad etish', callback_data: `resv:decline:${reservation.id}` }
      ]
    ]
  });
}

async function finalizeBooking(chatId: string, session: BookingSession, from: any): Promise<void> {
  const gate = checkBookingGate(session.restaurantId);
  if (gate.status === 'unavailable') {
    sessions.delete(chatId);
    await sendTelegramMessage(chatId, `⚠️ ${gate.message}`);
    return;
  }
  // Re-check the daily cap at the finish line too, not just at the start —
  // otherwise five parallel conversations could each pass the opening check.
  const recent = countReservationsByChatSince(chatId, new Date(Date.now() - 24 * 3600_000).toISOString());
  if (recent >= MAX_BOOKINGS_PER_CHAT_PER_DAY) {
    sessions.delete(chatId);
    await sendTelegramMessage(chatId, "⚠️ Siz bugun juda ko'p bron qildingiz. Ertaga urinib ko'ring.");
    return;
  }

  // The very same schema the admin HTTP routes use — the bot gets no shortcut.
  const parsed = reservationCreateSchema.safeParse({
    reservedDate: session.reservedDate,
    reservedTime: session.reservedTime,
    partySize: session.partySize,
    guestName: session.guestName,
    guestPhone: session.guestPhone,
    note: session.note
  });
  if (!parsed.success) {
    sessions.delete(chatId);
    await sendTelegramMessage(chatId, "⚠️ Ma'lumotlarda xatolik bor. /book bilan qaytadan boshlang.");
    return;
  }

  // Fields are re-stated one by one instead of spread: this project compiles
  // without strictNullChecks, and Zod's inferred type marks every key optional
  // in that mode, so a spread wouldn't satisfy createReservation's signature.
  const data = parsed.data;
  const reservation = createReservation(session.restaurantId, {
    reservedDate: String(data.reservedDate),
    reservedTime: String(data.reservedTime),
    partySize: Number(data.partySize),
    guestName: String(data.guestName),
    guestPhone: String(data.guestPhone),
    note: data.note ? String(data.note) : null,
    source: 'bot',
    telegramChatId: chatId,
    telegramUsername: from?.username || null
  });
  sessions.delete(chatId);

  await sendTelegramMessage(
    chatId,
    `✅ <b>Bron so'rovi yuborildi!</b>\n\n${fmtSessionSummary(
      { ...session, step: 'confirm' },
      gate.restaurant.name
    )}\n\nRestoran tasdiqlagach shu yerga xabar keladi.\nBekor qilish uchun: /mybookings`,
    undefined,
    { parseMode: 'HTML' }
  );

  await notifyAdminOfReservation(session.restaurantId, reservation);
  reservationEvents.emit('reservationChanged', session.restaurantId, reservation);
}

// ---------------------------------------------------------------------------
// Telling the guest what the restaurant decided. Exported because the admin
// can also decide from the dashboard, not just from the Telegram buttons.
// ---------------------------------------------------------------------------
const GUEST_STATUS_TEXT: Record<string, string> = {
  confirmed: "✅ <b>Broningiz tasdiqlandi!</b>",
  declined: "❌ <b>Afsuski, bron rad etildi.</b>",
  cancelled: "🚫 <b>Bron bekor qilindi.</b>",
  no_show: "⚠️ <b>Bron bo'yicha kelmagan deb belgilandi.</b>",
  seated: "🍽 <b>Xush kelibsiz! Stolingiz tayyor.</b>"
};

export async function notifyGuestOfReservationUpdate(restaurantId: string, reservation: Reservation) {
  if (!telegramConfigured || !reservation.telegramChatId) return;
  const headline = GUEST_STATUS_TEXT[reservation.status];
  if (!headline) return;
  const restaurant = getRestaurantById(restaurantId);
  const lines = [
    headline,
    '',
    `🍽 ${escapeHtml(restaurant?.name || 'Restoran')}`,
    `🗓 ${reservation.reservedDate} — ${reservation.reservedTime}`,
    `👥 ${reservation.partySize} kishi`
  ];
  if (reservation.status === 'confirmed' && reservation.tableNumber) {
    lines.push(`🪑 Stol: ${reservation.tableNumber}`);
  }
  if (reservation.status === 'confirmed') {
    lines.push('', 'Bekor qilish kerak bo\'lsa: /mybookings');
  }
  await sendTelegramMessage(reservation.telegramChatId, lines.join('\n'), undefined, { parseMode: 'HTML' });
}

// ---------------------------------------------------------------------------
// Incoming updates.
// ---------------------------------------------------------------------------
const BOOKABLE_STATUSES_FOR_GUEST_CANCEL: Reservation['status'][] = ['pending', 'confirmed'];

async function sendMyBookings(chatId: string) {
  const all = listReservationsForChat(chatId, 20);
  const today = localDateIso();
  const upcoming = all.filter(r => r.reservedDate >= today && BOOKABLE_STATUSES_FOR_GUEST_CANCEL.includes(r.status));
  if (upcoming.length === 0) {
    await sendTelegramMessage(chatId, "Sizda faol bron yo'q. Yangi bron uchun: /book");
    return;
  }
  for (const reservation of upcoming) {
    const statusLabel = reservation.status === 'confirmed' ? '✅ tasdiqlangan' : '🕒 kutilmoqda';
    await sendTelegramMessage(
      chatId,
      `🍽 <b>${escapeHtml(reservation.restaurantName)}</b>\n🗓 ${reservation.reservedDate} — ${
        reservation.reservedTime
      }\n👥 ${reservation.partySize} kishi\n📌 ${statusLabel}`,
      [{ text: '🚫 Bronni bekor qilish', callback_data: `rgcancel:${reservation.id}` }],
      { parseMode: 'HTML' }
    );
  }
}

/**
 * Returns true when this message belonged to the reservation flow and has been
 * fully handled, so the caller should not process it any further.
 */
export async function handleReservationMessage(message: any): Promise<boolean> {
  const from = message?.from;
  const text: string | undefined = message?.text;
  if (!from || typeof text !== 'string') return false;
  const chatId = String(message.chat?.id ?? from.id);

  if (isFlooding(chatId)) return true; // drop silently — no reply to amplify

  const command = text.trim().split(/\s+/)[0].toLowerCase();

  if (command === '/book' || command === '/bron') {
    const restaurantId = getLastBookedRestaurantIdByChat(chatId);
    if (!restaurantId) {
      await sendTelegramMessage(
        chatId,
        "Stol bron qilish uchun restoranning bron havolasini oching (restoran menyusidagi yoki administratordan olingan havola)."
      );
      return true;
    }
    await startReservationFlow(chatId, restaurantId, from);
    return true;
  }

  if (command === '/mybookings' || command === '/bronlarim') {
    await sendMyBookings(chatId);
    return true;
  }

  const session = getSession(chatId);
  if (!session) return false;

  // A command mid-conversation is never an answer — let /start and friends
  // reach their own handlers instead of being stored as someone's name.
  if (text.startsWith('/')) {
    if (command === '/cancel' || command === '/stop') {
      sessions.delete(chatId);
      await sendTelegramMessage(chatId, 'Bron bekor qilindi. Qaytadan boshlash uchun: /book');
      return true;
    }
    return false;
  }

  const answer = text.trim().slice(0, 200);
  let result: StepResult;
  if (session.step === 'date') result = await applyDate(chatId, session, answer);
  else if (session.step === 'time') result = await applyTime(chatId, session, answer);
  else if (session.step === 'party') result = await applyParty(chatId, session, answer, from);
  else if (session.step === 'name') result = await applyName(chatId, session, answer);
  else if (session.step === 'phone') result = await applyPhone(chatId, session, answer);
  else {
    await sendTelegramMessage(chatId, "Tasdiqlash uchun yuqoridagi tugmani bosing yoki /cancel yozing.");
    return true;
  }

  if (result.status === 'error') {
    await sendTelegramMessage(chatId, `⚠️ ${result.message}`);
  }
  return true;
}

/**
 * Inline-button taps. Returns true when the tap belonged to the reservation
 * feature. Every branch answers the callback (Telegram spins forever
 * otherwise) and every branch re-authorizes from scratch: the guest branches
 * only ever resolve bookings made from THIS chat, and the admin branches only
 * bookings of a restaurant whose linked admin chat is THIS chat.
 */
export async function handleReservationCallback(callback: any): Promise<boolean> {
  const data: string | undefined = callback?.data;
  const from = callback?.from;
  if (!data || !from) return false;
  const chatId = String(callback.message?.chat?.id ?? from.id);
  const messageId: number | undefined = callback.message?.message_id;

  // --- restaurant admin decides on a booking ---
  if (data.startsWith('resv:')) {
    const [, action, reservationId] = data.split(':');
    if ((action !== 'confirm' && action !== 'decline') || !reservationId) {
      await answerTelegramCallback(callback.id);
      return true;
    }
    const restaurants = listRestaurantsByAdminChatId(String(from.id));
    let ownerRestaurant: RestaurantRow | undefined;
    let reservation: Reservation | undefined;
    for (const restaurant of restaurants) {
      const found = getReservation(restaurant.id, reservationId);
      if (found) {
        ownerRestaurant = restaurant;
        reservation = found;
        break;
      }
    }
    if (!ownerRestaurant || !reservation) {
      await answerTelegramCallback(callback.id, "Bu bron sizga tegishli emas yoki o'chirilgan.");
      return true;
    }
    if (reservation.status !== 'pending') {
      await answerTelegramCallback(callback.id, `Bu bron allaqachon ko'rib chiqilgan (${reservation.status}).`);
      if (messageId) {
        await editTelegramMessage(chatId, messageId, fmtReservationForAdmin(reservation), undefined, {
          parseMode: 'HTML'
        });
      }
      return true;
    }

    const nextStatus = action === 'confirm' ? 'confirmed' : 'declined';
    const updated = updateReservation(ownerRestaurant.id, reservationId, { status: nextStatus });
    if (updated.status !== 'ok') {
      await answerTelegramCallback(callback.id, 'Bronni yangilab bo\'lmadi.');
      return true;
    }
    await answerTelegramCallback(callback.id);
    if (messageId) {
      const banner = nextStatus === 'confirmed' ? '✅ <b>Tasdiqlandi</b>' : '❌ <b>Rad etildi</b>';
      await editTelegramMessage(
        chatId,
        messageId,
        `${banner}\n\n${fmtReservationForAdmin(updated.reservation)}`,
        undefined,
        { parseMode: 'HTML' }
      );
    }
    await notifyGuestOfReservationUpdate(ownerRestaurant.id, updated.reservation);
    reservationEvents.emit('reservationChanged', ownerRestaurant.id, updated.reservation);
    return true;
  }

  // --- guest cancels their own booking ---
  if (data.startsWith('rgcancel:')) {
    const reservationId = data.slice('rgcancel:'.length);
    const found = findReservationForChat(chatId, reservationId);
    if (!found) {
      await answerTelegramCallback(callback.id, 'Bron topilmadi.');
      return true;
    }
    if (!BOOKABLE_STATUSES_FOR_GUEST_CANCEL.includes(found.status)) {
      await answerTelegramCallback(callback.id, "Bu bronni bekor qilib bo'lmaydi.");
      return true;
    }
    const updated = updateReservation(found.restaurantId, reservationId, { status: 'cancelled' });
    if (updated.status !== 'ok') {
      await answerTelegramCallback(callback.id, "Bekor qilib bo'lmadi.");
      return true;
    }
    await answerTelegramCallback(callback.id, 'Bron bekor qilindi.');
    if (messageId) {
      await editTelegramMessage(chatId, messageId, '🚫 <b>Bron bekor qilindi.</b>', undefined, { parseMode: 'HTML' });
    }
    await notifyAdminOfGuestCancellation(found.restaurantId, updated.reservation);
    reservationEvents.emit('reservationChanged', found.restaurantId, updated.reservation);
    return true;
  }

  // --- guest is answering a step of the booking conversation ---
  if (!/^(rdate:|rtime:|rparty:|rname:|rconfirm$|rabort$)/.test(data)) return false;

  if (isFlooding(chatId)) {
    await answerTelegramCallback(callback.id);
    return true;
  }

  if (data === 'rabort') {
    sessions.delete(chatId);
    await answerTelegramCallback(callback.id, 'Bekor qilindi.');
    if (messageId) {
      await editTelegramMessage(chatId, messageId, 'Bron bekor qilindi. Qaytadan boshlash: /book');
    }
    return true;
  }

  const session = getSession(chatId);
  if (!session) {
    await answerTelegramCallback(callback.id, "Bu so'rovning muddati tugagan. /book bilan qaytadan boshlang.");
    return true;
  }

  let result: StepResult = { status: 'ok' };
  if (data.startsWith('rdate:') && session.step === 'date') {
    result = await applyDate(chatId, session, data.slice('rdate:'.length));
  } else if (data.startsWith('rtime:') && session.step === 'time') {
    result = await applyTime(chatId, session, data.slice('rtime:'.length));
  } else if (data.startsWith('rparty:') && session.step === 'party') {
    result = await applyParty(chatId, session, data.slice('rparty:'.length), from);
  } else if (data === 'rname:tg' && session.step === 'name') {
    result = await applyName(chatId, session, telegramDisplayName(from) || '');
  } else if (data === 'rconfirm' && session.step === 'confirm') {
    await answerTelegramCallback(callback.id);
    await finalizeBooking(chatId, session, from);
    return true;
  } else {
    // A tap on an older keyboard than the step we're on — tell them where
    // they actually are instead of silently corrupting the session.
    await answerTelegramCallback(callback.id, "Bu tugma eskirgan — oxirgi savolga javob bering.");
    return true;
  }

  await answerTelegramCallback(callback.id);
  if (result.status === 'error') {
    await sendTelegramMessage(chatId, `⚠️ ${result.message}`);
  }
  return true;
}

/**
 * Tells the restaurant that a guest cancelled their own booking. Exported
 * because a web guest can cancel from the booking status page too, not only
 * from the bot's /mybookings buttons.
 */
export async function notifyAdminOfGuestCancellation(restaurantId: string, reservation: Reservation) {
  if (!telegramConfigured) return;
  const restaurant = getRestaurantById(restaurantId);
  if (!restaurant?.admin_telegram_chat_id) return;
  await sendTelegramMessage(
    restaurant.admin_telegram_chat_id,
    `🚫 <b>Mijoz bronni bekor qildi</b>\n\n🗓 ${reservation.reservedDate} — ${reservation.reservedTime}\n👥 ${
      reservation.partySize
    } kishi\n🙋 ${escapeHtml(reservation.guestName)}`,
    undefined,
    { parseMode: 'HTML' }
  );
}
