// Where the marketing page's buttons actually go.
//
// Everything user-visible on qulaycafe.uz that is not an in-page anchor ends
// up here, so there is one place to check when a hostname or a contact detail
// changes — the design export shipped with `href="#"` on every CTA.
//
// The three surface URLs come from src/utils/surface.ts, the same helper the
// app itself uses to build cross-surface links, so the landing cannot drift
// from the app's idea of where admin/kitchen/clients live.
import { getSurfaceBaseUrl } from '../../utils/surface';

export const ADMIN_URL = getSurfaceBaseUrl('admin');
export const CLIENTS_URL = getSurfaceBaseUrl('clients');
export const KITCHEN_URL = getSurfaceBaseUrl('kitchen');

/**
 * Sales contact. There is no self-service signup: server.ts keeps
 * ENABLE_SELF_REGISTRATION off and creates each restaurant's login by hand
 * (see the "RESTAURANT SELF-REGISTRATION" block there), so every "get
 * started" button has to lead to a human, not to a registration form.
 *
 * VITE_CONTACT_* mirror OWNER_CONTACT_* the way VITE_ADMIN_URL mirrors
 * ADMIN_URL; the fallbacks keep the buttons working in a fresh checkout with
 * no .env. The same details are already public over /api/registration-info.
 */
const CONTACT_TELEGRAM =
  (import.meta.env.VITE_CONTACT_TELEGRAM as string | undefined)?.replace(/^@/, '') ||
  'Aslbek_fullstack';
const CONTACT_PHONE =
  (import.meta.env.VITE_CONTACT_PHONE as string | undefined) || '+998943448228';

export const TELEGRAM_URL = `https://t.me/${CONTACT_TELEGRAM}`;
export const PHONE_URL = `tel:${CONTACT_PHONE.replace(/[^+\d]/g, '')}`;

/** +998943448228 -> +998 94 344 82 28, for display only. */
export const PHONE_LABEL = CONTACT_PHONE.replace(
  /^(\+998)(\d{2})(\d{3})(\d{2})(\d{2})$/,
  '$1 $2 $3 $4 $5'
);

/** How many days a new restaurant gets for free — DEFAULT_TRIAL_DAYS in .env. */
export const TRIAL_DAYS = 14;

/**
 * The three sales plans. Prices are in so'm per month, VAT excluded.
 *
 * A plan is not a database row: it is a recipe of the per-restaurant module
 * switches the owner bot already flips (delivery_status / reservation_status /
 * loyalty_status on the restaurants table). The table and branch limits below
 * are a sales agreement Alex honours by hand — there is deliberately no code
 * that counts tables and refuses the eleventh, so do not go looking for it.
 */
export const PLANS = [
  {
    id: 'start',
    name: 'Start',
    price: 250_000,
    popular: false,
    audience: "Kichik kafe va choyxona — QR menyu va buyurtma yetarli bo'lganlar uchun.",
    features: [
      'QR-menyu — uzbek, rus va ingliz tillarida',
      'Mehmon telefonidan buyurtma beradi',
      'Oshxona ekrani',
      "10 stolgacha — xarita va QR kodlar",
      'Ofitsiantni chaqirish tugmasi',
      "Hisobotlar va Excel'ga eksport",
      'Logotip va rang sozlamalari',
      'Chek printeri (ESC/POS) va Z-hisobot',
    ],
  },
  {
    id: 'biznes',
    name: 'Biznes',
    price: 450_000,
    popular: true,
    audience: 'Restoran va qahvaxonalar — bron va doimiy mijozlar bilan ishlaydiganlar.',
    features: [
      "Start'dagi hamma narsa",
      '30 stolgacha',
      'Stol bron qilish — Telegram bot bilan',
      'Ball tizimi va mijozlar bazasi',
      "Statistika: tushum, eng ko'p sotilganlar, to'lov usullari",
      "Telegram'ga bildirishnomalar",
      "Qo'llab-quvvatlash — kun ichida javob",
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 750_000,
    popular: false,
    audience: "O'zi dostavka qiladigan va bir nechta filiali bor tarmoqlar uchun.",
    features: [
      "Biznes'dagi hamma narsa",
      'Stollar soni cheklanmagan',
      'Dostavka va olib ketish',
      'Kuryerlar uchun alohida Telegram bot',
      'Kuryerlarni boshqarish va joylashuv',
      "Qo'shimcha filial ulash",
      "Ustuvor qo'llab-quvvatlash — telefon va Telegram",
    ],
  },
] as const;

/** One-off: menyuni kiritish, rasmlar, QR kodlarni chiqarish, xodimlarni o'qitish. */
export const SETUP_FEE = 490_000;

/** Yillik to'lovda necha oy pulini to'lanadi (12 oy uchun 10 oy). */
export const ANNUAL_MONTHS = 10;

/** Har bir qo'shimcha filial uchun oylik qo'shimcha. */
export const EXTRA_BRANCH_PRICE = 350_000;

/** 250000 -> "250 000". Uses a non-breaking space so a price never wraps. */
export function somLabel(amount: number): string {
  return amount.toLocaleString('en-US').replace(/,/g, '\u00a0');
}

/**
 * "https://admin.qulaycafe.uz" -> "admin.qulaycafe.uz", for the section that
 * shows the four hostnames. On a dev box getSurfaceBaseUrl() returns
 * "http://localhost:3000/?surface=admin", so the query is dropped too.
 */
export function hostLabel(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
}

/** The hostname this page is being served from — qulaycafe.uz in production. */
export const LANDING_HOST = (() => {
  try {
    return window.location.host;
  } catch {
    return 'qulaycafe.uz';
  }
})();

// In-page anchors. Every section id the header and footer link to is listed
// here so a renamed section breaks in one place instead of silently scrolling
// nowhere (the export shipped a nav link to #afzalliklar, a section that does
// not exist).
export const SECTIONS = {
  top: '#top',
  howItWorks: '#qanday-ishlaydi',
  qrMenu: '#qr-menyu',
  kitchen: '#oshxona',
  tables: '#stollar',
  analytics: '#tahlil',
  features: '#imkoniyatlar',
  delivery: '#dostavka',
  surfaces: '#tizim',
  pricing: '#narxlar',
  cta: '#cta'
} as const;
