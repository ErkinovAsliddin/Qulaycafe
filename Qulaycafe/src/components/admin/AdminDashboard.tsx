import { formatSom } from '../../utils/currency';
import React, { useState } from 'react';
import { MenuItem, MenuCategory, Order, Table, LoyaltyMember, OrderStatus, WaiterCall, CustomizationGroup } from '../../types';
import {
  LayoutDashboard,
  QrCode,
  DollarSign,
  ShoppingBag,
  Users,
  Utensils,
  Plus,
  Edit,
  Trash2,
  Lock,
  Download,
  Search,
  Check,
  X,
  RefreshCw,
  Printer,
  AlertTriangle,
  Upload,
  Image as ImageIcon,
  Receipt,
  Clock,
  CreditCard,
  CheckCircle2,
  ChevronRight,
  Phone,
  Mail,
  Shield,
  Eye,
  EyeOff,
  ChefHat,
  Key,
  Bell,
  LayoutGrid,
  MoreHorizontal,
  Tags,
  ArrowUp,
  ArrowDown,
  CalendarDays,
  Star,
  MessageSquare
} from 'lucide-react';
import { QRCodeImage } from '../common/QRCodeImage';
import { CustomizationEditor, cleanCustomizations } from './CustomizationEditor';
import { getTableFullUrl, getShareableOrderUrl, getShareableBookingUrl } from '../../utils/qrGenerator';
import { Language, translations } from '../../lib/translations';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// ---------------------------------------------------------------------------
// Order-row pieces shared by the orders registry's two layouts.
//
// The registry is a nine-column table, which a phone cannot show: it collapsed
// into a horizontal-scroll strip where the action buttons — the only reason to
// open the tab — sat off the right edge. Below `md` it is rendered as cards
// instead, and these components are what keep the two layouts from drifting
// apart. Declared at module level so they aren't rebuilt on every render of the
// dashboard around them.
// ---------------------------------------------------------------------------
const OrderStatusChip: React.FC<{ status: string }> = ({ status }) => (
  <span className="bg-orange-50 text-orange-800 border border-orange-200 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase">
    {status}
  </span>
);

const OrderPaymentMethodChip: React.FC<{ method?: string }> = ({ method }) => (
  <span
    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase ${
      method === 'card' ? 'bg-sky-50 text-sky-800 border border-sky-200' : 'bg-zinc-50 text-zinc-700 border border-zinc-200'
    }`}
  >
    {method === 'card' ? '💳 Karta' : method === 'loyalty_points' ? '⭐ Ball' : '💵 Naqd'}
  </span>
);

const OrderPaymentStatusChip: React.FC<{ paymentStatus: string }> = ({ paymentStatus }) => (
  <span
    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase ${
      paymentStatus === 'paid'
        ? 'bg-green-50 text-green-800 border border-green-200'
        : 'bg-rose-50 text-rose-800 border border-rose-200'
    }`}
  >
    {paymentStatus}
  </span>
);

/** Where the order is going: a table, a courier or the counter. */
const orderDestinationLabel = (order: Order) =>
  order.orderType === 'delivery'
    ? '🛵 Dostavka'
    : order.orderType === 'pickup'
      ? '🥡 Olib ketish'
      : `Table #${order.tableNumber}`;

interface OrderRowActionsProps {
  order: Order;
  onPrintLocal: (order: Order) => void;
  onMarkPaid: (order: Order) => void;
  onDelete: (order: Order) => void;
  /** True on the phone layout, where a row of tiny buttons is unusable: they
      become a two-column grid of full-width tap targets instead. */
  stacked?: boolean;
}

const OrderRowActions: React.FC<OrderRowActionsProps> = ({
  order,
  onPrintLocal,
  onMarkPaid,
  onDelete,
  stacked = false
}) => {
  // 44px-ish targets on touch, the compact original inside the desktop table.
  const base = stacked
    ? 'text-xs font-bold px-3 py-2.5 rounded-xl border'
    : 'text-[10px] font-bold px-2.5 py-1 rounded-lg border';
  return (
    <div className={stacked ? 'grid grid-cols-2 gap-2' : 'inline-flex flex-wrap justify-end gap-1'}>
      <button
        onClick={() => onPrintLocal(order)}
        className={`${base} bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-200`}
      >
        🧾 Chek
      </button>
      <button
        onClick={async () => {
          const res = await fetch(`/api/admin/print-receipt/${order.id}`, { method: 'POST' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) alert(data.error || "Printerga chop etib bo'lmadi.");
        }}
        className={`${base} bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-200`}
      >
        🖨️ Termal
      </button>
      {order.paymentStatus !== 'paid' && (
        <button
          onClick={() => onMarkPaid(order)}
          className={`${base} bg-green-600 hover:bg-green-700 text-white border-green-600 shadow-sm`}
        >
          Mark Paid
        </button>
      )}
      <button
        onClick={() => onDelete(order)}
        className={`${base} bg-zinc-100 hover:bg-red-50 hover:text-red-700 text-zinc-500 border-zinc-200 hover:border-red-200`}
      >
        Delete
      </button>
    </div>
  );
};

interface AdminDashboardProps {
  menuItems: MenuItem[];
  /** Admin-managed menu sections, inactive ones included. */
  categories?: MenuCategory[];
  onAddCategory?: (input: { nameUz: string; nameRu?: string; nameEn?: string; icon?: string }) => Promise<boolean>;
  onUpdateCategory?: (
    id: string,
    patch: { nameUz?: string; nameRu?: string; nameEn?: string; icon?: string; isActive?: boolean }
  ) => Promise<boolean>;
  /**
   * Resolves `{ ok: false, dishCount }` when the section still holds dishes and
   * no `moveTo` was given, so the UI can offer to move them instead.
   */
  onDeleteCategory?: (
    id: string,
    moveTo?: string
  ) => Promise<{ ok: boolean; movedDishes: number; dishCount?: number; error?: string }>;
  onReorderCategories?: (ids: string[]) => Promise<boolean>;
  /** Refetches menu + categories, used after a bulk backup import. */
  onRefreshMenu?: () => void;
  orders: Order[];
  tables: Table[];
  loyaltyMembers: LoyaltyMember[];
  waiterCalls?: WaiterCall[];
  onResolveWaiterCall?: (id: string) => void;
  branding?: {
    logoUrl: string | null;
    brandColor: string | null;
    restaurantName: string | null;
    contactPhone: string | null;
    contactAddress: string | null;
    contactInstagram: string | null;
    workingHours: string | null;
  };
  onUpdateBranding?: (params: {
    logoUrl?: string | null;
    brandColor?: string | null;
    displayName?: string;
    contactPhone?: string;
    contactAddress?: string;
    contactInstagram?: string;
    workingHours?: string;
  }) => Promise<boolean>;
  deliveryStatus?: 'disabled' | 'active' | 'suspended';
  /**
   * Whether the platform owner has switched table reservations on for this
   * restaurant (owner bot: /reservations_on). Guests always book through
   * Telegram — the dashboard is only where the restaurant answers them.
   */
  reservationStatus?: 'disabled' | 'active';
  /** Bumped by App.tsx on every reservation SSE event, to trigger a refetch. */
  reservationsVersion?: number;
  adminPassword?: string;
  kitchenPin?: string;
  onUpdateAdminPassword: (newPass: string) => void;
  onUpdateKitchenPin: (newPin: string) => void;
  onUpdateMenuItem: (item: MenuItem) => void;
  onAddMenuItem: (item: Partial<MenuItem>) => void;
  onDeleteMenuItem: (id: string) => void;
  onAddTable?: (tableNumber: number, capacity: number, comment?: string) => void;
  onDeleteTable?: (tableNumber: number) => void;
  onUpdateOrderStatus: (orderId: string, status: OrderStatus, paymentStatus?: 'paid' | 'unpaid') => void;
  onDeleteOrder: (orderId: string) => void;
  onCleanupOldOrders: (olderThanDays: number) => Promise<number | null>;
  onUpdateExchangeRate: (currency: 'USD' | 'RUB', rateToSom: number) => Promise<void>;
  onUpdateSettings: (settings: { taxPercent?: number; serviceFeePercent?: number }) => Promise<void>;
  onLockAdmin: () => void;
  /** Guest surface (clients.…) — every QR code and shareable link uses this. */
  appUrl: string;
  /** Kitchen surface (kitchen.…), for the multi-device setup links. */
  kitchenUrl: string;
  /** Admin surface (admin.…), likewise. */
  adminUrl: string;
  restaurantId?: string;
  restaurantSlug?: string | null;
  lang: Language;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  menuItems,
  categories = [],
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onReorderCategories,
  onRefreshMenu,
  orders,
  tables,
  loyaltyMembers,
  waiterCalls = [],
  onResolveWaiterCall,
  branding,
  onUpdateBranding,
  deliveryStatus = 'disabled',
  reservationStatus = 'disabled',
  reservationsVersion = 0,
  adminPassword = 'admin',
  kitchenPin = '1234',
  onUpdateAdminPassword,
  onUpdateKitchenPin,
  onUpdateMenuItem,
  onAddMenuItem,
  onDeleteMenuItem,
  onAddTable,
  onDeleteTable,
  onUpdateOrderStatus,
  onDeleteOrder,
  onCleanupOldOrders,
  onUpdateExchangeRate,
  onUpdateSettings,
  onLockAdmin,
  appUrl,
  kitchenUrl,
  adminUrl,
  restaurantId,
  restaurantSlug,
  lang
}) => {
  const t = translations[lang];
  const [activeTab, setActiveTab] = useState<'overview' | 'tables' | 'inventory' | 'categories' | 'orders' | 'qr' | 'analytics' | 'branding' | 'delivery' | 'reservations' | 'security'>('overview');
  const [selectedQRTable, setSelectedQRTable] = useState<number>(1);
  const [isMoreSheetOpen, setIsMoreSheetOpen] = useState<boolean>(false);
  const [analyticsData, setAnalyticsData] = useState<{
    rangeDays: number;
    totalRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
    revenueChangePercent: number | null;
    previousPeriodRevenue: number;
    revenueTimeline: { date: string; revenue: number }[];
    topDishes: { name: string; quantity: number; revenue: number }[];
    categoryBreakdown: { category: string; revenue: number }[];
    paymentMethodBreakdown: { method: string; count: number; revenue: number }[];
    orderTypeBreakdown: { dineIn: number; delivery: number; pickup?: number };
  } | null>(null);
  const [analyticsRangeDays, setAnalyticsRangeDays] = useState<number>(7);
  const [analyticsLoading, setAnalyticsLoading] = useState<boolean>(false);
  // Guest reviews: per-dish averages + the raw recent comments, fetched when
  // the analytics tab opens and refreshed by the SSE REVIEWS_UPDATED ping.
  const [reviewSummaries, setReviewSummaries] = useState<
    { menuItemId: string; menuItemName: string; averageRating: number; totalReviews: number; ratingCounts: Record<string, number>; lastReviewAt: string }[]
  >([]);
  const [recentReviews, setRecentReviews] = useState<
    { id: string; menuItemName: string; rating: number; comment: string; tableNumber: number | null; createdAt: string }[]
  >([]);
  const [brandColorInput, setBrandColorInput] = useState<string>(branding?.brandColor || '#f97316');
  const [logoPreview, setLogoPreview] = useState<string | null>(branding?.logoUrl || null);
  const [displayNameInput, setDisplayNameInput] = useState<string>(branding?.restaurantName || '');
  const [contactPhoneInput, setContactPhoneInput] = useState<string>(branding?.contactPhone || '');
  const [contactAddressInput, setContactAddressInput] = useState<string>(branding?.contactAddress || '');
  const [contactInstagramInput, setContactInstagramInput] = useState<string>(branding?.contactInstagram || '');
  const [workingHoursInput, setWorkingHoursInput] = useState<string>(branding?.workingHours || '');
  const [brandingSaving, setBrandingSaving] = useState<boolean>(false);
  const [brandingMsg, setBrandingMsg] = useState<string | null>(null);
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/app-config')
      .then(r => (r.ok ? r.json() : null))
      .then(data => data?.telegramBotUsername && setTelegramBotUsername(data.telegramBotUsername))
      .catch(() => {});
  }, []);
  const [couriers, setCouriers] = useState<{ id: string; name: string; telegramUsername: string | null; status: 'active' | 'inactive'; createdAt: string }[]>([]);
  // Per-courier invite links: the admin types a name, gets a link, and sends
  // it to that courier. Replaces the old single click-and-connect link, which
  // required the courier to be sitting next to the admin's screen.
  const [courierInvites, setCourierInvites] = useState<
    { token: string; courierName: string; status: string; createdAt: string; expiresAt: string; link: string }[]
  >([]);
  const [courierInviteName, setCourierInviteName] = useState('');
  const [courierInviteBusy, setCourierInviteBusy] = useState(false);
  const [courierInviteError, setCourierInviteError] = useState<string | null>(null);
  const [copiedInviteToken, setCopiedInviteToken] = useState<string | null>(null);
  const [zReport, setZReport] = useState<{ date: string; cashTotal: number; cardTotal: number; otherTotal: number; orderCount: number; totalRevenue: number; closure: any } | null>(null);
  const [printerIp, setPrinterIp] = useState<string>('');
  const [printerPort, setPrinterPort] = useState<number>(9100);
  const [printerSaving, setPrinterSaving] = useState(false);
  const [printerMsg, setPrinterMsg] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // RESERVATIONS (bot-only booking; this is the restaurant's answer side)
  // ---------------------------------------------------------------------------
  type AdminReservation = {
    id: string;
    tableNumber: number | null;
    reservedDate: string;
    reservedTime: string;
    partySize: number;
    guestName: string;
    guestPhone: string;
    note: string | null;
    status: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'seated' | 'no_show';
    // Matches ReservationSource in src/server/db.ts — 'web' was missing here,
    // so the branch below that renders "via website" was unreachable by type.
    source: 'bot' | 'admin' | 'web';
    telegramUsername: string | null;
    createdAt: string;
  };
  const [reservations, setReservations] = useState<AdminReservation[]>([]);
  const [reservationPendingCount, setReservationPendingCount] = useState<number>(0);
  const [reservationDateFilter, setReservationDateFilter] = useState<string>('');
  const [reservationOnlyPending, setReservationOnlyPending] = useState<boolean>(false);
  const [reservationsLoading, setReservationsLoading] = useState<boolean>(false);
  const [reservationBusyId, setReservationBusyId] = useState<string | null>(null);
  const [reservationError, setReservationError] = useState<string>('');

  const fetchReservations = React.useCallback(() => {
    if (reservationStatus !== 'active') return;
    const params = new URLSearchParams();
    if (reservationDateFilter) params.set('date', reservationDateFilter);
    if (reservationOnlyPending) params.set('pending', 'true');
    setReservationsLoading(true);
    fetch(`/api/admin/reservations?${params.toString()}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        setReservations(Array.isArray(data.reservations) ? data.reservations : []);
        setReservationPendingCount(Number(data.pendingCount) || 0);
      })
      .catch(() => {})
      .finally(() => setReservationsLoading(false));
  }, [reservationStatus, reservationDateFilter, reservationOnlyPending]);

  // The badge has to be current even while the admin is looking at another
  // tab, so the count is fetched on mount and on every SSE bump — not only
  // when the reservations tab is open.
  React.useEffect(() => {
    fetchReservations();
  }, [fetchReservations, reservationsVersion]);

  const updateReservationStatus = async (
    id: string,
    patch: { status?: AdminReservation['status']; tableNumber?: number | null }
  ) => {
    setReservationBusyId(id);
    setReservationError('');
    try {
      const res = await fetch(`/api/admin/reservations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setReservationError(body?.error || t.reservationUpdateFailed);
        return;
      }
      // Refetch instead of patching in place: a decision can change the
      // pending count and the guest's row at once, and the server is the
      // authority on both.
      fetchReservations();
    } catch {
      setReservationError(t.reservationUpdateFailed);
    } finally {
      setReservationBusyId(null);
    }
  };

  // --- MENU BACKUP (export / import) ---
  const menuImportInputRef = React.useRef<HTMLInputElement>(null);
  const [menuImportBusy, setMenuImportBusy] = useState(false);
  const [menuImportReport, setMenuImportReport] = useState<{
    error?: string;
    totalRows?: number;
    createdItems?: number;
    updatedItems?: number;
    createdCategories?: number;
    updatedCategories?: number;
    skippedCount?: number;
    skipped?: { row: number; name: string; reason: string }[];
  } | null>(null);

  const handleExportMenu = async () => {
    try {
      const res = await fetch('/api/admin/menu/export');
      if (!res.ok) {
        setMenuImportReport({ error: 'Menyuni yuklab olish imkoni bo\'lmadi.' });
        return;
      }
      const data = await res.json();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `qulaycafe-menyu-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setMenuImportReport({ error: 'Menyuni yuklab olish imkoni bo\'lmadi.' });
    }
  };

  const handleImportMenu = async (file: File) => {
    setMenuImportBusy(true);
    setMenuImportReport(null);
    try {
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        setMenuImportReport({ error: "Fayl JSON emas. Backup faylini o'zgartirmasdan yuklang." });
        return;
      }
      const res = await fetch('/api/admin/menu/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMenuImportReport({ error: body.error || 'Import qilinmadi.' });
        return;
      }
      setMenuImportReport({
        totalRows: body.totalRows,
        createdItems: body.createdItems,
        updatedItems: body.updatedItems,
        createdCategories: body.createdCategories,
        updatedCategories: body.updatedCategories,
        skippedCount: body.skippedCount || 0,
        skipped: body.skipped || []
      });
      // The server broadcasts MENU_UPDATED, but a full reload is the simplest
      // way to be certain both the menu and the category tabs are in sync.
      if (onRefreshMenu) onRefreshMenu();
    } catch {
      setMenuImportReport({ error: 'Server bilan aloqa yo\'q.' });
    } finally {
      setMenuImportBusy(false);
    }
  };

  const fetchCouriers = React.useCallback(() => {
    fetch('/api/admin/couriers')
      .then(r => (r.ok ? r.json() : []))
      .then(setCouriers)
      .catch(() => {});
    fetch('/api/admin/couriers/invites')
      .then(r => (r.ok ? r.json() : []))
      .then(setCourierInvites)
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (activeTab !== 'delivery' || deliveryStatus !== 'active') return;
    fetchCouriers();
  }, [activeTab, deliveryStatus, fetchCouriers]);

  React.useEffect(() => {
    if (activeTab !== 'analytics') return;
    fetch('/api/admin/z-report')
      .then(r => (r.ok ? r.json() : null))
      .then(data => data && setZReport(data))
      .catch(() => {});
  }, [activeTab]);

  React.useEffect(() => {
    if (activeTab !== 'security') return;
    fetch('/api/admin/printer-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data) {
          setPrinterIp(data.printerIp || '');
          setPrinterPort(data.printerPort || 9100);
        }
      })
      .catch(() => {});
  }, [activeTab]);

  React.useEffect(() => {
    if (activeTab !== 'analytics') return;
    setAnalyticsLoading(true);
    fetch(`/api/admin/analytics?days=${analyticsRangeDays}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => data && setAnalyticsData(data))
      .finally(() => setAnalyticsLoading(false));
  }, [activeTab, analyticsRangeDays]);

  const fetchReviews = React.useCallback(() => {
    fetch('/api/admin/reviews?days=30')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        setReviewSummaries(data.summaries || []);
        setRecentReviews(data.recent || []);
      })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (activeTab !== 'analytics') return;
    fetchReviews();
  }, [activeTab, fetchReviews]);

  // A guest just submitted a review while this dashboard is open: the orders
  // prop changes with every SSE order update, and reviews arrive within a
  // minute of an order being served, so a light re-fetch keyed to the newest
  // order id keeps the list live without a dedicated SSE channel.
  const newestOrderId = orders[0]?.id || null;
  React.useEffect(() => {
    if (activeTab !== 'analytics') return;
    if (newestOrderId) fetchReviews();
  }, [newestOrderId, activeTab, fetchReviews]);

  // While an invite is still waiting to be opened, refresh in the background so
  // the courier shows up in the list the moment they press Start in Telegram.
  const hasPendingInvite = courierInvites.some(i => i.status === 'pending');
  React.useEffect(() => {
    if (activeTab !== 'delivery' || !hasPendingInvite) return;
    const interval = setInterval(fetchCouriers, 5000);
    return () => clearInterval(interval);
  }, [activeTab, hasPendingInvite, fetchCouriers]);

  const handleCreateCourierInvite = async () => {
    const name = courierInviteName.trim();
    if (!name) {
      setCourierInviteError('Kuryerning ismini yozing.');
      return;
    }
    setCourierInviteBusy(true);
    setCourierInviteError(null);
    try {
      const res = await fetch('/api/admin/couriers/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        const invite = await res.json();
        setCourierInvites(prev => [invite, ...prev]);
        setCourierInviteName('');
      } else {
        const body = await res.json().catch(() => ({}));
        setCourierInviteError(body.error || 'Havola yaratilmadi.');
      }
    } catch {
      setCourierInviteError('Server bilan aloqa yo\'q.');
    } finally {
      setCourierInviteBusy(false);
    }
  };

  const handleCopyInvite = async (invite: { token: string; link: string }) => {
    try {
      await navigator.clipboard.writeText(invite.link);
    } catch {
      // Clipboard is blocked on http / older browsers: fall back to selecting
      // the text so the admin can still copy it by hand.
      window.prompt('Havolani nusxalang:', invite.link);
    }
    setCopiedInviteToken(invite.token);
    setTimeout(() => setCopiedInviteToken(null), 2000);
  };

  const handleRevokeInvite = async (token: string) => {
    setCourierInviteBusy(true);
    try {
      const res = await fetch(`/api/admin/couriers/invites/${token}`, { method: 'DELETE' });
      if (res.ok) {
        setCourierInvites(prev => prev.map(i => (i.token === token ? { ...i, status: 'revoked' } : i)));
      }
    } finally {
      setCourierInviteBusy(false);
    }
  };

  
  // Security / Password change states
  const [adminPassInput, setAdminPassInput] = useState<string>('');
  const [kitchenPinInput, setKitchenPinInput] = useState<string>('');
  const [usdRateInput, setUsdRateInput] = useState<string>('');
  const [rubRateInput, setRubRateInput] = useState<string>('');
  const [exchangeRateMsg, setExchangeRateMsg] = useState<string | null>(null);
  const [taxPercentInput, setTaxPercentInput] = useState<string>('');
  const [serviceFeePercentInput, setServiceFeePercentInput] = useState<string>('');
  const [taxServiceMsg, setTaxServiceMsg] = useState<string | null>(null);
  const [showAdminPass, setShowAdminPass] = useState<boolean>(false);
  const [showKitchenPin, setShowKitchenPin] = useState<boolean>(false);
  const [adminPassMsg, setAdminPassMsg] = useState<string | null>(null);
  const [kitchenPinMsg, setKitchenPinMsg] = useState<string | null>(null);
  
  // Table management state
  const [showAddTableModal, setShowAddTableModal] = useState<boolean>(false);
  const [newTableNum, setNewTableNum] = useState<string>('');
  const [newTableCap, setNewTableCap] = useState<string>('4');
  const [newTableComment, setNewTableComment] = useState<string>('');
  const [tableToDelete, setTableToDelete] = useState<number | null>(null);
  const [selectedTableDetail, setSelectedTableDetail] = useState<Table | null>(null);

  // Modals state
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<MenuItem | null>(null);
  const [showAddDishModal, setShowAddDishModal] = useState<boolean>(false);

  // Preset food images for quick selection
  const presetFoodImages = [
    { name: 'Burger', url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80' },
    { name: 'Pizza', url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=80' },
    { name: 'Steak', url: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80' },
    { name: 'Pasta', url: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=800&q=80' },
    { name: 'Salad', url: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80' },
    { name: 'Drink', url: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80' },
  ];

  // Image Upload helper with HTML5 canvas automatic compression & resizing
  const handleFileUpload = (file: File, callback: (dataUrl: string) => void) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file (JPEG, PNG, WEBP, etc.)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawDataUrl = e.target?.result as string;
      if (!rawDataUrl) return;

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 800;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
          callback(compressedDataUrl);
        } else {
          callback(rawDataUrl);
        }
      };
      img.onerror = () => {
        callback(rawDataUrl);
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  };

  // New Dish Form State
  const [newDishNameUz, setNewDishNameUz] = useState<string>('');
  const [newDishNameRu, setNewDishNameRu] = useState<string>('');
  const [newDishNameEn, setNewDishNameEn] = useState<string>('');
  const [newDishPrice, setNewDishPrice] = useState<string>('12.00');
  const [newDishCategory, setNewDishCategory] = useState<string>('ikkinchi_taom');
  const [newDishDescUz, setNewDishDescUz] = useState<string>('');
  const [newDishDescRu, setNewDishDescRu] = useState<string>('');
  const [newDishDescEn, setNewDishDescEn] = useState<string>('');
  const [newDishImage, setNewDishImage] = useState<string>('https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80');
  // Optional per-dish choices (size, extras…). Empty by default — most dishes
  // don't need any, and an empty array is what the API expects for "none".
  const [newDishCustomizations, setNewDishCustomizations] = useState<CustomizationGroup[]>([]);

  // ---------------------------------------------------------------------------
  // CATEGORY MANAGEMENT STATE
  //
  // `categories` arrives from the server already ordered by sort_order. The
  // reorder buttons only move rows inside `pendingOrder` — nothing is written
  // until "save order" is pressed, and the server rejects a list that no longer
  // matches the database, so two admins reordering at once cannot interleave.
  // ---------------------------------------------------------------------------
  const sortedCategories = [...categories].sort((a, b) =>
    a.sortOrder === b.sortOrder ? a.id.localeCompare(b.id) : a.sortOrder - b.sortOrder
  );
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [categoryBusy, setCategoryBusy] = useState<boolean>(false);
  const [categoryError, setCategoryError] = useState<string>('');
  const [showAddCategory, setShowAddCategory] = useState<boolean>(false);
  const [newCatNameUz, setNewCatNameUz] = useState<string>('');
  const [newCatNameRu, setNewCatNameRu] = useState<string>('');
  const [newCatNameEn, setNewCatNameEn] = useState<string>('');
  const [newCatIcon, setNewCatIcon] = useState<string>('🍽️');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCatDraft, setEditCatDraft] = useState<{ nameUz: string; nameRu: string; nameEn: string; icon: string }>({
    nameUz: '',
    nameRu: '',
    nameEn: '',
    icon: ''
  });
  const [categoryToDelete, setCategoryToDelete] = useState<MenuCategory | null>(null);
  const [deleteMoveTo, setDeleteMoveTo] = useState<string>('');

  // While a reorder is staged, the list on screen follows `pendingOrder`.
  const displayedCategories: MenuCategory[] = pendingOrder
    ? pendingOrder.reduce<MenuCategory[]>((acc, id) => {
        const found = sortedCategories.find(c => c.id === id);
        if (found) acc.push(found);
        return acc;
      }, [])
    : sortedCategories;

  // A dish can only be filed under a section that exists. Hidden sections are
  // kept out of the picker, but if every section is hidden the admin still has
  // to be able to file the dish somewhere, so fall back to the full list.
  const activeCategories = sortedCategories.filter(c => c.isActive);
  const dishCategoryOptions = activeCategories.length > 0 ? activeCategories : sortedCategories;
  const effectiveNewDishCategory = dishCategoryOptions.some(c => c.id === newDishCategory)
    ? newDishCategory
    : dishCategoryOptions[0]?.id || newDishCategory;

  /** Localized section name, falling back to the slug for dishes in a section that vanished. */
  const categoryLabel = (id: string): string => {
    const match = categories.find(c => c.id === id);
    if (!match) return id.replace(/_/g, ' ');
    return (lang === 'ru' ? match.nameRu : lang === 'en' ? match.nameEn : match.nameUz) || match.nameUz || id;
  };

  const moveCategory = (index: number, direction: -1 | 1) => {
    const ids = displayedCategories.map(c => c.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setPendingOrder(ids);
    setCategoryError('');
  };

  const handleSaveOrder = async () => {
    if (!pendingOrder || !onReorderCategories) return;
    setCategoryBusy(true);
    const ok = await onReorderCategories(pendingOrder);
    setCategoryBusy(false);
    // On failure App.tsx has already refetched the real order, so dropping the
    // staged list puts the admin back on what the database actually holds.
    setPendingOrder(null);
    if (!ok) setCategoryError(t.catOrderUnsaved);
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddCategory) return;
    if (!newCatNameUz.trim()) {
      setCategoryError(t.catNameRequired);
      return;
    }
    setCategoryBusy(true);
    const ok = await onAddCategory({
      nameUz: newCatNameUz.trim(),
      nameRu: newCatNameRu.trim() || undefined,
      nameEn: newCatNameEn.trim() || undefined,
      icon: newCatIcon.trim() || undefined
    });
    setCategoryBusy(false);
    if (ok) {
      setShowAddCategory(false);
      setNewCatNameUz('');
      setNewCatNameRu('');
      setNewCatNameEn('');
      setNewCatIcon('🍽️');
      setCategoryError('');
    }
  };

  const startEditCategory = (cat: MenuCategory) => {
    setEditingCategoryId(cat.id);
    setEditCatDraft({ nameUz: cat.nameUz, nameRu: cat.nameRu, nameEn: cat.nameEn, icon: cat.icon });
    setCategoryError('');
  };

  const handleSaveCategoryEdit = async () => {
    if (!editingCategoryId || !onUpdateCategory) return;
    if (!editCatDraft.nameUz.trim()) {
      setCategoryError(t.catNameRequired);
      return;
    }
    setCategoryBusy(true);
    const ok = await onUpdateCategory(editingCategoryId, {
      nameUz: editCatDraft.nameUz.trim(),
      nameRu: editCatDraft.nameRu.trim() || editCatDraft.nameUz.trim(),
      nameEn: editCatDraft.nameEn.trim() || editCatDraft.nameUz.trim(),
      icon: editCatDraft.icon.trim() || '🍽️'
    });
    setCategoryBusy(false);
    if (ok) setEditingCategoryId(null);
  };

  const handleToggleCategoryActive = async (cat: MenuCategory) => {
    if (!onUpdateCategory) return;
    setCategoryBusy(true);
    await onUpdateCategory(cat.id, { isActive: !cat.isActive });
    setCategoryBusy(false);
  };

  const handleConfirmCategoryDelete = async () => {
    if (!categoryToDelete || !onDeleteCategory) return;
    setCategoryBusy(true);
    const result = await onDeleteCategory(categoryToDelete.id, deleteMoveTo || undefined);
    setCategoryBusy(false);
    if (result.ok) {
      setCategoryToDelete(null);
      setDeleteMoveTo('');
      setCategoryError('');
      setPendingOrder(null);
      return;
    }
    setCategoryError(result.error || t.catDeleteHasDishes.replace('{count}', String(result.dishCount ?? 0)));
  };

  // Analytics Metrics
  const totalRevenue = orders.reduce((acc, o) => acc + (o.paymentStatus === 'paid' ? o.totalAmount : 0), 0);
  const totalOrdersCount = orders.length;
  // Opens a small print-only window with a clean receipt layout and
  // triggers the browser's native print dialog — the person can "print"
  // to a real receipt printer or choose "Save as PDF", covering both
  // physical checks and a PDF copy without needing a PDF library.
  const printReceipt = (order: Order) => {
    const win = window.open('', '_blank', 'width=380,height=600');
    if (!win) return;
    const itemsHtml = order.items
      .map(
        i => `<tr><td>${i.quantity}x ${i.menuItem.name}</td><td style="text-align:right">${formatSom(i.itemTotal)}</td></tr>`
      )
      .join('');
    win.document.write(`
      <html>
        <head>
          <title>Chek — ${order.id}</title>
          <style>
            body { font-family: 'Courier New', monospace; padding: 16px; color: #111; font-size: 13px; }
            h1 { font-size: 16px; text-align: center; margin: 0 0 4px; }
            .sub { text-align: center; font-size: 11px; color: #555; margin-bottom: 12px; }
            table { width: 100%; border-collapse: collapse; margin: 12px 0; }
            td { padding: 3px 0; }
            .totals td { border-top: 1px dashed #999; padding-top: 6px; }
            .grand { font-weight: bold; font-size: 15px; border-top: 2px solid #111 !important; }
            .footer { text-align: center; margin-top: 16px; font-size: 11px; color: #555; }
          </style>
        </head>
        <body>
          <h1>${branding?.restaurantName || 'Restoran'}</h1>
          <div class="sub">${
            order.orderType === 'delivery' ? '🛵 Dostavka' : order.orderType === 'pickup' ? '🥡 Olib ketish' : `Stol #${order.tableNumber}`
          } • ${new Date(order.createdAt).toLocaleString('uz-UZ')}</div>
          <div class="sub">Buyurtma: ${order.id}</div>
          <table>${itemsHtml}</table>
          <table class="totals">
            <tr><td>Oraliq summa</td><td style="text-align:right">${formatSom(order.subtotal)}</td></tr>
            <tr><td>Soliq</td><td style="text-align:right">${formatSom(order.tax)}</td></tr>
            <tr><td>Xizmat haqi</td><td style="text-align:right">${formatSom(order.serviceCharge)}</td></tr>
            ${order.discount > 0 ? `<tr><td>Chegirma</td><td style="text-align:right">-${formatSom(order.discount)}</td></tr>` : ''}
            <tr class="grand"><td>JAMI</td><td style="text-align:right">${formatSom(order.totalAmount)}</td></tr>
          </table>
          <div class="footer">Xaridingiz uchun rahmat!</div>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);
    win.document.close();
  };

  const activeTablesCount = tables.filter(t => t.status !== 'available').length;
  const avgOrderValue = totalOrdersCount > 0 ? totalRevenue / totalOrdersCount : 0;

  const handleToggleAvailability = (item: MenuItem) => {
    onUpdateMenuItem({
      ...item,
      isAvailable: !item.isAvailable
    });
  };

  const handleCreateDish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDishNameUz.trim()) return;

    onAddMenuItem({
      nameUz: newDishNameUz,
      nameRu: newDishNameRu || newDishNameUz,
      nameEn: newDishNameEn || newDishNameUz,
      price: parseFloat(newDishPrice) || 12.00,
      category: effectiveNewDishCategory,
      descriptionUz: newDishDescUz,
      descriptionRu: newDishDescRu || newDishDescUz,
      descriptionEn: newDishDescEn || newDishDescUz,
      image: newDishImage,
      isAvailable: true,
      dietary: ['chef-recommendation'],
      prepTimeMinutes: 12,
      customizations: cleanCustomizations(newDishCustomizations)
    });

    setShowAddDishModal(false);
    setNewDishNameUz('');
    setNewDishNameRu('');
    setNewDishNameEn('');
    setNewDishDescUz('');
    setNewDishDescRu('');
    setNewDishDescEn('');
    setNewDishCustomizations([]);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    onUpdateMenuItem({ ...editingItem, customizations: cleanCustomizations(editingItem.customizations || []) });
    setEditingItem(null);
  };

  const handleConfirmDelete = () => {
    if (itemToDelete) {
      onDeleteMenuItem(itemToDelete.id);
      setItemToDelete(null);
    }
  };

  const pendingOrdersCount = orders.filter(o => o.status === 'pending').length;
  const pendingWaiterCount = waiterCalls.filter(c => c.status === 'pending').length;

  // Primary destinations — always one tap away, on both the desktop
  // sidebar and the mobile bottom bar.
  const primaryNavItems: { id: typeof activeTab; label: string; icon: any; badge?: number }[] = [
    { id: 'overview', label: t.overview, icon: LayoutDashboard },
    { id: 'orders', label: t.ordersList, icon: ShoppingBag, badge: pendingOrdersCount || undefined },
    { id: 'tables', label: t.tableMap, icon: LayoutGrid },
    { id: 'inventory', label: 'Taomnoma', icon: Utensils }
  ];

  // Everything else, grouped by theme — shown as sidebar sections on
  // desktop, and as the "Boshqa" bottom-sheet on mobile.
  const secondaryNavGroups: { title: string; items: { id: typeof activeTab; label: string; icon: any; badge?: number }[] }[] = [
    { title: 'Menyu', items: [{ id: 'categories', label: t.categoriesNav, icon: Tags }] },
    { title: 'Hisobot', items: [{ id: 'analytics', label: 'Statistika', icon: DollarSign }] },
    {
      title: 'Sozlamalar',
      items: [
        { id: 'branding', label: 'Brendlash', icon: ImageIcon },
        ...(deliveryStatus !== 'disabled' ? [{ id: 'delivery' as const, label: 'Dostavka', icon: Bell }] : []),
        // Hidden entirely until the platform owner enables the feature, so a
        // restaurant that never bought it doesn't see a dead tab.
        ...(reservationStatus === 'active'
          ? [
              {
                id: 'reservations' as const,
                label: t.reservationsNav,
                icon: CalendarDays,
                badge: reservationPendingCount || undefined
              }
            ]
          : []),
        { id: 'qr', label: t.qrPrint, icon: QrCode },
        { id: 'security', label: t.security || 'Security', icon: Shield }
      ]
    }
  ];
  const allSecondaryIds = secondaryNavGroups.flatMap(g => g.items.map(i => i.id));
  const isSecondaryActive = allSecondaryIds.includes(activeTab);

  return (
    <div className="flex min-h-screen bg-zinc-50">

      {/* DESKTOP SIDEBAR */}
      <aside className="hidden md:flex md:flex-col md:w-60 md:shrink-0 bg-white border-r border-zinc-200 sticky top-0 h-screen overflow-y-auto">
        <div className="p-5 border-b border-zinc-100">
          <div className="flex items-center space-x-2.5">
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt="Logo" className="w-9 h-9 rounded-xl object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-orange-500 text-white flex items-center justify-center font-black text-sm shrink-0">
                {(branding?.restaurantName || 'B').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="overflow-hidden">
              <p className="text-sm font-black text-zinc-900 truncate">{branding?.restaurantName || t.admin}</p>
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wide">Boshqaruv paneli</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-5 overflow-y-auto">
          <div className="space-y-0.5">
            <p className="px-2.5 text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-1.5">Operatsiyalar</p>
            {primaryNavItems.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                    activeTab === item.id ? 'bg-orange-50 text-orange-700' : 'text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  <span className="flex items-center space-x-2.5">
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </span>
                  {!!item.badge && (
                    <span className="bg-rose-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {secondaryNavGroups.map(group => (
            <div key={group.title} className="space-y-0.5">
              <p className="px-2.5 text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-1.5">{group.title}</p>
              {group.items.map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                      activeTab === item.id ? 'bg-orange-50 text-orange-700' : 'text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    <span className="flex items-center space-x-2.5">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </span>
                    {!!item.badge && (
                      <span className="bg-rose-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-zinc-100">
          <button
            onClick={onLockAdmin}
            className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-bold px-3 py-2.5 rounded-xl flex items-center justify-center space-x-1.5 border border-zinc-200 transition-colors"
          >
            <Lock className="w-3.5 h-3.5 text-orange-500" />
            <span>{t.logout}</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <div className="flex-1 min-w-0 pb-20 md:pb-0">

        {/* MOBILE TOP BAR (sidebar replaces this on desktop) */}
        <div className="md:hidden bg-white border-b border-zinc-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center space-x-2">
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt="Logo" className="w-7 h-7 rounded-lg object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-lg bg-orange-500 text-white flex items-center justify-center font-black text-xs shrink-0">
                {(branding?.restaurantName || 'B').charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-sm font-black text-zinc-900 truncate max-w-[160px]">{branding?.restaurantName || t.admin}</span>
          </div>
          <button onClick={onLockAdmin} className="text-zinc-400 p-1.5" title={t.logout}>
            <Lock className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">

      {/* Waiter Call Banner */}
      {waiterCalls.filter(c => c.status === 'pending').length > 0 && (
        <div className="bg-rose-600 text-white rounded-2xl p-4 shadow-lg space-y-2">
          <div className="flex items-center space-x-2 font-black text-sm">
            <span>🔔 Ofitsiant chaqirilmoqda!</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {waiterCalls.filter(c => c.status === 'pending').map(call => (
              <button
                key={call.id}
                onClick={() => onResolveWaiterCall && onResolveWaiterCall(call.id)}
                className="bg-white/15 hover:bg-white/25 border border-white/30 rounded-xl px-3 py-1.5 text-xs font-bold flex items-center space-x-2 transition-colors"
              >
                <span>{t.table} #{call.tableNumber}</span>
                <Check className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm">
              <div className="flex justify-between items-center text-orange-600">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">{t.todayRevenue}</span>
                <DollarSign className="w-5 h-5" />
              </div>
              <div className="text-3xl font-black text-zinc-900 mt-2">{formatSom(totalRevenue)}</div>
              <p className="text-[11px] text-green-600 mt-1 font-semibold">{t.paidOrdersTotal}</p>
            </div>

            <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm">
              <div className="flex justify-between items-center text-orange-600">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">{t.occupiedTables}</span>
                <Users className="w-5 h-5" />
              </div>
              <div className="text-3xl font-black text-zinc-900 mt-2">{activeTablesCount} / {tables.length}</div>
              <p className="text-[11px] text-zinc-500 mt-1 font-medium">{t.occupancyRate}</p>
            </div>

            <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm">
              <div className="flex justify-between items-center text-orange-600">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">{t.totalOrders}</span>
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div className="text-3xl font-black text-zinc-900 mt-2">{totalOrdersCount}</div>
              <p className="text-[11px] text-zinc-500 mt-1 font-medium">{t.submittedToday}</p>
            </div>

            <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm">
              <div className="flex justify-between items-center text-orange-600">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">{t.avgOrderValue}</span>
                <Utensils className="w-5 h-5" />
              </div>
              <div className="text-3xl font-black text-zinc-900 mt-2">{formatSom(avgOrderValue)}</div>
              <p className="text-[11px] text-zinc-500 mt-1 font-medium">{t.perTableAvg}</p>
            </div>
          </div>

          {/* Quick Table Grid Overview */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-zinc-900">{t.liveTableStatus}</h3>
              <button
                onClick={() => setActiveTab('tables')}
                className="text-orange-600 text-xs font-bold hover:underline"
              >
                {t.viewTableMap}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {tables.map(t => (
                <div
                  key={t.tableNumber}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    t.status === 'eating'
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : t.status === 'ordering'
                      ? 'bg-orange-50 border-orange-200 text-orange-900'
                      : t.status === 'seated'
                      ? 'bg-blue-50 border-blue-200 text-blue-900'
                      : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                  }`}
                >
                  <div className="font-extrabold text-sm">Table #{t.tableNumber}</div>
                  <div className="text-[10px] capitalize font-semibold mt-1">
                    {t.status.replace('_', ' ')}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* TABLE MAP TAB */}
      {activeTab === 'tables' && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-zinc-900">Interactive Table Layout & Management</h2>
              <p className="text-xs text-zinc-500 mt-0.5 font-medium">Add or remove floor tables, view live occupancy and active orders</p>
            </div>

            <button
              onClick={() => {
                const nextNum = tables.length > 0 ? Math.max(...tables.map(t => t.tableNumber)) + 1 : 1;
                setNewTableNum(nextNum.toString());
                setNewTableCap('4');
                setShowAddTableModal(true);
              }}
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center space-x-2 shadow-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Table</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {tables.map(table => {
              const activeOrd = orders.find(o => o.id === table.currentOrderId);
              const isUnpaidBill = activeOrd && activeOrd.paymentStatus === 'unpaid' && (activeOrd.status === 'served' || table.status === 'bill_requested');

              let statusBorder = 'border-emerald-200 bg-emerald-50/20 hover:border-emerald-400';
              let badgeStyle = 'bg-emerald-100 text-emerald-800 border-emerald-300';
              let statusLabel = 'AVAILABLE';

              if (isUnpaidBill) {
                statusBorder = 'border-rose-400 bg-rose-50/40 hover:border-rose-500 ring-2 ring-rose-200 shadow-md animate-pulse';
                badgeStyle = 'bg-rose-500 text-white font-extrabold border-rose-600';
                statusLabel = 'PENDING PAYMENT';
              } else if (table.status === 'eating') {
                statusBorder = 'border-purple-200 bg-purple-50/20 hover:border-purple-400';
                badgeStyle = 'bg-purple-100 text-purple-800 border-purple-300';
                statusLabel = 'EATING / OCCUPIED';
              } else if (table.status === 'ordering') {
                statusBorder = 'border-amber-200 bg-amber-50/20 hover:border-amber-400';
                badgeStyle = 'bg-amber-100 text-amber-800 border-amber-300';
                statusLabel = 'ORDERING';
              } else if (table.status === 'seated') {
                statusBorder = 'border-sky-200 bg-sky-50/20 hover:border-sky-400';
                badgeStyle = 'bg-sky-100 text-sky-800 border-sky-300';
                statusLabel = 'SEATED';
              }

              return (
                <div
                  key={table.tableNumber}
                  className={`border rounded-2xl p-4 flex flex-col justify-between space-y-3 relative transition-all cursor-pointer ${statusBorder}`}
                  onClick={() => setSelectedTableDetail(table)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-2xl font-black text-zinc-900">Table #{table.tableNumber}</span>
                        <span className="text-[11px] text-zinc-500 font-bold bg-white px-2 py-0.5 rounded-full border border-zinc-200">
                          {table.capacity} Seats
                        </span>
                      </div>
                      <span className="block text-[11px] text-zinc-500 font-medium mt-0.5">
                        {activeOrd ? `Active Order: #${activeOrd.id}` : 'No active order'}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                      <span className={`px-2 py-1 rounded-md text-[9px] font-extrabold border uppercase tracking-wider ${badgeStyle}`}>
                        {statusLabel}
                      </span>

                      <button
                        onClick={() => setTableToDelete(table.tableNumber)}
                        className="p-1 bg-white hover:bg-rose-50 text-zinc-400 hover:text-rose-600 rounded-lg border border-zinc-200 transition-colors ml-1"
                        title="Remove table"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Active Order Summary Block */}
                  {activeOrd ? (
                    <div className="bg-white/90 border border-zinc-200 rounded-xl p-3 text-xs space-y-1.5 shadow-sm">
                      <div className="flex justify-between items-center font-black">
                        <span className="text-zinc-900 font-extrabold truncate pr-2">{activeOrd.customerName}</span>
                        <span className="text-orange-600 text-sm">{formatSom(activeOrd.totalAmount)}</span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-zinc-600">
                        <span>{activeOrd.items.reduce((acc, i) => acc + i.quantity, 0)} Items</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                          activeOrd.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {activeOrd.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-400 italic py-3 text-center font-medium bg-white/50 rounded-xl border border-dashed border-zinc-200">
                      Table is currently empty
                    </div>
                  )}

                  <div className="pt-2 border-t border-zinc-200/60 flex justify-between items-center text-xs" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        setSelectedQRTable(table.tableNumber);
                        setActiveTab('qr');
                      }}
                      className="text-orange-600 font-bold hover:underline flex items-center space-x-1 text-[11px]"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>Print QR</span>
                    </button>

                    <button
                      onClick={() => setSelectedTableDetail(table)}
                      className="bg-zinc-900 hover:bg-orange-600 text-white font-bold px-3 py-1.5 rounded-lg text-[11px] flex items-center space-x-1 transition-colors shadow-sm"
                    >
                      <span>View Details</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MENU TAB */}
      {activeTab === 'inventory' && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-xl font-bold text-zinc-900">{t.manageDishes}</h2>
              <p className="text-xs text-zinc-500 mt-0.5 font-medium">Taom qo‘shish, tahrirlash, o‘chirish va mavjudligini boshqarish</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Backup: take the whole menu out as JSON, or bring one in from
                  another system. Import is tolerant — see the report below. */}
              <button
                onClick={handleExportMenu}
                className="bg-white hover:bg-zinc-50 border border-zinc-300 text-zinc-700 font-bold px-3 py-2.5 rounded-xl text-xs transition-colors"
              >
                Menyuni yuklab olish
              </button>
              <button
                onClick={() => menuImportInputRef.current?.click()}
                disabled={menuImportBusy}
                className="bg-white hover:bg-zinc-50 border border-zinc-300 disabled:opacity-60 text-zinc-700 font-bold px-3 py-2.5 rounded-xl text-xs transition-colors"
              >
                {menuImportBusy ? 'Yuklanmoqda...' : 'Menyuni import qilish'}
              </button>
              <input
                ref={menuImportInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) handleImportMenu(file);
                }}
              />
            <button
              onClick={() => setShowAddDishModal(true)}
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center space-x-2 shadow-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>{t.addNewDish}</span>
            </button>
            </div>
          </div>

          {menuImportReport && (
            <div
              className={`rounded-xl border p-4 text-xs font-medium ${
                menuImportReport.error
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : menuImportReport.skippedCount
                    ? // A green banner over a partial import is how "not
                      // everything moved" goes unnoticed for weeks.
                      'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-green-50 border-green-200 text-green-900'
              }`}
            >
              {menuImportReport.error ? (
                <p className="font-bold">{menuImportReport.error}</p>
              ) : (
                <div className="space-y-1.5">
                  <p className="font-bold">
                    Import tugadi: {menuImportReport.createdItems} yangi taom, {menuImportReport.updatedItems} yangilandi,{' '}
                    {menuImportReport.createdCategories} yangi kategoriya
                    {menuImportReport.updatedCategories
                      ? `, ${menuImportReport.updatedCategories} kategoriya tarjimasi to'ldirildi`
                      : ''}{' '}
                    ({menuImportReport.totalRows} yozuvdan).
                  </p>
                  {menuImportReport.skippedCount > 0 && (
                    <div className="space-y-1">
                      <p className="font-bold text-amber-800">
                        {menuImportReport.skippedCount} yozuv o'tmadi:
                      </p>
                      <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-amber-900">
                        {menuImportReport.skipped.map(s => (
                          <li key={s.row}>
                            #{s.row} {s.name ? `"${s.name}"` : ''} — {s.reason}
                          </li>
                        ))}
                      </ul>
                      {menuImportReport.skippedCount > (menuImportReport.skipped?.length || 0) && (
                        <p className="text-[11px] text-amber-800">
                          … va yana {menuImportReport.skippedCount - (menuImportReport.skipped?.length || 0)} yozuv.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => setMenuImportReport(null)}
                className="mt-2 text-[11px] font-bold underline opacity-70 hover:opacity-100"
              >
                Yopish
              </button>
            </div>
          )}

          {/* Inventory Items Table */}
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-xs text-zinc-700">
              <thead className="bg-zinc-100 text-zinc-500 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3 rounded-l-xl">{t.dishName}</th>
                  <th className="p-3">{t.category}</th>
                  <th className="p-3">{t.price}</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 rounded-r-xl text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {menuItems.map(item => (
                  <tr key={item.id} className="hover:bg-zinc-50 transition-colors">
                    <td className="p-3 flex items-center space-x-3">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-10 h-10 rounded-xl object-cover shrink-0 border border-zinc-200"
                        referrerPolicy="no-referrer"
                      />
                      <div>
                        <div className="font-bold text-zinc-900">{item.name}</div>
                        <div className="text-[10px] text-zinc-500 truncate max-w-xs">{item.description}</div>
                      </div>
                    </td>

                    <td className="p-3 font-bold text-orange-600">{categoryLabel(item.category)}</td>
                    <td className="p-3 font-extrabold text-zinc-900">{formatSom(item.price)}</td>

                    <td className="p-3">
                      <button
                        onClick={() => handleToggleAvailability(item)}
                        className={`px-3 py-1 rounded-md text-[10px] font-bold border transition-colors ${
                          item.isAvailable
                            ? 'bg-green-50 text-green-800 border-green-200'
                            : 'bg-rose-50 text-rose-800 border-rose-200'
                        }`}
                      >
                        {item.isAvailable ? t.inStock : t.soldOut}
                      </button>
                    </td>

                    <td className="p-3 text-right space-x-2">
                      <button
                        onClick={() => setEditingItem(item)}
                        className="p-1.5 bg-zinc-100 hover:bg-orange-50 text-zinc-700 hover:text-orange-600 rounded-lg text-xs font-bold border border-zinc-200 transition-colors"
                        title={t.editDish}
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setItemToDelete(item)}
                        className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-bold border border-rose-200 transition-colors"
                        title={t.deleteDish}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MENU CATEGORIES TAB */}
      {activeTab === 'categories' && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-xl font-bold text-zinc-900">{t.categoriesTitle}</h2>
              <p className="text-xs text-zinc-500 mt-0.5 font-medium">{t.categoriesDesc}</p>
            </div>
            <button
              onClick={() => {
                setShowAddCategory(v => !v);
                setCategoryError('');
              }}
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center space-x-2 shadow-sm transition-all shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>{t.catAddNew}</span>
            </button>
          </div>

          {!!categoryError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl px-3 py-2.5 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{categoryError}</span>
            </div>
          )}

          {showAddCategory && (
            <form
              onSubmit={handleCreateCategory}
              className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 space-y-3 text-xs"
            >
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-1">
                  <label className="block text-zinc-600 font-medium mb-1">{t.catIconLabel}</label>
                  <input
                    value={newCatIcon}
                    onChange={e => setNewCatIcon(e.target.value)}
                    maxLength={4}
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-center text-lg focus:border-orange-500 focus:outline-none"
                    aria-label={t.catIconLabel}
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 font-medium mb-1">{t.catNameUzLabel} *</label>
                  <input
                    value={newCatNameUz}
                    onChange={e => setNewCatNameUz(e.target.value)}
                    required
                    maxLength={60}
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 font-medium mb-1">{t.catNameRuLabel}</label>
                  <input
                    value={newCatNameRu}
                    onChange={e => setNewCatNameRu(e.target.value)}
                    maxLength={60}
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 font-medium mb-1">{t.catNameEnLabel}</label>
                  <input
                    value={newCatNameEn}
                    onChange={e => setNewCatNameEn(e.target.value)}
                    maxLength={60}
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={categoryBusy}
                  className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{t.catAddNew}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddCategory(false)}
                  className="bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 font-bold px-4 py-2 rounded-xl"
                >
                  {t.cancel}
                </button>
              </div>
            </form>
          )}

          {!!pendingOrder && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-amber-900">{t.catOrderUnsaved}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleSaveOrder}
                  disabled={categoryBusy}
                  className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg"
                >
                  {t.catSaveOrder}
                </button>
                <button
                  onClick={() => setPendingOrder(null)}
                  className="bg-white border border-amber-200 text-amber-900 text-xs font-bold px-3 py-1.5 rounded-lg"
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          )}

          {displayedCategories.length === 0 ? (
            <p className="text-xs text-zinc-500 font-medium py-6 text-center">{t.catNoneYet}</p>
          ) : (
            <ul className="space-y-2">
              {displayedCategories.map((cat, index) => (
                <li
                  key={cat.id}
                  className={`border rounded-2xl p-3 transition-colors ${
                    cat.isActive ? 'border-zinc-200 bg-white' : 'border-zinc-200 bg-zinc-50'
                  }`}
                >
                  {editingCategoryId === cat.id ? (
                    <div className="space-y-3 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-zinc-600 font-medium mb-1">{t.catIconLabel}</label>
                          <input
                            value={editCatDraft.icon}
                            onChange={e => setEditCatDraft({ ...editCatDraft, icon: e.target.value })}
                            maxLength={4}
                            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-center text-lg focus:border-orange-500 focus:outline-none"
                            aria-label={t.catIconLabel}
                          />
                        </div>
                        <div>
                          <label className="block text-zinc-600 font-medium mb-1">{t.catNameUzLabel} *</label>
                          <input
                            value={editCatDraft.nameUz}
                            onChange={e => setEditCatDraft({ ...editCatDraft, nameUz: e.target.value })}
                            maxLength={60}
                            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-zinc-600 font-medium mb-1">{t.catNameRuLabel}</label>
                          <input
                            value={editCatDraft.nameRu}
                            onChange={e => setEditCatDraft({ ...editCatDraft, nameRu: e.target.value })}
                            maxLength={60}
                            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-zinc-600 font-medium mb-1">{t.catNameEnLabel}</label>
                          <input
                            value={editCatDraft.nameEn}
                            onChange={e => setEditCatDraft({ ...editCatDraft, nameEn: e.target.value })}
                            maxLength={60}
                            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-zinc-500 font-medium">{t.catRenameHint}</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSaveCategoryEdit}
                          disabled={categoryBusy}
                          className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{t.catSaveAction}</span>
                        </button>
                        <button
                          onClick={() => setEditingCategoryId(null)}
                          className="bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 font-bold px-4 py-2 rounded-xl"
                        >
                          {t.cancel}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button
                          onClick={() => moveCategory(index, -1)}
                          disabled={index === 0 || categoryBusy}
                          title={t.catMoveUp}
                          aria-label={t.catMoveUp}
                          className="p-1 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => moveCategory(index, 1)}
                          disabled={index === displayedCategories.length - 1 || categoryBusy}
                          title={t.catMoveDown}
                          aria-label={t.catMoveDown}
                          className="p-1 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>

                      <span className="text-xl shrink-0" aria-hidden="true">{cat.icon}</span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-bold ${cat.isActive ? 'text-zinc-900' : 'text-zinc-500'}`}>
                            {categoryLabel(cat.id)}
                          </span>
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                              cat.isActive
                                ? 'bg-green-50 text-green-800 border-green-200'
                                : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                            }`}
                          >
                            {cat.isActive ? t.catVisible : t.catHidden}
                          </span>
                          <span className="text-[10px] font-bold text-zinc-500 bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded-full">
                            {cat.dishCount} {t.catDishesCount.toLowerCase()}
                          </span>
                        </div>
                        <p className="text-[10px] text-zinc-400 font-medium truncate mt-0.5">
                          {cat.nameUz} · {cat.nameRu} · {cat.nameEn}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleToggleCategoryActive(cat)}
                          disabled={categoryBusy}
                          title={cat.isActive ? t.catHide : t.catShow}
                          aria-label={cat.isActive ? t.catHide : t.catShow}
                          className="p-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg border border-zinc-200 disabled:opacity-50"
                        >
                          {cat.isActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => startEditCategory(cat)}
                          disabled={categoryBusy}
                          title={t.catEditAction}
                          aria-label={t.catEditAction}
                          className="p-1.5 bg-zinc-100 hover:bg-orange-50 text-zinc-700 hover:text-orange-600 rounded-lg border border-zinc-200 disabled:opacity-50"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setCategoryToDelete(cat);
                            setDeleteMoveTo('');
                            setCategoryError('');
                          }}
                          disabled={categoryBusy || displayedCategories.length <= 1}
                          title={t.catDeleteAction}
                          aria-label={t.catDeleteAction}
                          className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg border border-rose-200 disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ORDERS LIST TAB */}
      {activeTab === 'orders' && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-6 shadow-sm space-y-5">
          {/* Stacks on a phone: side by side, the heading squeezed the cleanup
              button into a two-line sliver. */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-zinc-900">{t.ordersList}</h2>
              <p className="text-xs text-zinc-500 mt-0.5 font-medium">{orders.length} ta buyurtma</p>
            </div>
            <button
              onClick={async () => {
                if (!window.confirm('Delete all orders older than 30 days? This cannot be undone.')) return;
                const count = await onCleanupOldOrders(30);
                if (count !== null) window.alert(`Deleted ${count} old order(s).`);
              }}
              className="shrink-0 bg-zinc-100 hover:bg-red-50 hover:text-red-700 text-zinc-600 text-xs font-bold px-3 py-2.5 rounded-xl border border-zinc-200 hover:border-red-200 transition-colors"
            >
              🧹 30 kundan oshgan buyurtmalarni tozalash
            </button>
          </div>

          {orders.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-10 font-medium">Hozircha buyurtma yo'q.</p>
          ) : (
            <>
              {/* PHONE LAYOUT — one card per order. Everything the table showed,
                  in reading order, with nothing off-screen to the right. */}
              <div className="md:hidden space-y-3">
                {orders.map(ord => (
                  <div key={ord.id} className="border border-zinc-200 rounded-2xl p-3.5 space-y-3 bg-white">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-xs text-orange-600 truncate">#{ord.id}</p>
                        <p className="font-extrabold text-sm text-zinc-900 mt-0.5">{orderDestinationLabel(ord)}</p>
                        {!!ord.customerName && (
                          <p className="text-[11px] text-zinc-500 font-medium truncate">{ord.customerName}</p>
                        )}
                      </div>
                      <span className="font-black text-sm text-zinc-900 shrink-0">{formatSom(ord.totalAmount)}</span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <OrderStatusChip status={ord.status} />
                      <OrderPaymentMethodChip method={ord.paymentMethod} />
                      <OrderPaymentStatusChip paymentStatus={ord.paymentStatus} />
                    </div>

                    {/* line-clamp rather than truncate: on a narrow screen one
                        clipped line of a five-dish order says nothing useful. */}
                    <p className="text-[11px] text-zinc-500 font-medium line-clamp-2">
                      {ord.items.map(i => `${i.quantity}x ${i.menuItem.name}`).join(', ')}
                    </p>

                    <OrderRowActions
                      order={ord}
                      stacked
                      onPrintLocal={printReceipt}
                      onMarkPaid={o => onUpdateOrderStatus(o.id, o.status, 'paid')}
                      onDelete={o => {
                        if (window.confirm(`Delete order #${o.id}? This cannot be undone.`)) onDeleteOrder(o.id);
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* DESKTOP LAYOUT — the full registry table. */}
              <div className="hidden md:block overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-xs text-zinc-700">
                  <thead className="bg-zinc-100 text-zinc-500 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-3">Order ID</th>
                      <th className="p-3">Table</th>
                      <th className="p-3">Customer</th>
                      <th className="p-3">Items Summary</th>
                      <th className="p-3">Total Pay</th>
                      <th className="p-3">Order Status</th>
                      <th className="p-3">How</th>
                      <th className="p-3">Payment</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {orders.map(ord => (
                      <tr key={ord.id} className="hover:bg-zinc-50 transition-colors">
                        <td className="p-3 font-bold text-orange-600">#{ord.id}</td>
                        <td className="p-3 font-extrabold text-zinc-900">{orderDestinationLabel(ord)}</td>
                        <td className="p-3 font-medium">{ord.customerName}</td>
                        <td className="p-3 max-w-xs truncate text-zinc-500">
                          {ord.items.map(i => `${i.quantity}x ${i.menuItem.name}`).join(', ')}
                        </td>
                        <td className="p-3 font-bold text-zinc-900">{formatSom(ord.totalAmount)}</td>
                        <td className="p-3">
                          <OrderStatusChip status={ord.status} />
                        </td>
                        <td className="p-3">
                          <OrderPaymentMethodChip method={ord.paymentMethod} />
                        </td>
                        <td className="p-3">
                          <OrderPaymentStatusChip paymentStatus={ord.paymentStatus} />
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          <OrderRowActions
                            order={ord}
                            onPrintLocal={printReceipt}
                            onMarkPaid={o => onUpdateOrderStatus(o.id, o.status, 'paid')}
                            onDelete={o => {
                              if (window.confirm(`Delete order #${o.id}? This cannot be undone.`)) onDeleteOrder(o.id);
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
      {/* QR GENERATOR TAB */}
      {activeTab === 'qr' && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-6">

          {/* Shareable ordering link — for Instagram bio, website, delivery, Telegram etc. */}
          {restaurantSlug && (
            <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-black text-sky-900">🔗 Restoraningizning umumiy havolasi</h3>
              <p className="text-xs text-sky-800/80">
                Bu havolani Instagram bio'ga, saytga yoki xohlagan joyga qo'ying — mijozlar shu orqali to'g'ridan-to'g'ri
                sizning menyungizga va dostavka buyurtma berish sahifasiga tushadi (stol raqamisiz).
              </p>
              <div className="flex items-center space-x-2">
                <input
                  readOnly
                  value={getShareableOrderUrl(appUrl, restaurantSlug)}
                  className="flex-1 bg-white border border-sky-300 rounded-xl px-3 py-2 text-xs font-mono text-zinc-700"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => navigator.clipboard.writeText(getShareableOrderUrl(appUrl, restaurantSlug))}
                  className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors shrink-0"
                >
                  Nusxa olish
                </button>
              </div>

              {telegramBotUsername && (
                <>
                  <div className="border-t border-sky-200/70 pt-3" />
                  <h4 className="text-xs font-black text-sky-900">📱 Telegram orqali buyurtma (Mini App)</h4>
                  <p className="text-[11px] text-sky-800/70">
                    Mijoz shu havolani bossa, Telegram ichida ochilib, sizning menyungiz to'g'ridan-to'g'ri Telegramda ko'rinadi — brauzer kerak emas.
                  </p>
                  <div className="flex items-center space-x-2">
                    <input
                      readOnly
                      value={`https://t.me/${telegramBotUsername}?start=order_${restaurantSlug}`}
                      className="flex-1 bg-white border border-sky-300 rounded-xl px-3 py-2 text-xs font-mono text-zinc-700"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      onClick={() => navigator.clipboard.writeText(`https://t.me/${telegramBotUsername}?start=order_${restaurantSlug}`)}
                      className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors shrink-0"
                    >
                      Nusxa olish
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Shareable BOOKING link — the reason web booking exists: a guest
              who never installs Telegram (a tourist, say) can reserve a table
              from Google Maps or an Instagram bio. Only shown once the
              reservations feature is switched on for this restaurant. */}
          {restaurantSlug && reservationStatus === 'active' && (
            <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-black text-violet-900">📅 Stol bron qilish havolasi</h3>
              <p className="text-xs text-violet-800/80">
                Bu havolani Google Maps, Instagram yoki saytga qo'ying — mijoz menyuni kutmasdan to'g'ridan-to'g'ri
                bron shaklini ko'radi. Telegram shart emas, uch tilda ishlaydi. Bron sizga xuddi bot orqali kelgani
                kabi "Bronlar" bo'limida ko'rinadi.
              </p>
              <div className="flex items-center space-x-2">
                <input
                  readOnly
                  value={getShareableBookingUrl(appUrl, restaurantSlug)}
                  className="flex-1 bg-white border border-violet-300 rounded-xl px-3 py-2 text-xs font-mono text-zinc-700"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => navigator.clipboard.writeText(getShareableBookingUrl(appUrl, restaurantSlug))}
                  className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors shrink-0"
                >
                  Nusxa olish
                </button>
              </div>
            </div>
          )}

          <div className="max-w-2xl mx-auto text-center space-y-4">
            <h2 className="text-2xl font-black text-zinc-900">Table QR Code Generator & Printing</h2>
            <p className="text-xs text-zinc-500 font-medium">
              Select a table number to generate its instant digital scanning QR code card.
            </p>

            <div className="flex flex-wrap justify-center gap-2">
              {(tables.length > 0 ? tables.map(t => t.tableNumber) : Array.from({ length: 12 }, (_, i) => i + 1)).map(num => (
                <button
                  key={num}
                  onClick={() => setSelectedQRTable(num)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    selectedQRTable === num
                      ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                      : 'bg-zinc-100 text-zinc-700 border-zinc-200'
                  }`}
                >
                  T-{num}
                </button>
              ))}
            </div>

            {/* QR Card Preview */}
            <div className="bg-white text-zinc-900 rounded-2xl p-8 max-w-sm mx-auto shadow-xl border-2 border-orange-500 space-y-4">
              <div className="font-extrabold text-lg uppercase tracking-wider text-orange-600">
                Gourmet Bistro
              </div>
              <div className="text-3xl font-black text-zinc-900">
                TABLE #{selectedQRTable}
              </div>

              <div className="w-52 h-52 mx-auto bg-white p-3 rounded-xl shadow-inner border border-zinc-200">
                <QRCodeImage
                  value={getTableFullUrl(selectedQRTable, appUrl, restaurantId, restaurantSlug)}
                  alt={`Table ${selectedQRTable} QR Code`}
                />
              </div>

              <p className="text-xs text-zinc-500 font-medium">
                Scan with any phone camera to view digital menu & order directly for Table #{selectedQRTable}
              </p>

              <div className="pt-3 border-t border-zinc-100 flex items-center justify-center space-x-2">
                <button
                  onClick={() => {
                    const url = getTableFullUrl(selectedQRTable, appUrl, restaurantId, restaurantSlug);
                    navigator.clipboard.writeText(url);
                    alert(`Copied URL for Table #${selectedQRTable}:\n${url}`);
                  }}
                  className="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-bold px-3 py-1.5 rounded-lg border border-zinc-200 transition-colors"
                >
                  Copy Table URL
                </button>
                <a
                  href={getTableFullUrl(selectedQRTable, appUrl, restaurantId, restaurantSlug)}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                >
                  Test Table Menu
                </a>
              </div>
            </div>

            {/* Direct Multi-Device Role Links Section */}
            <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 space-y-3">
              <h3 className="font-extrabold text-sm text-zinc-900 uppercase tracking-wider">
                📱 Multi-Device Setup (Separate Kitchen & POS Screen Links)
              </h3>
              <p className="text-xs text-zinc-600">
                Each screen has its own address, so a device only ever sees the one interface it is meant for
                (Kitchen iPad, Cashier POS terminal, or Customer Phones):
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div className="bg-white p-3.5 rounded-xl border border-zinc-200 space-y-1.5">
                  <div className="text-xs font-extrabold text-orange-600 flex items-center justify-between">
                    <span>👨‍🍳 Kitchen Display (KDS)</span>
                    <button
                      onClick={() => {
                        // Each surface has its own hostname now, so this is the
                        // kitchen host itself — a ?view=kitchen query on the
                        // guest host resolves to the menu in production.
                        const url = kitchenUrl;
                        navigator.clipboard.writeText(url);
                        alert(`Copied Kitchen URL:\n${url}`);
                      }}
                      className="text-[10px] bg-orange-50 hover:bg-orange-100 text-orange-700 px-2 py-0.5 rounded-md font-bold"
                    >
                      Copy Link
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500">Open on tablet in kitchen to manage incoming ticket orders live.</p>
                  <p className="text-[10px] font-mono text-zinc-400 break-all">{kitchenUrl}</p>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-zinc-200 space-y-1.5">
                  <div className="text-xs font-extrabold text-zinc-900 flex items-center justify-between">
                    <span>📱 Customer Digital Menu</span>
                    <button
                      onClick={() => {
                        const url = getTableFullUrl(1, appUrl, restaurantId, restaurantSlug);
                        navigator.clipboard.writeText(url);
                        alert(`Copied Customer Menu URL:\n${url}`);
                      }}
                      className="text-[10px] bg-zinc-100 hover:bg-zinc-200 text-zinc-700 px-2 py-0.5 rounded-md font-bold"
                    >
                      Copy Link
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500">Table QR scan landing page for customers to order directly.</p>
                  <p className="text-[10px] font-mono text-zinc-400 break-all">{appUrl}</p>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-zinc-200 space-y-1.5">
                  <div className="text-xs font-extrabold text-amber-600 flex items-center justify-between">
                    <span>🔒 Admin & Manager POS</span>
                    <button
                      onClick={() => {
                        const url = adminUrl;
                        navigator.clipboard.writeText(url);
                        alert(`Copied Admin URL:\n${url}`);
                      }}
                      className="text-[10px] bg-amber-50 hover:bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md font-bold"
                    >
                      Copy Link
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500">Manager portal for menu edits, sales analytics, and tables.</p>
                  <p className="text-[10px] font-mono text-zinc-400 break-all">{adminUrl}</p>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ANALYTICS TAB */}
      {activeTab === 'analytics' && (
        <div className="space-y-5">
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center space-x-1.5 bg-zinc-100 p-1 rounded-xl border border-zinc-200">
                {[7, 30, 90].map(d => (
                  <button
                    key={d}
                    onClick={() => setAnalyticsRangeDays(d)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      analyticsRangeDays === d ? 'bg-orange-500 text-white shadow-xs' : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {d} kun
                  </button>
                ))}
              </div>
              <a
                href="/api/admin/orders/export"
                className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold px-3 py-2 rounded-xl flex items-center space-x-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Excel yuklab olish</span>
              </a>
            </div>

            {analyticsLoading ? (
              <div className="py-16 text-center text-zinc-400 text-xs font-bold">Yuklanmoqda...</div>
            ) : analyticsData ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                    <div className="text-[11px] text-zinc-500 font-bold uppercase">Jami daromad</div>
                    <div className="text-xl font-black text-zinc-900 mt-1">{formatSom(analyticsData.totalRevenue)}</div>
                    {analyticsData.revenueChangePercent !== null && (
                      <div className={`text-[11px] font-bold mt-1 ${analyticsData.revenueChangePercent >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {analyticsData.revenueChangePercent >= 0 ? '▲' : '▼'} {Math.abs(analyticsData.revenueChangePercent)}% oldingi davrga nisbatan
                      </div>
                    )}
                  </div>
                  <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                    <div className="text-[11px] text-zinc-500 font-bold uppercase">Buyurtmalar soni</div>
                    <div className="text-xl font-black text-zinc-900 mt-1">{analyticsData.totalOrders}</div>
                    <div className="text-[11px] text-zinc-400 mt-1">
                      🍽 {analyticsData.orderTypeBreakdown.dineIn} zalda &nbsp;•&nbsp; 🛵 {analyticsData.orderTypeBreakdown.delivery} dostavka &nbsp;•&nbsp; 🥡 {analyticsData.orderTypeBreakdown.pickup ?? 0} olib ketish
                    </div>
                  </div>
                  <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                    <div className="text-[11px] text-zinc-500 font-bold uppercase">O'rtacha chek</div>
                    <div className="text-xl font-black text-zinc-900 mt-1">{formatSom(analyticsData.averageOrderValue)}</div>
                  </div>
                </div>

                <div className="pt-2">
                  <h4 className="text-xs font-extrabold text-zinc-700 uppercase mb-2">Kunlik daromad</h4>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analyticsData.revenueTimeline}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => formatSom(v)} />
                        <Bar dataKey="revenue" fill="#f97316" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <h4 className="text-xs font-extrabold text-zinc-700 uppercase mb-2">To'lov turlari</h4>
                    {analyticsData.paymentMethodBreakdown.length === 0 ? (
                      <p className="text-xs text-zinc-400 py-4 text-center">Ma'lumot yo'q</p>
                    ) : (
                      <div className="space-y-1.5">
                        {analyticsData.paymentMethodBreakdown.map(p => (
                          <div key={p.method} className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5">
                            <span className="text-xs font-bold text-zinc-800">
                              {p.method === 'card' ? '💳 Karta' : p.method === 'loyalty_points' ? '⭐ Ballar' : '💵 Naqd'}
                            </span>
                            <div className="text-right">
                              <span className="text-xs font-black text-zinc-900">{formatSom(p.revenue)}</span>
                              <span className="text-[10px] text-zinc-400 ml-2">{p.count} ta</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="text-xs font-extrabold text-zinc-700 uppercase mb-2">Kategoriya bo'yicha daromad</h4>
                    {analyticsData.categoryBreakdown.length === 0 ? (
                      <p className="text-xs text-zinc-400 py-4 text-center">Ma'lumot yo'q</p>
                    ) : (
                      <div className="space-y-1.5">
                        {analyticsData.categoryBreakdown.slice(0, 5).map(c => (
                          <div key={c.category} className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5">
                            <span className="text-xs font-bold text-zinc-800 capitalize">{categoryLabel(c.category)}</span>
                            <span className="text-xs font-black text-zinc-900">{formatSom(c.revenue)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-2">
                  <h4 className="text-xs font-extrabold text-zinc-700 uppercase mb-2">Eng ko'p sotilgan taomlar</h4>
                  {analyticsData.topDishes.length === 0 ? (
                    <p className="text-xs text-zinc-400 py-4 text-center">Ma'lumot yo'q</p>
                  ) : (
                    <div className="space-y-1.5">
                      {analyticsData.topDishes.map((dish, i) => (
                        <div key={dish.name + i} className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] font-black text-zinc-400 w-4">{i + 1}</span>
                            <span className="text-xs font-bold text-zinc-900">{dish.name}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-black text-orange-600">{dish.quantity}x</span>
                            <span className="text-[10px] text-zinc-400 ml-2">{formatSom(dish.revenue)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-zinc-400 py-8 text-center">Ma'lumot topilmadi</p>
            )}
          </div>

          {/* GUEST REVIEWS — per-dish star averages + the latest comments */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-xl border border-amber-100">
                  <Star className="w-5 h-5" />
                </div>
                <h3 className="text-xs font-extrabold text-zinc-700 uppercase">Mijozlar baholari</h3>
              </div>
              <button
                onClick={fetchReviews}
                className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
                title="Yangilash"
                aria-label="Yangilash"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {reviewSummaries.length === 0 ? (
              <div className="text-center py-8">
                <MessageSquare className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                <p className="text-xs text-zinc-400 font-medium">
                  Hali baho yo'q — mijoz buyurtmasi tortilgandan keyin yulduzcha bosishi mumkin.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  {reviewSummaries.map(s => {
                    const low = s.averageRating < 3.5;
                    return (
                      <div
                        key={s.menuItemId}
                        className={`flex items-center justify-between rounded-xl px-3 py-2.5 border ${
                          low ? 'bg-rose-50 border-rose-200' : 'bg-zinc-50 border-zinc-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-zinc-900 block truncate">{s.menuItemName}</span>
                          <span className="text-[10px] text-zinc-400 font-bold">
                            {s.totalReviews} ta baho • oxirgi {new Date(s.lastReviewAt).toLocaleDateString('uz-UZ')}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0">
                          {/* One filled star per whole rating point — cheap and
                              readable at a glance, no chart library needed. */}
                          <div className="flex items-center">
                            {[1, 2, 3, 4, 5].map(star => (
                              <Star
                                key={star}
                                className={`w-3.5 h-3.5 ${
                                  star <= Math.round(s.averageRating) ? 'text-amber-400 fill-amber-400' : 'text-zinc-300'
                                }`}
                              />
                            ))}
                          </div>
                          <span
                            className={`text-xs font-black w-9 text-right ${
                              low ? 'text-rose-600' : 'text-zinc-900'
                            }`}
                          >
                            {s.averageRating.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {recentReviews.filter(r => r.comment).length > 0 && (
                  <div className="pt-1">
                    <h4 className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider mb-2">Oxirgi izohlar</h4>
                    <div className="space-y-2">
                      {recentReviews
                        .filter(r => r.comment)
                        .slice(0, 5)
                        .map(r => (
                          <div key={r.id} className="bg-zinc-50 border border-zinc-200 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-black text-zinc-900">{r.menuItemName}</span>
                              <span className="text-[10px] font-bold text-amber-600">
                                {'⭐'.repeat(r.rating)}
                              </span>
                            </div>
                            <p className="text-[11px] text-zinc-600 font-medium">{r.comment}</p>
                            <p className="text-[10px] text-zinc-400 mt-1">
                              {r.tableNumber ? `Stol #${r.tableNumber} • ` : ''}
                              {new Date(r.createdAt).toLocaleString('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Z-REPORT (daily cash reconciliation) */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm space-y-3">
            <h3 className="text-xs font-extrabold text-zinc-700 uppercase">Kunlik hisobot (Z-report)</h3>
            {zReport ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3">
                    <div className="text-[10px] text-zinc-500 font-bold uppercase">Naqd</div>
                    <div className="text-sm font-black text-zinc-900 mt-0.5">{formatSom(zReport.cashTotal)}</div>
                  </div>
                  <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3">
                    <div className="text-[10px] text-zinc-500 font-bold uppercase">Karta</div>
                    <div className="text-sm font-black text-zinc-900 mt-0.5">{formatSom(zReport.cardTotal)}</div>
                  </div>
                  <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3">
                    <div className="text-[10px] text-zinc-500 font-bold uppercase">Jami</div>
                    <div className="text-sm font-black text-orange-600 mt-0.5">{formatSom(zReport.totalRevenue)}</div>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400">{zReport.date} • {zReport.orderCount} ta buyurtma</p>
                {zReport.closure ? (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-2.5 text-[11px] text-green-800 font-bold">
                    ✅ Yopilgan: {new Date(zReport.closure.closedAt).toLocaleString('uz-UZ')}
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      const res = await fetch('/api/admin/z-report/close', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({})
                      });
                      if (res.ok) {
                        const updated = await fetch('/api/admin/z-report').then(r => r.json());
                        setZReport(updated);
                      }
                    }}
                    className="bg-zinc-900 hover:bg-black text-white font-bold px-4 py-2 rounded-xl text-xs transition-colors"
                  >
                    Kunni yopish
                  </button>
                )}
              </>
            ) : (
              <p className="text-xs text-zinc-400 py-4 text-center">Yuklanmoqda...</p>
            )}
          </div>
        </div>
      )}

      {/* BRANDING TAB */}
      {activeTab === 'branding' && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex items-center space-x-3 border-b border-zinc-100 pb-4">
            <div className="p-3 bg-orange-50 text-orange-600 rounded-xl border border-orange-100">
              <ImageIcon className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900">Brendlash</h2>
              <p className="text-xs text-zinc-500 font-medium mt-0.5">
                Logotip va rangingizni sozlang — mijozlar buni sizning o'z tizimingiz sifatida ko'radi.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-2">Restoran nomi</label>
                <input
                  type="text"
                  value={displayNameInput}
                  onChange={(e) => setDisplayNameInput(e.target.value)}
                  placeholder="Masalan: Old City Restaurant"
                  className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2.5 text-sm text-zinc-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-2">Logotip</label>
                <div className="flex items-center space-x-3">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo preview" className="w-16 h-16 rounded-2xl object-cover border border-zinc-200" />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-zinc-100 border border-zinc-200 flex items-center justify-center text-zinc-400">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                  )}
                  <label className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-bold px-3 py-2 rounded-xl cursor-pointer border border-zinc-200 transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 400 * 1024) {
                          setBrandingMsg("Rasm hajmi juda katta (max 400KB).");
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => setLogoPreview(reader.result as string);
                        reader.readAsDataURL(file);
                      }}
                    />
                    Rasm tanlash
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-2">Asosiy rang</label>
                <div className="flex items-center space-x-3">
                  <input
                    type="color"
                    value={brandColorInput}
                    onChange={(e) => setBrandColorInput(e.target.value)}
                    className="w-14 h-10 rounded-xl border border-zinc-200 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-zinc-500">{brandColorInput}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-2">Telefon (mijozlar uchun)</label>
                  <input
                    type="text"
                    value={contactPhoneInput}
                    onChange={(e) => setContactPhoneInput(e.target.value)}
                    placeholder="+998901234567"
                    className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2.5 text-sm text-zinc-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-2">Instagram</label>
                  <input
                    type="text"
                    value={contactInstagramInput}
                    onChange={(e) => setContactInstagramInput(e.target.value)}
                    placeholder="restoran_nomi"
                    className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2.5 text-sm text-zinc-900 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-2">Manzil</label>
                <input
                  type="text"
                  value={contactAddressInput}
                  onChange={(e) => setContactAddressInput(e.target.value)}
                  placeholder="Samarqand, Registon ko'chasi 12"
                  className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2.5 text-sm text-zinc-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-2">Ish vaqti</label>
                <input
                  type="text"
                  value={workingHoursInput}
                  onChange={(e) => setWorkingHoursInput(e.target.value)}
                  placeholder="09:00 - 23:00"
                  className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2.5 text-sm text-zinc-900 outline-none"
                />
              </div>

              <button
                onClick={async () => {
                  if (!onUpdateBranding) return;
                  setBrandingSaving(true);
                  setBrandingMsg(null);
                  const ok = await onUpdateBranding({
                    logoUrl: logoPreview,
                    brandColor: brandColorInput,
                    displayName: displayNameInput,
                    contactPhone: contactPhoneInput,
                    contactAddress: contactAddressInput,
                    contactInstagram: contactInstagramInput,
                    workingHours: workingHoursInput
                  });
                  setBrandingSaving(false);
                  setBrandingMsg(ok ? "✅ Saqlandi!" : "❌ Xatolik yuz berdi.");
                }}
                disabled={brandingSaving}
                className="bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-colors"
              >
                {brandingSaving ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
              {brandingMsg && <p className="text-xs font-bold text-zinc-600">{brandingMsg}</p>}
            </div>

            {/* Live preview */}
            <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4">
              <p className="text-[11px] text-zinc-400 font-bold uppercase mb-2">Mijoz ko'rinishi (namuna)</p>
              <div className="bg-white rounded-xl p-3 border border-zinc-200 flex items-center space-x-2.5">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" className="w-9 h-9 rounded-xl object-cover" />
                ) : (
                  <div style={{ backgroundColor: brandColorInput }} className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-sm">
                    P
                  </div>
                )}
                <span style={{ backgroundColor: brandColorInput }} className="text-white font-black text-[10px] px-2.5 py-0.5 rounded-lg uppercase">
                  Stol #1
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELIVERY / COURIERS TAB */}
      {activeTab === 'delivery' && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex items-center space-x-3 border-b border-zinc-100 pb-4">
            <div className="p-3 bg-orange-50 text-orange-600 rounded-xl border border-orange-100">
              <span className="text-xl">🛵</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900">Dostavka</h2>
              <p className="text-xs text-zinc-500 font-medium mt-0.5">
                Kuryerlaringizni ulang — yangi dostavka buyurtmasi kelganda ularga Telegram orqali avtomatik xabar boradi.
              </p>
            </div>
          </div>

          {deliveryStatus !== 'active' ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 font-medium">
              Dostavka xizmati hozircha faol emas. Administrator bilan bog'laning.
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <h3 className="text-xs font-extrabold text-zinc-700 uppercase">Kuryerlar</h3>
                {couriers.length === 0 ? (
                  <p className="text-xs text-zinc-400 py-3">Hali kuryer ulanmagan.</p>
                ) : (
                  <div className="space-y-1.5">
                    {couriers.map(c => (
                      <div key={c.id} className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5">
                        <div>
                          <span className="text-xs font-bold text-zinc-900">{c.name}</span>
                          {c.telegramUsername && <span className="text-[11px] text-zinc-400 ml-2">@{c.telegramUsername}</span>}
                        </div>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-zinc-200 text-zinc-500'}`}>
                          {c.status === 'active' ? 'Faol' : 'Faol emas'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* One link per courier: type the name, copy the link, send it in
                  Telegram. The courier never needs the admin panel. */}
              <div className="pt-4 border-t border-zinc-100 space-y-3">
                <h3 className="text-xs font-extrabold text-zinc-700 uppercase">Yangi kuryer uchun havola</h3>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={courierInviteName}
                    onChange={e => setCourierInviteName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateCourierInvite();
                    }}
                    placeholder="Kuryerning ismi (masalan: Aziz)"
                    maxLength={80}
                    className="flex-1 px-3 py-2.5 border border-zinc-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-orange-400 focus:border-orange-400 outline-none"
                  />
                  <button
                    onClick={handleCreateCourierInvite}
                    disabled={courierInviteBusy}
                    className="bg-zinc-900 hover:bg-black disabled:opacity-60 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-colors whitespace-nowrap"
                  >
                    {courierInviteBusy ? '...' : 'Havola yaratish'}
                  </button>
                </div>
                {courierInviteError && (
                  <p className="text-[11px] font-bold text-red-600">{courierInviteError}</p>
                )}
                <p className="text-[11px] text-zinc-400">
                  Havolani nusxalab kuryerga yuboring. Kuryer havolani ochib "Start" bosgach, yuqoridagi ro'yxatda avtomatik paydo bo'ladi. Har bir havola bir marta ishlaydi va 7 kundan keyin muddati tugaydi.
                </p>

                {courierInvites.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {courierInvites.map(invite => {
                      const expired = invite.status === 'pending' && new Date(invite.expiresAt).getTime() < Date.now();
                      const state = expired ? 'expired' : invite.status;
                      const badge =
                        state === 'used'
                          ? { text: 'Ulangan', cls: 'bg-green-100 text-green-700' }
                          : state === 'revoked'
                            ? { text: 'Bekor qilingan', cls: 'bg-zinc-200 text-zinc-500' }
                            : state === 'expired'
                              ? { text: 'Muddati tugagan', cls: 'bg-amber-100 text-amber-700' }
                              : { text: 'Kutilmoqda', cls: 'bg-blue-100 text-blue-700' };
                      return (
                        <div key={invite.token} className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-zinc-900 truncate">{invite.courierName}</span>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${badge.cls}`}>
                              {badge.text}
                            </span>
                          </div>
                          {state === 'pending' && (
                            <>
                              <div className="flex items-center gap-2">
                                <input
                                  readOnly
                                  value={invite.link}
                                  onFocus={e => e.currentTarget.select()}
                                  className="flex-1 min-w-0 px-2 py-1.5 bg-white border border-zinc-200 rounded-lg text-[11px] text-zinc-600 font-mono"
                                />
                                <button
                                  onClick={() => handleCopyInvite(invite)}
                                  className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-3 py-1.5 rounded-lg text-[11px] transition-colors whitespace-nowrap"
                                >
                                  {copiedInviteToken === invite.token ? 'Nusxalandi' : 'Nusxalash'}
                                </button>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-zinc-400">
                                  Muddati: {new Date(invite.expiresAt).toLocaleDateString()}
                                </span>
                                <button
                                  onClick={() => handleRevokeInvite(invite.token)}
                                  disabled={courierInviteBusy}
                                  className="text-[10px] font-bold text-red-600 hover:text-red-700 disabled:opacity-60"
                                >
                                  Bekor qilish
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* RESERVATIONS TAB — booking happens only in the bot, this is the answer side */}
      {activeTab === 'reservations' && reservationStatus === 'active' && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-center space-x-3 border-b border-zinc-100 pb-4">
            <div className="p-3 bg-orange-50 text-orange-600 rounded-xl border border-orange-100">
              <CalendarDays className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900">{t.reservationsNav}</h2>
              <p className="text-xs text-zinc-500 font-medium mt-0.5">{t.reservationsDesc}</p>
            </div>
          </div>

          {/* The only way in for a guest: the bot deep link. Nothing books on the web. */}
          {telegramBotUsername && restaurantSlug && (
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 space-y-2">
              <p className="text-[11px] font-bold text-zinc-600">{t.reservationShareLink}</p>
              <div className="flex items-center space-x-2">
                <input
                  readOnly
                  value={`https://t.me/${telegramBotUsername}?start=book_${restaurantSlug}`}
                  onFocus={e => e.currentTarget.select()}
                  className="flex-1 min-w-0 bg-white border border-zinc-200 rounded-lg px-2.5 py-2 text-[11px] font-mono text-zinc-700"
                />
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(`https://t.me/${telegramBotUsername}?start=book_${restaurantSlug}`)
                  }
                  className="shrink-0 bg-zinc-900 hover:bg-black text-white font-bold px-3 py-2 rounded-lg text-[11px] transition-colors"
                >
                  {t.copyLink}
                </button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center flex-wrap gap-2">
            <input
              type="date"
              value={reservationDateFilter}
              onChange={e => setReservationDateFilter(e.target.value)}
              className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-800 focus:border-orange-500 focus:outline-none"
            />
            {reservationDateFilter && (
              <button
                onClick={() => setReservationDateFilter('')}
                className="text-[11px] font-bold text-zinc-500 hover:text-zinc-800 px-2 py-1.5"
              >
                {t.reservationClearDate}
              </button>
            )}
            <button
              onClick={() => setReservationOnlyPending(v => !v)}
              className={`px-3 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
                reservationOnlyPending
                  ? 'bg-orange-500 border-orange-500 text-white'
                  : 'bg-white border-zinc-200 text-zinc-600 hover:border-orange-300'
              }`}
            >
              {t.reservationOnlyPending}
            </button>
            <button
              onClick={fetchReservations}
              disabled={reservationsLoading}
              className="px-3 py-2 rounded-xl text-[11px] font-bold bg-white border border-zinc-200 text-zinc-600 hover:border-orange-300 disabled:opacity-50 transition-colors"
            >
              {reservationsLoading ? '...' : t.reservationRefresh}
            </button>
          </div>

          {reservationError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 text-xs font-bold">
              {reservationError}
            </div>
          )}

          {reservations.length === 0 ? (
            <p className="text-xs text-zinc-400 py-4">{reservationsLoading ? '...' : t.reservationsEmpty}</p>
          ) : (
            <div className="space-y-2">
              {reservations.map(r => {
                const busy = reservationBusyId === r.id;
                const statusLabel = {
                  pending: t.reservationStatusPending,
                  confirmed: t.reservationStatusConfirmed,
                  declined: t.reservationStatusDeclined,
                  cancelled: t.reservationStatusCancelled,
                  seated: t.reservationStatusSeated,
                  no_show: t.reservationStatusNoShow
                }[r.status];
                const statusClass = {
                  pending: 'bg-amber-100 text-amber-800',
                  confirmed: 'bg-emerald-100 text-emerald-700',
                  declined: 'bg-rose-100 text-rose-700',
                  cancelled: 'bg-zinc-200 text-zinc-600',
                  seated: 'bg-blue-100 text-blue-700',
                  no_show: 'bg-zinc-800 text-white'
                }[r.status];
                return (
                  <div
                    key={r.id}
                    className={`border rounded-2xl p-3.5 space-y-3 ${
                      r.status === 'pending' ? 'border-amber-300 bg-amber-50/40' : 'border-zinc-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                          <span className="text-sm font-black text-zinc-900">
                            {r.reservedDate} · {r.reservedTime}
                          </span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${statusClass}`}>
                            {statusLabel}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-zinc-700 mt-1 truncate">
                          {r.guestName} · {r.partySize} {t.reservationGuestsShort}
                        </p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          <a href={`tel:${r.guestPhone}`} className="font-mono hover:text-orange-600">
                            {r.guestPhone}
                          </a>
                          {r.telegramUsername && <span className="ml-2">@{r.telegramUsername}</span>}
                        </p>
                        {r.note && <p className="text-[11px] text-zinc-600 mt-1 italic">“{r.note}”</p>}
                      </div>
                      <label className="shrink-0 text-right">
                        <span className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">{t.table}</span>
                        <select
                          value={r.tableNumber ?? ''}
                          disabled={busy}
                          onChange={e =>
                            updateReservationStatus(r.id, {
                              tableNumber: e.target.value === '' ? null : Number(e.target.value)
                            })
                          }
                          className="bg-white border border-zinc-200 rounded-lg px-2 py-1.5 text-xs font-bold text-zinc-800 focus:border-orange-500 focus:outline-none disabled:opacity-50"
                        >
                          <option value="">—</option>
                          {tables.map(tb => (
                            <option key={tb.tableNumber} value={tb.tableNumber}>
                              #{tb.tableNumber} ({tb.capacity})
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {/* Only the transitions that make sense from the current state. */}
                    <div className="flex items-center flex-wrap gap-1.5 pt-1 border-t border-zinc-200/70">
                      {r.status === 'pending' && (
                        <>
                          <button
                            onClick={() => updateReservationStatus(r.id, { status: 'confirmed' })}
                            disabled={busy}
                            className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg text-[11px] transition-colors"
                          >
                            {t.reservationConfirm}
                          </button>
                          <button
                            onClick={() => updateReservationStatus(r.id, { status: 'declined' })}
                            disabled={busy}
                            className="bg-white hover:bg-rose-50 border border-rose-200 disabled:opacity-50 text-rose-600 font-bold px-3 py-1.5 rounded-lg text-[11px] transition-colors"
                          >
                            {t.reservationDecline}
                          </button>
                        </>
                      )}
                      {r.status === 'confirmed' && (
                        <>
                          <button
                            onClick={() => updateReservationStatus(r.id, { status: 'seated' })}
                            disabled={busy}
                            className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg text-[11px] transition-colors"
                          >
                            {t.reservationMarkSeated}
                          </button>
                          <button
                            onClick={() => updateReservationStatus(r.id, { status: 'no_show' })}
                            disabled={busy}
                            className="bg-white hover:bg-zinc-100 border border-zinc-300 disabled:opacity-50 text-zinc-700 font-bold px-3 py-1.5 rounded-lg text-[11px] transition-colors"
                          >
                            {t.reservationMarkNoShow}
                          </button>
                          <button
                            onClick={() => updateReservationStatus(r.id, { status: 'cancelled' })}
                            disabled={busy}
                            className="bg-white hover:bg-rose-50 border border-rose-200 disabled:opacity-50 text-rose-600 font-bold px-3 py-1.5 rounded-lg text-[11px] transition-colors"
                          >
                            {t.reservationCancel}
                          </button>
                        </>
                      )}
                      <span className="ml-auto text-[10px] text-zinc-400">
                        {r.source === 'bot'
                          ? t.reservationSourceBot
                          : r.source === 'web'
                            ? t.reservationSourceWeb
                            : t.reservationSourceAdmin}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECURITY & PASSWORDS MANAGEMENT TAB */}
      {activeTab === 'security' && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex items-center space-x-3 border-b border-zinc-100 pb-4">
            <div className="p-3 bg-orange-50 text-orange-600 rounded-xl border border-orange-100">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900">{t.security}</h2>
              <p className="text-xs text-zinc-500 font-medium mt-0.5">{t.securityDesc}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Admin Password Card */}
            <div className="bg-zinc-50/80 border border-zinc-200 rounded-2xl p-5 space-y-4">
              <div className="flex items-center space-x-2 text-zinc-900 font-extrabold text-sm border-b border-zinc-200/80 pb-2.5">
                <Lock className="w-4 h-4 text-orange-500" />
                <span>{t.adminPasswordSettingLabel}</span>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-zinc-600">
                  {t.newAdminPassPlaceholder}
                </label>
                <div className="relative">
                  <input
                    type={showAdminPass ? "text" : "password"}
                    value={adminPassInput}
                    onChange={(e) => {
                      setAdminPassInput(e.target.value);
                      setAdminPassMsg(null);
                    }}
                    placeholder="••••••••"
                    className="w-full bg-white border border-zinc-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 rounded-xl px-3 py-2.5 text-xs text-zinc-900 outline-none pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPass(!showAdminPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 p-1"
                  >
                    {showAdminPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {adminPassMsg && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>{adminPassMsg}</span>
                </div>
              )}

              <button
                onClick={() => {
                  if (!adminPassInput.trim()) return;
                  onUpdateAdminPassword(adminPassInput.trim());
                  setAdminPassMsg(t.passUpdatedSuccess);
                  setAdminPassInput('');
                }}
                disabled={!adminPassInput.trim()}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm transition-all flex items-center justify-center space-x-1.5"
              >
                <Key className="w-3.5 h-3.5" />
                <span>{t.savePassword}</span>
              </button>
            </div>

            {/* Kitchen PIN / Password Card */}
            <div className="bg-zinc-50/80 border border-zinc-200 rounded-2xl p-5 space-y-4">
              <div className="flex items-center space-x-2 text-zinc-900 font-extrabold text-sm border-b border-zinc-200/80 pb-2.5">
                <ChefHat className="w-4 h-4 text-orange-500" />
                <span>{t.kitchenPinSettingLabel}</span>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-zinc-600">
                  {t.newKitchenPinPlaceholder}
                </label>
                <div className="relative">
                  <input
                    type={showKitchenPin ? "text" : "password"}
                    value={kitchenPinInput}
                    onChange={(e) => {
                      setKitchenPinInput(e.target.value);
                      setKitchenPinMsg(null);
                    }}
                    placeholder="••••••••"
                    className="w-full bg-white border border-zinc-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 rounded-xl px-3 py-2.5 text-xs text-zinc-900 outline-none pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKitchenPin(!showKitchenPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 p-1"
                  >
                    {showKitchenPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {kitchenPinMsg && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>{kitchenPinMsg}</span>
                </div>
              )}

              <button
                onClick={() => {
                  if (!kitchenPinInput.trim()) return;
                  onUpdateKitchenPin(kitchenPinInput.trim());
                  setKitchenPinMsg(t.passUpdatedSuccess);
                  setKitchenPinInput('');
                }}
                disabled={!kitchenPinInput.trim()}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm transition-all flex items-center justify-center space-x-1.5"
              >
                <Key className="w-3.5 h-3.5" />
                <span>{t.savePassword}</span>
              </button>
            </div>

          </div>

          {/* Tax & Service Fee Card — soliq (tax) and xizmat haqi (service
              fee) percentages, admin-editable anytime. The server always
              recalculates every order using these — a customer can never
              override this by tampering with their request. */}
          <div className="bg-zinc-50/80 border border-zinc-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-200/80 pb-2.5">
              <div className="flex items-center space-x-2 text-zinc-900 font-extrabold text-sm">
                <span>🧾</span>
                <span>Soliq va Xizmat Haqi (Tax &amp; Service Fee)</span>
              </div>
              {taxServiceMsg && <span className="text-[10px] text-green-600 font-bold">{taxServiceMsg}</span>}
            </div>
            <p className="text-[11px] text-zinc-500">
              These percentages apply to every order and are shown to customers at checkout. Change them anytime — takes effect immediately, no restart needed.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Soliq (Tax) %</label>
                <div className="flex space-x-2 mt-1">
                  <input
                    type="number"
                    value={taxPercentInput}
                    onChange={(e) => setTaxPercentInput(e.target.value)}
                    placeholder="e.g. 8"
                    className="flex-1 bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  <button
                    onClick={async () => {
                      const pct = Number(taxPercentInput);
                      if (isNaN(pct) || pct < 0) return;
                      await onUpdateSettings({ taxPercent: pct });
                      setTaxServiceMsg('Tax % saved ✓');
                      window.setTimeout(() => setTaxServiceMsg(null), 3000);
                    }}
                    disabled={!taxPercentInput.trim()}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold px-3 py-2 rounded-xl text-xs"
                  >
                    Save
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Xizmat Haqi (Service Fee) %</label>
                <div className="flex space-x-2 mt-1">
                  <input
                    type="number"
                    value={serviceFeePercentInput}
                    onChange={(e) => setServiceFeePercentInput(e.target.value)}
                    placeholder="e.g. 5"
                    className="flex-1 bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  <button
                    onClick={async () => {
                      const pct = Number(serviceFeePercentInput);
                      if (isNaN(pct) || pct < 0) return;
                      await onUpdateSettings({ serviceFeePercent: pct });
                      setTaxServiceMsg('Service fee % saved ✓');
                      window.setTimeout(() => setTaxServiceMsg(null), 3000);
                    }}
                    disabled={!serviceFeePercentInput.trim()}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold px-3 py-2 rounded-xl text-xs"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Exchange Rates Card — customer-facing display only. Menu
              prices always stay in so'm; these rates just control what a
              customer sees if they switch the display to USD/RUB. */}
          <div className="bg-zinc-50/80 border border-zinc-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-200/80 pb-2.5">
              <div className="flex items-center space-x-2 text-zinc-900 font-extrabold text-sm">
                <span>💱</span>
                <span>Exchange Rates (customer display only)</span>
              </div>
              {exchangeRateMsg && <span className="text-[10px] text-green-600 font-bold">{exchangeRateMsg}</span>}
            </div>
            <p className="text-[11px] text-zinc-500">
              These only affect what customers see if they switch the menu to USD or RUB — every order is still charged and recorded in so'm. Rates refresh automatically once a day; you can also set them by hand here.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase">1 USD = ? so'm</label>
                <div className="flex space-x-2 mt-1">
                  <input
                    type="number"
                    value={usdRateInput}
                    onChange={(e) => setUsdRateInput(e.target.value)}
                    placeholder="e.g. 12000"
                    className="flex-1 bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  <button
                    onClick={async () => {
                      const rate = Number(usdRateInput);
                      if (!rate || rate <= 0) return;
                      await onUpdateExchangeRate('USD', rate);
                      setExchangeRateMsg('USD rate saved ✓');
                      window.setTimeout(() => setExchangeRateMsg(null), 3000);
                    }}
                    disabled={!usdRateInput.trim()}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold px-3 py-2 rounded-xl text-xs"
                  >
                    Save
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase">1 RUB = ? so'm</label>
                <div className="flex space-x-2 mt-1">
                  <input
                    type="number"
                    value={rubRateInput}
                    onChange={(e) => setRubRateInput(e.target.value)}
                    placeholder="e.g. 150"
                    className="flex-1 bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  <button
                    onClick={async () => {
                      const rate = Number(rubRateInput);
                      if (!rate || rate <= 0) return;
                      await onUpdateExchangeRate('RUB', rate);
                      setExchangeRateMsg('RUB rate saved ✓');
                      window.setTimeout(() => setExchangeRateMsg(null), 3000);
                    }}
                    disabled={!rubRateInput.trim()}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold px-3 py-2 rounded-xl text-xs"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Thermal Printer Settings Card */}
          <div className="bg-zinc-50/80 border border-zinc-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center space-x-2 text-zinc-900 font-extrabold text-sm border-b border-zinc-200/80 pb-2.5">
              <Printer className="w-4 h-4 text-orange-500" />
              <span>Termal printer (tarmoq orqali)</span>
            </div>
            <p className="text-xs text-zinc-500">
              Printeringizning IP manzilini kiriting — buyurtmalar bo'limidan bevosita shu printerga chek chop etishingiz mumkin bo'ladi.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Printer IP</label>
                <input
                  type="text"
                  value={printerIp}
                  onChange={(e) => setPrinterIp(e.target.value)}
                  placeholder="192.168.1.50"
                  className="w-full bg-white border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2 text-xs text-zinc-900 outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Port</label>
                <input
                  type="number"
                  value={printerPort}
                  onChange={(e) => setPrinterPort(Number(e.target.value))}
                  className="w-full bg-white border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2 text-xs text-zinc-900 outline-none"
                />
              </div>
            </div>
            <button
              onClick={async () => {
                setPrinterSaving(true);
                setPrinterMsg(null);
                try {
                  const res = await fetch('/api/admin/printer-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ printerIp: printerIp || undefined, printerPort })
                  });
                  setPrinterMsg(res.ok ? '✅ Saqlandi!' : '❌ Xatolik yuz berdi.');
                } finally {
                  setPrinterSaving(false);
                }
              }}
              disabled={printerSaving}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold px-4 py-2 rounded-xl text-xs transition-colors"
            >
              {printerSaving ? 'Saqlanmoqda...' : 'Saqlash'}
            </button>
            {printerMsg && <p className="text-xs font-bold text-zinc-600">{printerMsg}</p>}
          </div>

          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 font-medium flex items-center space-x-2">
            <span className="text-sm shrink-0">🔒</span>
            <span>{t.securityPrivateNotice}</span>
          </div>
        </div>
      )}

      {/* ADD NEW DISH MODAL */}
      {showAddDishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
              <h3 className="text-lg font-bold text-zinc-900">{t.addNewDish}</h3>
              <button onClick={() => setShowAddDishModal(false)} className="text-zinc-400 hover:text-zinc-900">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDish} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 gap-2 bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <p className="text-[10px] font-bold text-zinc-500 uppercase">{t.dishName} — 3 tilda / in 3 languages</p>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇺🇿 O'zbekcha (required)</label>
                  <input
                    type="text"
                    required
                    value={newDishNameUz}
                    onChange={e => setNewDishNameUz(e.target.value)}
                    placeholder="masalan: Palov, Shashlik"
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇷🇺 Русский</label>
                  <input
                    type="text"
                    value={newDishNameRu}
                    onChange={e => setNewDishNameRu(e.target.value)}
                    placeholder="например: Плов, Шашлык"
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇬🇧 English</label>
                  <input
                    type="text"
                    value={newDishNameEn}
                    onChange={e => setNewDishNameEn(e.target.value)}
                    placeholder="e.g. Plov, Shashlik"
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-zinc-400">Leave Russian/English blank to reuse the Uzbek name for now.</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-zinc-600 font-medium mb-1">{t.price} ($)</label>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={newDishPrice}
                    onChange={e => setNewDishPrice(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-zinc-600 font-medium mb-1">{t.category}</label>
                  <select
                    value={effectiveNewDishCategory}
                    onChange={e => setNewDishCategory(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  >
                    {dishCategoryOptions.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.icon} {categoryLabel(cat.id)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* DIRECT IMAGE UPLOAD & PRESETS */}
              <div className="space-y-2 border border-zinc-200 rounded-xl p-3 bg-zinc-50/50">
                <label className="block text-zinc-700 font-bold flex items-center justify-between">
                  <span>Product Image</span>
                  <span className="text-[10px] text-zinc-400 font-normal">Upload photo or select preset</span>
                </label>

                {/* Preview Thumbnail */}
                {newDishImage && (
                  <div className="relative w-full h-32 rounded-xl overflow-hidden border border-zinc-200 bg-zinc-100 group">
                    <img
                      src={newDishImage}
                      alt="Product Preview"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2">
                      <label htmlFor="add-dish-file" className="cursor-pointer bg-white text-zinc-900 text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center space-x-1 shadow">
                        <Upload className="w-3 h-3" />
                        <span>Change Photo</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* File Upload Button */}
                <div className="flex items-center space-x-2">
                  <input
                    type="file"
                    id="add-dish-file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleFileUpload(file, (dataUrl) => setNewDishImage(dataUrl));
                      }
                    }}
                  />
                  <label
                    htmlFor="add-dish-file"
                    className="w-full cursor-pointer bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 font-bold py-2 rounded-xl text-center flex items-center justify-center space-x-2 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload Image File Directly</span>
                  </label>
                </div>

                {/* Preset Fast Picks */}
                <div>
                  <span className="block text-[10px] text-zinc-500 font-semibold mb-1">Quick Sample Photos:</span>
                  <div className="flex flex-wrap gap-1">
                    {presetFoodImages.map(p => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => setNewDishImage(p.url)}
                        className="text-[10px] bg-white hover:bg-orange-50 border border-zinc-200 hover:border-orange-300 text-zinc-700 px-2 py-1 rounded-lg font-medium transition-colors"
                      >
                        📷 {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <p className="text-[10px] font-bold text-zinc-500 uppercase">{t.description} — 3 tilda / in 3 languages</p>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇺🇿 O'zbekcha</label>
                  <textarea
                    value={newDishDescUz}
                    onChange={e => setNewDishDescUz(e.target.value)}
                    placeholder="Taomning tarkibi va ta'mi haqida..."
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 h-14 resize-none focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇷🇺 Русский</label>
                  <textarea
                    value={newDishDescRu}
                    onChange={e => setNewDishDescRu(e.target.value)}
                    placeholder="Ингредиенты и вкус блюда..."
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 h-14 resize-none focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇬🇧 English</label>
                  <textarea
                    value={newDishDescEn}
                    onChange={e => setNewDishDescEn(e.target.value)}
                    placeholder="Delicious ingredients and flavor notes..."
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 h-14 resize-none focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-zinc-400">Leave Russian/English blank to reuse the Uzbek description for now.</p>
              </div>

              <CustomizationEditor
                value={newDishCustomizations}
                onChange={setNewDishCustomizations}
                lang={lang}
                idPrefix="add"
              />

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddDishModal(false)}
                  className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 rounded-xl transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="w-1/2 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2.5 rounded-xl transition-colors shadow-sm"
                >
                  {t.saveChanges}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT DISH MODAL */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
              <h3 className="text-lg font-bold text-zinc-900">{t.editDish}</h3>
              <button onClick={() => setEditingItem(null)} className="text-zinc-400 hover:text-zinc-900">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 gap-2 bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <p className="text-[10px] font-bold text-zinc-500 uppercase">{t.dishName} — 3 tilda / in 3 languages</p>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇺🇿 O'zbekcha (required)</label>
                  <input
                    type="text"
                    required
                    value={editingItem.nameUz}
                    onChange={e => setEditingItem({ ...editingItem, nameUz: e.target.value, name: e.target.value })}
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇷🇺 Русский</label>
                  <input
                    type="text"
                    value={editingItem.nameRu}
                    onChange={e => setEditingItem({ ...editingItem, nameRu: e.target.value })}
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇬🇧 English</label>
                  <input
                    type="text"
                    value={editingItem.nameEn}
                    onChange={e => setEditingItem({ ...editingItem, nameEn: e.target.value })}
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-zinc-600 font-medium mb-1">{t.price} ($)</label>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={editingItem.price}
                    onChange={e => setEditingItem({ ...editingItem, price: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-zinc-600 font-medium mb-1">{t.category}</label>
                  <select
                    value={editingItem.category}
                    onChange={e => setEditingItem({ ...editingItem, category: e.target.value })}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                  >
                    {/* The dish's own section stays selectable even when it is
                        hidden, so opening the form cannot silently move it. */}
                    {!dishCategoryOptions.some(cat => cat.id === editingItem!.category) && (
                      <option value={editingItem.category}>{categoryLabel(editingItem.category)}</option>
                    )}
                    {dishCategoryOptions.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.icon} {categoryLabel(cat.id)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Availability is the only stock control: mavjud / tugadi. */}
              <div>
                <label className="block text-zinc-600 font-medium mb-1">Holati</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingItem({ ...editingItem, isAvailable: true })}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-xs border transition-colors ${
                      editingItem.isAvailable
                        ? 'bg-green-50 text-green-800 border-green-300'
                        : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-100'
                    }`}
                  >
                    {t.inStock}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingItem({ ...editingItem, isAvailable: false })}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-xs border transition-colors ${
                      !editingItem.isAvailable
                        ? 'bg-rose-50 text-rose-800 border-rose-300'
                        : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-100'
                    }`}
                  >
                    {t.soldOut}
                  </button>
                </div>
              </div>

              {/* DIRECT IMAGE UPLOAD & PRESETS */}
              <div className="space-y-2 border border-zinc-200 rounded-xl p-3 bg-zinc-50/50">
                <label className="block text-zinc-700 font-bold flex items-center justify-between">
                  <span>Product Image</span>
                  <span className="text-[10px] text-zinc-400 font-normal">Upload photo or select preset</span>
                </label>

                {/* Preview Thumbnail */}
                {editingItem.image && (
                  <div className="relative w-full h-32 rounded-xl overflow-hidden border border-zinc-200 bg-zinc-100 group">
                    <img
                      src={editingItem.image}
                      alt="Product Preview"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2">
                      <label htmlFor="edit-dish-file" className="cursor-pointer bg-white text-zinc-900 text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center space-x-1 shadow">
                        <Upload className="w-3 h-3" />
                        <span>Change Photo</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* File Upload Button */}
                <div className="flex items-center space-x-2">
                  <input
                    type="file"
                    id="edit-dish-file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleFileUpload(file, (dataUrl) => setEditingItem({ ...editingItem, image: dataUrl }));
                      }
                    }}
                  />
                  <label
                    htmlFor="edit-dish-file"
                    className="w-full cursor-pointer bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 font-bold py-2 rounded-xl text-center flex items-center justify-center space-x-2 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload Image File Directly</span>
                  </label>
                </div>

                {/* Preset Fast Picks */}
                <div>
                  <span className="block text-[10px] text-zinc-500 font-semibold mb-1">Quick Sample Photos:</span>
                  <div className="flex flex-wrap gap-1">
                    {presetFoodImages.map(p => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => setEditingItem({ ...editingItem, image: p.url })}
                        className="text-[10px] bg-white hover:bg-orange-50 border border-zinc-200 hover:border-orange-300 text-zinc-700 px-2 py-1 rounded-lg font-medium transition-colors"
                      >
                        📷 {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <p className="text-[10px] font-bold text-zinc-500 uppercase">{t.description} — 3 tilda / in 3 languages</p>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇺🇿 O'zbekcha</label>
                  <textarea
                    value={editingItem.descriptionUz}
                    onChange={e => setEditingItem({ ...editingItem, descriptionUz: e.target.value, description: e.target.value })}
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 h-14 resize-none focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇷🇺 Русский</label>
                  <textarea
                    value={editingItem.descriptionRu}
                    onChange={e => setEditingItem({ ...editingItem, descriptionRu: e.target.value })}
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 h-14 resize-none focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-zinc-500 font-medium mb-1">🇬🇧 English</label>
                  <textarea
                    value={editingItem.descriptionEn}
                    onChange={e => setEditingItem({ ...editingItem, descriptionEn: e.target.value })}
                    className="w-full bg-white border border-zinc-200 rounded-xl p-2.5 text-zinc-900 h-14 resize-none focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              <CustomizationEditor
                value={editingItem.customizations || []}
                onChange={groups => setEditingItem({ ...editingItem, customizations: groups })}
                lang={lang}
                idPrefix="edit"
              />

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 rounded-xl transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="w-1/2 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2.5 rounded-xl transition-colors shadow-sm"
                >
                  {t.saveChanges}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD TABLE MODAL */}
      {showAddTableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
              <h3 className="text-lg font-bold text-zinc-900">Add New Floor Table</h3>
              <button onClick={() => setShowAddTableModal(false)} className="text-zinc-400 hover:text-zinc-900">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={e => {
                e.preventDefault();
                const num = parseInt(newTableNum, 10);
                const cap = parseInt(newTableCap, 10) || 4;
                if (num && !isNaN(num) && num > 0 && onAddTable) {
                  onAddTable(num, cap, newTableComment.trim());
                  setShowAddTableModal(false);
                  setNewTableNum('');
                  setNewTableComment('');
                }
              }}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block text-zinc-600 font-medium mb-1">Table Number</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={newTableNum}
                  onChange={e => setNewTableNum(e.target.value)}
                  placeholder="e.g. 13"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-zinc-900 font-bold focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-600 font-medium mb-1">Seating Capacity (Guests)</label>
                <input
                  type="number"
                  required
                  min="1"
                  max="50"
                  value={newTableCap}
                  onChange={e => setNewTableCap(e.target.value)}
                  placeholder="4"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-600 font-medium mb-1">Stolda izoh (location note, optional)</label>
                <input
                  type="text"
                  value={newTableComment}
                  onChange={e => setNewTableComment(e.target.value)}
                  placeholder="e.g. Near the window, 2nd floor terrace"
                  maxLength={300}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-zinc-900 focus:border-orange-500 focus:outline-none"
                />
                <p className="text-[10px] text-zinc-400 mt-1">Shown to the customer at this table so they know where they are.</p>
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddTableModal(false)}
                  className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 rounded-xl"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="w-1/2 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2.5 rounded-xl shadow-sm"
                >
                  Create Table
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE TABLE CONFIRMATION MODAL */}
      {tableToDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto border border-rose-100">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <h3 className="font-extrabold text-base text-zinc-900">Remove Table #{tableToDelete}</h3>
            <p className="text-xs text-zinc-500 font-medium">Are you sure you want to remove Table #{tableToDelete} from the active floor layout?</p>

            <div className="flex space-x-2 pt-2">
              <button
                onClick={() => setTableToDelete(null)}
                className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 rounded-xl text-xs"
              >
                {t.cancel}
              </button>
              <button
                onClick={() => {
                  if (tableToDelete !== null && onDeleteTable) {
                    onDeleteTable(tableToDelete);
                  }
                  setTableToDelete(null);
                }}
                className="w-1/2 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm"
              >
                Remove Table
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INTERACTIVE TABLE DETAIL MODAL */}
      {selectedTableDetail && (() => {
        const activeOrd = orders.find(o => o.id === selectedTableDetail.currentOrderId);
        const isUnpaidBill = activeOrd && activeOrd.paymentStatus === 'unpaid' && (activeOrd.status === 'served' || selectedTableDetail.status === 'bill_requested');

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
              
              {/* Modal Header */}
              <div className="flex justify-between items-start border-b border-zinc-100 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-2xl font-black text-zinc-900">Table #{selectedTableDetail.tableNumber} Details</h3>
                    <span className="text-xs font-extrabold bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-full border border-zinc-200">
                      {selectedTableDetail.capacity} Seats
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 font-medium mt-0.5">Live table status and active order breakdown</p>
                  {selectedTableDetail.comment && (
                    <p className="text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1 mt-1.5 inline-block">
                      📍 {selectedTableDetail.comment}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => setSelectedTableDetail(null)}
                  className="p-1.5 text-zinc-400 hover:text-zinc-900 bg-zinc-100 hover:bg-zinc-200 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Status Indicator Banner */}
              <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold ${
                isUnpaidBill
                  ? 'bg-rose-50 border-rose-300 text-rose-800'
                  : selectedTableDetail.status === 'eating'
                  ? 'bg-purple-50 border-purple-200 text-purple-800'
                  : selectedTableDetail.status === 'ordering'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : selectedTableDetail.status === 'seated'
                  ? 'bg-sky-50 border-sky-200 text-sky-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}>
                <div className="flex items-center space-x-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    isUnpaidBill ? 'bg-rose-500 animate-ping' : selectedTableDetail.status === 'available' ? 'bg-emerald-500' : 'bg-purple-500'
                  }`} />
                  <span className="uppercase tracking-wider font-black">
                    {isUnpaidBill ? 'Bill Requested / Pending Payment' : selectedTableDetail.status.replace('_', ' ')}
                  </span>
                </div>

                {activeOrd && (
                  <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-black ${
                    activeOrd.paymentStatus === 'paid' ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'
                  }`}>
                    {activeOrd.paymentStatus === 'paid' ? 'PAID' : 'UNPAID'}
                  </span>
                )}
              </div>

              {/* ACTIVE ORDER CONTENT */}
              {activeOrd ? (
                <div className="space-y-4">
                  {/* Customer Information Box */}
                  <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3.5 space-y-2 text-xs">
                    <div className="flex justify-between items-center border-b border-zinc-200 pb-2">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-extrabold block">Customer</span>
                        <span className="font-extrabold text-zinc-900 text-sm">{activeOrd.customerName}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-extrabold block">Order ID</span>
                        <span className="font-black text-orange-600">#{activeOrd.id}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                      <div>
                        <span className="text-zinc-500 font-semibold block">Contact:</span>
                        <span className="font-bold text-zinc-800">{activeOrd.customerPhoneOrEmail || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 font-semibold block">Payment Method:</span>
                        <span className="font-bold text-zinc-800 uppercase">{activeOrd.paymentMethod?.replace('_', ' ') || 'At Table'}</span>
                      </div>
                    </div>

                    {activeOrd.orderNote && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[11px] text-amber-900">
                        <span className="font-bold">Kitchen Request:</span> "{activeOrd.orderNote}"
                      </div>
                    )}
                  </div>

                  {/* Order Progress Stepper Controls */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-extrabold text-zinc-500 uppercase tracking-wider block">
                      Kitchen Progress Status
                    </label>
                    <div className="grid grid-cols-4 gap-1.5 text-center">
                      {(['pending', 'preparing', 'ready', 'served'] as OrderStatus[]).map(st => (
                        <button
                          key={st}
                          onClick={() => onUpdateOrderStatus(activeOrd.id, st)}
                          className={`py-2 px-1 rounded-xl text-[10px] font-bold uppercase transition-all ${
                            activeOrd.status === st
                              ? 'bg-orange-500 text-white shadow-sm'
                              : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Itemized Dishes List */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-extrabold text-zinc-500 uppercase tracking-wider block">
                      Ordered Items ({activeOrd.items.reduce((acc, i) => acc + i.quantity, 0)})
                    </label>

                    <div className="bg-zinc-50 border border-zinc-200 rounded-xl divide-y divide-zinc-200/80 max-h-48 overflow-y-auto custom-scrollbar">
                      {activeOrd.items.map(item => (
                        <div key={item.cartItemId} className="p-2.5 flex items-center justify-between text-xs">
                          <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                            <img
                              src={item.menuItem.image}
                              alt={item.menuItem.name}
                              className="w-10 h-10 rounded-lg object-cover shrink-0"
                              referrerPolicy="no-referrer"
                            />
                            <div className="min-w-0">
                              <div className="font-extrabold text-zinc-900 truncate">
                                {item.menuItem.name} <span className="text-orange-600 font-black">×{item.quantity}</span>
                              </div>
                              {item.selectedCustomizations.length > 0 && (
                                <div className="text-[10px] text-zinc-500 truncate">
                                  {item.selectedCustomizations.map(c => c.optionName).join(', ')}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="font-black text-zinc-900 text-xs shrink-0">
                            {formatSom(item.itemTotal)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bill Total Summary */}
                  <div className="bg-zinc-900 text-white rounded-xl p-4 space-y-2 text-xs">
                    <div className="flex justify-between text-zinc-400">
                      <span>Subtotal</span>
                      <span>{formatSom(activeOrd.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-400">
                      <span>Tax (8%) & Service (5%)</span>
                      <span>{formatSom((activeOrd.tax + activeOrd.serviceCharge))}</span>
                    </div>
                    {activeOrd.discount > 0 && (
                      <div className="flex justify-between text-emerald-400">
                        <span>Loyalty Discount</span>
                        <span>{formatSom(-(activeOrd.discount))}</span>
                      </div>
                    )}
                    <div className="border-t border-zinc-800 pt-2 flex justify-between items-center text-base font-black">
                      <span>Total Bill</span>
                      <span className="text-orange-400">{formatSom(activeOrd.totalAmount)}</span>
                    </div>
                  </div>

                  {/* Settlement & Actions */}
                  <div className="pt-2 flex flex-col sm:flex-row gap-2">
                    {activeOrd.paymentStatus !== 'paid' ? (
                      <button
                        onClick={() => {
                          onUpdateOrderStatus(activeOrd.id, 'paid', 'paid');
                          setSelectedTableDetail(null);
                        }}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 rounded-xl text-xs shadow flex items-center justify-center space-x-1.5 transition-all"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Settle Bill & Clear Table</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          onUpdateOrderStatus(activeOrd.id, 'served', 'paid');
                          setSelectedTableDetail(null);
                        }}
                        className="flex-1 bg-zinc-800 hover:bg-zinc-900 text-white font-extrabold py-3 rounded-xl text-xs flex items-center justify-center space-x-1.5 transition-all"
                      >
                        <span>Clear Table Layout</span>
                      </button>
                    )}

                    <button
                      onClick={() => {
                        setSelectedQRTable(selectedTableDetail.tableNumber);
                        setActiveTab('qr');
                        setSelectedTableDetail(null);
                      }}
                      className="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-bold px-4 py-3 rounded-xl text-xs flex items-center justify-center space-x-1"
                    >
                      <QrCode className="w-4 h-4" />
                      <span>Print QR</span>
                    </button>
                  </div>

                </div>
              ) : (
                /* EMPTY TABLE STATE */
                <div className="text-center py-8 space-y-4">
                  <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto border border-emerald-200">
                    <Utensils className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-base text-zinc-900">Table #{selectedTableDetail.tableNumber} is Available</h4>
                    <p className="text-xs text-zinc-500 max-w-xs mx-auto mt-1">
                      No active guests or orders currently assigned to this table.
                    </p>
                  </div>

                  <div className="flex justify-center space-x-2 pt-2">
                    <button
                      onClick={() => {
                        setSelectedQRTable(selectedTableDetail.tableNumber);
                        setActiveTab('qr');
                        setSelectedTableDetail(null);
                      }}
                      className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center space-x-1.5 shadow"
                    >
                      <QrCode className="w-4 h-4" />
                      <span>Generate QR Code</span>
                    </button>

                    <button
                      onClick={() => {
                        setTableToDelete(selectedTableDetail.tableNumber);
                        setSelectedTableDetail(null);
                      }}
                      className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center space-x-1.5 border border-rose-200"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Remove Table</span>
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        );
      })()}

      {/* DELETE DISH CONFIRMATION MODAL */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto border border-rose-100">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <h3 className="font-extrabold text-base text-zinc-900">{t.deleteDish}</h3>
            <p className="text-xs text-zinc-500 font-medium">{t.confirmDelete}</p>
            <p className="text-sm font-black text-orange-600">"{itemToDelete.name}"</p>

            <div className="flex space-x-2 pt-2">
              <button
                onClick={() => setItemToDelete(null)}
                className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 rounded-xl text-xs"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="w-1/2 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm"
              >
                {t.deleteDish}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CATEGORY DELETE — offers to move the dishes instead of dead-ending */}
      {categoryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto border border-rose-100">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <h3 className="font-extrabold text-base text-zinc-900 text-center">{t.catDeleteTitle}</h3>
            <p className="text-sm font-black text-orange-600 text-center">
              {categoryToDelete.icon} {categoryLabel(categoryToDelete.id)}
            </p>
            <p className="text-xs text-zinc-500 font-medium text-center">
              {categoryToDelete.dishCount > 0
                ? t.catDeleteHasDishes.replace('{count}', String(categoryToDelete.dishCount))
                : t.catDeleteEmpty}
            </p>

            {categoryToDelete.dishCount > 0 && (
              <div>
                <label className="block text-zinc-600 font-medium mb-1 text-xs">{t.catMoveTo}</label>
                <select
                  value={deleteMoveTo}
                  onChange={e => setDeleteMoveTo(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-xs text-zinc-900 focus:border-orange-500 focus:outline-none"
                >
                  <option value="">—</option>
                  {sortedCategories
                    .filter(cat => cat.id !== categoryToDelete!.id)
                    .map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.icon} {categoryLabel(cat.id)}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {!!categoryError && <p className="text-[11px] text-rose-600 font-bold text-center">{categoryError}</p>}

            <div className="flex space-x-2 pt-1">
              <button
                onClick={() => {
                  setCategoryToDelete(null);
                  setDeleteMoveTo('');
                  setCategoryError('');
                }}
                className="w-1/2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 rounded-xl text-xs"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleConfirmCategoryDelete}
                disabled={categoryBusy || (categoryToDelete.dishCount > 0 && !deleteMoveTo)}
                className="w-1/2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm"
              >
                {t.catDeleteAction}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>

        </div>

      {/* MOBILE BOTTOM TAB BAR */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-zinc-200 flex items-stretch shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
        {primaryNavItems.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex-1 flex flex-col items-center justify-center py-2 space-y-0.5 relative ${
                activeTab === item.id ? 'text-orange-600' : 'text-zinc-400'
              }`}
            >
              <span className="relative">
                <Icon className="w-5 h-5" />
                {!!item.badge && (
                  <span className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-bold">{item.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => setIsMoreSheetOpen(true)}
          className={`flex-1 flex flex-col items-center justify-center py-2 space-y-0.5 ${
            isSecondaryActive ? 'text-orange-600' : 'text-zinc-400'
          }`}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-[10px] font-bold">Boshqa</span>
        </button>
      </nav>

      {/* MOBILE "MORE" BOTTOM SHEET */}
      {isMoreSheetOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-zinc-900/50 backdrop-blur-sm flex items-end animate-fadeIn"
          onClick={() => setIsMoreSheetOpen(false)}
        >
          <div
            className="w-full bg-white rounded-t-3xl p-5 pb-8 space-y-5 max-h-[75vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-zinc-900">Boshqa sozlamalar va hisobotlar</h3>
              <button onClick={() => setIsMoreSheetOpen(false)} className="text-zinc-400 p-1.5 bg-zinc-100 rounded-full">
                <X className="w-4 h-4" />
              </button>
            </div>
            {secondaryNavGroups.map(group => (
              <div key={group.title} className="space-y-2">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">{group.title}</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {group.items.map(item => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveTab(item.id);
                          setIsMoreSheetOpen(false);
                        }}
                        className={`flex items-center space-x-2.5 p-3 rounded-2xl border text-left transition-colors ${
                          activeTab === item.id ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-zinc-50 border-zinc-200 text-zinc-700'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="text-xs font-bold">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <button
              onClick={onLockAdmin}
              className="w-full bg-zinc-900 hover:bg-black text-white font-bold py-3 rounded-xl text-xs flex items-center justify-center space-x-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{t.logout}</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
