import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import {
  createRestaurant,
  getRestaurantByPhone,
  getRestaurantById,
  getSubscription,
  listRestaurantsWithSubscriptions,
  setSubscriptionStatus,
  setDeliveryStatus,
  setRestaurantReservationStatus,
  setLoyaltyStatus,
  deleteRestaurant
} from './db';
import { adminBaseUrl, guestOrderUrl } from './publicUrls';

// ---------------------------------------------------------------------------
// This is Alex's PRIVATE bot for running Qulaycafe as a business — a second,
// completely separate bot from the customer-facing verification bot in
// telegram.ts. Only the Telegram account(s) listed in OWNER_TELEGRAM_IDS can
// issue commands to it. There is deliberately no payment gateway wired in:
// Alex collects payment however he likes (cash, click, payme, bank transfer)
// and then tells this bot to activate/extend/suspend a restaurant.
// ---------------------------------------------------------------------------

const OWNER_BOT_TOKEN = process.env.OWNER_BOT_TOKEN || '';
const OWNER_TELEGRAM_IDS = (process.env.OWNER_TELEGRAM_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export const ownerBotConfigured = !!(OWNER_BOT_TOKEN && OWNER_TELEGRAM_IDS.length > 0);

async function sendOwnerMessage(chatId: number | string, text: string) {
  if (!OWNER_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${OWNER_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error('[ownerBot] failed to send message', err);
  }
}

export async function registerOwnerWebhook(publicUrl: string, secretToken: string) {
  if (!OWNER_BOT_TOKEN || !publicUrl) return;
  try {
    await fetch(`https://api.telegram.org/bot${OWNER_BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${publicUrl.replace(/\/$/, '')}/api/owner-bot/webhook`,
        secret_token: secretToken,
        allowed_updates: ['message']
      })
    });
  } catch (err) {
    console.error('[ownerBot] failed to register webhook', err);
  }
}

function generatePassword(): string {
  // 8 random alphanumeric chars — easy enough to read aloud/type over
  // Telegram, still resistant to guessing since login is also rate-limited
  // and lockout-protected server-side.
  return crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'pw' + Date.now();
}

function fmtRestaurant(r: {
  id: string;
  name: string;
  phone: string;
  sub_status?: string;
  sub_period_end?: string | null;
  delivery_status?: string;
  reservation_status?: string;
  loyalty_status?: string;
}): string {
  const status = r.sub_status || 'unknown';
  const emoji = status === 'active' ? '✅' : status === 'trial' ? '🕒' : status === 'suspended' ? '⛔️' : '❓';
  const period = r.sub_period_end ? new Date(r.sub_period_end).toLocaleDateString('uz-UZ') : 'muddatsiz';
  // Which optional features are switched on matters as much as the
  // subscription when Alex is answering "why can't my admin see X?".
  const features = `🛵 dostavka: ${r.delivery_status === 'active' ? 'yoqilgan' : "o'chirilgan"} | 📅 bron: ${
    r.reservation_status === 'active' ? 'yoqilgan' : "o'chirilgan"
  } | ⭐️ ball: ${r.loyalty_status === 'disabled' ? "o'chirilgan" : 'yoqilgan'}`;
  return `${emoji} <b>${r.name}</b>\n📞 ${r.phone}\n🆔 ${r.id}\n📅 holati: ${status} (tugash: ${period})\n${features}`;
}

function findRestaurant(identifier: string) {
  const cleaned = identifier.trim();
  return getRestaurantByPhone(cleaned) || getRestaurantByPhone('+' + cleaned) || getRestaurantById(cleaned);
}

// Two-step confirmation for the destructive /delete command — keyed by the
// owner's own chat id, expires after 5 minutes if never confirmed.
const pendingDeletions = new Map<string, { restaurantId: string; restaurantName: string; requestedAt: number }>();

const HELP_TEXT = `<b>Qulaycafe boshqaruv boti</b>

/new &lt;telefon&gt; &lt;nomi&gt; — yangi restoran yaratish (parol avtomatik yaratiladi)
/list — faol restoranlar ro'yxati (to'xtatilganlar yashirilgan)
/list_all — hammasi, shu jumladan to'xtatilganlar
/delete &lt;telefon&gt; — restoranni butunlay o'chirish (tasdiqlash talab qilinadi)
/extend &lt;telefon yoki id&gt; &lt;kun&gt; — obunani shuncha kunga uzaytirish va faollashtirish
/activate &lt;telefon yoki id&gt; — obunani faollashtirish (muddatni o'zgartirmasdan)
/suspend &lt;telefon yoki id&gt; — obunani to'xtatish (restoran ishlamay qoladi)
/expiring — muddati yaqin yoki o'tgan restoranlar ro'yxati
/delivery_on &lt;telefon&gt; — dostavka xizmatini yoqish
/delivery_off &lt;telefon&gt; — dostavka xizmatini o'chirish
/reservations_on &lt;telefon&gt; — stol bronini yoqish (mijozlar bot orqali bron qiladi)
/reservations_off &lt;telefon&gt; — stol bronini o'chirish
/loyalty_on &lt;telefon&gt; — bonus ballar (aksiya) tizimini yoqish
/loyalty_off &lt;telefon&gt; — bonus ballar tizimini o'chirish (mavjud ballar saqlanadi)
/help — shu yordam matni

<b>Tariflar</b> (qulaycafe.uz/#narxlar)
Tarif — bu alohida sozlama emas, quyidagi kalitlar majmuasi. Yangi restoran
sukut bo'yicha dostavka va bron o'chirilgan, ball yoqilgan holda yaratiladi.

Start (250 000 so'm/oy) — /reservations_off va /loyalty_off
Biznes (450 000 so'm/oy) — /reservations_on va /loyalty_on
Pro (750 000 so'm/oy) — Biznes'dagi ikkitasi + /delivery_on

Stollar soni (10 / 30 / cheklanmagan) va filiallar kelishuv asosida — kod
buni tekshirmaydi, qo'lda nazorat qilinadi. Qo'shimcha filial = /new bilan
yangi restoran.`;

export async function handleOwnerBotMessage(message: any) {
  const from = message?.from;
  const text: string | undefined = message?.text;
  if (!from || !text) return;

  const fromId = String(from.id);
  if (!OWNER_TELEGRAM_IDS.includes(fromId)) {
    // Silently ignore anyone not on the whitelist — no hint given about
    // what this bot does or how to use it.
    return;
  }

  const parts = text.trim().split(/\s+/);
  const command = (parts[0] || '').toLowerCase();

  try {
    if (command === '/start' || command === '/help') {
      await sendOwnerMessage(from.id, HELP_TEXT);
      return;
    }

    if (command === '/new') {
      const phone = parts[1];
      const name = parts.slice(2).join(' ');
      if (!phone || !name) {
        await sendOwnerMessage(from.id, "Foydalanish: /new +998901234567 Old City Restaurant");
        return;
      }
      if (getRestaurantByPhone(phone)) {
        await sendOwnerMessage(from.id, `⚠️ Bu telefon raqam (${phone}) bilan restoran allaqachon mavjud.`);
        return;
      }
      const password = generatePassword();
      const passwordHash = bcrypt.hashSync(password, 12);
      const restaurant = createRestaurant({ name, phone, passwordHash });
      // Two different links now: guests order on the clients host, the owner
      // signs in on the admin host. Sending one URL for both was fine when
      // everything lived on app.qulaycafe.uz; it isn't anymore.
      const menuLink = guestOrderUrl(restaurant.slug) || `/order/${restaurant.slug}`;
      const adminLink = adminBaseUrl();
      await sendOwnerMessage(
        from.id,
        `✅ Yangi restoran yaratildi!\n\n<b>${restaurant.name}</b>\n🆔 ${restaurant.id}\n🔗 Menyu havolasi: ${menuLink}\n\nMijozga bering:\n${
          adminLink ? `🔐 Kirish: ${adminLink}\n` : ''
        }📞 Login: <code>${phone}</code>\n🔑 Parol: <code>${password}</code>\n\nSinov muddati: 14 kun. To'lov qilgach /extend buyrug'i bilan uzaytiring.`
      );
      return;
    }

    if (command === '/list' || command === '/list_all') {
      const restaurants = listRestaurantsWithSubscriptions();
      const showAll = command === '/list_all';
      const visible = showAll ? restaurants : restaurants.filter(r => r.sub_status !== 'suspended');
      if (visible.length === 0) {
        await sendOwnerMessage(
          from.id,
          showAll ? "Hozircha hech qanday restoran yo'q." : "Faol restoranlar yo'q. To'xtatilganlarni ko'rish uchun /list_all yozing."
        );
        return;
      }
      const chunks = visible.map(fmtRestaurant);
      // Telegram messages have a length limit — batch in groups of 10.
      for (let i = 0; i < chunks.length; i += 10) {
        await sendOwnerMessage(from.id, chunks.slice(i, i + 10).join('\n\n'));
      }
      if (!showAll) {
        const hiddenCount = restaurants.length - visible.length;
        if (hiddenCount > 0) {
          await sendOwnerMessage(from.id, `(${hiddenCount} ta to'xtatilgan restoran yashirilgan — /list_all bilan ko'rish mumkin)`);
        }
      }
      return;
    }

    if (command === '/delete') {
      const identifier = parts[1];
      const restaurant = identifier ? findRestaurant(identifier) : undefined;
      if (!restaurant) {
        await sendOwnerMessage(from.id, 'Foydalanish: /delete +998901234567');
        return;
      }
      pendingDeletions.set(String(from.id), { restaurantId: restaurant.id, restaurantName: restaurant.name, requestedAt: Date.now() });
      await sendOwnerMessage(
        from.id,
        `⚠️ <b>${restaurant.name}</b>ni butunlay o'chirmoqchimisiz? Barcha menyu, buyurtmalar, kuryerlar va boshqa ma'lumotlar QAYTARILMAS holda o'chadi.\n\nTasdiqlash uchun: /delete_confirm\nBekor qilish uchun boshqa narsa yozing.`
      );
      return;
    }

    if (command === '/delete_confirm') {
      const pending = pendingDeletions.get(String(from.id));
      if (!pending || Date.now() - pending.requestedAt > 5 * 60_000) {
        await sendOwnerMessage(from.id, "Tasdiqlash muddati tugagan yoki so'rov yo'q. Avval /delete +raqam yozing.");
        pendingDeletions.delete(String(from.id));
        return;
      }
      deleteRestaurant(pending.restaurantId);
      pendingDeletions.delete(String(from.id));
      await sendOwnerMessage(from.id, `🗑 <b>${pending.restaurantName}</b> butunlay o'chirildi.`);
      return;
    }

    if (command === '/extend') {
      const identifier = parts[1];
      const days = Number(parts[2]);
      if (!identifier || !Number.isFinite(days) || days <= 0) {
        await sendOwnerMessage(from.id, 'Foydalanish: /extend +998901234567 30');
        return;
      }
      const restaurant = findRestaurant(identifier);
      if (!restaurant) {
        await sendOwnerMessage(from.id, `⚠️ Restoran topilmadi: ${identifier}`);
        return;
      }
      const existingSub = getSubscription(restaurant.id);
      const baseTime =
        existingSub?.current_period_end && new Date(existingSub.current_period_end).getTime() > Date.now()
          ? new Date(existingSub.current_period_end).getTime()
          : Date.now();
      const newPeriodEnd = new Date(baseTime + days * 24 * 60 * 60 * 1000).toISOString();
      setSubscriptionStatus(restaurant.id, 'active', newPeriodEnd, `Extended ${days} days by owner`);
      await sendOwnerMessage(
        from.id,
        `✅ <b>${restaurant.name}</b> obunasi ${days} kunga uzaytirildi.\nYangi tugash sanasi: ${new Date(
          newPeriodEnd
        ).toLocaleDateString('uz-UZ')}`
      );
      return;
    }

    if (command === '/activate') {
      const identifier = parts[1];
      const restaurant = identifier ? findRestaurant(identifier) : undefined;
      if (!restaurant) {
        await sendOwnerMessage(from.id, 'Foydalanish: /activate +998901234567');
        return;
      }
      setSubscriptionStatus(restaurant.id, 'active', null, 'Activated by owner (no expiry set)');
      await sendOwnerMessage(from.id, `✅ <b>${restaurant.name}</b> faollashtirildi (muddatsiz).`);
      return;
    }

    if (command === '/suspend') {
      const identifier = parts[1];
      const restaurant = identifier ? findRestaurant(identifier) : undefined;
      if (!restaurant) {
        await sendOwnerMessage(from.id, 'Foydalanish: /suspend +998901234567');
        return;
      }
      setSubscriptionStatus(restaurant.id, 'suspended', null, 'Suspended by owner');
      await sendOwnerMessage(from.id, `⛔️ <b>${restaurant.name}</b> to'xtatildi. Mijoz tizimga kira olmaydi.`);
      return;
    }

    if (command === '/delivery_on') {
      const identifier = parts[1];
      const restaurant = identifier ? findRestaurant(identifier) : undefined;
      if (!restaurant) {
        await sendOwnerMessage(from.id, 'Foydalanish: /delivery_on +998901234567');
        return;
      }
      setDeliveryStatus(restaurant.id, 'active');
      await sendOwnerMessage(
        from.id,
        `✅ <b>${restaurant.name}</b> uchun dostavka xizmati yoqildi. Admin endi kuryer ulashi mumkin.`
      );
      return;
    }

    if (command === '/delivery_off') {
      const identifier = parts[1];
      const restaurant = identifier ? findRestaurant(identifier) : undefined;
      if (!restaurant) {
        await sendOwnerMessage(from.id, 'Foydalanish: /delivery_off +998901234567');
        return;
      }
      setDeliveryStatus(restaurant.id, 'disabled');
      await sendOwnerMessage(from.id, `⛔️ <b>${restaurant.name}</b> uchun dostavka xizmati o'chirildi.`);
      return;
    }

    if (command === '/reservations_on') {
      const identifier = parts[1];
      const restaurant = identifier ? findRestaurant(identifier) : undefined;
      if (!restaurant) {
        await sendOwnerMessage(from.id, 'Foydalanish: /reservations_on +998901234567');
        return;
      }
      setRestaurantReservationStatus(restaurant.id, 'active');
      const botUsername = process.env.TELEGRAM_BOT_USERNAME || '';
      const bookLink = botUsername
        ? `\n\n🔗 Mijozlar uchun bron havolasi:\nhttps://t.me/${botUsername}?start=book_${restaurant.slug}`
        : '';
      await sendOwnerMessage(
        from.id,
        `✅ <b>${restaurant.name}</b> uchun stol broni yoqildi. Mijozlar Telegram bot orqali bron qiladi, admin panelda "Bronlar" bo'limi paydo bo'ladi.${bookLink}`
      );
      return;
    }

    if (command === '/reservations_off') {
      const identifier = parts[1];
      const restaurant = identifier ? findRestaurant(identifier) : undefined;
      if (!restaurant) {
        await sendOwnerMessage(from.id, 'Foydalanish: /reservations_off +998901234567');
        return;
      }
      setRestaurantReservationStatus(restaurant.id, 'disabled');
      await sendOwnerMessage(
        from.id,
        `⛔️ <b>${restaurant.name}</b> uchun stol broni o'chirildi. Yangi bron qabul qilinmaydi (mavjud bronlar saqlanadi).`
      );
      return;
    }

    // Bonus points ("ball") program. Unlike delivery/reservations this one is
    // ON by default for every restaurant, so /loyalty_off is the command that
    // actually gets used — for a restaurant that doesn't want to hand out
    // discounts. Earned balances survive the switch either way.
    if (command === '/loyalty_on' || command === '/loyalty_off') {
      const turningOn = command === '/loyalty_on';
      const identifier = parts[1];
      const restaurant = identifier ? findRestaurant(identifier) : undefined;
      if (!restaurant) {
        await sendOwnerMessage(from.id, `Foydalanish: ${command} +998901234567`);
        return;
      }
      setLoyaltyStatus(restaurant.id, turningOn ? 'active' : 'disabled');
      await sendOwnerMessage(
        from.id,
        turningOn
          ? `✅ <b>${restaurant.name}</b> uchun bonus ballar tizimi yoqildi. Mijozlar har buyurtmadan ball yig'adi va ularni chegirma sifatida ishlatadi (1000 so'm = 1 ball, 1 ball = 100 so'm).`
          : `⛔️ <b>${restaurant.name}</b> uchun bonus ballar tizimi o'chirildi. Yangi ball berilmaydi va ballar bilan to'lash mumkin emas — mijozlarning eski ballari saqlanib qoladi va qayta yoqilganda tiklanadi.`
      );
      return;
    }

    if (command === '/expiring') {
      await checkExpiringSubscriptionsAndNotifyOwnerForOne(from.id);
      return;
    }

    await sendOwnerMessage(from.id, "Tushunmadim. /help yozing.");
  } catch (err) {
    console.error('[ownerBot] command failed', err);
    await sendOwnerMessage(from.id, "❌ Xatolik yuz berdi. Qaytadan urinib ko'ring.");
  }
}

// ---------------------------------------------------------------------------
// Daily reminder: messages every whitelisted owner about any restaurant
// whose subscription expires within OWNER_EXPIRY_REMINDER_DAYS (default 3)
// days, and about any restaurant that expired since the last check and is
// now effectively cut off. Meant to be called once a day from server.ts —
// this is the whole "don't forget to collect payment" safety net, with no
// payment gateway involved.
// ---------------------------------------------------------------------------
const EXPIRY_REMINDER_DAYS = Number(process.env.OWNER_EXPIRY_REMINDER_DAYS) || 3;

function buildExpiryReportLines(): string[] {
  const now = Date.now();
  const reminderWindowMs = EXPIRY_REMINDER_DAYS * 24 * 60 * 60 * 1000;
  const restaurants = listRestaurantsWithSubscriptions();

  const expiringSoon = restaurants.filter(r => {
    if (r.sub_status === 'suspended' || !r.sub_period_end) return false;
    const end = new Date(r.sub_period_end).getTime();
    return end > now && end - now <= reminderWindowMs;
  });

  const justExpired = restaurants.filter(r => {
    if (r.sub_status === 'suspended' || !r.sub_period_end) return false;
    const end = new Date(r.sub_period_end).getTime();
    // Only flag ones that expired within the last 24h, so the automatic
    // daily check doesn't repeat forever for a restaurant Alex already
    // knows about and is simply choosing not to suspend yet.
    return end <= now && now - end <= 24 * 60 * 60 * 1000;
  });

  const lines: string[] = [];
  if (expiringSoon.length > 0) {
    lines.push('⏰ <b>Tez orada tugaydigan obunalar:</b>');
    for (const r of expiringSoon) {
      const daysLeft = Math.ceil((new Date(r.sub_period_end as string).getTime() - now) / (24 * 60 * 60 * 1000));
      lines.push(`• ${r.name} (${r.phone}) — ${daysLeft} kun qoldi`);
    }
  }
  if (justExpired.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push("⚠️ <b>Muddati o'tgan (hali to'xtatilmagan):</b>");
    for (const r of justExpired) {
      lines.push(`• ${r.name} (${r.phone})`);
    }
    lines.push('');
    lines.push("To'lov kelganda: /extend +raqam kun_soni");
  }
  return lines;
}

// Called once a day from server.ts — silently does nothing if there's
// nothing to report, so it never spams the owner with empty messages.
export async function checkExpiringSubscriptionsAndNotifyOwner() {
  if (!ownerBotConfigured) return;
  try {
    const lines = buildExpiryReportLines();
    if (lines.length === 0) return;
    for (const ownerId of OWNER_TELEGRAM_IDS) {
      await sendOwnerMessage(ownerId, lines.join('\n'));
    }
  } catch (err) {
    console.error('[ownerBot] expiry reminder check failed', err);
  }
}

// Called from the /expiring command — always replies, even if nothing is
// expiring soon, since a person explicitly asked.
async function checkExpiringSubscriptionsAndNotifyOwnerForOne(chatId: number | string) {
  try {
    const lines = buildExpiryReportLines();
    await sendOwnerMessage(chatId, lines.length > 0 ? lines.join('\n') : "✅ Hozircha muddati yaqin restoran yo'q.");
  } catch (err) {
    console.error('[ownerBot] /expiring command failed', err);
  }
}
