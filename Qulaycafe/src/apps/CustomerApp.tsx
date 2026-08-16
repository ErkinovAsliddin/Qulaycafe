import React, { useEffect, useState } from 'react';
import { CartItem, GoogleUser, LoyaltyMember, MenuCategory, MenuItem, Order, Table } from '../types';
import { Language } from '../lib/translations';
import { HeaderNav } from '../components/HeaderNav';
import { TableConfirmModal } from '../components/customer/TableConfirmModal';
import { CustomerView } from '../components/customer/CustomerView';
import { ItemCustomizerModal } from '../components/customer/ItemCustomizerModal';
import { CartDrawer } from '../components/customer/CartDrawer';
import { OrderStatusTracker } from '../components/customer/OrderStatusTracker';
import { OrderHistoryModal } from '../components/customer/OrderHistoryModal';
import { QRScannerModal } from '../components/customer/QRScannerModal';
import { GoogleAuthModal } from '../components/customer/GoogleAuthModal';
import { RestaurantLocationModal } from '../components/customer/RestaurantLocationModal';
import { ReservationModal } from '../components/customer/ReservationModal';
import { WelcomeSplash } from '../components/customer/WelcomeSplash';
import { ErrorToast, useErrorToast } from '../components/ErrorToast';
import { CurrencyProvider } from '../utils/CurrencyContext';
import {
  withRestaurantParam,
  getInitialOrderModeHint,
  getBookingIntent,
  getReservationHint,
  getRestaurantId
} from '../utils/restaurantContext';
import { initTelegramMiniApp, TelegramWebAppUser } from '../utils/telegramMiniApp';
import { cartLineTotal } from '../utils/cart';

// ---------------------------------------------------------------------------
// The guest surface (clients.qulaycafe.uz). Everything a person sitting at a
// table — or ordering delivery from an Instagram link — can reach.
//
// It knows nothing about staff sessions, orders belonging to other tables, the
// kitchen display, or the admin dashboard: none of that is imported here, so
// none of it is in the JavaScript this browser downloads.
//
// Note there is deliberately NO /api/auth/me call on this surface. Which
// restaurant this guest belongs to is already fully decided before React
// mounts (initRestaurantContext resolves /order/<slug>, /book/<slug> or ?r=
// and stores it), so the menu request goes out on the very first tick instead
// of waiting for a session round-trip that can only ever answer "no session".
// That serial round-trip was why the menu often needed 2-3 refreshes to show.
// ---------------------------------------------------------------------------
export default function CustomerApp() {
  const [lang, setLang] = useState<Language>('uz');
  const { errorToast, showError } = useErrorToast();
  const [isRealtimeConnected, setIsRealtimeConnected] = useState<boolean>(true);

  // --- Menu data (public, tenant-scoped by the X-Restaurant-Id header) ---
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  // 'loading' until the menu request settles, so the guest sees a skeleton
  // rather than a bare "no dishes found" screen.
  const [menuState, setMenuState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [branding, setBranding] = useState<{
    logoUrl: string | null;
    brandColor: string | null;
    restaurantName: string | null;
    contactPhone: string | null;
    contactAddress: string | null;
    contactInstagram: string | null;
    workingHours: string | null;
  }>({
    logoUrl: null,
    brandColor: null,
    restaurantName: null,
    contactPhone: null,
    contactAddress: null,
    contactInstagram: null,
    workingHours: null
  });

  // --- Where/how this guest is ordering ---
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [isTableModalOpen, setIsTableModalOpen] = useState<boolean>(false);
  const [orderMode, setOrderMode] = useState<'dine_in' | 'delivery' | 'pickup'>(
    getInitialOrderModeHint() || 'dine_in'
  );
  const [deliveryStatus, setDeliveryStatus] = useState<'disabled' | 'active' | 'suspended'>('disabled');
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [deliveryPhone, setDeliveryPhone] = useState<string>('');
  const [deliveryLat, setDeliveryLat] = useState<number | null>(null);
  const [deliveryLng, setDeliveryLng] = useState<number | null>(null);
  const [isQRScannerModalOpen, setIsQRScannerModalOpen] = useState<boolean>(false);

  // --- Cart ---
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);
  const [selectedDishForCustomization, setSelectedDishForCustomization] = useState<MenuItem | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeCustomerOrder, setActiveCustomerOrder] = useState<Order | null>(null);

  // --- Identity (optional: Google or Telegram, used for loyalty + order
  //     verification). There is no guest account/password anywhere. ---
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(() => {
    const saved = localStorage.getItem('prime_restaurant_google_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  });
  const [telegramWebAppUser, setTelegramWebAppUser] = useState<TelegramWebAppUser | null>(null);
  const [isGoogleAuthModalOpen, setIsGoogleAuthModalOpen] = useState<boolean>(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);
  const [isWelcomeSplashOpen, setIsWelcomeSplashOpen] = useState<boolean>(!getBookingIntent());
  const [customerName, setCustomerName] = useState<string>(() => googleUser?.name || '');
  const [customerPhoneOrEmail, setCustomerPhoneOrEmail] = useState<string>(() => googleUser?.email || '');
  const [confirmationCode, setConfirmationCode] = useState<string>('');
  const [currentLoyaltyMember, setCurrentLoyaltyMember] = useState<LoyaltyMember | null>(null);
  const [isLoyaltyModalOpen, setIsLoyaltyModalOpen] = useState<boolean>(false);
  // The points ("ball") program can be switched off per restaurant from the
  // owner bot. Optimistically 'active' — the real value lands with /api/settings
  // a moment later, and the server refuses to award or spend points either way.
  const [loyaltyStatus, setLoyaltyStatus] = useState<'disabled' | 'active'>('active');
  const isLoyaltyEnabled = loyaltyStatus === 'active';

  // --- Table booking ---
  const [reservationStatus, setReservationStatus] = useState<'disabled' | 'active'>(
    getReservationHint()?.status === 'active' ? 'active' : 'disabled'
  );
  const [isReservationModalOpen, setIsReservationModalOpen] = useState<boolean>(false);
  const [reservationToken, setReservationToken] = useState<string | null>(null);
  const [bookingSlug, setBookingSlug] = useState<string | null>(getBookingIntent()?.slug || null);
  const [arrivedForBooking, setArrivedForBooking] = useState<boolean>(!!getBookingIntent());

  // If opened from inside Telegram as a Mini App (via the bot's ordering
  // button), verify the signed identity Telegram provides — this counts as a
  // legitimate verification path, same as Google Sign-In.
  useEffect(() => {
    initTelegramMiniApp().then(user => {
      if (user) setTelegramWebAppUser(user);
    });
  }, []);

  // Publicly-readable data: menu + tables + categories.
  //
  // Each request is retried twice on a transport error with a short backoff:
  // the very first request from a cold mobile connection is the one that tends
  // to fail, and an empty menu is indistinguishable from "this restaurant has
  // no dishes" to the person looking at it.
  const fetchState = async () => {
    setMenuState(prev => (prev === 'ready' ? prev : 'loading'));

    const getJson = async (url: string, retries = 2): Promise<any | null> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await fetch(url);
          if (res.ok) return await res.json();
          // A 4xx/5xx is a real answer, not a flaky connection — don't retry.
          return null;
        } catch {
          if (attempt === retries) return null;
          await new Promise(resolve => window.setTimeout(resolve, 300 * (attempt + 1)));
        }
      }
      return null;
    };

    const [menuRes, tablesRes, categoriesRes] = await Promise.all([
      getJson('/api/menu'),
      getJson('/api/tables'),
      getJson('/api/categories')
    ]);

    if (tablesRes) setTables(tablesRes);
    if (categoriesRes) setCategories(categoriesRes);

    if (menuRes) {
      setMenuItems(menuRes);
      setMenuState('ready');
    } else {
      setMenuState('error');
      showError("Menyuni yuklab bo'lmadi. Internetni tekshirib, qaytadan urinib ko'ring.");
    }
  };

  // Fired on the first tick — nothing to wait for, the tenant is already known.
  useEffect(() => {
    fetchState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Branding + which optional features this restaurant has (delivery,
  // bookings, points). Also fired immediately, in parallel with the menu.
  useEffect(() => {
    fetch('/api/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        setBranding({
          logoUrl: data.logoUrl || null,
          brandColor: data.brandColor || null,
          restaurantName: data.restaurantName || null,
          contactPhone: data.contactPhone || null,
          contactAddress: data.contactAddress || null,
          contactInstagram: data.contactInstagram || null,
          workingHours: data.workingHours || null
        });
        if (data.deliveryStatus) setDeliveryStatus(data.deliveryStatus);
        if (data.reservationStatus) setReservationStatus(data.reservationStatus);
        if (data.loyaltyStatus) setLoyaltyStatus(data.loyaltyStatus);
        if (data.slug) setBookingSlug(prev => prev || data.slug);
      })
      .catch(() => {});
  }, []);

  // Table number from the QR link (?table=N). No table means this person came
  // from a general link, so they keep whatever order mode was hinted at.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTable = params.get('table');
    if (urlTable) {
      const parsedNum = parseInt(urlTable, 10);
      if (!isNaN(parsedNum) && parsedNum > 0) {
        setTableNumber(parsedNum);
        setIsTableModalOpen(false);
      } else {
        setIsTableModalOpen(true);
      }
    } else {
      setTableNumber(1);
    }
  }, []);

  // This table's own open order. Kept out of fetchState so picking a table
  // later (QR scan, table modal) actually loads its order right away.
  useEffect(() => {
    if (!tableNumber || orderMode !== 'dine_in') return;
    let cancelled = false;
    fetch(`/api/orders/table/${tableNumber}`)
      .then(r => (r.ok ? r.json() : null))
      .then(myOrders => {
        if (!cancelled && myOrders) setOrders(myOrders);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tableNumber, orderMode]);

  // Real-time updates, scoped as narrowly as the guest's situation allows:
  //  - dine-in: this table's channel (order status + menu/table changes)
  //  - delivery/pickup: the single order they placed, by id — never a shared
  //    channel, so one guest's address/phone/items can never reach another.
  useEffect(() => {
    if (orderMode !== 'dine_in') {
      if (!activeCustomerOrder?.id) return;
      const eventSource = new EventSource(withRestaurantParam(`/api/events/order/${activeCustomerOrder.id}`));
      eventSource.onopen = () => setIsRealtimeConnected(true);
      eventSource.onerror = () => setIsRealtimeConnected(false);
      eventSource.onmessage = event => {
        try {
          const payload = JSON.parse(event.data);
          if ((payload.type === 'ORDER_CREATED' || payload.type === 'ORDER_UPDATED') && payload.data.order) {
            setOrders(prev => {
              const exists = prev.some(o => o.id === payload.data.order.id);
              return exists
                ? prev.map(o => (o.id === payload.data.order.id ? payload.data.order : o))
                : [payload.data.order, ...prev];
            });
          }
        } catch (e) {
          console.error('Error parsing SSE event', e);
        }
      };
      return () => eventSource.close();
    }

    if (!tableNumber) return;
    const eventSource = new EventSource(withRestaurantParam(`/api/events/table/${tableNumber}`));
    eventSource.onopen = () => setIsRealtimeConnected(true);
    eventSource.onerror = () => setIsRealtimeConnected(false);
    eventSource.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'ORDER_CREATED' || payload.type === 'ORDER_UPDATED') {
          if (payload.data.order) {
            setOrders(prev => {
              const exists = prev.some(o => o.id === payload.data.order.id);
              return exists
                ? prev.map(o => (o.id === payload.data.order.id ? payload.data.order : o))
                : [payload.data.order, ...prev];
            });
          }
        } else if (payload.type === 'MENU_UPDATED') {
          if (Array.isArray(payload.data)) setMenuItems(payload.data);
        } else if (payload.type === 'CATEGORIES_UPDATED') {
          // The table stream carries the active-only list — exactly what the
          // guest's category tabs should show.
          if (Array.isArray(payload.data)) setCategories(payload.data);
        } else if (payload.type === 'TABLE_INFO_UPDATED') {
          if (payload.data?.tableNumber !== undefined) {
            setTables(prev =>
              prev.map(t =>
                t.tableNumber === payload.data.tableNumber ? { ...t, comment: payload.data.comment } : t
              )
            );
          }
        }
      } catch (e) {
        console.error('Error parsing SSE event', e);
      }
    };
    return () => eventSource.close();
  }, [tableNumber, orderMode, activeCustomerOrder?.id]);

  // Keep the tracked order in step with whatever arrived over SSE.
  useEffect(() => {
    if (orderMode !== 'dine_in') {
      setActiveCustomerOrder(prev => {
        if (!prev) return prev;
        return orders.find(o => o.id === prev.id) || prev;
      });
      return;
    }
    if (tableNumber) {
      const tableOrder = orders.find(
        o => o.tableNumber === tableNumber && o.status !== 'paid' && o.status !== 'cancelled'
      );
      setActiveCustomerOrder(tableOrder || null);
    }
  }, [tableNumber, orders, orderMode]);

  // The guest's own booking token. Kept per restaurant so a phone that booked
  // at two different places doesn't show one restaurant's booking under the
  // other's name. A ?b=<token> link wins over the remembered one — that is the
  // link the guest deliberately opened.
  const bookingTokenStorageKey = `qulaycafe_booking_token_${getRestaurantId()}`;

  useEffect(() => {
    const intent = getBookingIntent();
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(bookingTokenStorageKey);
    } catch {
      /* localStorage blocked (private mode, some in-app browsers) — the
         booking still works, it just can't be reopened later */
    }
    const token = intent?.token || remembered;
    if (token) setReservationToken(token);
    if (intent) setIsReservationModalOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReservationTokenIssued = (token: string) => {
    setReservationToken(token);
    try {
      localStorage.setItem(bookingTokenStorageKey, token);
    } catch {
      /* see above — nothing to do, the code is on screen */
    }
  };

  const handleReservationTokenInvalid = () => {
    setReservationToken(null);
    try {
      localStorage.removeItem(bookingTokenStorageKey);
    } catch {
      /* ignore */
    }
  };

  const handleSignInGoogle = (user: GoogleUser) => {
    setGoogleUser(user);
    setCustomerName(user.name);
    setCustomerPhoneOrEmail(user.email);
    localStorage.setItem('prime_restaurant_google_user', JSON.stringify(user));
  };

  const handleSignOutGoogle = () => {
    setGoogleUser(null);
    localStorage.removeItem('prime_restaurant_google_user');
  };

  // --- Cart operations ---
  const handleDirectAddToCart = (dish: MenuItem) => {
    if (!dish.isAvailable) {
      showError(`"${dish.name}" tugadi.`);
      return;
    }
    setCartItems(prev => {
      const existingIndex = prev.findIndex(
        i => i.menuItem.id === dish.id && i.selectedCustomizations.length === 0 && !i.specialInstructions
      );
      if (existingIndex > -1) {
        const existing = prev[existingIndex];
        const newQty = existing.quantity + 1;
        const updated = [...prev];
        updated[existingIndex] = {
          ...existing,
          quantity: newQty,
          itemTotal: cartLineTotal(existing, newQty)
        };
        return updated;
      }
      const cartItemId = 'cart-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5);
      return [
        ...prev,
        {
          cartItemId,
          menuItem: dish,
          quantity: 1,
          selectedCustomizations: [],
          specialInstructions: '',
          itemTotal: dish.price
        }
      ];
    });
  };

  const handleAddToCart = (itemData: Omit<CartItem, 'cartItemId'>) => {
    const cartItemId = 'cart-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5);
    setCartItems(prev => [...prev, { ...itemData, cartItemId }]);
    setIsCartOpen(true);
  };

  const handleRemoveCartItem = (cartItemId: string) => {
    setCartItems(prev => prev.filter(i => i.cartItemId !== cartItemId));
  };

  const handleUpdateQuantity = (cartItemId: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveCartItem(cartItemId);
      return;
    }
    setCartItems(prev =>
      prev.map(item =>
        item.cartItemId === cartItemId
          ? { ...item, quantity: newQty, itemTotal: cartLineTotal(item, newQty) }
          : item
      )
    );
  };

  const handleClearCart = () => setCartItems([]);

  const handleCallWaiter = async (tableNum: number): Promise<boolean> => {
    try {
      const res = await fetch('/api/waiter-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableNumber: tableNum })
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // Submit the order to the kitchen.
  const handleSubmitOrder = async (orderConfig: {
    paymentMethod: 'card' | 'cash';
    loyaltyPointsRedeemed: number;
    orderNote: string;
  }): Promise<boolean> => {
    const subtotal = cartItems.reduce((acc, item) => acc + item.itemTotal, 0);
    const tax = subtotal * 0.08;
    const serviceCharge = subtotal * 0.05;
    const discount = orderConfig.loyaltyPointsRedeemed * 100;
    const totalAmount = Math.max(0, subtotal + tax + serviceCharge - discount);
    const isDelivery = orderMode === 'delivery';
    const isPickup = orderMode === 'pickup';
    const isTakeoutLike = isDelivery || isPickup; // neither has a real physical table

    const payload = {
      tableNumber: isTakeoutLike ? 0 : tableNumber || 1,
      customerName:
        customerName ||
        (isDelivery ? 'Dostavka mijozi' : isPickup ? 'Olib ketish mijozi' : `Table ${tableNumber || 1} Guest`),
      customerPhoneOrEmail: customerPhoneOrEmail || '',
      items: cartItems,
      subtotal,
      tax,
      serviceCharge,
      discount,
      totalAmount,
      loyaltyPointsRedeemed: orderConfig.loyaltyPointsRedeemed,
      paymentMethod: orderConfig.paymentMethod,
      orderNote: orderConfig.orderNote,
      orderType: isDelivery ? 'delivery' : isPickup ? 'pickup' : 'dine_in',
      deliveryAddress: isDelivery ? deliveryAddress : undefined,
      // Pickup reuses the same phone field so the kitchen can call the
      // customer when the order is ready.
      deliveryPhone: isTakeoutLike ? deliveryPhone : undefined,
      deliveryLat: isDelivery && deliveryLat != null ? deliveryLat : undefined,
      deliveryLng: isDelivery && deliveryLng != null ? deliveryLng : undefined
    };

    // A stable idempotency key per submit attempt so a flaky mobile network
    // retry can never create two real orders for one tap of "confirm".
    const idempotencyKey = `order-${isTakeoutLike ? orderMode : tableNumber}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const createdOrder: Order = await res.json();
        setOrders(prev => [createdOrder, ...prev]);
        setActiveCustomerOrder(createdOrder);
        setCartItems([]);
        setDeliveryLat(null);
        setDeliveryLng(null);
        return true;
      }
      const body = await res.json().catch(() => ({ error: null }));
      showError(body.error || "Buyurtma yuborilmadi. Qaytadan urinib ko'ring.");
      // Returning false keeps the cart drawer open so the guest can retry
      // without rebuilding the whole order.
      return false;
    } catch {
      showError("Oshxona bilan aloqa yo'q. Buyurtma YUBORILMADI — internetni tekshirib qaytadan urinib ko'ring.");
      return false;
    }
  };

  // Loyalty self-service: exact match on the guest's own phone/email only,
  // via the public lookup endpoint.
  const handleVerifyLoyalty = async (query: string, code: string, nameOverride?: string) => {
    // Nothing to look up or register while the restaurant's points program is
    // off — the endpoints answer 403, and contact verification for the order
    // itself does not depend on having a member record.
    if (!isLoyaltyEnabled) return;
    const nameToUse = nameOverride || customerName;
    try {
      const res = await fetch(`/api/loyalty/lookup?identifier=${encodeURIComponent(query)}`);
      if (res.ok) {
        const member: LoyaltyMember | null = await res.json();
        if (member) {
          setCurrentLoyaltyMember(member);
          setCustomerName(member.name);
          return;
        }
      }
      // No existing member found -> register a new one.
      const regRes = await fetch('/api/loyalty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameToUse, phoneOrEmail: query, confirmationCode: code })
      });
      if (regRes.ok) {
        setCurrentLoyaltyMember(await regRes.json());
      } else {
        showError("Sodiqlik a'zoligini tasdiqlab bo'lmadi. Qaytadan urinib ko'ring.");
      }
    } catch {
      showError("Serverga ulanib bo'lmadi.");
    }
  };

  const cartSubtotal = cartItems.reduce((acc, item) => acc + item.itemTotal, 0);
  const cartCount = cartItems.reduce((acc, i) => acc + i.quantity, 0);

  return (
    <CurrencyProvider>
      <div className="min-h-screen bg-zinc-100 text-zinc-900 font-sans selection:bg-orange-500 selection:text-white">
        <ErrorToast message={errorToast} />

        <HeaderNav
          tableNumber={tableNumber}
          onOpenQRScanner={() => setIsQRScannerModalOpen(true)}
          onOpenLocation={() => setIsLocationModalOpen(true)}
          onOpenGoogleAuth={() => setIsGoogleAuthModalOpen(true)}
          googleUser={googleUser}
          cartCount={cartCount}
          onOpenCart={() => setIsCartOpen(true)}
          onOpenOrderHistory={() => setIsLoyaltyModalOpen(true)}
          loyaltyPoints={isLoyaltyEnabled ? currentLoyaltyMember?.pointsBalance : undefined}
          loyaltyEnabled={isLoyaltyEnabled}
          lang={lang}
          onLanguageChange={setLang}
          showTableTools={orderMode === 'dine_in'}
          branding={branding}
        />

        <main>
          <CustomerView
            menuItems={menuItems}
            categories={categories}
            tableNumber={tableNumber || 1}
            tableComment={tables.find(t => t.tableNumber === (tableNumber || 1))?.comment}
            onSelectItem={item => setSelectedDishForCustomization(item)}
            onDirectAddToCart={handleDirectAddToCart}
            cartCount={cartCount}
            cartSubtotal={cartSubtotal}
            onOpenCart={() => setIsCartOpen(true)}
            onOpenQRScanner={() => setIsQRScannerModalOpen(true)}
            onOpenLocation={() => setIsLocationModalOpen(true)}
            onOpenGoogleAuth={() => setIsGoogleAuthModalOpen(true)}
            lang={lang}
            onLanguageChange={setLang}
            activeOrder={activeCustomerOrder}
            logoUrl={branding.logoUrl}
            brandColor={branding.brandColor}
            restaurantName={branding.restaurantName}
            contactPhone={branding.contactPhone}
            contactAddress={branding.contactAddress}
            contactInstagram={branding.contactInstagram}
            onCallWaiter={handleCallWaiter}
            deliveryEnabled={deliveryStatus === 'active'}
            orderMode={orderMode}
            onSetOrderMode={setOrderMode}
            menuState={menuState}
            onRetryMenu={fetchState}
            reservationsEnabled={reservationStatus === 'active'}
            onOpenReservation={() => setIsReservationModalOpen(true)}
          />

          <OrderStatusTracker activeOrder={activeCustomerOrder} hasCartItems={cartItems.length > 0} lang={lang} />
        </main>

        {/* Table QR camera scanner */}
        <QRScannerModal
          isOpen={isQRScannerModalOpen}
          onClose={() => setIsQRScannerModalOpen(false)}
          onSelectTable={num => setTableNumber(num)}
          lang={lang}
        />

        {/* Table selection / confirmation */}
        <TableConfirmModal
          isOpen={isTableModalOpen}
          currentTable={tableNumber}
          tables={tables}
          onConfirm={num => {
            setTableNumber(num);
            setIsTableModalOpen(false);
          }}
          lang={lang}
        />

        {/* Dish customizer */}
        <ItemCustomizerModal
          item={selectedDishForCustomization}
          isOpen={!!selectedDishForCustomization}
          onClose={() => setSelectedDishForCustomization(null)}
          onAddToCart={handleAddToCart}
          lang={lang}
        />

        {/* Cart + bill breakdown */}
        <CartDrawer
          isOpen={isCartOpen}
          onClose={() => setIsCartOpen(false)}
          cartItems={cartItems}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={handleRemoveCartItem}
          onClearCart={handleClearCart}
          tableNumber={tableNumber || 1}
          customerName={customerName}
          setCustomerName={setCustomerName}
          customerPhoneOrEmail={customerPhoneOrEmail}
          setCustomerPhoneOrEmail={setCustomerPhoneOrEmail}
          confirmationCode={confirmationCode}
          setConfirmationCode={setConfirmationCode}
          loyaltyMember={isLoyaltyEnabled ? currentLoyaltyMember : null}
          loyaltyEnabled={isLoyaltyEnabled}
          onVerifyLoyalty={handleVerifyLoyalty}
          googleUser={googleUser}
          onOpenGoogleAuth={() => setIsGoogleAuthModalOpen(true)}
          onSubmitOrder={handleSubmitOrder}
          lang={lang}
          orderMode={orderMode}
          deliveryAddress={deliveryAddress}
          setDeliveryAddress={setDeliveryAddress}
          deliveryPhone={deliveryPhone}
          setDeliveryPhone={setDeliveryPhone}
          deliveryLat={deliveryLat}
          deliveryLng={deliveryLng}
          onCaptureLocation={(lat, lng) => {
            setDeliveryLat(lat);
            setDeliveryLng(lng);
          }}
          telegramWebAppUser={telegramWebAppUser}
        />

        {/* This guest's own orders + loyalty balance */}
        <OrderHistoryModal
          isOpen={isLoyaltyModalOpen}
          onClose={() => setIsLoyaltyModalOpen(false)}
          member={isLoyaltyEnabled ? currentLoyaltyMember : null}
          loyaltyEnabled={isLoyaltyEnabled}
          orders={orders.filter(
            o => o.tableNumber === tableNumber || o.customerPhoneOrEmail === customerPhoneOrEmail
          )}
          lang={lang}
        />

        <GoogleAuthModal
          isOpen={isGoogleAuthModalOpen}
          onClose={() => setIsGoogleAuthModalOpen(false)}
          currentUser={googleUser}
          onSignInSuccess={handleSignInGoogle}
          onSignOut={handleSignOutGoogle}
          lang={lang}
        />

        <RestaurantLocationModal
          isOpen={isLocationModalOpen}
          onClose={() => setIsLocationModalOpen(false)}
          branding={branding}
        />

        <WelcomeSplash
          isOpen={isWelcomeSplashOpen}
          onClose={() => setIsWelcomeSplashOpen(false)}
          lang={lang}
          onSelectLang={newLang => setLang(newLang)}
          branding={branding}
        />

        {/* Table booking. Two entry points, one component: the "Book a table"
            button on the menu, and the standalone /book/<slug> link a
            restaurant shares (which opens it on arrival). */}
        <ReservationModal
          isOpen={isReservationModalOpen && reservationStatus === 'active'}
          onClose={() => setIsReservationModalOpen(false)}
          lang={lang}
          brandColor={branding.brandColor}
          restaurantName={branding.restaurantName}
          bookingSlug={bookingSlug}
          initialToken={reservationToken}
          onTokenIssued={handleReservationTokenIssued}
          onTokenInvalid={handleReservationTokenInvalid}
          onViewMenu={
            arrivedForBooking
              ? () => {
                  setIsReservationModalOpen(false);
                  setArrivedForBooking(false);
                }
              : undefined
          }
        />

        {/* A dropped real-time connection is worth telling the guest about:
            their order status would otherwise appear frozen. */}
        {!isRealtimeConnected && (
          <div className="fixed bottom-2 left-2 z-40 bg-zinc-900/90 text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg">
            ⚠ Aloqa tiklanmoqda…
          </div>
        )}
      </div>
    </CurrencyProvider>
  );
}
