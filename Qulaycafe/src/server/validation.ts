import { z } from 'zod';

// Every field a client can send is validated and bounded here. This is what
// stops malformed/malicious payloads (huge strings, wrong types, negative
// prices, XSS payloads in text fields, etc.) from ever reaching the database.

const safeText = (max: number) => z.string().trim().min(1).max(max);

export const customizationOptionSchema = z.object({
  id: z.string().max(64),
  name: safeText(120),
  price: z.number().finite().min(0).max(100000)
});

export const customizationGroupSchema = z
  .object({
    id: z.string().max(64),
    title: safeText(120),
    required: z.boolean(),
    maxSelect: z.number().int().min(1).max(20).optional(),
    // At least one option: an empty group renders as a blank block for the
    // customer, and a required empty group makes the dish impossible to order
    // at all. The admin editor drops such groups before saving; this is the
    // same rule enforced for any other client.
    options: z.array(customizationOptionSchema).min(1).max(30)
  })
  // maxSelect can never exceed the number of options — otherwise the customer
  // UI advertises a limit it can't reach and "required" checks get confusing.
  .refine(group => (group.maxSelect ?? 1) <= group.options.length, {
    message: 'maxSelect cannot be greater than the number of options',
    path: ['maxSelect']
  });

const imageField = z
  .string()
  .max(4_000_000) // generous enough for a base64-encoded uploaded photo
  .refine(
    val =>
      val === '' ||
      val.startsWith('data:image/') ||
      /^https?:\/\//.test(val) ||
      // A photo already uploaded and stored as bytes: the admin form round-trips
      // the whole dish on save, so an unchanged photo comes back as the URL we
      // handed out rather than as base64.
      /^\/api\/(menu\/[^/]+\/image|branding\/logo)(\?|$)/.test(val),
    {
      message: 'image must be a valid http(s) URL, an uploaded image, or empty'
    }
  )
  .optional();

// Categories are rows now, not a fixed union, so a dish's category can only be
// bounded in shape here — that it actually EXISTS for this restaurant is
// checked in the route, which is the only place that knows the tenant.
const categoryIdField = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'category must be a category id like "birinchi_taom"');

// Emoji are multi-codepoint (🍽️ is 3 UTF-16 units, 👨‍🍳 is 5), so this is a
// character budget for "one emoji or a couple of letters", not a length of 1.
const categoryIconField = z.string().trim().max(16).optional();

export const categoryCreateSchema = z.object({
  nameUz: safeText(60),
  nameRu: z.string().trim().max(60).optional(),
  nameEn: z.string().trim().max(60).optional(),
  icon: categoryIconField,
  isActive: z.boolean().optional()
});

export const categoryUpdateSchema = z
  .object({
    nameUz: safeText(60).optional(),
    nameRu: z.string().trim().max(60).optional(),
    nameEn: z.string().trim().max(60).optional(),
    icon: categoryIconField,
    isActive: z.boolean().optional()
  })
  .refine(d => Object.values(d).some(v => v !== undefined), {
    message: 'At least one field is required'
  });

export const categoryReorderSchema = z.object({
  ids: z.array(categoryIdField).min(1).max(200)
});

export const menuItemCreateSchema = z.object({
  nameUz: safeText(120),
  nameRu: safeText(120),
  nameEn: safeText(120),
  descriptionUz: z.string().trim().max(2000).optional().default(''),
  descriptionRu: z.string().trim().max(2000).optional().default(''),
  descriptionEn: z.string().trim().max(2000).optional().default(''),
  price: z.number().finite().min(0).max(1_000_000),
  category: categoryIdField,
  image: imageField,
  isAvailable: z.boolean().optional().default(true),
  dietary: z.array(z.enum(['vegetarian', 'vegan', 'gluten-free', 'halal', 'spicy', 'chef-recommendation'])).max(10).optional().default([]),
  prepTimeMinutes: z.number().int().min(0).max(600).optional().default(12),
  customizations: z.array(customizationGroupSchema).max(20).optional().default([])
});

export const menuItemUpdateSchema = menuItemCreateSchema.partial().extend({
  isAvailable: z.boolean().optional()
});

// What a dish costs to make, in so'm like everything else money-related here.
// Stored apart from the dish itself (see menu_item_costs in db.ts) so it can
// never ride along to a guest, which is also why it is its own endpoint
// rather than a field on menuItemCreateSchema. 0 clears a previously recorded
// cost — "not known" rather than "free".
export const menuItemCostSchema = z.object({
  costPrice: z.number().finite().min(0).max(1_000_000)
});

const selectedCustomizationSchema = z.object({
  groupTitle: safeText(120),
  optionName: safeText(120),
  price: z.number().finite().min(0).max(100000)
});

// Money here is Uzbek so'm, where a single dish routinely costs 100_000+ and a
// line of ten of them is an ordinary family order — not an attack. The caps are
// derived from the limits that already exist rather than guessed, so a valid
// cart can never be rejected as "Invalid request data":
//   line total  <= quantity cap (50) x the menu-item price cap (1_000_000)
const MAX_LINE_TOTAL_SOM = 50 * 1_000_000;
const cartItemSchema = z.object({
  cartItemId: z.string().max(100),
  menuItem: z.object({ id: z.string().max(64) }).passthrough(),
  quantity: z.number().int().min(1).max(50),
  selectedCustomizations: z.array(selectedCustomizationSchema).max(30).default([]),
  specialInstructions: z.string().trim().max(500).optional(),
  itemTotal: z.number().finite().min(0).max(MAX_LINE_TOTAL_SOM)
});

// One order's money fields. Bounded so garbage can't reach the database, but far
// above any real bill (1 milliard so'm is ~80_000 USD) — a banquet must go
// through, and the totals are recomputed server-side anyway.
const MAX_ORDER_TOTAL_SOM = 1_000_000_000;

export const orderCreateSchema = z.object({
  tableNumber: z.number().int().min(0).max(9999), // 0 is used as the "no physical table" sentinel for delivery orders
  customerName: z.string().trim().max(120).optional(),
  customerPhoneOrEmail: z.string().trim().max(200).optional(),
  items: z.array(cartItemSchema).min(1).max(100),
  subtotal: z.number().finite().min(0).max(MAX_ORDER_TOTAL_SOM),
  tax: z.number().finite().min(0).max(MAX_ORDER_TOTAL_SOM),
  serviceCharge: z.number().finite().min(0).max(MAX_ORDER_TOTAL_SOM),
  discount: z.number().finite().min(0).max(MAX_ORDER_TOTAL_SOM).optional().default(0),
  totalAmount: z.number().finite().min(0).max(MAX_ORDER_TOTAL_SOM),
  loyaltyPointsRedeemed: z.number().int().min(0).max(10_000_000).optional().default(0),
  paymentMethod: z.enum(['cash', 'card', 'loyalty_points', 'pay_at_counter']).optional().default('cash'),
  orderNote: z.string().trim().max(500).optional(),
  orderType: z.enum(['dine_in', 'delivery', 'pickup']).optional().default('dine_in'),
  deliveryAddress: z.string().trim().max(300).optional(),
  deliveryPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, "Telefon raqam noto'g'ri formatda")
    .optional(),
  // Precise geolocation captured from the customer's device (browser
  // Geolocation API) when they tap "send my location" instead of typing an
  // address — lets the courier get a real map pin via Telegram instead of
  // trying to interpret free-text directions.
  deliveryLat: z.number().finite().min(-90).max(90).optional(),
  deliveryLng: z.number().finite().min(-180).max(180).optional()
});

export const orderStatusUpdateSchema = z.object({
  status: z.enum(['pending', 'preparing', 'ready', 'out_for_delivery', 'served', 'paid', 'cancelled']).optional(),
  paymentStatus: z.enum(['unpaid', 'paid']).optional()
}).refine(d => d.status || d.paymentStatus, { message: 'status or paymentStatus is required' });

export const tableCreateSchema = z.object({
  tableNumber: z.number().int().min(1).max(9999),
  capacity: z.number().int().min(1).max(50).optional().default(4),
  comment: z.string().trim().max(300).optional().default('')
});

export const loyaltyRegisterSchema = z.object({
  name: safeText(120),
  phoneOrEmail: z.string().trim().min(3).max(200),
  confirmationCode: z.string().trim().max(20).optional()
});

export const loginSchema = z.object({
  password: z.string().min(1).max(200)
});

const phoneField = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .regex(/^\+?[0-9]{7,15}$/, "Telefon raqam noto'g'ri formatda (masalan: +998901234567)");

// Restaurant staff (admin/kitchen) now log in with their restaurant's phone
// number + password, since the phone number is what identifies WHICH
// restaurant they belong to in a multi-tenant system.
export const phoneLoginSchema = z.object({
  phone: phoneField,
  password: z.string().min(1).max(200)
});

export const restaurantRegisterSchema = z.object({
  name: safeText(150),
  phone: phoneField,
  password: z.string().min(6).max(200),
  deliveryEnabled: z.boolean().optional().default(false)
});

export const ownerCreateRestaurantSchema = z.object({
  name: safeText(150),
  phone: phoneField
});

export const ownerSubscriptionUpdateSchema = z.object({
  restaurantId: z.string().min(1).max(100),
  status: z.enum(['trial', 'active', 'suspended']),
  extendDays: z.number().int().min(0).max(3650).optional()
});

export const googleVerifySchema = z.object({
  credential: z.string().min(20).max(4000)
});

export const exchangeRateUpdateSchema = z.object({
  currency: z.enum(['USD', 'RUB']),
  rateToSom: z.number().finite().min(0.01).max(1_000_000)
});

export const settingsUpdateSchema = z.object({
  taxPercent: z.number().finite().min(0).max(50).optional(),
  serviceFeePercent: z.number().finite().min(0).max(50).optional()
}).refine(d => d.taxPercent !== undefined || d.serviceFeePercent !== undefined, {
  message: 'At least one of taxPercent or serviceFeePercent is required'
});

export const changePasswordSchema = z.object({
  newPassword: z.string().min(4).max(200)
});

export const brandingUpdateSchema = z.object({
  logoUrl: imageField,
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'brandColor must be a hex color like #f97316')
    .optional(),
  displayName: safeText(150).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  contactAddress: safeText(300).optional(),
  contactInstagram: z
    .string()
    .trim()
    .max(60)
    .regex(/^@?[a-zA-Z0-9._]{0,60}$/, 'Instagram username invalid')
    .optional(),
  workingHours: z.string().trim().max(100).optional()
});

export const waiterCallSchema = z.object({
  tableNumber: z.number().int().min(1).max(9999)
});

export const printerSettingsSchema = z.object({
  printerConnectionType: z.enum(['network', 'usb']).optional(),
  printerIp: z
    .string()
    .trim()
    .regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'printerIp must be a valid IPv4 address')
    .optional()
    .or(z.literal('')),
  printerPort: z.number().int().min(1).max(65535).optional()
});

export const deliveryOrderFieldsSchema = z.object({
  orderType: z.enum(['dine_in', 'delivery', 'pickup']).optional(),
  deliveryAddress: safeText(300).optional(),
  deliveryPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, "Telefon raqam noto'g'ri formatda")
    .optional(),
  deliveryLat: z.number().finite().min(-90).max(90).optional(),
  deliveryLng: z.number().finite().min(-180).max(180).optional()
});

export const courierNameUpdateSchema = z.object({
  name: safeText(80)
});

// ---------------------------------------------------------------------------
// Table reservations. Bookings come in from three places — the Telegram bot,
// the public web form, and the admin dashboard — and every one of them runs
// through the field schemas below. The bot validates each answer with them as
// the guest types it, so no entry point can disagree with another about what a
// valid booking looks like.
// ---------------------------------------------------------------------------
export const reservationDateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine(val => !Number.isNaN(new Date(`${val}T00:00:00Z`).getTime()), { message: 'date is not a real date' });

export const reservationTimeField = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM (24h)');

export const reservationPartySizeField = z.number().int().min(1).max(50);

export const reservationGuestNameField = safeText(80);

export const reservationPhoneField = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, "Telefon raqam noto'g'ri formatda (masalan: +998901234567)");

export const reservationNoteField = z.string().trim().max(300);

export const reservationCreateSchema = z.object({
  reservedDate: reservationDateField,
  reservedTime: reservationTimeField,
  partySize: reservationPartySizeField,
  guestName: reservationGuestNameField,
  guestPhone: reservationPhoneField,
  note: reservationNoteField.optional()
});

/**
 * The public web booking form. Same fields, same limits, same regexes as the
 * bot flow — the only difference is that a browser is more forgiving about
 * what it sends, so this schema normalizes before it validates:
 *   - a phone typed as "+998 90 123-45-67" is stripped to +998901234567
 *     (the bot does exactly this strip before validating too)
 *   - a party size arriving as the string "4" from a form input is coerced
 * A guest's name is only length-checked, never "cleaned": it ends up escaped
 * wherever it is rendered, not sanitized at the door.
 */
export const reservationPublicCreateSchema = z.object({
  reservedDate: reservationDateField,
  reservedTime: reservationTimeField,
  partySize: z.coerce.number().pipe(reservationPartySizeField),
  guestName: reservationGuestNameField.min(2, 'name is too short'),
  guestPhone: z.preprocess(
    value => (typeof value === 'string' ? value.replace(/[\s()\-.]/g, '') : value),
    reservationPhoneField
  ),
  note: reservationNoteField.optional()
});

/**
 * A web guest's own booking token, as generated by the server
 * (crypto.randomBytes(24).toString('hex')). Pinned to lowercase hex of an
 * exact length so a malformed or padded token is rejected before it ever
 * reaches a database lookup.
 */
export const reservationTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{48}$/, 'invalid booking token')
});

export const reservationUpdateSchema = z
  .object({
    status: z.enum(['pending', 'confirmed', 'declined', 'cancelled', 'seated', 'no_show']).optional(),
    tableNumber: z.number().int().min(1).max(9999).nullable().optional(),
    note: reservationNoteField.nullable().optional()
  })
  .refine(d => d.status !== undefined || d.tableNumber !== undefined || d.note !== undefined, {
    message: 'At least one field is required'
  });

// --- Guest reviews (rate the dishes of a served order) ---
// One rating per dish, submitted together as the guest's whole review of the
// order. Bounded hard: ratings are exactly 1..5, and the free-text comment is
// a short note, not a paste target.
export const reviewRatingField = z.number().int().min(1).max(5);

export const reviewDishSchema = z.object({
  menuItemId: z.string().trim().min(1).max(120),
  rating: reviewRatingField
});

export const reviewSubmitSchema = z.object({
  orderId: z.string().trim().min(1).max(80),
  ratings: z.array(reviewDishSchema).min(1).max(30),
  comment: z.string().trim().max(500).optional()
});
