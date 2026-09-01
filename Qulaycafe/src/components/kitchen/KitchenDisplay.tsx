import React, { useState, useEffect } from 'react';
import { Order, OrderStatus, WaiterCall } from '../../types';
import { ChefHat, Clock, CheckCircle2, AlertCircle, Play, Bell, Check, Flame, Utensils, BellRing, Send } from 'lucide-react';
import { playOrderChimeSound } from '../../utils/audio';
import { Language, translations } from '../../lib/translations';

// Hour (local) at which the kitchen's day rolls over. 05:00 keeps a ticket
// taken just before midnight on screen while it is still being cooked.
const KITCHEN_DAY_START_HOUR = 5;

interface KitchenDisplayProps {
  orders: Order[];
  onUpdateStatus: (orderId: string, newStatus: OrderStatus) => void;
  lang: Language;
  waiterCalls?: WaiterCall[];
  onResolveWaiterCall?: (id: string) => void;
  // Telegram order alerts live here rather than in the admin panel: the
  // kitchen is who needs to be pinged when a new order lands.
  onGenerateTelegramLink?: () => Promise<{ token: string; deepLink: string } | null>;
  onCheckTelegramLinkStatus?: (token: string) => Promise<any>;
  onUnlinkTelegram?: () => Promise<boolean>;
  telegramLinked?: boolean;
}

export const KitchenDisplay: React.FC<KitchenDisplayProps> = ({
  orders,
  onUpdateStatus,
  lang,
  waiterCalls = [],
  onResolveWaiterCall,
  onGenerateTelegramLink,
  onCheckTelegramLinkStatus,
  onUnlinkTelegram,
  telegramLinked = false
}) => {
  const t = translations[lang];
  const [filter, setFilter] = useState<'all' | 'pending' | 'preparing' | 'ready'>('all');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const pendingWaiterCalls = waiterCalls.filter(c => c.status === 'pending');

  // --- Telegram order alerts ---
  const [telegramLink, setTelegramLink] = useState<{ token: string; deepLink: string } | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<'idle' | 'waiting' | 'linked'>(
    telegramLinked ? 'linked' : 'idle'
  );
  const [telegramBusy, setTelegramBusy] = useState<boolean>(false);

  useEffect(() => {
    setTelegramStatus(prev => (prev === 'waiting' ? prev : telegramLinked ? 'linked' : 'idle'));
  }, [telegramLinked]);

  // Poll until the staff member taps the deep link and presses Start in the
  // bot, so the card flips to "connected" without a page refresh.
  useEffect(() => {
    if (!telegramLink || telegramStatus !== 'waiting' || !onCheckTelegramLinkStatus) return;
    const interval = setInterval(async () => {
      const status = await onCheckTelegramLinkStatus(telegramLink.token);
      if (status?.status === 'verified') {
        setTelegramStatus('linked');
        clearInterval(interval);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [telegramLink, telegramStatus, onCheckTelegramLinkStatus]);

  const handleConnectTelegram = async () => {
    if (!onGenerateTelegramLink || telegramBusy) return;
    setTelegramBusy(true);
    try {
      const link = await onGenerateTelegramLink();
      if (link) {
        setTelegramLink(link);
        setTelegramStatus('waiting');
      }
    } finally {
      setTelegramBusy(false);
    }
  };

  const handleUnlinkTelegram = async () => {
    if (!onUnlinkTelegram || telegramBusy) return;
    setTelegramBusy(true);
    try {
      if (await onUnlinkTelegram()) {
        setTelegramStatus('idle');
        setTelegramLink(null);
      }
    } finally {
      setTelegramBusy(false);
    }
  };
  
  // Track item-level preparedness for one-by-one cooking dispatch
  // Key format: `${orderId}_${itemIndex}` -> boolean
  const [preparedItems, setPreparedItems] = useState<Record<string, boolean>>({});

  // Play audio chime when a new 'pending' order arrives
  useEffect(() => {
    // Scoped to today's tickets: a ticket left 'pending' from an earlier day
    // would otherwise re-arm the chime on every render for as long as it sat
    // there. isFromToday is defined below — the effect body runs after the
    // whole component body, so the closure is already initialised.
    const hasPending = orders.some(o => o.status === 'pending' && isFromToday(o));
    if (hasPending && soundEnabled) {
      playOrderChimeSound();
    }
  }, [orders.length, soundEnabled]);

  // ---------------------------------------------------------------------------
  // The kitchen board shows ONE business day. Yesterday's tickets that were
  // never marked served/paid used to stay on the screen forever, mixed in with
  // today's real work — the cook cannot tell which is which, and the oldest
  // card (the most alarming elapsed time) is the one nobody needs.
  //
  // The cut is at 05:00 local, not midnight, on purpose: a ticket taken at
  // 23:50 must still be on the screen at 00:10 while it is being cooked. So
  // "today" runs 05:00 -> 05:00, which is what a kitchen actually means by a
  // day. Nothing is deleted and nothing changes server-side — the admin
  // dashboard still lists every order, this is only what the cook is shown.
  // ---------------------------------------------------------------------------
  const businessDayStart = (() => {
    const start = new Date();
    if (start.getHours() < KITCHEN_DAY_START_HOUR) start.setDate(start.getDate() - 1);
    start.setHours(KITCHEN_DAY_START_HOUR, 0, 0, 0);
    return start.getTime();
  })();

  const openOrders = orders.filter(o => o.status !== 'paid' && o.status !== 'cancelled');
  const isFromToday = (o: Order) => {
    const created = new Date(o.createdAt).getTime();
    // An unparseable/missing timestamp must never hide a real ticket.
    return Number.isNaN(created) ? true : created >= businessDayStart;
  };
  const activeOrders = openOrders.filter(isFromToday);
  // Counted, not hidden silently: if something was left open from an earlier
  // day the cook is told it exists and where to close it, so an order can never
  // vanish without a trace.
  const staleOrderCount = openOrders.length - activeOrders.length;
  const filteredOrders = activeOrders.filter(o => {
    if (filter === 'all') return true;
    return o.status === filter;
  });

  // Calculate elapsed time in minutes
  const getElapsedMinutes = (isoString: string) => {
    const created = new Date(isoString).getTime();
    const now = Date.now();
    return Math.floor((now - created) / 60000);
  };

  const toggleItemPrepared = (orderId: string, itemIdx: number) => {
    const key = `${orderId}_${itemIdx}`;
    setPreparedItems(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      
      {/* Header Banner - Responsive for Mobile & Desktop */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 sm:p-3 bg-orange-50 text-orange-600 rounded-xl border border-orange-100 shrink-0">
            <ChefHat className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg sm:text-2xl font-black text-zinc-900 tracking-tight">
                {t.kdsTitle}
              </h1>
              <span className="bg-green-50 text-green-800 text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-md border border-green-200">
                {t.kdsLive}
              </span>
            </div>
            <p className="text-zinc-500 text-[11px] sm:text-xs mt-0.5 font-medium">
              {t.kdsSub}
            </p>
          </div>
        </div>

        {/* Stats & Audio Controls */}
        <div className="flex items-center space-x-2 sm:space-x-3 w-full md:w-auto justify-between md:justify-end border-t md:border-0 pt-3 md:pt-0 border-zinc-100">
          <button
            onClick={() => {
              setSoundEnabled(!soundEnabled);
              if (!soundEnabled) playOrderChimeSound();
            }}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
              soundEnabled
                ? 'bg-orange-50 text-orange-800 border-orange-200'
                : 'bg-white text-zinc-500 border-zinc-200'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>{soundEnabled ? t.chimeOn : t.chimeMuted}</span>
          </button>

          <div className="flex items-center space-x-2 bg-zinc-100 px-3 py-1.5 rounded-xl border border-zinc-200 text-xs text-zinc-700 font-medium">
            <span>{t.pendingCount}: <strong className="text-orange-600 font-black">{orders.filter(o => o.status === 'pending').length}</strong></span>
            <span>•</span>
            <span>{t.cookingCount}: <strong className="text-amber-600 font-black">{orders.filter(o => o.status === 'preparing').length}</strong></span>
          </div>
        </div>
      </div>

      {/* Telegram order alerts — connect the kitchen's own Telegram chat */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-xs space-y-2.5">
        <div className="flex items-center space-x-2 text-zinc-900 font-extrabold text-sm">
          <Send className="w-4 h-4 text-sky-500" />
          <span>Telegram bildirishnomasi (oshxona)</span>
        </div>
        <p className="text-[11px] sm:text-xs text-zinc-500">
          Oshxona Telegramini ulang — yangi buyurtma kelganda darhol xabar keladi, bu sahifa ochiq bo'lmasa ham.
        </p>
        {telegramStatus === 'linked' ? (
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl p-3">
            <span className="text-xs font-bold text-green-800">✅ Ulangan</span>
            <button
              onClick={handleUnlinkTelegram}
              disabled={telegramBusy}
              className="text-xs font-bold text-rose-600 hover:text-rose-700 disabled:opacity-50"
            >
              Uzish
            </button>
          </div>
        ) : telegramStatus === 'waiting' && telegramLink ? (
          <div className="space-y-2">
            <a
              href={telegramLink.deepLink}
              target="_blank"
              rel="noreferrer"
              className="block w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-2.5 rounded-xl text-xs text-center transition-colors"
            >
              Telegramda ochish va tasdiqlash
            </a>
            <p className="text-[11px] text-zinc-400 text-center">
              Havolani bosib, botda "Start" bosing — bu yerda avtomatik yangilanadi...
            </p>
          </div>
        ) : (
          <button
            onClick={handleConnectTelegram}
            disabled={telegramBusy}
            className="bg-zinc-900 hover:bg-black disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-colors"
          >
            {telegramBusy ? 'Havola olinmoqda...' : 'Telegramni ulash'}
          </button>
        )}
      </div>

      {/* Left over from an earlier day. Shown rather than silently dropped, so
          nobody can lose an order to the daily cut — but kept out of the board
          itself, which is the whole point of the cut. */}
      {staleOrderCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-3.5 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[11px] sm:text-xs font-medium leading-relaxed">
            <span className="font-black">{staleOrderCount}</span> ta buyurtma oldingi kunlardan yopilmagan.
            Ular bugungi ro'yxatda ko'rsatilmaydi — admin panelidagi buyurtmalar bo'limidan yoping.
          </p>
        </div>
      )}

      {/* Waiter Call Banner — urgent, sits above everything else */}
      {pendingWaiterCalls.length > 0 && (
        <div className="bg-rose-600 text-white rounded-2xl p-3.5 sm:p-4 shadow-lg space-y-2 animate-pulse-slow">
          <div className="flex items-center space-x-2 font-black text-sm">
            <BellRing className="w-5 h-5" />
            <span>Ofitsiant chaqirilmoqda!</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {pendingWaiterCalls.map(call => (
              <button
                key={call.id}
                onClick={() => onResolveWaiterCall && onResolveWaiterCall(call.id)}
                className="bg-white/15 hover:bg-white/25 border border-white/30 rounded-xl px-3 py-1.5 text-xs font-bold flex items-center space-x-2 transition-colors"
              >
                <span>{t.table} #{call.tableNumber}</span>
                <span className="opacity-70">
                  {new Date(call.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <Check className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center space-x-1.5 bg-zinc-100 p-1 sm:p-1.5 rounded-xl border border-zinc-200 overflow-x-auto custom-scrollbar">
        {(['all', 'pending', 'preparing', 'ready'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs font-bold capitalize whitespace-nowrap transition-all ${
              filter === f
                ? 'bg-orange-500 text-white shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            {f === 'all' ? `${t.allActive} (${activeOrders.length})` : f === 'pending' ? `${t.pendingCount} (${activeOrders.filter(o => o.status === f).length})` : f === 'preparing' ? `${t.cookingCount} (${activeOrders.filter(o => o.status === f).length})` : `${t.statusReady} (${activeOrders.filter(o => o.status === f).length})`}
          </button>
        ))}
      </div>

      {/* KOT Tickets Grid */}
      {filteredOrders.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl p-12 sm:p-16 text-center text-zinc-500 space-y-3 shadow-xs">
          <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
          <p className="font-bold text-zinc-900 text-base sm:text-lg">{t.kdsClearTitle}</p>
          <p className="text-xs text-zinc-500 font-medium">{t.kdsClearDesc}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
          {filteredOrders.map((order) => {
            const elapsedMins = getElapsedMinutes(order.createdAt);
            const isLate = elapsedMins > 20;
            const isWarning = elapsedMins > 10 && elapsedMins <= 20;

            // Item preparation counting
            const totalItems = order.items.length;
            const doneCount = order.items.filter((_, idx) => preparedItems[`${order.id}_${idx}`]).length;
            const isAllItemsPrepared = totalItems > 0 && doneCount === totalItems;

            return (
              <div
                key={order.id}
                className={`bg-white border rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-xs transition-all relative overflow-hidden ${
                  order.status === 'pending'
                    ? 'border-orange-500 ring-2 ring-orange-500/10'
                    : order.status === 'preparing'
                    ? 'border-amber-400'
                    : 'border-zinc-200'
                }`}
              >
                
                {/* Ticket Header */}
                <div className="border-b border-zinc-100 pb-3 mb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-xl sm:text-2xl font-black text-zinc-900">
                        {order.orderType === 'delivery'
                          ? '🛵 Dostavka'
                          : order.orderType === 'pickup'
                          ? '🥡 Olib ketish'
                          : `${t.table.toUpperCase()} #${order.tableNumber}`}
                      </span>
                    </div>

                    {/* Timer Badge */}
                    <div className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-bold ${
                      isLate
                        ? 'bg-rose-50 text-rose-700 border border-rose-200 animate-pulse'
                        : isWarning
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-green-50 text-green-800 border border-green-200'
                    }`}>
                      <Clock className="w-3.5 h-3.5" />
                      <span>{elapsedMins}m</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-zinc-500 mt-1 font-medium">
                    <span>Ticket #{order.id} • {order.customerName}</span>
                    <span className="text-[10px] text-zinc-400">
                      {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* One-by-One Progress Indicator Bar */}
                  <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-zinc-500">
                    <span>{t.itemsPrepared}: {doneCount}/{totalItems}</span>
                    <span className={doneCount === totalItems ? 'text-green-600' : 'text-orange-600'}>
                      {Math.round((doneCount / totalItems) * 100)}%
                    </span>
                  </div>
                  <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden mt-1">
                    <div
                      className="bg-orange-500 h-full transition-all duration-300"
                      style={{ width: `${(doneCount / totalItems) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Ordered Items List - Interactive Checkboxes One by One! */}
                <div className="space-y-2 flex-1 mb-4">
                  <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">
                    {t.tapDishToCheck}
                  </p>

                  {order.items.map((item, idx) => {
                    const isItemDone = preparedItems[`${order.id}_${idx}`] || order.status === 'ready' || order.status === 'served';

                    return (
                      <div
                        key={idx}
                        onClick={() => toggleItemPrepared(order.id, idx)}
                        className={`border rounded-xl p-2.5 cursor-pointer transition-all ${
                          isItemDone
                            ? 'bg-green-50/70 border-green-300 text-zinc-600 line-through'
                            : 'bg-zinc-50 hover:bg-orange-50/50 border-zinc-200 text-zinc-900'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <span className="font-extrabold text-xs sm:text-sm flex items-center space-x-2">
                            <span className={`w-5 h-5 rounded-md text-[10px] font-black flex items-center justify-center shrink-0 ${
                              isItemDone ? 'bg-green-600 text-white' : 'bg-orange-500 text-white'
                            }`}>
                              {isItemDone ? <Check className="w-3.5 h-3.5" /> : `${item.quantity}x`}
                            </span>
                            <span className={isItemDone ? 'line-through text-zinc-500' : ''}>
                              {item.menuItem.name}
                            </span>
                          </span>

                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                            isItemDone ? 'bg-green-200 text-green-900' : 'bg-zinc-200 text-zinc-700'
                          }`}>
                            {isItemDone ? t.statusReady.toUpperCase() : t.statusPreparing.toUpperCase()}
                          </span>
                        </div>

                        {/* Customizations */}
                        {item.selectedCustomizations.length > 0 && (
                          <div className="text-[11px] text-orange-700 font-semibold mt-1 pl-7">
                            • {item.selectedCustomizations.map(c => c.optionName).join(', ')}
                          </div>
                        )}

                        {/* Special Kitchen Notes */}
                        {item.specialInstructions && (
                          <div className="text-[11px] text-rose-700 font-bold mt-1 bg-rose-50 border border-rose-200 rounded-lg p-1 pl-2 flex items-center space-x-1">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            <span>Note: "{item.specialInstructions}"</span>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Order-wide Note */}
                  {order.orderNote && (
                    <p className="text-xs text-orange-800 italic bg-orange-50 border border-orange-200 p-2 rounded-xl font-medium">
                      Note: {order.orderNote}
                    </p>
                  )}

                  {/* Delivery / pickup contact info — the kitchen needs this
                      to hand the order to the right courier, or to call the
                      customer when a pickup order is ready. */}
                  {order.orderType === 'delivery' && (
                    <div className="text-xs bg-sky-50 border border-sky-200 text-sky-800 p-2 rounded-xl font-medium space-y-0.5">
                      <div>📍 {order.deliveryAddress || (order.deliveryLat ? 'Joylashuv yuborilgan (kuryer botida)' : '—')}</div>
                      <div>📞 {order.deliveryPhone || order.customerPhoneOrEmail || '—'}</div>
                      {order.courierName && <div>🛵 Kuryer: {order.courierName}</div>}
                    </div>
                  )}
                  {order.orderType === 'pickup' && (
                    <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 p-2 rounded-xl font-medium">
                      📞 {order.deliveryPhone || order.customerPhoneOrEmail || '—'} — tayyor bo'lganda qo'ng'iroq qiling
                    </div>
                  )}
                </div>

                {/* Ticket Action Workflow Buttons */}
                <div className="pt-3 border-t border-zinc-100">
                  {order.status === 'pending' && (
                    <button
                      onClick={() => onUpdateStatus(order.id, 'preparing')}
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-2.5 rounded-xl shadow-xs flex items-center justify-center space-x-2 transition-all text-xs active:scale-95"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>{t.acceptStart}</span>
                    </button>
                  )}

                  {order.status === 'preparing' && (
                    <button
                      onClick={() => onUpdateStatus(order.id, 'ready')}
                      className={`w-full font-bold py-2.5 rounded-xl shadow-xs flex items-center justify-center space-x-2 transition-all text-xs active:scale-95 ${
                        isAllItemsPrepared
                          ? 'bg-green-600 hover:bg-green-700 text-white ring-2 ring-green-500/20'
                          : 'bg-zinc-900 hover:bg-black text-white'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isAllItemsPrepared ? t.allDoneMarkReady : t.markReady}</span>
                    </button>
                  )}

                  {order.status === 'ready' && (
                    <button
                      onClick={() => onUpdateStatus(order.id, 'served')}
                      className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-200 font-bold py-2.5 rounded-xl flex items-center justify-center space-x-2 transition-all text-xs"
                    >
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span>{t.markServed}</span>
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};

