import React, { useEffect, useState } from 'react';
import { MenuCategory, MenuItem, Order, LoyaltyMember, Table, OrderStatus, WaiterCall } from '../types';
import { Language, translations } from '../lib/translations';
import { playOrderChimeSound } from '../utils/audio';
import { KitchenDisplay } from '../components/kitchen/KitchenDisplay';
import { AdminDashboard } from '../components/admin/AdminDashboard';
import { OnboardingWizard } from '../components/admin/OnboardingWizard';
import { AdminAuthModal } from '../components/admin/AdminAuthModal';
import { ErrorToast, useErrorToast } from '../components/ErrorToast';
import { CurrencyProvider } from '../utils/CurrencyContext';
import { setRestaurantId } from '../utils/restaurantContext';
import { getAdminBaseUrl, getClientsBaseUrl, getKitchenBaseUrl, Surface } from '../utils/surface';
import { describeApiError } from '../utils/apiErrors';
import { ChefHat, LayoutDashboard, LogOut, Wifi, WifiOff } from 'lucide-react';

// ---------------------------------------------------------------------------
// The staff surfaces: admin.qulaycafe.uz and kitchen.qulaycafe.uz.
//
// One module for both, because they share the same session handling, the same
// real-time stream and most of the same data. Which one is rendered is decided
// by the hostname, never by an in-app toggle — there is no path from the guest
// surface into this code, and no path from the kitchen into the dashboard
// beyond logging in as an admin on the admin hostname.
//
// This whole module is behind React.lazy() in App.tsx, so it is downloaded
// only by a browser that actually landed on a staff hostname.
// ---------------------------------------------------------------------------
export default function StaffApp({ surface }: { surface: Extract<Surface, 'admin' | 'kitchen'> }) {
  const [lang, setLang] = useState<Language>('uz');
  const t = translations[lang];
  const { errorToast, showError } = useErrorToast();
  const [isRealtimeConnected, setIsRealtimeConnected] = useState<boolean>(true);

  // Mirrors what /api/auth/me told us; the real check is server-side.
  const [role, setRole] = useState<'admin' | 'kitchen' | null>(null);
  const [sessionChecked, setSessionChecked] = useState<boolean>(false);
  const isAdmin = role === 'admin';
  // An admin can work the kitchen screen; a kitchen login can never reach the
  // dashboard.
  const isKitchen = role === 'admin' || role === 'kitchen';
  const authorized = surface === 'admin' ? isAdmin : isKitchen;

  const [loggedInRestaurantId, setLoggedInRestaurantId] = useState<string>('default');
  const [loggedInRestaurantName, setLoggedInRestaurantName] = useState<string | null>(null);
  const [loggedInRestaurantSlug, setLoggedInRestaurantSlug] = useState<string | null>(null);
  const [subscriptionPeriodEnd, setSubscriptionPeriodEnd] = useState<string | null>(null);
  const [subscriptionBlocked, setSubscriptionBlocked] = useState<boolean>(false);
  const [deliveryStatus, setDeliveryStatus] = useState<'disabled' | 'active' | 'suspended'>('disabled');
  const [reservationStatus, setReservationStatus] = useState<'disabled' | 'active'>('disabled');
  // Bumped on every reservation SSE event; the dashboard refetches when it
  // changes, which keeps one source of truth (the server) for the list.
  const [reservationsVersion, setReservationsVersion] = useState<number>(0);
  // Server-backed (settings.onboardingCompleted), so the setup wizard is asked
  // once per restaurant instead of on every admin login.
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(false);
  const [kitchenTelegramLinked, setKitchenTelegramLinked] = useState<boolean>(false);
  // Staff-only data has been fetched at least once. The onboarding wizard waits
  // for this: "0 tables" during the initial load is not "this restaurant has no
  // tables".
  const [staffStateLoaded, setStaffStateLoaded] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [loyaltyMembers, setLoyaltyMembers] = useState<LoyaltyMember[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
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

  // Restore the session on load/refresh — the server is the source of truth.
  // A staff member's restaurant id only becomes known here, and every /api/…
  // request carries it as a header, so no restaurant-scoped fetch may run
  // before this resolves.
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : { role: null }))
      .then(({ role: sessionRole, restaurantId, restaurantName, restaurantSlug, subscriptionPeriodEnd: periodEnd, subscriptionActive, deliveryStatus: delivery, reservationStatus: reservation, onboardingCompleted, telegramLinked }) => {
        setRole(sessionRole === 'admin' || sessionRole === 'kitchen' ? sessionRole : null);
        if (restaurantId) {
          setLoggedInRestaurantId(restaurantId);
          setRestaurantId(restaurantId);
        }
        if (restaurantName) setLoggedInRestaurantName(restaurantName);
        if (restaurantSlug) setLoggedInRestaurantSlug(restaurantSlug);
        if (periodEnd) setSubscriptionPeriodEnd(periodEnd);
        if (delivery) setDeliveryStatus(delivery);
        if (reservation) setReservationStatus(reservation);
        if (onboardingCompleted) setOnboardingDismissed(true);
        setKitchenTelegramLinked(!!telegramLinked);
        if ((sessionRole === 'admin' || sessionRole === 'kitchen') && subscriptionActive === false) {
          setSubscriptionBlocked(true);
        }
      })
      .catch(() => {})
      .finally(() => setSessionChecked(true));
  }, []);

  // The login form is what this hostname is for when nobody is signed in, so it
  // opens by itself rather than hiding behind a button.
  useEffect(() => {
    if (sessionChecked && !authorized) setIsAuthModalOpen(true);
    if (authorized) setIsAuthModalOpen(false);
  }, [sessionChecked, authorized]);

  // Menu, tables and category list. Waits for the session so the request
  // carries the right restaurant, and re-runs if that id changes (login,
  // logout, switching restaurant).
  const fetchState = async () => {
    const getJson = async (url: string): Promise<any | null> => {
      try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    };
    const [menuRes, tablesRes, categoriesRes] = await Promise.all([
      getJson('/api/menu'),
      getJson('/api/tables'),
      getJson('/api/categories')
    ]);
    if (menuRes) setMenuItems(menuRes);
    if (tablesRes) setTables(tablesRes);
    if (categoriesRes) setCategories(categoriesRes);
  };

  const refreshAdminCategories = async () => {
    const list = await fetch('/api/admin/categories').then(r => (r.ok ? r.json() : null));
    if (list) setCategories(list);
  };

  // After a bulk menu import the whole menu and category list can change at
  // once; re-read both rather than patching local state row by row.
  const handleRefreshMenu = async () => {
    await fetchState();
    try {
      const res = await fetch('/api/admin/categories');
      if (res.ok) setCategories(await res.json());
    } catch {
      // The public list fetched by fetchState is already in place.
    }
  };

  // Full order list, loyalty list, pending waiter calls, and (admin only) the
  // category list including inactive sections.
  const fetchStaffState = async () => {
    try {
      const ordersRawRes = await fetch('/api/orders');
      if (ordersRawRes.status === 402) {
        setSubscriptionBlocked(true);
        return;
      }
      const [ordersRes, loyaltyRes, waiterCallsRes, adminCategoriesRes] = await Promise.all([
        ordersRawRes.ok ? ordersRawRes.json() : null,
        fetch('/api/loyalty').then(r => (r.ok ? r.json() : null)),
        fetch('/api/admin/waiter-calls?pending=true').then(r => (r.ok ? r.json() : null)),
        // Admin-only, so a kitchen session simply gets nothing here and keeps
        // the public active-only list it already has.
        fetch('/api/admin/categories').then(r => (r.ok ? r.json() : null))
      ]);
      setSubscriptionBlocked(false);
      if (ordersRes) setOrders(ordersRes);
      if (loyaltyRes) setLoyaltyMembers(loyaltyRes);
      if (waiterCallsRes) setWaiterCalls(waiterCallsRes);
      if (adminCategoriesRes) setCategories(adminCategoriesRes);
    } catch {
      showError('Buyurtma/mijoz maʼlumotlarini yangilab boʻlmadi.');
    } finally {
      setStaffStateLoaded(true);
    }
  };

  useEffect(() => {
    if (!sessionChecked || !authorized) return;
    fetchState();
    fetchStaffState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionChecked, authorized, loggedInRestaurantId]);

  // Branding — also gives the staff top bar the restaurant's real name.
  useEffect(() => {
    if (!sessionChecked || !authorized) return;
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
      })
      .catch(() => {});
  }, [sessionChecked, authorized, loggedInRestaurantId]);

  // Staff real-time stream: full order/menu/table detail, session-gated on the
  // server as well as here.
  useEffect(() => {
    if (!authorized) return;
    const eventSource = new EventSource('/api/events');
    eventSource.onopen = () => setIsRealtimeConnected(true);
    eventSource.onerror = () => setIsRealtimeConnected(false);
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'ORDER_CREATED') {
          if (payload.data.order) {
            setOrders(prev => [payload.data.order, ...prev.filter(o => o.id !== payload.data.order.id)]);
          }
        } else if (payload.type === 'ORDER_UPDATED') {
          if (payload.data.order) {
            setOrders(prev => prev.map(o => (o.id === payload.data.order.id ? payload.data.order : o)));
          }
        } else if (payload.type === 'MENU_UPDATED') {
          if (Array.isArray(payload.data)) setMenuItems(payload.data);
        } else if (payload.type === 'CATEGORIES_UPDATED') {
          // Staff stream carries the full list, inactive sections included.
          if (Array.isArray(payload.data)) setCategories(payload.data);
        } else if (payload.type === 'TABLES_UPDATED') {
          if (Array.isArray(payload.data)) setTables(payload.data);
        } else if (payload.type === 'ORDER_DELETED') {
          if (payload.data?.id) setOrders(prev => prev.filter(o => o.id !== payload.data.id));
        } else if (payload.type === 'ORDERS_CLEANED_UP') {
          fetchStaffState(); // simplest correct way to reflect a bulk deletion
        } else if (payload.type === 'WAITER_CALL') {
          setWaiterCalls(prev => [payload.data, ...prev]);
          playOrderChimeSound();
        } else if (payload.type === 'WAITER_CALL_RESOLVED') {
          if (payload.data?.id) {
            setWaiterCalls(prev => prev.map(c => (c.id === payload.data.id ? { ...c, status: 'resolved' } : c)));
          }
        } else if (payload.type === 'RESERVATION_UPDATED') {
          // Bookings arrive from Telegram, not from this browser, so the list is
          // always refetched rather than patched — this only signals a change.
          setReservationsVersion(v => v + 1);
          if (payload.data?.status === 'pending') playOrderChimeSound();
        }
      } catch (e) {
        console.error('Error parsing SSE event', e);
      }
    };
    return () => eventSource.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized]);

  // ---------------------------------------------------------------------------
  // Login / logout. The hostname decides which credential set is asked for —
  // there is no in-app target switch any more, so a kitchen PIN can never be
  // typed into the admin form by accident (or on purpose).
  // ---------------------------------------------------------------------------
  const handleAuthenticate = async (phone: string, pass: string): Promise<boolean> => {
    const endpoint = surface === 'kitchen' ? '/api/auth/kitchen/login' : '/api/auth/admin/login';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password: pass })
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      if (data?.restaurantId) {
        setLoggedInRestaurantId(data.restaurantId);
        setRestaurantId(data.restaurantId);
      }
      if (data?.restaurantName) setLoggedInRestaurantName(data.restaurantName);
      if (data?.restaurantSlug) setLoggedInRestaurantSlug(data.restaurantSlug);
      if (data?.subscriptionPeriodEnd) setSubscriptionPeriodEnd(data.subscriptionPeriodEnd);
      if (data?.deliveryStatus) setDeliveryStatus(data.deliveryStatus);
      if (data?.reservationStatus) setReservationStatus(data.reservationStatus);
      setRole(surface === 'kitchen' ? 'kitchen' : 'admin');
      return true;
    } catch {
      showError('Serverga ulanib boʻlmadi. Internetni tekshirib, qaytadan urinib koʻring.');
      return false;
    }
  };

  const handleRegisterRestaurant = async (name: string, phone: string, pass: string, deliveryEnabled: boolean): Promise<boolean> => {
    try {
      const res = await fetch('/api/restaurants/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, password: pass, deliveryEnabled })
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      if (data?.restaurantId) {
        setLoggedInRestaurantId(data.restaurantId);
        setRestaurantId(data.restaurantId);
      }
      if (data?.name) setLoggedInRestaurantName(data.name);
      if (data?.slug) setLoggedInRestaurantSlug(data.slug);
      setDeliveryStatus(data?.deliveryEnabled ? 'active' : 'disabled');
      setRole('admin');
      return true;
    } catch {
      showError('Serverga ulanib boʻlmadi. Internetni tekshirib, qaytadan urinib koʻring.');
      return false;
    }
  };

  // Logging out on a staff hostname drops back to the login screen — there is
  // no customer view here to fall back into. Everything loaded for the previous
  // session is cleared so a second login can never render the first
  // restaurant's orders.
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if the network call fails, still clear local UI state below.
    }
    setRole(null);
    setSubscriptionBlocked(false);
    setStaffStateLoaded(false);
    setRestaurantId('default');
    setLoggedInRestaurantId('default');
    setLoggedInRestaurantName(null);
    setLoggedInRestaurantSlug(null);
    setOrders([]);
    setTables([]);
    setMenuItems([]);
    setCategories([]);
    setLoyaltyMembers([]);
    setWaiterCalls([]);
  };

  const handleUpdateAdminPassword = async (newPass: string) => {
    try {
      const res = await fetch('/api/auth/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPass })
      });
      if (!res.ok) throw new Error('Failed to update password');
    } catch {
      showError('Admin parolini yangilab boʻlmadi. Qaytadan urinib koʻring.');
    }
  };

  const handleUpdateKitchenPin = async (newPin: string) => {
    try {
      const res = await fetch('/api/auth/kitchen/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPin })
      });
      if (!res.ok) throw new Error('Failed to update PIN');
    } catch {
      showError('Oshxona PIN kodini yangilab boʻlmadi. Qaytadan urinib koʻring.');
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: OrderStatus, paymentStatus?: 'paid' | 'unpaid') => {
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, paymentStatus })
      });
      if (res.ok) {
        const updated: Order = await res.json();
        setOrders(prev => prev.map(o => (o.id === orderId ? updated : o)));
      } else {
        showError('Buyurtma holatini yangilab boʻlmadi. Qaytadan urinib koʻring.');
      }
    } catch {
      showError('Serverga ulanib boʻlmadi — buyurtma holati yangilanmadi.');
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' });
      if (res.ok) {
        setOrders(prev => prev.filter(o => o.id !== orderId));
      } else {
        showError('Buyurtmani oʻchirib boʻlmadi. Qaytadan urinib koʻring.');
      }
    } catch {
      showError('Serverga ulanib boʻlmadi — buyurtma oʻchirilmadi.');
    }
  };

  const handleCleanupOldOrders = async (olderThanDays: number): Promise<number | null> => {
    try {
      const res = await fetch('/api/admin/orders/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanDays })
      });
      if (res.ok) {
        const result = await res.json();
        await fetchStaffState(); // refresh the order list to reflect the deletion
        return result.ordersDeleted;
      }
      showError('Eski buyurtmalarni tozalab boʻlmadi. Qaytadan urinib koʻring.');
      return null;
    } catch {
      showError('Serverga ulanib boʻlmadi — tozalash bajarilmadi.');
      return null;
    }
  };

  const handleUpdateMenuItem = async (updatedItem: MenuItem) => {
    try {
      const res = await fetch(`/api/menu/${updatedItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedItem)
      });
      if (res.ok) {
        const item: MenuItem = await res.json();
        setMenuItems(prev => prev.map(m => (m.id === item.id ? item : m)));
      } else {
        const body = await res.json().catch(() => ({}));
        showError(describeApiError(body) || 'Taomdagi oʻzgarishlarni saqlab boʻlmadi.');
      }
    } catch {
      showError('Serverga ulanib boʻlmadi — taom saqlanmadi.');
    }
  };

  const handleAddMenuItem = async (newItem: Partial<MenuItem>) => {
    try {
      const res = await fetch('/api/menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem)
      });
      if (res.ok) {
        const added: MenuItem = await res.json();
        setMenuItems(prev => [...prev, added]);
      } else {
        const body = await res.json().catch(() => ({}));
        showError(describeApiError(body) || 'Taom qoʻshilmadi. Maydonlarni tekshirib koʻring.');
      }
    } catch {
      showError('Serverga ulanib boʻlmadi — taom qoʻshilmadi.');
    }
  };

  const handleDeleteMenuItem = async (id: string) => {
    try {
      const res = await fetch(`/api/menu/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMenuItems(prev => prev.filter(m => m.id !== id));
      } else {
        showError('Taomni oʻchirib boʻlmadi. Qaytadan urinib koʻring.');
      }
    } catch {
      showError('Serverga ulanib boʻlmadi — taom oʻchirilmadi.');
    }
  };

  // ---------------------------------------------------------------------------
  // Admin category management. Every handler resolves to true/false so the
  // dashboard knows whether to close its form, and the server is treated as the
  // source of truth: the list is replaced from the response rather than patched
  // optimistically, which keeps sort_order honest.
  // ---------------------------------------------------------------------------
  const handleAddCategory = async (input: {
    nameUz: string;
    nameRu?: string;
    nameEn?: string;
    icon?: string;
  }): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      if (res.ok) {
        const created: MenuCategory = await res.json();
        setCategories(prev => [...prev.filter(c => c.id !== created.id), created]);
        return true;
      }
      const body = await res.json().catch(() => ({}));
      showError(describeApiError(body) || 'Kategoriya qoʻshilmadi. Qaytadan urinib koʻring.');
      return false;
    } catch {
      showError('Serverga ulanib boʻlmadi. Kategoriya qoʻshilmadi.');
      return false;
    }
  };

  const handleUpdateCategory = async (
    id: string,
    patch: { nameUz?: string; nameRu?: string; nameEn?: string; icon?: string; isActive?: boolean }
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/admin/categories/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (res.ok) {
        const updated: MenuCategory = await res.json();
        setCategories(prev => prev.map(c => (c.id === updated.id ? updated : c)));
        return true;
      }
      const body = await res.json().catch(() => ({}));
      showError(describeApiError(body) || 'Kategoriya saqlanmadi. Qaytadan urinib koʻring.');
      return false;
    } catch {
      showError('Serverga ulanib boʻlmadi. Kategoriya saqlanmadi.');
      return false;
    }
  };

  /**
   * Deleting a category the menu still uses is refused by the server unless a
   * `moveTo` section is named, so the dashboard can offer "move these dishes to
   * X, then delete" instead of a dead end. `dishCount` comes back with the
   * refusal so the caller can say how many dishes are in the way.
   *
   * One flat shape rather than a discriminated union: this project compiles
   * without `strict`, where TypeScript will not narrow a union by a boolean.
   */
  const handleDeleteCategory = async (
    id: string,
    moveTo?: string
  ): Promise<{ ok: boolean; movedDishes: number; dishCount?: number; error?: string }> => {
    try {
      const url = moveTo
        ? `/api/admin/categories/${encodeURIComponent(id)}?moveTo=${encodeURIComponent(moveTo)}`
        : `/api/admin/categories/${encodeURIComponent(id)}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        const body = await res.json().catch(() => ({ movedDishes: 0 }));
        setCategories(prev => prev.filter(c => c.id !== id));
        if (body.movedDishes) {
          // Those dishes now belong to another section — reload so the
          // inventory table and the customer tabs agree with the database.
          await fetchState();
          await refreshAdminCategories();
        }
        return { ok: true, movedDishes: body.movedDishes || 0 };
      }
      const body = await res.json().catch(() => ({}));
      return { ok: false, movedDishes: 0, dishCount: body.dishCount, error: describeApiError(body) || body.error };
    } catch {
      return { ok: false, movedDishes: 0, error: 'Serverga ulanib boʻlmadi.' };
    }
  };

  const handleReorderCategories = async (ids: string[]): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/categories/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      if (res.ok) {
        const list: MenuCategory[] = await res.json();
        setCategories(list);
        return true;
      }
      const body = await res.json().catch(() => ({}));
      showError(describeApiError(body) || 'Tartib saqlanmadi.');
      // A stale list means this page no longer matches the database; pull the
      // real order back so the admin is not left staring at a wrong sequence.
      await refreshAdminCategories();
      return false;
    } catch {
      showError('Serverga ulanib boʻlmadi. Tartib saqlanmadi.');
      return false;
    }
  };

  const handleAddTable = async (tableNumber: number, capacity: number, comment?: string) => {
    try {
      const res = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableNumber, capacity, comment: comment || '' })
      });
      if (res.ok) {
        const table: Table = await res.json();
        setTables(prev => {
          const exists = prev.some(t => t.tableNumber === table.tableNumber);
          if (exists) return prev.map(t => (t.tableNumber === table.tableNumber ? table : t));
          return [...prev, table].sort((a, b) => a.tableNumber - b.tableNumber);
        });
      } else {
        showError('Stolni saqlab boʻlmadi. Qaytadan urinib koʻring.');
      }
    } catch {
      showError('Serverga ulanib boʻlmadi — stol saqlanmadi.');
    }
  };

  const handleDeleteTable = async (tableNumber: number) => {
    try {
      const res = await fetch(`/api/tables/${tableNumber}`, { method: 'DELETE' });
      if (res.ok) {
        setTables(prev => prev.filter(t => t.tableNumber !== tableNumber));
      } else {
        showError('Stolni oʻchirib boʻlmadi. Qaytadan urinib koʻring.');
      }
    } catch {
      showError('Serverga ulanib boʻlmadi — stol oʻchirilmadi.');
    }
  };

  const handleResolveWaiterCall = async (callId: string) => {
    setWaiterCalls(prev => prev.map(c => (c.id === callId ? { ...c, status: 'resolved' } : c)));
    try {
      const res = await fetch(`/api/admin/waiter-calls/${callId}/resolve`, { method: 'POST' });
      if (!res.ok) throw new Error('failed');
    } catch {
      showError('Ofitsiant chaqiruvini belgilashda xatolik yuz berdi.');
      fetchStaffState();
    }
  };

  const handleUpdateExchangeRate = async (currency: 'USD' | 'RUB', rateToSom: number) => {
    try {
      const res = await fetch('/api/admin/exchange-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency, rateToSom })
      });
      if (!res.ok) showError(`${currency} kursini yangilab boʻlmadi. Qaytadan urinib koʻring.`);
    } catch {
      showError(`Serverga ulanib boʻlmadi — ${currency} kursi yangilanmadi.`);
    }
  };

  const handleUpdateSettings = async (settings: { taxPercent?: number; serviceFeePercent?: number }) => {
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (!res.ok) showError('Sozlamani yangilab boʻlmadi. Qaytadan urinib koʻring.');
    } catch {
      showError('Serverga ulanib boʻlmadi — sozlama yangilanmadi.');
    }
  };

  const handleUpdateBranding = async (params: {
    logoUrl?: string | null;
    brandColor?: string | null;
    displayName?: string;
    contactPhone?: string;
    contactAddress?: string;
    contactInstagram?: string;
    workingHours?: string;
  }): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/branding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      if (!res.ok) {
        showError('Brendlashni saqlashda xatolik yuz berdi.');
        return false;
      }
      const data = await res.json();
      setBranding({
        logoUrl: data.logoUrl,
        brandColor: data.brandColor,
        restaurantName: data.restaurantName,
        contactPhone: data.contactPhone,
        contactAddress: data.contactAddress,
        contactInstagram: data.contactInstagram,
        workingHours: data.workingHours
      });
      if (data.restaurantName) setLoggedInRestaurantName(data.restaurantName);
      return true;
    } catch {
      showError("Serverga ulanib bo'lmadi.");
      return false;
    }
  };

  const handleGenerateTelegramLink = async (): Promise<{ token: string; deepLink: string } | null> => {
    try {
      const res = await fetch('/api/admin/telegram/link-token', { method: 'POST' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const handleCheckTelegramLinkStatus = async (token: string) => {
    try {
      const res = await fetch(`/api/admin/telegram/link-status/${token}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const handleUnlinkTelegram = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/telegram/unlink', { method: 'POST' });
      if (res.ok) setKitchenTelegramLinked(false);
      return res.ok;
    } catch {
      return false;
    }
  };

  // Persists the "I've seen the wizard" flag so it never returns on the next
  // login; the local flag flips immediately either way.
  const handleFinishOnboarding = async () => {
    setOnboardingDismissed(true);
    try {
      await fetch('/api/admin/onboarding/complete', { method: 'POST' });
    } catch {
      // Non-fatal: the wizard is already closed for this session.
    }
  };

  // QR codes and shareable links must point at the guest surface, never at the
  // hostname the admin happens to be looking at — a QR printed from
  // admin.qulaycafe.uz that opened the admin login would be useless.
  const clientsBaseUrl = getClientsBaseUrl();
  // The "open this on the kitchen iPad" links have to carry the staff
  // hostnames for the same reason.
  const kitchenBaseUrl = getKitchenBaseUrl();
  const adminBaseUrl = getAdminBaseUrl();
  const showOnboarding =
    surface === 'admin' && staffStateLoaded && tables.length === 0 && !onboardingDismissed;

  return (
    <CurrencyProvider>
      <div className="min-h-screen bg-zinc-100 text-zinc-900 font-sans selection:bg-orange-500 selection:text-white">
        <ErrorToast message={errorToast} />

        {/* Staff top bar. Deliberately has no view switcher: this hostname is
            either the dashboard or the kitchen screen, decided before the app
            mounted. It does carry a logout button — the kitchen screen
            previously had no way out at all. */}
        <header className="sticky top-0 z-40 bg-zinc-900 text-white border-b border-zinc-800">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${surface === 'admin' ? 'bg-orange-500' : 'bg-emerald-500'}`}>
                {surface === 'admin' ? <LayoutDashboard className="w-4 h-4" /> : <ChefHat className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-black uppercase tracking-tight truncate">
                  {loggedInRestaurantName || branding.restaurantName || 'Qulaycafe'}
                </span>
                <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  {surface === 'admin' ? t.staffAdminTitle : t.staffKitchenTitle}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={`p-1.5 rounded-lg ${isRealtimeConnected ? 'text-emerald-400' : 'text-rose-400'}`}
                title={isRealtimeConnected ? 'Online' : 'Offline'}
              >
                {isRealtimeConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              </span>

              <div className="hidden sm:flex items-center bg-zinc-800 p-0.5 rounded-lg">
                {(['uz', 'ru', 'en'] as Language[]).map(code => (
                  <button
                    key={code}
                    onClick={() => setLang(code)}
                    className={`px-1.5 py-0.5 text-[10px] font-extrabold rounded-md transition-colors ${
                      lang === code ? 'bg-orange-500 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                    aria-pressed={lang === code}
                  >
                    {code.toUpperCase()}
                  </button>
                ))}
              </div>

              {authorized && (
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 bg-zinc-800 hover:bg-rose-600 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.staffLogout}</span>
                </button>
              )}
            </div>
          </div>
        </header>

        <main>
          {!sessionChecked && (
            <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3 text-zinc-500">
              <div className="w-8 h-8 border-2 border-zinc-300 border-t-orange-500 rounded-full animate-spin" />
              <p className="text-sm font-bold">{t.staffCheckingSession}</p>
            </div>
          )}

          {/* Not signed in (or signed in as kitchen on the admin hostname).
              The login form is the whole page here — there is no guest UI on a
              staff hostname to fall back to. */}
          {sessionChecked && !authorized && (
            <div className="min-h-[70vh] flex items-center justify-center p-6">
              <div className="max-w-sm w-full bg-white border border-zinc-200 rounded-2xl p-6 text-center space-y-4 shadow-sm">
                <div className={`w-12 h-12 mx-auto rounded-2xl flex items-center justify-center text-white ${surface === 'admin' ? 'bg-orange-500' : 'bg-emerald-500'}`}>
                  {surface === 'admin' ? <LayoutDashboard className="w-6 h-6" /> : <ChefHat className="w-6 h-6" />}
                </div>
                <div className="space-y-1.5">
                  <h1 className="text-lg font-black text-zinc-900">{t.staffSignInPrompt}</h1>
                  <p className="text-sm text-zinc-500">
                    {surface === 'admin' ? t.staffSignInAdminDesc : t.staffSignInKitchenDesc}
                  </p>
                </div>
                <button
                  onClick={() => setIsAuthModalOpen(true)}
                  className="w-full bg-zinc-900 hover:bg-black text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
                >
                  {t.staffSignInButton}
                </button>
                {/* A guest who mistyped the hostname gets a way out instead of
                    a login form they can never pass. */}
                <a
                  href={clientsBaseUrl}
                  className="block text-xs font-bold text-orange-600 hover:text-orange-700 hover:underline"
                >
                  {t.staffGuestHint}
                </a>
              </div>
            </div>
          )}

          {authorized && subscriptionBlocked && (
            <div className="min-h-[70vh] flex items-center justify-center p-6">
              <div className="max-w-sm w-full bg-white border border-rose-200 rounded-2xl p-6 text-center space-y-3 shadow-sm">
                <div className="text-3xl">⏸️</div>
                <h2 className="text-lg font-black text-zinc-900">{t.staffSubscriptionPaused}</h2>
                <p className="text-sm text-zinc-500">{t.staffSubscriptionPausedDesc}</p>
                <button
                  onClick={handleLogout}
                  className="w-full bg-zinc-900 hover:bg-black text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
                >
                  {t.staffLogout}
                </button>
              </div>
            </div>
          )}

          {surface === 'kitchen' && authorized && !subscriptionBlocked && (
            <KitchenDisplay
              orders={orders}
              onUpdateStatus={handleUpdateOrderStatus}
              lang={lang}
              waiterCalls={waiterCalls}
              onResolveWaiterCall={handleResolveWaiterCall}
              onGenerateTelegramLink={handleGenerateTelegramLink}
              onCheckTelegramLinkStatus={handleCheckTelegramLinkStatus}
              onUnlinkTelegram={handleUnlinkTelegram}
              telegramLinked={kitchenTelegramLinked}
            />
          )}

          {/* The setup wizard is a one-time thing. It only appears once the
              staff data has actually loaded (so a slow first request can't fake
              "no tables"), the restaurant really has no tables, and the server
              has no record of onboarding being completed before. */}
          {surface === 'admin' && authorized && !subscriptionBlocked && showOnboarding && (
            <OnboardingWizard
              restaurantName={loggedInRestaurantName}
              categories={categories}
              onAddTable={handleAddTable}
              onAddMenuItem={handleAddMenuItem}
              onUpdateKitchenPin={handleUpdateKitchenPin}
              onFinish={handleFinishOnboarding}
            />
          )}

          {surface === 'admin' && authorized && !subscriptionBlocked && !showOnboarding && (
            <>
              {(() => {
                if (!subscriptionPeriodEnd) return null;
                const daysLeft = Math.ceil((new Date(subscriptionPeriodEnd).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                if (daysLeft > 3) return null;
                return (
                  <div className={`px-4 py-2.5 text-center text-xs font-bold ${daysLeft <= 0 ? 'bg-rose-600 text-white' : 'bg-amber-400 text-amber-950'}`}>
                    {daysLeft <= 0
                      ? "Obunangiz muddati tugadi — to'lov uchun administrator bilan bog'laning."
                      : `Obunangiz ${daysLeft} kundan keyin tugaydi — davom etish uchun administrator bilan bog'laning.`}
                  </div>
                );
              })()}
              <AdminDashboard
                menuItems={menuItems}
                categories={categories}
                onAddCategory={handleAddCategory}
                onUpdateCategory={handleUpdateCategory}
                onDeleteCategory={handleDeleteCategory}
                onReorderCategories={handleReorderCategories}
                onRefreshMenu={handleRefreshMenu}
                orders={orders}
                tables={tables}
                loyaltyMembers={loyaltyMembers}
                waiterCalls={waiterCalls}
                onResolveWaiterCall={handleResolveWaiterCall}
                branding={branding}
                onUpdateBranding={handleUpdateBranding}
                deliveryStatus={deliveryStatus}
                reservationStatus={reservationStatus}
                reservationsVersion={reservationsVersion}
                onUpdateAdminPassword={handleUpdateAdminPassword}
                onUpdateKitchenPin={handleUpdateKitchenPin}
                onUpdateMenuItem={handleUpdateMenuItem}
                onAddMenuItem={handleAddMenuItem}
                onDeleteMenuItem={handleDeleteMenuItem}
                onAddTable={handleAddTable}
                onDeleteTable={handleDeleteTable}
                onUpdateOrderStatus={handleUpdateOrderStatus}
                onDeleteOrder={handleDeleteOrder}
                onCleanupOldOrders={handleCleanupOldOrders}
                onUpdateExchangeRate={handleUpdateExchangeRate}
                onUpdateSettings={handleUpdateSettings}
                onLockAdmin={handleLogout}
                appUrl={clientsBaseUrl}
                kitchenUrl={kitchenBaseUrl}
                adminUrl={adminBaseUrl}
                restaurantId={loggedInRestaurantId}
                restaurantSlug={loggedInRestaurantSlug}
                lang={lang}
              />
            </>
          )}
        </main>

        <AdminAuthModal
          isOpen={isAuthModalOpen && !authorized}
          onClose={() => setIsAuthModalOpen(false)}
          onAuthenticate={handleAuthenticate}
          // Self-registration creates an admin account, so it is only ever
          // offered on the admin hostname.
          onRegister={surface === 'admin' ? handleRegisterRestaurant : undefined}
          lang={lang}
          targetView={surface}
        />
      </div>
    </CurrencyProvider>
  );
}
