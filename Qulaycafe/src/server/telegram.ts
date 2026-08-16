import { db } from './db';
import crypto from 'crypto';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';
const TOKEN_TTL_MINUTES = 5;

export const telegramConfigured = !!(BOT_TOKEN && BOT_USERNAME);

export function createVerificationToken(
  opts: { purpose?: 'customer' | 'admin_notify' | 'courier_link'; restaurantId?: string } = {}
): { token: string; deepLink: string } {
  const token = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60_000);
  db.prepare(
    `INSERT INTO telegram_verifications (token, status, created_at, expires_at, purpose, restaurant_id) VALUES (?, 'pending', ?, ?, ?, ?)`
  ).run(token, now.toISOString(), expiresAt.toISOString(), opts.purpose || 'customer', opts.restaurantId || null);
  return { token, deepLink: `https://t.me/${BOT_USERNAME}?start=${token}` };
}

export function getVerificationStatus(token: string) {
  const row = db
    .prepare(
      `SELECT status, telegram_user_id, telegram_username, telegram_first_name, expires_at, purpose, restaurant_id FROM telegram_verifications WHERE token = ?`
    )
    .get(token) as
    | {
        status: string;
        telegram_user_id: string | null;
        telegram_username: string | null;
        telegram_first_name: string | null;
        expires_at: string;
        purpose: string;
        restaurant_id: string | null;
      }
    | undefined;

  if (!row) return { status: 'not_found' as const };
  if (row.status === 'pending' && new Date(row.expires_at).getTime() < Date.now()) {
    return { status: 'expired' as const };
  }
  return {
    status: row.status as 'pending' | 'verified',
    telegramUserId: row.telegram_user_id || undefined,
    telegramUsername: row.telegram_username || undefined,
    telegramFirstName: row.telegram_first_name || undefined,
    purpose: (row.purpose || 'customer') as 'customer' | 'admin_notify' | 'courier_link',
    restaurantId: row.restaurant_id || undefined
  };
}

export function markVerified(
  token: string,
  user: { id: number; username?: string; first_name?: string }
): { ok: boolean; purpose?: 'customer' | 'admin_notify' | 'courier_link'; restaurantId?: string } {
  const row = db
    .prepare(`SELECT status, expires_at, purpose, restaurant_id FROM telegram_verifications WHERE token = ?`)
    .get(token) as { status: string; expires_at: string; purpose: string; restaurant_id: string | null } | undefined;
  if (!row || row.status !== 'pending') return { ok: false };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false };

  db.prepare(
    `UPDATE telegram_verifications SET status = 'verified', telegram_user_id = ?, telegram_username = ?, telegram_first_name = ? WHERE token = ?`
  ).run(String(user.id), user.username || '', user.first_name || '', token);
  return {
    ok: true,
    purpose: (row.purpose || 'customer') as 'customer' | 'admin_notify' | 'courier_link',
    restaurantId: row.restaurant_id || undefined
  };
}

// ---------------------------------------------------------------------------
// Telegram Mini App support: when a customer opens the ordering page as a
// Mini App from inside Telegram (via a bot's web_app button), the page is
// handed a signed `initData` string containing their verified Telegram
// identity. This validates that signature using Telegram's official
// algorithm (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
// so a Mini App launch can count as a legitimate identity-verification path,
// same trust level as the existing deep-link bot flow — but instant, no
// round trip to Telegram and back required.
// ---------------------------------------------------------------------------
export function verifyTelegramWebAppInitData(
  initData: string
): { id: string; username?: string; firstName?: string } | null {
  if (!BOT_TOKEN || !initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    // Reject stale launches — Telegram's own recommendation is to treat
    // initData as valid for a limited window, not indefinitely.
    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || Date.now() / 1000 - authDate > 24 * 60 * 60) return null;

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (computedHash !== hash) return null;

    const userJson = params.get('user');
    if (!userJson) return null;
    const user = JSON.parse(userJson);
    return { id: String(user.id), username: user.username || undefined, firstName: user.first_name || undefined };
  } catch {
    return null;
  }
}

// Minimal Telegram Bot API client — just enough to send a confirmation
// message back to the customer after they tap "Start" in the bot, and to
// drive the reservation flow (inline Confirm/Decline buttons on the admin's
// notification, which arrive back as callback_query updates).
export type TelegramButton = {
  text: string;
  web_app?: { url: string };
  url?: string;
  callback_data?: string;
};

/**
 * Escapes the four characters Telegram's HTML parse mode treats as markup.
 * Every value that came from a user (a guest's name, a restaurant's name)
 * MUST go through this before being interpolated into a parse_mode: 'HTML'
 * message — otherwise a name like "<b>" breaks or forges the message.
 * Button labels are plain text and must NOT be escaped.
 */
export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function callBotApi(method: string, body: Record<string, unknown>): Promise<any> {
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch {
    // Best-effort — if this fails the customer still sees success in the
    // browser via polling, they just don't get the bot's confirmation text.
    return null;
  }
}

/**
 * `buttons` is rendered as ONE row unless `rows` is passed, in which case each
 * inner array is its own row (the reservation flow needs date/time keyboards
 * that don't run off the side of the screen).
 * Returns the sent message's id, so a later edit can replace it in place.
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  buttons?: TelegramButton[],
  opts: { parseMode?: 'HTML'; rows?: TelegramButton[][] } = {}
): Promise<number | null> {
  const keyboard = opts.rows ? opts.rows : buttons ? [buttons] : undefined;
  const result = await callBotApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: opts.parseMode,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
  });
  const messageId = result?.result?.message_id;
  return typeof messageId === 'number' ? messageId : null;
}

/**
 * Replaces a message's text and buttons. Used to "consume" the admin's
 * Confirm/Decline buttons the moment one of them is tapped, so the same
 * reservation can't be acted on twice from a stale message.
 */
export async function editTelegramMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  buttons?: TelegramButton[],
  opts: { parseMode?: 'HTML' } = {}
) {
  await callBotApi('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: opts.parseMode,
    reply_markup: buttons ? { inline_keyboard: [buttons] } : { inline_keyboard: [] }
  });
}

/** Telegram requires every callback_query to be answered, or the client spins. */
export async function answerTelegramCallback(callbackQueryId: string, text?: string) {
  await callBotApi('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: !!text
  });
}

export async function registerWebhook(publicUrl: string, secretToken: string) {
  if (!BOT_TOKEN || !publicUrl) return;
  await callBotApi('setWebhook', {
    url: `${publicUrl.replace(/\/$/, '')}/api/telegram/webhook`,
    secret_token: secretToken,
    // callback_query is required for the reservation Confirm/Decline buttons;
    // without it Telegram silently drops every button tap.
    allowed_updates: ['message', 'callback_query']
  });
}
