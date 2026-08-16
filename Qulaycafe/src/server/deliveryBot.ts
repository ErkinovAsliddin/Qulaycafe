import { EventEmitter } from 'events';
import {
  getRestaurantById,
  createCourier,
  listCouriers,
  getCourierByTelegramChatId,
  getCourierById,
  saveDeliveryNotification,
  listDeliveryNotifications,
  getOrderRawJson,
  updateOrderRawJson,
  getCourierInviteByToken,
  claimCourierInvite
} from './db';
import { markVerified, getVerificationStatus, escapeTelegramHtml } from './telegram';
import type { Order } from '../types';

// ---------------------------------------------------------------------------
// ONE shared bot for delivery, used by every restaurant that has opted in
// (restaurants.delivery_status === 'active'). A courier links their own
// Telegram to exactly one restaurant via a deep link the admin generates;
// from then on every message/button tap from that Telegram chat is scoped
// to that restaurant's couriers/orders only — never another restaurant's.
// ---------------------------------------------------------------------------

const DELIVERY_BOT_TOKEN = process.env.TELEGRAM_DELIVERY_BOT_TOKEN || '';
export const deliveryBotConfigured = !!DELIVERY_BOT_TOKEN;

// Emits 'orderUpdated' with (restaurantId, order) whenever a courier action
// changes an order via Telegram — server.ts listens once at startup to
// forward these onto the normal SSE broadcast so the admin dashboard
// updates live, without this module needing to know about SSE internals.
export const deliveryEvents = new EventEmitter();

interface TelegramApiMessage {
  message_id: number;
}

async function callTelegramApi(method: string, body: Record<string, unknown>): Promise<any> {
  if (!DELIVERY_BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${DELIVERY_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (err) {
    console.error(`[deliveryBot] ${method} failed`, err);
    return null;
  }
}

type DeliveryButton = { text: string; callback_data: string } | { text: string; url: string };

async function sendDeliveryMessage(
  chatId: string | number,
  text: string,
  buttons?: DeliveryButton[]
): Promise<number | null> {
  const result = await callTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: buttons ? { inline_keyboard: [buttons] } : undefined
  });
  const msg: TelegramApiMessage | undefined = result?.result;
  return msg?.message_id ?? null;
}

async function editDeliveryMessage(
  chatId: string | number,
  messageId: number,
  text: string,
  buttons?: DeliveryButton[]
) {
  await callTelegramApi('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: buttons ? { inline_keyboard: [buttons] } : { inline_keyboard: [] }
  });
}

// Sends the customer's precise location as a real Telegram map pin (not
// just a text address) so the courier can tap it and jump straight into
// navigation. Returns the message id so it can be cleaned up later for
// couriers who didn't end up taking the order.
async function sendDeliveryLocation(chatId: string | number, lat: number, lng: number): Promise<number | null> {
  const result = await callTelegramApi('sendLocation', {
    chat_id: chatId,
    latitude: lat,
    longitude: lng
  });
  const msg: TelegramApiMessage | undefined = result?.result;
  return msg?.message_id ?? null;
}

// Best-effort cleanup — removes a courier's now-irrelevant location pin
// (e.g. after another courier accepted the order) so their chat doesn't
// fill up with stale pins. Never throws; Telegram already no-ops on
// messages that are too old to delete or were already removed.
async function deleteDeliveryMessage(chatId: string | number, messageId: number) {
  await callTelegramApi('deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function answerCallback(callbackQueryId: string, text?: string) {
  await callTelegramApi('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: !!text });
}

export async function registerDeliveryBotWebhook(publicUrl: string, secretToken: string) {
  if (!DELIVERY_BOT_TOKEN || !publicUrl) return;
  await callTelegramApi('setWebhook', {
    url: `${publicUrl.replace(/\/$/, '')}/api/delivery-bot/webhook`,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query']
  });
}

// ---------------------------------------------------------------------------
// Called by server.ts right after a delivery order is created. Notifies
// every active courier of that restaurant with an "accept" button; the
// first one to tap it gets the order, and everyone else's message is
// edited to reflect that.
// ---------------------------------------------------------------------------
export async function notifyCouriersOfNewOrder(restaurantId: string, order: Order) {
  if (!deliveryBotConfigured) return;
  const couriers = listCouriers(restaurantId, true);
  if (couriers.length === 0) return;

  const itemsSummary = order.items.map(i => `${i.quantity}x ${i.menuItem.name}`).join(', ');
  const hasPreciseLocation = typeof order.deliveryLat === 'number' && typeof order.deliveryLng === 'number';
  const locationLine = hasPreciseLocation ? '📍 Aniq joylashuv quyida (xarita pin) ⬇️' : `📍 ${order.deliveryAddress || '—'}`;
  const text = `🛵 <b>Yangi dostavka buyurtmasi</b>\n\n📦 ${itemsSummary}\n${locationLine}\n📞 ${order.deliveryPhone || order.customerPhoneOrEmail || '—'}\n💰 ${order.totalAmount.toLocaleString('uz-UZ')} so'm`;

  for (const courier of couriers) {
    // Text notification with the "accept" button always goes out first...
    const messageId = await sendDeliveryMessage(courier.telegramChatId, text, [
      { text: '✅ Qabul qilish', callback_data: `accept:${order.id}` }
    ]);
    // ...followed by a real Telegram location pin when the customer shared
    // their precise location, so the courier gets an actual map marker
    // instead of having to interpret a typed address.
    let locationMessageId: number | null = null;
    if (hasPreciseLocation) {
      locationMessageId = await sendDeliveryLocation(courier.telegramChatId, order.deliveryLat as number, order.deliveryLng as number);
    }
    if (messageId) {
      saveDeliveryNotification(restaurantId, order.id, courier.id, courier.telegramChatId, messageId, locationMessageId ?? undefined);
    }
  }
}

async function handleAccept(restaurantId: string, orderId: string, courierId: string, courierName: string, from: any, callbackQueryId: string) {
  const rawJson = getOrderRawJson(restaurantId, orderId);
  if (!rawJson) {
    await answerCallback(callbackQueryId, "Bu buyurtma topilmadi (o'chirilgan bo'lishi mumkin).");
    return;
  }
  const order: Order = JSON.parse(rawJson);
  if (order.courierId) {
    await answerCallback(callbackQueryId, order.courierId === courierId ? 'Siz allaqachon qabul qilgansiz.' : 'Bu buyurtmani boshqa kuryer allaqachon qabul qildi.');
    return;
  }

  order.courierId = courierId;
  order.courierName = courierName;
  updateOrderRawJson(restaurantId, orderId, JSON.stringify(order));
  await answerCallback(callbackQueryId);

  const hasPreciseLocation = typeof order.deliveryLat === 'number' && typeof order.deliveryLng === 'number';
  const mapsButton: DeliveryButton | null = hasPreciseLocation
    ? { text: '🗺 Xaritada ochish', url: `https://maps.google.com/?q=${order.deliveryLat},${order.deliveryLng}` }
    : null;

  const notifications = listDeliveryNotifications(restaurantId, orderId);
  for (const n of notifications) {
    if (n.courierId === courierId) {
      const acceptedButtons: DeliveryButton[] = [{ text: "🚗 Yo'lda", callback_data: `enroute:${orderId}` }];
      if (mapsButton) acceptedButtons.push(mapsButton);
      await editDeliveryMessage(
        n.telegramChatId,
        n.messageId,
        `✅ <b>Siz qabul qildingiz</b>\n\n📍 ${order.deliveryAddress || '—'}\n📞 ${order.deliveryPhone || order.customerPhoneOrEmail || '—'}\n💰 ${order.totalAmount.toLocaleString('uz-UZ')} so'm`,
        acceptedButtons
      );
      // Their own location pin (if one was sent) stays as-is — that's the
      // whole point of sending it.
    } else {
      await editDeliveryMessage(n.telegramChatId, n.messageId, '❌ Bu buyurtmani boshqa kuryer qabul qildi.');
      // Clean up the location pin sent to couriers who didn't get the
      // order, so their chat doesn't accumulate irrelevant map pins.
      if (n.locationMessageId) {
        deleteDeliveryMessage(n.telegramChatId, n.locationMessageId).catch(() => {});
      }
    }
  }

  deliveryEvents.emit('orderUpdated', restaurantId, order);
}

async function handleEnroute(restaurantId: string, orderId: string, courierId: string, callbackQueryId: string) {
  const rawJson = getOrderRawJson(restaurantId, orderId);
  if (!rawJson) return;
  const order: Order = JSON.parse(rawJson);
  if (order.courierId !== courierId) {
    await answerCallback(callbackQueryId, 'Bu buyurtma sizga tegishli emas.');
    return;
  }
  order.status = 'out_for_delivery';
  order.updatedAt = new Date().toISOString();
  updateOrderRawJson(restaurantId, orderId, JSON.stringify(order));
  await answerCallback(callbackQueryId);

  const notifications = listDeliveryNotifications(restaurantId, orderId);
  const mine = notifications.find(n => n.courierId === courierId);
  if (mine) {
    const hasPreciseLocation = typeof order.deliveryLat === 'number' && typeof order.deliveryLng === 'number';
    const buttons: DeliveryButton[] = [{ text: '✅ Yetkazildi', callback_data: `delivered:${orderId}` }];
    if (hasPreciseLocation) {
      buttons.push({ text: '🗺 Xaritada ochish', url: `https://maps.google.com/?q=${order.deliveryLat},${order.deliveryLng}` });
    }
    await editDeliveryMessage(
      mine.telegramChatId,
      mine.messageId,
      `🚗 <b>Yo'lda</b>\n\n📍 ${order.deliveryAddress || '—'}\n📞 ${order.deliveryPhone || order.customerPhoneOrEmail || '—'}`,
      buttons
    );
  }
  deliveryEvents.emit('orderUpdated', restaurantId, order);
}

async function handleDelivered(restaurantId: string, orderId: string, courierId: string, callbackQueryId: string) {
  const rawJson = getOrderRawJson(restaurantId, orderId);
  if (!rawJson) return;
  const order: Order = JSON.parse(rawJson);
  if (order.courierId !== courierId) {
    await answerCallback(callbackQueryId, 'Bu buyurtma sizga tegishli emas.');
    return;
  }
  order.status = 'served';
  order.updatedAt = new Date().toISOString();
  updateOrderRawJson(restaurantId, orderId, JSON.stringify(order));
  await answerCallback(callbackQueryId, "Rahmat! Yetkazildi deb belgilandi. ✅");

  const notifications = listDeliveryNotifications(restaurantId, orderId);
  const mine = notifications.find(n => n.courierId === courierId);
  if (mine) {
    await editDeliveryMessage(mine.telegramChatId, mine.messageId, '✅ Yetkazildi. Rahmat!');
  }
  deliveryEvents.emit('orderUpdated', restaurantId, order);
}

export async function handleDeliveryBotUpdate(update: any) {
  const message = update?.message;
  const callback = update?.callback_query;

  if (message?.text?.startsWith('/start') && message.from) {
    const parts = message.text.split(' ');
    const token = parts[1];
    if (!token) {
      await sendDeliveryMessage(message.from.id, "Salom! Bu — dostavka kuryerlar boti. Restoran administratoridan havola oling.");
      return;
    }

    // Preferred path: a per-courier invite the admin created and forwarded.
    // The courier's name comes from the invite, so the admin sees the name
    // they typed instead of whatever the courier called their Telegram account.
    const invite = getCourierInviteByToken(token);
    if (invite) {
      if (invite.status !== 'pending') {
        await sendDeliveryMessage(
          message.from.id,
          invite.status === 'used'
            ? "⚠️ Bu havola allaqachon ishlatilgan. Administratordan yangi havola so'rang."
            : invite.status === 'revoked'
            ? "⚠️ Bu havola bekor qilingan. Administratordan yangi havola so'rang."
            : "⚠️ Havola muddati tugagan. Administratordan yangisini so'rang."
        );
        return;
      }
      const inviteRestaurant = getRestaurantById(invite.restaurantId);
      if (!inviteRestaurant || inviteRestaurant.delivery_status !== 'active') {
        await sendDeliveryMessage(message.from.id, "Bu restoran uchun dostavka xizmati hozircha faol emas.");
        return;
      }
      const courier = createCourier(
        invite.restaurantId,
        String(message.from.id),
        message.from.username || null,
        invite.courierName || message.from.first_name || 'Kuryer'
      );
      // Claim AFTER the courier row exists, and only if still pending — two
      // people opening the same forwarded link can't both register.
      if (!claimCourierInvite(token, courier.id)) {
        await sendDeliveryMessage(message.from.id, "⚠️ Bu havola allaqachon ishlatilgan. Administratordan yangi havola so'rang.");
        return;
      }
      await sendDeliveryMessage(
        message.from.id,
        `✅ Bog'landingiz, <b>${escapeTelegramHtml(courier.name)}</b>! Endi <b>${escapeTelegramHtml(inviteRestaurant.name)}</b> uchun yangi dostavka buyurtmalari shu yerga keladi.`
      );
      return;
    }

    // Legacy path: short-lived click-and-connect tokens still in circulation.
    const result = markVerified(token, message.from);
    if (!result.ok || result.purpose !== 'courier_link' || !result.restaurantId) {
      await sendDeliveryMessage(message.from.id, "⚠️ Havola muddati tugagan yoki noto'g'ri. Administratordan yangisini so'rang.");
      return;
    }
    const restaurant = getRestaurantById(result.restaurantId);
    if (!restaurant || restaurant.delivery_status !== 'active') {
      await sendDeliveryMessage(message.from.id, "Bu restoran uchun dostavka xizmati hozircha faol emas.");
      return;
    }
    const name = message.from.first_name || message.from.username || 'Kuryer';
    createCourier(result.restaurantId, String(message.from.id), message.from.username || null, name);
    await sendDeliveryMessage(
      message.from.id,
      `✅ Bog'landingiz! Endi <b>${restaurant.name}</b> uchun yangi dostavka buyurtmalari shu yerga keladi.`
    );
    return;
  }

  if (callback?.data && callback.from) {
    const [action, orderId] = String(callback.data).split(':');
    const courier = getCourierByTelegramChatId(String(callback.from.id));
    if (!courier) {
      await answerCallback(callback.id, "Siz kuryer sifatida ro'yxatdan o'tmagansiz.");
      return;
    }
    if (action === 'accept') {
      await handleAccept(courier.restaurantId, orderId, courier.id, courier.name, callback.from, callback.id);
    } else if (action === 'enroute') {
      await handleEnroute(courier.restaurantId, orderId, courier.id, callback.id);
    } else if (action === 'delivered') {
      await handleDelivered(courier.restaurantId, orderId, courier.id, callback.id);
    }
  }
}
