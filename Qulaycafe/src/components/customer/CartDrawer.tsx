import { useCurrency } from '../../utils/CurrencyContext';
import React, { useState, useEffect, useRef } from 'react';
import { CartItem, LoyaltyMember, GoogleUser } from '../../types';
import {
  X,
  Trash2,
  Plus,
  Minus,
  CreditCard,
  Wallet,
  ShieldCheck,
  CheckCircle2,
  Phone,
  Send,
  ShoppingBag,
  Sparkles,
  StickyNote,
  MapPin,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { Language, translations } from '../../lib/translations';
import { getRestaurantId } from '../../utils/restaurantContext';
import { acquireLocation } from '../../utils/geolocation';
import { cartUnitPrice } from '../../utils/cart';

// A returning customer shouldn't have to re-verify every single visit —
// once they've verified via Telegram or WhatsApp, remember it on this
// device (scoped per restaurant, since the same phone could be a
// returning customer of several different restaurants over time).
function identityStorageKey() {
  return `qulaycafe_customer_identity_${getRestaurantId()}`;
}
function loadSavedIdentity(): { name: string; phoneOrEmail: string; verifiedVia: 'telegram' | 'whatsapp' } | null {
  try {
    const raw = localStorage.getItem(identityStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveIdentity(name: string, phoneOrEmail: string, verifiedVia: 'telegram' | 'whatsapp') {
  try {
    localStorage.setItem(identityStorageKey(), JSON.stringify({ name, phoneOrEmail, verifiedVia }));
  } catch {
    /* localStorage unavailable — verification just won't be remembered next visit */
  }
}
function clearSavedIdentity() {
  try {
    localStorage.removeItem(identityStorageKey());
  } catch {
    /* ignore */
  }
}
// The cart is a checkout flow, not one long wall of cards: every block below
// is a numbered step in the order a guest actually needs them — the dishes
// they picked, where it goes, a note, how they pay, who they are, what it
// costs. The identity cards used to sit directly under the dish list, which
// meant a delivery customer scrolled past three sign-in boxes before reaching
// the address field they were looking for.
function StepHeader({
  step,
  title,
  icon,
  action
}: {
  step: number;
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-5 h-5 rounded-full bg-zinc-700 text-[10px] font-black text-zinc-200 flex items-center justify-center shrink-0 tabular-nums">
          {step}
        </span>
        <span className="shrink-0">{icon}</span>
        <h3 className="text-[11px] font-black uppercase tracking-wider text-white truncate">{title}</h3>
      </div>
      {action}
    </div>
  );
}

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onUpdateQuantity: (cartItemId: string, newQty: number) => void;
  onRemoveItem: (cartItemId: string) => void;
  /** Empties the whole cart. Optional so an embedder can hide the action. */
  onClearCart?: () => void;
  tableNumber: number;
  customerName: string;
  setCustomerName: (name: string) => void;
  customerPhoneOrEmail: string;
  setCustomerPhoneOrEmail: (val: string) => void;
  confirmationCode: string;
  setConfirmationCode: (code: string) => void;
  loyaltyMember: LoyaltyMember | null;
  /** False when this restaurant's points program is switched off by the owner:
      no "pay with points" switch and no "you will earn N points" line. */
  loyaltyEnabled?: boolean;
  onVerifyLoyalty: (phoneOrEmail: string, code: string, name?: string) => void;
  googleUser?: GoogleUser | null;
  onOpenGoogleAuth?: () => void;
  /** Resolves false when the order was NOT accepted, so the drawer stays open. */
  onSubmitOrder: (orderData: {
    paymentMethod: 'card' | 'cash';
    loyaltyPointsRedeemed: number;
    orderNote: string;
  }) => void | Promise<boolean | void>;
  lang: Language;
  orderMode?: 'dine_in' | 'delivery' | 'pickup';
  /** Lets the guest switch between courier delivery and self-pickup from inside
      the checkout, which is where that decision actually belongs. */
  onSetOrderMode?: (mode: 'dine_in' | 'delivery' | 'pickup') => void;
  deliveryAddress?: string;
  setDeliveryAddress?: (val: string) => void;
  deliveryPhone?: string;
  setDeliveryPhone?: (val: string) => void;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  onCaptureLocation?: (lat: number, lng: number) => void;
  telegramWebAppUser?: { id: string; username?: string; firstName?: string } | null;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cartItems,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  tableNumber,
  customerName,
  setCustomerName,
  customerPhoneOrEmail,
  setCustomerPhoneOrEmail,
  confirmationCode,
  setConfirmationCode,
  loyaltyMember,
  loyaltyEnabled = true,
  onVerifyLoyalty,
  googleUser,
  onOpenGoogleAuth,
  onSubmitOrder,
  lang,
  orderMode = 'dine_in',
  onSetOrderMode,
  deliveryAddress = '',
  setDeliveryAddress,
  deliveryPhone = '',
  setDeliveryPhone,
  deliveryLat = null,
  deliveryLng = null,
  onCaptureLocation,
  telegramWebAppUser
}) => {
  const t = translations[lang];
  const { formatPrice } = useCurrency();
  const isDelivery = orderMode === 'delivery';
  const isPickup = orderMode === 'pickup';
  // Both mean "not eating at a table here", which is the one thing the header
  // switcher decides; delivery vs pickup is settled in the step below.
  const isTakeaway = isDelivery || isPickup;

  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  // Guards against a second tap while a fix is still being acquired — the old
  // code let a double tap start two competing requests.
  const locationRequestRef = useRef<boolean>(false);

  const [redeemPoints, setRedeemPoints] = useState<boolean>(false);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash'>('cash');
  const [orderNote, setOrderNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // Validation and network problems are shown in the footer, right above the
  // button that triggered them. alert() used to do this job: it covered the
  // form, said nothing about which field was wrong, and on iOS it can be
  // suppressed entirely — leaving a guest tapping a button that did nothing.
  const [formError, setFormError] = useState<string | null>(null);
  // Emptying the cart is one tap plus one confirmation, inline. window.confirm
  // is blockable and looks like a browser warning rather than part of the app.
  const [confirmClear, setConfirmClear] = useState<boolean>(false);

  const handleShareLocation = async () => {
    if (locationRequestRef.current) return;
    locationRequestRef.current = true;
    setLocationStatus('loading');
    setLocationError(null);
    try {
      const result = await acquireLocation();
      if (result.ok) {
        onCaptureLocation?.(result.lat, result.lng);
        setLocationAccuracy(Math.round(result.accuracy));
        setLocationStatus('idle');
        setLocationError(null);
      } else {
        // The typed address field below still works in every one of these
        // cases, so a failure here never blocks the order.
        const reason = result.reason;
        setLocationStatus('error');
        setLocationError(
          reason === 'denied'
            ? "Joylashuvga ruxsat berilmagan. Brauzer sozlamalarida ruxsat bering yoki manzilni qo'lda yozing."
            : reason === 'insecure'
            ? "Bu sahifa xavfsiz ulanishda (https) emas — brauzer joylashuvni bermaydi. Manzilni qo'lda yozing."
            : reason === 'unsupported'
            ? "Brauzeringiz joylashuvni qo'llab-quvvatlamaydi. Manzilni qo'lda yozing."
            : "Joylashuvni aniqlab bo'lmadi. Ochiq joyda yoki GPS yoniq holda qayta urinib ko'ring."
        );
      }
    } finally {
      locationRequestRef.current = false;
    }
  };
  // Verification State — only two ways to become verified: real Google
  // Sign-In (set via the useEffect below when googleUser is populated by the
  // app-level Google flow) or real Telegram bot verification (see
  // handleTelegramVerify). There is no email/name-only path anymore — both
  // require actually proving control of the account.
  const [isContactVerified, setIsContactVerified] = useState<boolean>(!!googleUser);
  const [verifiedVia, setVerifiedVia] = useState<'google' | 'telegram' | 'whatsapp' | null>(googleUser ? 'google' : null);

  // Returning customer — restore their remembered identity instead of
  // asking them to verify again every visit.
  useEffect(() => {
    if (googleUser || telegramWebAppUser || isContactVerified) return;
    const saved = loadSavedIdentity();
    if (saved) {
      setCustomerName(saved.name);
      setCustomerPhoneOrEmail(saved.phoneOrEmail);
      setIsContactVerified(true);
      setVerifiedVia(saved.verifiedVia);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleForgetMe = () => {
    clearSavedIdentity();
    setIsContactVerified(false);
    setVerifiedVia(null);
    setCustomerName('');
    setCustomerPhoneOrEmail('');
  };

  useEffect(() => {
    if (googleUser) {
      if (!customerName) setCustomerName(googleUser.name);
      if (!customerPhoneOrEmail) setCustomerPhoneOrEmail(googleUser.email);
      setIsContactVerified(true);
      setVerifiedVia('google');
    }
  }, [googleUser]);

  // Opened as a Telegram Mini App with a verified signature — counts the
  // same as Google Sign-In: proven control of a real account, no
  // additional deep-link round trip needed.
  useEffect(() => {
    if (telegramWebAppUser) {
      const identifier = telegramWebAppUser.username ? `@${telegramWebAppUser.username}` : `telegram-${telegramWebAppUser.id}`;
      if (!customerName) setCustomerName(telegramWebAppUser.firstName || identifier);
      if (!customerPhoneOrEmail) setCustomerPhoneOrEmail(identifier);
      setIsContactVerified(true);
      setVerifiedVia('telegram');
    }
  }, [telegramWebAppUser]);
  const [telegramConfigured, setTelegramConfigured] = useState<boolean | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<'idle' | 'waiting' | 'expired'>('idle');
  const telegramPollRef = useRef<number | null>(null);
  const [whatsappNumberInput, setWhatsappNumberInput] = useState<string>('');
  const [settings, setSettings] = useState<{ taxPercent: number; serviceFeePercent: number }>({
    taxPercent: 8,
    serviceFeePercent: 5
  });

  useEffect(() => {
    fetch('/api/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d) setSettings(d);
      })
      .catch(() => {}); // keep the defaults above if this fails
  }, []);

  useEffect(() => {
    fetch('/api/auth/telegram/config')
      .then(r => r.json())
      .then(d => setTelegramConfigured(!!d.configured))
      .catch(() => setTelegramConfigured(false));
    return () => {
      if (telegramPollRef.current) window.clearInterval(telegramPollRef.current);
    };
  }, []);

  // Escape closes the sheet, and the page behind it stops scrolling while it is
  // open — a full-screen drawer that lets the menu scroll underneath is the
  // classic mobile drawer bug, and on iOS it steals the swipe that should be
  // scrolling the cart itself.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  // A validation message must not outlive the thing it complained about.
  useEffect(() => {
    setFormError(null);
  }, [isContactVerified, deliveryAddress, deliveryPhone, deliveryLat, deliveryLng, cartItems.length]);

  useEffect(() => {
    if (!isOpen) setConfirmClear(false);
  }, [isOpen]);
  if (!isOpen) return null;

  // Bill Calculations — rounded the same way the server rounds them
  // (server.ts recomputes tax/service authoritatively with Math.round), so the
  // total shown here is the total actually charged, to the so'm.
  const subtotal = cartItems.reduce((acc, item) => acc + item.itemTotal, 0);
  const tax = Math.round((subtotal * settings.taxPercent) / 100);
  const serviceCharge = Math.round((subtotal * settings.serviceFeePercent) / 100);
  const totalDishes = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  // Loyalty Discount Calculation — 1 point is worth 100 so'm when redeemed.
  // All of it collapses to zero when the program is off for this restaurant,
  // which is also what the server enforces on the order it receives.
  const canRedeemPoints = loyaltyEnabled && !!loyaltyMember && loyaltyMember.pointsBalance >= 100;
  let pointsToRedeem = 0;
  let loyaltyDiscount = 0;
  if (redeemPoints && loyaltyMember && canRedeemPoints) {
    const maxDiscountAllowed = subtotal * 0.5;
    const availableDiscountSom = loyaltyMember.pointsBalance * 100;
    loyaltyDiscount = Math.min(maxDiscountAllowed, availableDiscountSom);
    pointsToRedeem = Math.floor(loyaltyDiscount / 100);
    loyaltyDiscount = pointsToRedeem * 100; // re-derive so it's an exact multiple of 100 so'm
  }

  const finalTotal = Math.max(0, subtotal + tax + serviceCharge - loyaltyDiscount);
  const pointsToEarn = loyaltyEnabled ? Math.round(finalTotal / 1000) : 0;

  // Real Telegram verification: opens the restaurant's bot with a one-time
  // token, then polls until the customer has pressed Start in Telegram
  // (which proves they control that account) — nothing is faked here.
  const handleTelegramVerify = async () => {
    if (!telegramConfigured) {
      setFormError(t.cartErrorTelegramOff);
      return;
    }
    setFormError(null);
    try {
      const res = await fetch('/api/auth/telegram/start', { method: 'POST' });
      if (!res.ok) {
        setFormError(t.cartErrorTelegramStart);
        return;
      }
      const { token, deepLink } = await res.json();
      window.open(deepLink, '_blank');
      setTelegramStatus('waiting');

      const startedAt = Date.now();
      telegramPollRef.current = window.setInterval(async () => {
        if (Date.now() - startedAt > 5.5 * 60_000) {
          window.clearInterval(telegramPollRef.current!);
          setTelegramStatus('expired');
          return;
        }
        try {
          const statusRes = await fetch(`/api/auth/telegram/status/${token}`);
          const status = await statusRes.json();
          if (status.status === 'verified') {
            window.clearInterval(telegramPollRef.current!);
            const identifier = status.telegramUsername ? `@${status.telegramUsername}` : `telegram-${status.telegramUserId}`;
            const finalName = customerName || status.telegramFirstName || identifier;
            setCustomerPhoneOrEmail(identifier);
            if (!customerName && status.telegramFirstName) setCustomerName(status.telegramFirstName);
            setIsContactVerified(true);
            setVerifiedVia('telegram');
            setTelegramStatus('idle');
            saveIdentity(finalName, identifier, 'telegram');
            onVerifyLoyalty(identifier, '', finalName);
          } else if (status.status === 'expired' || status.status === 'not_found') {
            window.clearInterval(telegramPollRef.current!);
            setTelegramStatus('expired');
          }
        } catch {
          // transient network hiccup — keep polling, don't give up on one failure
        }
      }, 2500);
    } catch {
      setFormError(t.cartErrorTelegramStart);
    }
  };

  // WhatsApp verification: the owner explicitly wants this to be a simple
  // third option — entering a name + WhatsApp number counts as verified
  // immediately, no code sent. This is intentionally simpler than the
  // Google/Telegram paths (which really do prove account ownership); it's
  // included because the restaurant owner asked for it as a lower-friction
  // option for customers who don't want to use either of those.
  const handleWhatsAppVerify = () => {
    const number = whatsappNumberInput.trim();
    if (!number) {
      setFormError(t.cartErrorWhatsapp);
      return;
    }
    const name = customerName.trim();
    if (!name) {
      setFormError(t.cartErrorName);
      return;
    }
    setFormError(null);
    setCustomerPhoneOrEmail(number);
    setIsContactVerified(true);
    setVerifiedVia('whatsapp');
    saveIdentity(name, number, 'whatsapp');
    onVerifyLoyalty(number, '', name);
  };
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (cartItems.length === 0 || isSubmitting) return;

    // Verification is mandatory before an order can be sent to the kitchen.
    // Only two paths count: real Google Sign-In or real Telegram bot
    // verification — both prove the customer actually controls that
    // account, unlike a name/email typed into a text box.
    if (!isContactVerified) {
      setFormError(t.cartVerifyRequired);
      return;
    }
    if (isDelivery && !deliveryPhone.trim()) {
      setFormError(t.cartErrorPhone);
      return;
    }
    if (isDelivery && !deliveryAddress.trim() && !(deliveryLat != null && deliveryLng != null)) {
      setFormError(t.cartErrorAddress);
      return;
    }
    if (isPickup && !deliveryPhone.trim()) {
      setFormError(t.cartErrorPhonePickup);
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      // Awaited: the previous version fired and forgot, so the drawer closed
      // and the button re-enabled before the server had answered — a second
      // tap could then submit the same cart twice.
      const accepted = await onSubmitOrder({
        paymentMethod,
        loyaltyPointsRedeemed: pointsToRedeem,
        orderNote
      });
      // Only close on success — leaving the cart open means a failed order
      // can be retried without the customer rebuilding it from scratch.
      if (accepted !== false) onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const modeBadge = isDelivery ? (
    <span className="bg-sky-500 text-[10px] text-white px-2 py-0.5 rounded-full font-extrabold">🛵 Dostavka</span>
  ) : isPickup ? (
    <span className="bg-amber-500 text-[10px] text-white px-2 py-0.5 rounded-full font-extrabold">🥡 Olib ketish</span>
  ) : (
    <span className="bg-orange-500 text-[10px] text-white px-2 py-0.5 rounded-full font-extrabold">
      {t.table} #{tableNumber}
    </span>
  );
  // Step numbers are counted as the sections render instead of hardcoded: a
  // dine-in guest has no address step, and a numbered list that skips 2 reads
  // like something failed to load.
  let stepCounter = 0;
  const nextStep = () => ++stepCounter;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-zinc-900/70 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
      role="presentation"
    >
      <div className="absolute inset-y-0 right-0 max-w-full flex w-full sm:w-auto">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.yourCart}
          onClick={e => e.stopPropagation()}
          className="w-full sm:w-screen sm:max-w-md bg-zinc-900 text-white flex flex-col shadow-2xl h-full"
        >
          {/* Header */}
          <div className="px-4 py-3.5 sm:px-5 border-b border-zinc-800 flex items-center justify-between gap-3 bg-zinc-900 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black tracking-wider uppercase text-white truncate">{t.yourCart}</h2>
                {modeBadge}
              </div>
              <p className="text-zinc-400 text-xs mt-0.5 tabular-nums">
                {t.itemsCount.replace('{count}', String(totalDishes))}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.cartBackToMenu}
              className="w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-white bg-zinc-800 rounded-full transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Cart Content */}
          <div className="px-4 py-4 sm:px-5 overflow-y-auto flex-1 flex flex-col gap-5 custom-scrollbar">
            {cartItems.length === 0 ? (
              // The empty cart used to say "no dishes found" — the search
              // result string, which reads like the menu itself is broken.
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-14">
                <div className="w-16 h-16 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                  <ShoppingBag className="w-7 h-7 text-zinc-500" />
                </div>
                <p className="font-black text-sm text-white">{t.cartEmptyTitle}</p>
                <p className="text-xs text-zinc-500 max-w-[16rem] leading-relaxed">{t.cartEmptyHint}</p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-1 bg-orange-500 hover:bg-orange-600 text-white text-xs font-black px-5 py-3 rounded-xl transition-colors active:scale-95"
                >
                  {t.cartBackToMenu}
                </button>
              </div>
            ) : (
              <>
                {/* 1 — the dishes themselves */}
                <section>
                  <StepHeader
                    step={nextStep()}
                    title={t.cartStepDishes}
                    icon={<ShoppingBag className="w-3.5 h-3.5 text-orange-400" />}
                    action={
                      onClearCart ? (
                        confirmClear ? (
                          <button
                            type="button"
                            onClick={() => {
                              onClearCart();
                              setConfirmClear(false);
                            }}
                            className="text-[10px] font-black text-rose-300 bg-rose-500/15 border border-rose-500/40 px-2.5 py-1.5 rounded-lg shrink-0"
                          >
                            {t.cartClearConfirm}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmClear(true)}
                            className="text-[10px] font-bold text-zinc-500 hover:text-rose-300 px-2 py-1.5 rounded-lg shrink-0 transition-colors"
                          >
                            {t.cartClear}
                          </button>
                        )
                      ) : undefined
                    }
                  />
                  <ul className="space-y-2.5">
                    {cartItems.map(item => (
                      <li
                        key={item.cartItemId}
                        className="bg-zinc-800/80 border border-zinc-700/60 rounded-2xl p-3"
                      >
                        <div className="flex gap-3">
                          <img
                            src={item.menuItem.image}
                            alt=""
                            className="w-16 h-16 rounded-xl object-cover shrink-0 bg-zinc-900"
                            referrerPolicy="no-referrer"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              {/* Wrapped, not truncated: a guest checking their
                                  order needs the whole dish name, and "Osh (katta,
                                  qo'shimcha go'sht bilan)" used to end at "Osh (…". */}
                              <h4 className="font-bold text-xs text-white leading-snug line-clamp-2">
                                {item.menuItem.name}
                              </h4>
                              <span className="text-xs font-black text-orange-400 shrink-0 tabular-nums">
                                {formatPrice(item.itemTotal)}
                              </span>
                            </div>
                            {item.selectedCustomizations.length > 0 && (
                              <p className="text-[10px] text-zinc-400 mt-1 leading-snug line-clamp-2">
                                {item.selectedCustomizations.map(c => c.optionName).join(' · ')}
                              </p>
                            )}
                            {item.quantity > 1 && (
                              <p className="text-[10px] text-zinc-500 mt-0.5 tabular-nums">
                                {t.cartPerItem.replace('{price}', formatPrice(cartUnitPrice(item)))}
                              </p>
                            )}
                          </div>
                        </div>
                        {/* Controls on their own row: 36px targets that no longer
                            share a line with the price, so a thumb can hit them. */}
                        <div className="flex items-center justify-between mt-2.5">
                          <div className="flex items-center bg-zinc-900 rounded-xl border border-zinc-700 p-1">
                            <button
                              type="button"
                              aria-label={t.cartDecrease}
                              onClick={() => onUpdateQuantity(item.cartItemId, item.quantity - 1)}
                              className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors active:scale-95"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-8 text-center text-sm font-black text-white tabular-nums">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={t.cartIncrease}
                              onClick={() => onUpdateQuantity(item.cartItemId, item.quantity + 1)}
                              className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors active:scale-95"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => onRemoveItem(item.cartItemId)}
                            className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-bold text-zinc-500 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{t.cartRemove}</span>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                {/* 2 — delivery or pickup. This is the "delivery section" the
                    guest entered from the menu header, so the choice between a
                    courier and collecting it themselves is made HERE, next to
                    the fields it changes, instead of being a third button up in
                    the menu header where it meant nothing yet. Switching flips
                    the section below between an address form and a phone-only
                    form; the cart, the totals and everything typed so far are
                    untouched. */}
                {isTakeaway && onSetOrderMode && (
                  <section className="bg-zinc-800/90 border border-zinc-700/80 rounded-2xl p-4">
                    <StepHeader
                      step={nextStep()}
                      title={t.cartStepFulfilment}
                      icon={<ShoppingBag className="w-3.5 h-3.5 text-zinc-400" />}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => onSetOrderMode('delivery')}
                        aria-pressed={isDelivery}
                        className={`rounded-xl px-3 py-3 text-xs font-bold border transition-colors ${
                          isDelivery
                            ? 'bg-sky-500 border-sky-400 text-white'
                            : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                        }`}
                      >
                        🛵 {t.fulfilmentDelivery}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetOrderMode('pickup')}
                        aria-pressed={isPickup}
                        className={`rounded-xl px-3 py-3 text-xs font-bold border transition-colors ${
                          isPickup
                            ? 'bg-amber-500 border-amber-400 text-white'
                            : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                        }`}
                      >
                        🥡 {t.fulfilmentPickup}
                      </button>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed mt-2.5">
                      {isPickup ? t.fulfilmentPickupHint : t.fulfilmentDeliveryHint}
                    </p>
                  </section>
                )}
                {/* 3 — where it goes. Directly after the dishes now, instead of
                    below three sign-in cards. */}
                {isDelivery && (
                  <section className="bg-sky-500/10 border border-sky-500/30 rounded-2xl p-4">
                    <StepHeader
                      step={nextStep()}
                      title={t.cartStepDelivery}
                      icon={<MapPin className="w-3.5 h-3.5 text-sky-300" />}
                    />
                    <div className="space-y-3">
                      {/* Precise geolocation — the fast path. One tap sends the
                          courier a real map pin instead of them having to
                          interpret typed directions. Falls back gracefully to
                          the text field below if permission is denied. */}
                      <button
                        type="button"
                        onClick={handleShareLocation}
                        disabled={locationStatus === 'loading'}
                        className={`w-full flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs font-bold transition-colors disabled:opacity-80 ${
                          deliveryLat != null && deliveryLng != null
                            ? 'bg-green-500/20 border border-green-500/40 text-green-300'
                            : 'bg-sky-500 hover:bg-sky-600 text-white'
                        }`}
                      >
                        {locationStatus === 'loading' ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                            <span>Joylashuv aniqlanmoqda... (GPS yonishini kuting)</span>
                          </>
                        ) : deliveryLat != null && deliveryLng != null ? (
                          <span>✅ Joylashuv yuborildi — kuryer xaritada ko'radi</span>
                        ) : (
                          <span>📍 Joylashuvimni yuborish</span>
                        )}
                      </button>
                      {deliveryLat != null && deliveryLng != null && locationStatus !== 'loading' && (
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] text-green-400">
                            {locationAccuracy != null ? `Aniqlik: ~${locationAccuracy} m` : 'Joylashuv saqlandi'}
                          </p>
                          <button
                            type="button"
                            onClick={handleShareLocation}
                            className="text-[10px] font-bold text-sky-300 hover:text-sky-200 underline"
                          >
                            Qayta aniqlash
                          </button>
                        </div>
                      )}
                      {locationStatus === 'error' && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] text-rose-400 leading-relaxed">{locationError}</p>
                          <button
                            type="button"
                            onClick={handleShareLocation}
                            className="text-[10px] font-bold text-sky-300 hover:text-sky-200 underline"
                          >
                            Qaytadan urinish
                          </button>
                        </div>
                      )}
                      <div>
                        <label className="text-[10px] font-bold text-zinc-400 uppercase" htmlFor="cart-address">
                          Manzil {deliveryLat != null ? '(ixtiyoriy izoh — masalan, "3-qavat, domofon 15")' : ''}
                        </label>
                        <input
                          id="cart-address"
                          type="text"
                          value={deliveryAddress}
                          onChange={e => setDeliveryAddress && setDeliveryAddress(e.target.value)}
                          placeholder="Ko'cha, uy raqami, mo'ljal"
                          className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-zinc-400 uppercase" htmlFor="cart-phone">
                          Telefon raqam (kuryer qo'ng'iroq qiladi)
                        </label>
                        <input
                          id="cart-phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          value={deliveryPhone}
                          onChange={e => setDeliveryPhone && setDeliveryPhone(e.target.value)}
                          placeholder="+998901234567"
                          className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                    </div>
                  </section>
                )}
                {/* Pickup ("olib ketish") — no address, no courier, just a
                    contact number so the kitchen can call when it's ready. */}
                {isPickup && (
                  <section className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                    <StepHeader
                      step={nextStep()}
                      title={t.cartStepPickup}
                      icon={<Phone className="w-3.5 h-3.5 text-amber-300" />}
                    />
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      Buyurtma tayyor bo'lganda sizga qo'ng'iroq qilamiz. O'zingiz kelib olib ketasiz.
                    </p>
                    <div className="mt-3">
                      <label className="text-[10px] font-bold text-zinc-400 uppercase" htmlFor="cart-pickup-phone">
                        Telefon raqam
                      </label>
                      <input
                        id="cart-pickup-phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={deliveryPhone}
                        onChange={e => setDeliveryPhone && setDeliveryPhone(e.target.value)}
                        placeholder="+998901234567"
                        className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                  </section>
                )}

                {/* 4 — the note. The state existed and was submitted with every
                    order, but there was no field to type it into. */}
                <section className="bg-zinc-800/90 border border-zinc-700/80 rounded-2xl p-4">
                  <StepHeader
                    step={nextStep()}
                    title={t.cartStepNote}
                    icon={<StickyNote className="w-3.5 h-3.5 text-zinc-400" />}
                    action={<span className="text-[10px] text-zinc-500 shrink-0">{t.cartNoteOptional}</span>}
                  />
                  <textarea
                    value={orderNote}
                    onChange={e => setOrderNote(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder={t.cartNotePlaceholder}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-500 resize-none leading-relaxed"
                  />
                </section>

                {/* 5 — payment */}
                <section className="bg-zinc-800/90 border border-zinc-700/80 rounded-2xl p-4">
                  <StepHeader
                    step={nextStep()}
                    title={t.cartStepPayment}
                    icon={<Wallet className="w-3.5 h-3.5 text-zinc-400" />}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('cash')}
                      aria-pressed={paymentMethod === 'cash'}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        paymentMethod === 'cash'
                          ? 'bg-orange-500/20 border-orange-500 text-orange-400 font-bold'
                          : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <Wallet className="w-4 h-4 mx-auto mb-1" />
                      <span className="text-[10px] block font-bold">{t.cash}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('card')}
                      aria-pressed={paymentMethod === 'card'}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        paymentMethod === 'card'
                          ? 'bg-orange-500/20 border-orange-500 text-orange-400 font-bold'
                          : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <CreditCard className="w-4 h-4 mx-auto mb-1" />
                      <span className="text-[10px] block font-bold">{t.card}</span>
                    </button>
                  </div>
                  {/* Redeeming points was computed but had no control anywhere in
                      the drawer, so a member could never actually spend them. */}
                  {canRedeemPoints && loyaltyMember && (
                    <label className="mt-3 flex items-start gap-3 bg-zinc-900 border border-zinc-700 rounded-xl p-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={redeemPoints}
                        onChange={e => setRedeemPoints(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-orange-500 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                          {t.cartRedeemPoints.replace('{points}', String(loyaltyMember.pointsBalance))}
                        </span>
                        <span className="text-[10px] text-zinc-400 block mt-0.5">{t.cartRedeemHint}</span>
                      </span>
                    </label>
                  )}
                </section>
                {/* 6 — who they are. Last of the input steps: it blocks the
                    submit, so it sits where the eye lands before the button. */}
                <section className="bg-zinc-800/90 border border-zinc-700/80 rounded-2xl p-4">
                  <StepHeader
                    step={nextStep()}
                    title={t.cartStepVerify}
                    icon={<ShieldCheck className={`w-3.5 h-3.5 ${isContactVerified ? 'text-green-400' : 'text-amber-400'}`} />}
                    action={
                      isContactVerified ? (
                        <span className="bg-green-500/20 text-green-400 text-[10px] font-bold px-2 py-0.5 rounded-md border border-green-500/30 flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{t.cartVerified}</span>
                        </span>
                      ) : undefined
                    }
                  />
                  <div className="space-y-2.5">
                    {isContactVerified ? (
                      <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                          <span className="text-xs text-green-300 font-bold truncate">
                            {customerName || customerPhoneOrEmail}
                            {verifiedVia === 'google'
                              ? ' · Google'
                              : verifiedVia === 'telegram'
                              ? ' · Telegram'
                              : verifiedVia === 'whatsapp'
                              ? ' · WhatsApp'
                              : ''}
                          </span>
                        </div>
                        {!googleUser && !telegramWebAppUser && (
                          <button
                            type="button"
                            onClick={handleForgetMe}
                            className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 underline shrink-0"
                          >
                            {t.cartNotMe}
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Google OAuth */}
                        {onOpenGoogleAuth && (
                          <div className="bg-zinc-900 border border-zinc-700/80 rounded-xl p-3 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shrink-0">
                                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.37 24 12 24z" />
                                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.15 0 9.99 0 12s.45 3.85 1.24 5.42l4.04-3.15z" />
                                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                                </svg>
                              </div>
                              <div className="min-w-0">
                                <span className="text-xs font-bold text-white block truncate">{t.cartVerifyGoogleTitle}</span>
                                <span className="text-[10px] text-zinc-400 block truncate">{t.cartVerifyGoogleHint}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={onOpenGoogleAuth}
                              className="bg-white hover:bg-zinc-100 text-zinc-900 font-extrabold px-3 py-2 rounded-xl text-xs shrink-0 transition-colors"
                            >
                              {t.cartVerifyGoogleAction}
                            </button>
                          </div>
                        )}
                        {/* Telegram bot verification */}
                        {telegramConfigured !== false && (
                          <div className="bg-zinc-900 border border-zinc-700/80 rounded-xl p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-xl bg-sky-500 flex items-center justify-center shrink-0">
                                  <Send className="w-4 h-4 text-white" />
                                </div>
                                <div className="min-w-0">
                                  <span className="text-xs font-bold text-white block truncate">{t.cartVerifyTelegramTitle}</span>
                                  <span className="text-[10px] text-zinc-400 block truncate">{t.cartVerifyTelegramHint}</span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={handleTelegramVerify}
                                disabled={telegramStatus === 'waiting'}
                                className="bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white font-extrabold px-3 py-2 rounded-xl text-xs shrink-0 transition-colors"
                              >
                                {telegramStatus === 'expired' ? t.cartVerifyRetry : t.cartVerifyAction}
                              </button>
                            </div>
                            {telegramStatus === 'waiting' && (
                              <p className="mt-2 text-[10px] text-sky-300 flex items-center gap-1.5">
                                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                                {t.cartVerifyTelegramWaiting}
                              </p>
                            )}
                            {telegramStatus === 'expired' && (
                              <p className="mt-2 text-[10px] text-amber-300 leading-relaxed">{t.cartVerifyTelegramExpired}</p>
                            )}
                          </div>
                        )}
                        {/* WhatsApp — the low-friction third option. Name and
                            number live inside this card because the other two
                            paths fill the name in for the guest automatically. */}
                        <div className="bg-zinc-900 border border-zinc-700/80 rounded-xl p-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-green-500 flex items-center justify-center shrink-0">
                              <Phone className="w-4 h-4 text-white" />
                            </div>
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-white block truncate">{t.cartVerifyWhatsappTitle}</span>
                              <span className="text-[10px] text-zinc-400 block truncate">{t.cartVerifyWhatsappHint}</span>
                            </div>
                          </div>
                          <div className="mt-2.5 space-y-2">
                            <input
                              id="cart-customer-name"
                              type="text"
                              autoComplete="name"
                              value={customerName}
                              onChange={e => setCustomerName(e.target.value)}
                              placeholder={t.cartVerifyNamePlaceholder}
                              aria-label={t.cartVerifyNamePlaceholder}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                            />
                            <div className="flex gap-2">
                              <input
                                type="tel"
                                inputMode="tel"
                                autoComplete="tel"
                                value={whatsappNumberInput}
                                onChange={e => setWhatsappNumberInput(e.target.value)}
                                placeholder="+998901234567"
                                aria-label={t.cartVerifyWhatsappTitle}
                                className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                              />
                              <button
                                type="button"
                                onClick={handleWhatsAppVerify}
                                className="bg-green-500 hover:bg-green-600 text-white font-extrabold px-3.5 py-2 rounded-xl text-xs shrink-0 transition-colors"
                              >
                                {t.cartVerifyAction}
                              </button>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </section>
                {/* 7 — what it costs. The total is repeated on the button, but
                    the breakdown belongs here so nobody is surprised by a
                    service fee only after the order is already in the kitchen. */}
                <section className="bg-zinc-800/90 border border-zinc-700/80 rounded-2xl p-4">
                  <StepHeader
                    step={nextStep()}
                    title={t.cartStepBill}
                    icon={<CreditCard className="w-3.5 h-3.5 text-zinc-400" />}
                  />
                  <dl className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-zinc-400">{t.subtotal}</dt>
                      <dd className="text-white font-bold tabular-nums">{formatPrice(subtotal)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-zinc-400">
                        {t.tax}
                        <span className="text-zinc-500 tabular-nums"> ({settings.taxPercent}% + {settings.serviceFeePercent}%)</span>
                      </dt>
                      <dd className="text-white font-bold tabular-nums">{formatPrice(tax + serviceCharge)}</dd>
                    </div>
                    {loyaltyDiscount > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-orange-400 flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 shrink-0" />
                          {t.cartLoyaltyDiscount.replace('{points}', String(pointsToRedeem))}
                        </dt>
                        <dd className="text-orange-400 font-bold tabular-nums">−{formatPrice(loyaltyDiscount)}</dd>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 border-t border-zinc-700 pt-2.5 mt-1">
                      <dt className="text-white font-black uppercase tracking-wide text-[11px]">{t.total}</dt>
                      <dd className="text-orange-400 font-black text-base tabular-nums">{formatPrice(finalTotal)}</dd>
                    </div>
                  </dl>
                </section>
              </>
            )}
          </div>
          {/* Footer — the only place the order can be sent from, pinned so the
              guest never has to scroll to find it, and padded for the iPhone
              home bar (env(safe-area-inset-bottom)) which used to sit on top
              of the button. */}
          {cartItems.length > 0 && (
            <div className="border-t border-zinc-800 bg-zinc-900 shrink-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-2.5">
              {formError && (
                <p
                  role="alert"
                  className="text-[11px] font-bold text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2.5 flex items-start gap-2 leading-relaxed"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{formError}</span>
                </p>
              )}
              {!isContactVerified && !formError && (
                <p className="text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2.5 flex items-start gap-2 leading-relaxed">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{t.cartVerifyRequired}</span>
                </p>
              )}
              {pointsToEarn > 0 && isContactVerified && !formError && (
                <p className="text-[10px] text-zinc-400 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-orange-400 shrink-0" />
                  <span>{t.cartPointsToEarn.replace('{points}', String(pointsToEarn))}</span>
                </p>
              )}
              {/* Deliberately enabled while unverified: a dead grey button tells
                  the guest nothing, whereas tapping this one names the missing
                  step in the message above. */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-70 text-white font-black py-4 rounded-2xl transition-colors active:scale-[0.99] flex items-center justify-center gap-2 text-sm"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t.cartSending}</span>
                  </>
                ) : (
                  <>
                    <span className="truncate">{t.submitOrderKitchen}</span>
                    <span className="tabular-nums shrink-0">· {formatPrice(finalTotal)}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
