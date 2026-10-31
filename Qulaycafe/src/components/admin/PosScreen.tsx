import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { MenuItem, MenuCategory, Table, Order } from '../../types';
import { formatSom } from '../../utils/currency';
import {
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  Percent,
  Tag,
  X,
  Edit2,
  Users,
  Calculator,
  PlusCircle,
  FileText,
  AlertCircle
} from 'lucide-react';

interface PosCartItem {
  menuItem: MenuItem;
  quantity: number;
  customPrice?: number;
  itemTotal: number;
  selectedCustomizations: [];
  cartItemId: string;
}

interface PosScreenProps {
  menuItems: MenuItem[];
  categories: MenuCategory[];
  tables: Table[];
  orders?: Order[];
  onOrderCreated?: (order: unknown) => void;
}

export function PosScreen({ menuItems, categories, tables, orders = [], onOrderCreated }: PosScreenProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [orderNote, setOrderNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editing price of a specific cart item
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [tempPriceInput, setTempPriceInput] = useState<string>('');

  // Service fee percentage state (default 10%, can be changed per order)
  const [servicePercent, setServicePercent] = useState<number>(10);
  const [showCustomService, setShowCustomService] = useState<boolean>(false);

  // Discount states
  const [discountType, setDiscountType] = useState<'none' | 'percent' | 'fixed'>('none');
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [discountFixed, setDiscountFixed] = useState<number>(0);
  const [showCustomDiscount, setShowCustomDiscount] = useState<boolean>(false);

  // Split bill (bo'lib hisoblash) & Change calculator
  const [showSplitCalc, setShowSplitCalc] = useState<boolean>(false);
  const [splitCount, setSplitCount] = useState<number>(2);
  const [cashReceived, setCashReceived] = useState<string>('');

  // Append mode for existing table order
  const [appendMode, setAppendMode] = useState<boolean>(true);

  // Fetch initial service fee setting from backend
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        if (typeof d.serviceFeePercent === 'number') {
          setServicePercent(d.serviceFeePercent);
        }
      })
      .catch(() => {});
  }, []);

  // Look up if selected table already has an active, unpaid order
  const openOrderForSelectedTable = useMemo(() => {
    if (!selectedTable || !orders || orders.length === 0) return null;
    return (
      orders.find(
        o => o.tableNumber === selectedTable && o.paymentStatus !== 'paid' && o.status !== 'cancelled'
      ) || null
    );
  }, [selectedTable, orders]);

  // Categories & filtering
  const activeCategories = useMemo(
    () =>
      categories.filter(
        c => c.isActive && menuItems.some(m => m.category === c.id && m.isAvailable)
      ),
    [categories, menuItems]
  );

  const displayCategory = selectedCategory ?? activeCategories[0]?.id ?? null;

  const filteredItems = useMemo(
    () => menuItems.filter(m => m.isAvailable && (!displayCategory || m.category === displayCategory)),
    [menuItems, displayCategory]
  );

  // Cart operations
  const addToCart = useCallback((item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.menuItem.id === item.id);
      if (existing) {
        const unitPrice = existing.customPrice ?? item.price;
        return prev.map(c =>
          c.menuItem.id === item.id
            ? { ...c, quantity: c.quantity + 1, itemTotal: (c.quantity + 1) * unitPrice }
            : c
        );
      }
      return [
        ...prev,
        {
          menuItem: item,
          quantity: 1,
          customPrice: undefined,
          itemTotal: item.price,
          selectedCustomizations: [],
          cartItemId: `pos-${item.id}-${Date.now()}`,
        },
      ];
    });
  }, []);

  const removeOne = useCallback((itemId: string) => {
    setCart(prev => {
      const existing = prev.find(c => c.menuItem.id === itemId);
      if (!existing) return prev;
      if (existing.quantity === 1) return prev.filter(c => c.menuItem.id !== itemId);
      const unitPrice = existing.customPrice ?? existing.menuItem.price;
      return prev.map(c =>
        c.menuItem.id === itemId
          ? { ...c, quantity: c.quantity - 1, itemTotal: (c.quantity - 1) * unitPrice }
          : c
      );
    });
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setCart(prev => prev.filter(c => c.menuItem.id !== itemId));
  }, []);

  // Update custom price for a cart item
  const handleSaveCustomPrice = (itemId: string) => {
    const newPrice = Math.max(0, Math.floor(Number(tempPriceInput) || 0));
    setCart(prev =>
      prev.map(c => {
        if (c.menuItem.id === itemId) {
          const finalPrice = newPrice > 0 ? newPrice : c.menuItem.price;
          return {
            ...c,
            customPrice: newPrice > 0 ? newPrice : undefined,
            itemTotal: finalPrice * c.quantity,
          };
        }
        return c;
      })
    );
    setEditingPriceItemId(null);
    setTempPriceInput('');
  };

  // Subtotal from all cart items
  const subtotal = useMemo(() => cart.reduce((s, c) => s + c.itemTotal, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, c) => s + c.quantity, 0), [cart]);

  // Service charge calculation (soliq olib tashlandi, faqat service charge)
  const serviceChargeAmount = useMemo(() => {
    if (subtotal <= 0 || servicePercent <= 0) return 0;
    return Math.round((subtotal * servicePercent) / 100);
  }, [subtotal, servicePercent]);

  // Discount calculation
  const discountAmount = useMemo(() => {
    if (subtotal <= 0 || discountType === 'none') return 0;
    if (discountType === 'percent') {
      const pct = Math.min(100, Math.max(0, discountPercent));
      return Math.round((subtotal * pct) / 100);
    }
    if (discountType === 'fixed') {
      return Math.min(subtotal, Math.max(0, discountFixed));
    }
    return 0;
  }, [subtotal, discountType, discountPercent, discountFixed]);

  // Final total (Oraliq + Xizmat haqi - Chegirma, Soliq = 0)
  const finalTotal = Math.max(0, subtotal + serviceChargeAmount - discountAmount);

  // Split bill per person amount
  const splitAmountPerPerson = useMemo(() => {
    if (finalTotal <= 0 || splitCount <= 1) return finalTotal;
    return Math.ceil(finalTotal / splitCount);
  }, [finalTotal, splitCount]);

  // Change return calculation (Qaytim)
  const changeDue = useMemo(() => {
    const received = Number(cashReceived) || 0;
    if (received <= 0 || received < finalTotal) return null;
    return received - finalTotal;
  }, [cashReceived, finalTotal]);

  const resetDiscount = () => {
    setDiscountType('none');
    setDiscountPercent(0);
    setDiscountFixed(0);
    setShowCustomDiscount(false);
  };

  const handleApplyPresetPercent = (pct: number) => {
    if (pct === 0) {
      resetDiscount();
    } else {
      setDiscountType('percent');
      setDiscountPercent(pct);
      setShowCustomDiscount(false);
    }
  };

  // Order submission
  const handleSubmit = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      // If table already has an active order and append mode is chosen -> APPEND ITEMS
      if (openOrderForSelectedTable && appendMode) {
        const res = await fetch(`/api/admin/orders/${openOrderForSelectedTable.id}/append-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: cart,
            orderNote: orderNote || undefined,
            servicePercent,
            discount: discountAmount,
          }),
        });

        if (!res.ok) {
          const d = await res.json().catch(() => ({ error: 'Xato yuz berdi' }));
          throw new Error(d.error || 'Qo‘shimcha buyurtma qo‘shishda xato yuz berdi');
        }

        const updatedOrder = await res.json();
        setSuccessMsg(`Stol #${selectedTable} buyurtmasiga yangi taomlar qo'shildi! Jami bitta chekda chiqadi.`);
        setCart([]);
        setOrderNote('');
        setCashReceived('');
        onOrderCreated?.(updatedOrder);
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        // Standard create order
        const res = await fetch('/api/admin/orders/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableNumber: selectedTable ?? 0,
            customerName: selectedTable ? `Stol #${selectedTable}` : 'Kassa buyurtmasi',
            items: cart,
            paymentMethod,
            orderNote: orderNote || undefined,
            orderType: 'dine_in',
            discount: discountAmount,
            servicePercent,
          }),
        });

        if (!res.ok) {
          const d = await res.json().catch(() => ({ error: 'Xato yuz berdi' }));
          throw new Error(d.error || 'Buyurtma yaratishda xato yuz berdi');
        }

        const order = await res.json();
        setSuccessMsg(`Buyurtma qabul qilindi! (${selectedTable ? `Stol #${selectedTable}` : 'Kassa'})`);
        setCart([]);
        setOrderNote('');
        setSelectedTable(null);
        setCashReceived('');
        resetDiscount();
        onOrderCreated?.(order);
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Xato yuz berdi');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 0px)' }}>
      {/* ─── LEFT: Menu browser ─── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-zinc-50">
        {/* Category tabs */}
        <div className="flex gap-2 px-4 py-3 overflow-x-auto shrink-0 bg-white border-b border-zinc-100 shadow-xs">
          {activeCategories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                displayCategory === cat.id
                  ? 'bg-orange-500 text-white shadow-xs'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.nameUz}</span>
            </button>
          ))}
        </div>

        {/* Menu grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredItems.map(item => {
              const inCart = cart.find(c => c.menuItem.id === item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  className="relative bg-white rounded-2xl border border-zinc-100 p-3 text-left hover:border-orange-300 hover:shadow-md transition-all active:scale-95 cursor-pointer"
                >
                  {item.image && (
                    <img
                      src={item.image}
                      alt={item.nameUz}
                      className="w-full h-24 object-cover rounded-xl mb-2 border border-zinc-100"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <p className="text-xs font-bold text-zinc-900 line-clamp-2 leading-tight">
                    {item.nameUz || item.name}
                  </p>
                  <p className="text-sm font-black text-orange-600 mt-1">{formatSom(item.price)}</p>
                  {!!inCart && (
                    <span className="absolute top-2 right-2 bg-orange-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center shadow-xs">
                      {inCart.quantity}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-zinc-400">
              <p className="text-sm font-bold">Bu kategoriyada mavjud taom yo'q</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── RIGHT: Cart panel ─── */}
      <div className="w-84 xl:w-96 shrink-0 bg-white border-l border-zinc-200 flex flex-col shadow-xl">
        {/* Cart header */}
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-black text-zinc-900">Savat</span>
            {cartCount > 0 && (
              <span className="bg-orange-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                {cartCount}
              </span>
            )}
          </div>
          {cart.length > 0 && (
            <button
              onClick={() => {
                setCart([]);
                resetDiscount();
              }}
              className="text-xs text-zinc-400 hover:text-red-500 font-bold transition-colors"
            >
              Tozalash
            </button>
          )}
        </div>

        {/* Table selector */}
        <div className="px-4 py-2 border-b border-zinc-100">
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wide mb-1">
            Stol tanlash
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
            <button
              onClick={() => setSelectedTable(null)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                selectedTable === null
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'border-zinc-200 text-zinc-600 hover:border-orange-300'
              }`}
            >
              Stol yo'q
            </button>
            {tables.map(t => {
              const hasActiveOrder = orders.some(
                o => o.tableNumber === t.tableNumber && o.paymentStatus !== 'paid' && o.status !== 'cancelled'
              );
              return (
                <button
                  key={t.tableNumber}
                  onClick={() => setSelectedTable(t.tableNumber)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors relative ${
                    selectedTable === t.tableNumber
                      ? 'bg-orange-500 text-white border-orange-500'
                      : hasActiveOrder
                      ? 'border-amber-300 bg-amber-50 text-amber-800 hover:border-orange-300'
                      : 'border-zinc-200 text-zinc-600 hover:border-orange-300'
                  }`}
                >
                  #{t.tableNumber}
                  {hasActiveOrder && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── Existing Order Notice (Zakasga zakas qo'shish) ─── */}
        {openOrderForSelectedTable && (
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200">
            <div className="flex items-start justify-between gap-1 mb-1.5">
              <div className="flex items-center gap-1.5 text-amber-900 font-black text-xs">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Stol #{selectedTable} da ochiq buyurtma bor!</span>
              </div>
              <span className="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded-md font-bold">
                {formatSom(openOrderForSelectedTable.totalAmount)}
              </span>
            </div>
            <p className="text-[10px] text-amber-800 mb-2">
              Oldingi zakas: {openOrderForSelectedTable.items.length} ta taom. Yangi taomlar bitta chekda qo'shiladi.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setAppendMode(true)}
                className={`py-1 rounded-lg text-[10px] font-bold border transition-colors flex items-center justify-center gap-1 ${
                  appendMode
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-white border-amber-200 text-amber-800'
                }`}
              >
                <PlusCircle className="w-3 h-3" />
                Mavjudiga qo'shish
              </button>
              <button
                type="button"
                onClick={() => setAppendMode(false)}
                className={`py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                  !appendMode
                    ? 'bg-zinc-800 text-white border-zinc-800'
                    : 'bg-white border-amber-200 text-amber-800'
                }`}
              >
                Yangi alohida
              </button>
            </div>
          </div>
        )}

        {/* ─── Cart items list ─── */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-zinc-300">
              <ShoppingCart className="w-8 h-8 mb-2" />
              <p className="text-xs font-bold">Savat bo'sh</p>
              <p className="text-[10px] text-zinc-300 mt-0.5">Taom tanlang</p>
            </div>
          ) : (
            cart.map(item => {
              const unitPrice = item.customPrice ?? item.menuItem.price;
              const isPriceOverridden = item.customPrice !== undefined && item.customPrice !== item.menuItem.price;
              const isEditingPrice = editingPriceItemId === item.menuItem.id;

              return (
                <div
                  key={item.menuItem.id}
                  className="py-2 border-b border-zinc-100 last:border-0 space-y-1.5"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-zinc-900 truncate">
                        {item.menuItem.nameUz || item.menuItem.name}
                      </p>
                      <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                        {isPriceOverridden ? (
                          <span className="font-bold text-orange-600 flex items-center gap-0.5">
                            {formatSom(unitPrice)} <span className="line-through text-zinc-300 font-normal">({formatSom(item.menuItem.price)})</span>
                          </span>
                        ) : (
                          <span>{formatSom(unitPrice)}</span>
                        )}
                        <span>× {item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPriceItemId(item.menuItem.id);
                            setTempPriceInput(String(unitPrice));
                          }}
                          className="text-zinc-400 hover:text-orange-500 ml-1 p-0.5"
                          title="Narxni o'zgartirish"
                        >
                          <Edit2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs font-black text-zinc-900 shrink-0">{formatSom(item.itemTotal)}</p>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => removeOne(item.menuItem.id)}
                        className="w-6 h-6 rounded-lg bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-600 transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center text-xs font-black text-zinc-900">{item.quantity}</span>
                      <button
                        onClick={() => addToCart(item.menuItem)}
                        className="w-6 h-6 rounded-lg bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center text-zinc-600 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => removeItem(item.menuItem.id)}
                        className="w-6 h-6 rounded-lg hover:bg-red-50 flex items-center justify-center text-zinc-300 hover:text-red-500 ml-0.5 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Inline Price Editor */}
                  {isEditingPrice && (
                    <div className="flex items-center gap-1.5 p-1.5 bg-orange-50/80 rounded-xl border border-orange-200 animate-fadeIn">
                      <span className="text-[10px] font-bold text-orange-900 shrink-0">Yangi narx:</span>
                      <input
                        type="number"
                        min="0"
                        step="500"
                        value={tempPriceInput}
                        onChange={e => setTempPriceInput(e.target.value)}
                        placeholder="Narx..."
                        className="w-full text-xs border border-orange-300 rounded-lg px-2 py-1 bg-white font-bold text-zinc-800 focus:outline-none focus:ring-1 focus:ring-orange-500"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveCustomPrice(item.menuItem.id);
                          if (e.key === 'Escape') setEditingPriceItemId(null);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveCustomPrice(item.menuItem.id)}
                        className="bg-orange-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg shrink-0 hover:bg-orange-600"
                      >
                        Saqlash
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPriceItemId(null)}
                        className="text-zinc-400 hover:text-zinc-600 text-[10px] p-1 shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ─── Xizmat Haqi (Service Fee) Override Section ─── */}
        <div className="px-4 py-2 border-t border-zinc-100 bg-zinc-50/50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wide flex items-center gap-1">
              <span>Xizmat haqi</span>
              <span className="text-orange-600 font-bold">({servicePercent}%)</span>
            </span>
            <span className="text-[10px] font-bold text-zinc-700">
              +{formatSom(serviceChargeAmount)}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-1">
            {[0, 5, 10, 15, 20].map(pct => (
              <button
                key={pct}
                type="button"
                onClick={() => {
                  setServicePercent(pct);
                  setShowCustomService(false);
                }}
                className={`py-0.5 rounded-lg text-[10px] font-bold border transition-colors ${
                  servicePercent === pct && !showCustomService
                    ? 'bg-zinc-800 text-white border-zinc-800'
                    : 'bg-white border-zinc-200 text-zinc-600 hover:border-orange-300'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* ─── Chegirma (Discount) Section ─── */}
        <div className="px-4 py-2 border-t border-zinc-100 bg-zinc-50/50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wide flex items-center gap-1">
              <Percent className="w-3 h-3 text-orange-500" />
              Chegirma
            </span>
            {discountAmount > 0 && (
              <button
                type="button"
                onClick={resetDiscount}
                className="text-[10px] font-bold text-rose-500 hover:underline flex items-center gap-0.5"
              >
                <X className="w-2.5 h-2.5" />
                Bekor qilish
              </button>
            )}
          </div>

          {/* Quick preset buttons */}
          <div className="grid grid-cols-5 gap-1 mb-1">
            {[
              { label: '0%', val: 0 },
              { label: '5%', val: 5 },
              { label: '10%', val: 10 },
              { label: '15%', val: 15 },
              { label: '20%', val: 20 },
            ].map(p => (
              <button
                key={p.val}
                type="button"
                onClick={() => handleApplyPresetPercent(p.val)}
                className={`py-0.5 rounded-lg text-[10px] font-bold border transition-colors ${
                  discountType === (p.val === 0 ? 'none' : 'percent') && discountPercent === p.val && !showCustomDiscount
                    ? 'bg-orange-500 text-white border-orange-500 shadow-xs'
                    : 'bg-white border-zinc-200 text-zinc-600 hover:border-orange-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom discount toggle */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setShowCustomDiscount(prev => !prev);
                if (!showCustomDiscount && discountType === 'none') {
                  setDiscountType('percent');
                }
              }}
              className={`text-[10px] font-bold flex items-center gap-1 transition-colors ${
                showCustomDiscount ? 'text-orange-600' : 'text-zinc-500 hover:text-orange-500'
              }`}
            >
              <Tag className="w-3 h-3" />
              <span>{showCustomDiscount ? 'Maxsus (yopish)' : 'Boshqa foiz yoki summa...'}</span>
            </button>
            {discountAmount > 0 && (
              <span className="text-[10px] font-black text-rose-600">
                -{formatSom(discountAmount)}
              </span>
            )}
          </div>

          {showCustomDiscount && (
            <div className="mt-1.5 p-2 bg-white rounded-xl border border-zinc-200 space-y-1.5">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setDiscountType('percent');
                    setDiscountFixed(0);
                  }}
                  className={`flex-1 py-0.5 rounded-lg text-[10px] font-bold border ${
                    discountType === 'percent'
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'border-zinc-200 text-zinc-600'
                  }`}
                >
                  % Foiz
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDiscountType('fixed');
                    setDiscountPercent(0);
                  }}
                  className={`flex-1 py-0.5 rounded-lg text-[10px] font-bold border ${
                    discountType === 'fixed'
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'border-zinc-200 text-zinc-600'
                  }`}
                >
                  so'm Summa
                </button>
              </div>

              {discountType === 'percent' ? (
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={discountPercent || ''}
                    onChange={e => setDiscountPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                    placeholder="Foiz miqdori (masalan 12)"
                    className="w-full text-xs border border-zinc-200 rounded-lg px-2 py-1 pr-6 focus:outline-none focus:ring-1 focus:ring-orange-400 font-bold"
                  />
                  <span className="absolute right-2 top-1 text-xs text-zinc-400 font-bold">%</span>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max={subtotal}
                    value={discountFixed || ''}
                    onChange={e => setDiscountFixed(Math.min(subtotal, Math.max(0, Number(e.target.value) || 0)))}
                    placeholder="Summa so'mda..."
                    className="w-full text-xs border border-zinc-200 rounded-lg px-2 py-1 pr-10 focus:outline-none focus:ring-1 focus:ring-orange-400 font-bold"
                  />
                  <span className="absolute right-2 top-1 text-[10px] text-zinc-400 font-bold">so'm</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Hisobni Bo'lish (Split Bill Calculator) ─── */}
        <div className="px-4 py-2 border-t border-zinc-100 bg-zinc-50/50">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowSplitCalc(prev => !prev)}
              className="text-[10px] font-black text-zinc-500 uppercase tracking-wide flex items-center gap-1 hover:text-orange-600 transition-colors"
            >
              <Users className="w-3 h-3 text-orange-500" />
              <span>Hisobni bo'lish / Qaytim</span>
              <span className="text-[9px] font-bold text-zinc-400">({showSplitCalc ? 'yopish' : 'ochish'})</span>
            </button>
            {showSplitCalc && finalTotal > 0 && (
              <span className="text-[10px] font-black text-orange-600">
                {splitCount} kishiga: {formatSom(splitAmountPerPerson)} dan
              </span>
            )}
          </div>

          {showSplitCalc && (
            <div className="mt-2 p-2.5 bg-white rounded-xl border border-zinc-200 space-y-2">
              <div>
                <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Necha kishiga bo'linsin?</p>
                <div className="grid grid-cols-4 gap-1">
                  {[2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSplitCount(n)}
                      className={`py-1 rounded-lg text-xs font-black border transition-colors ${
                        splitCount === n
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'border-zinc-200 text-zinc-700 hover:border-orange-300'
                      }`}
                    >
                      {n} kishi
                    </button>
                  ))}
                </div>
              </div>

              {finalTotal > 0 && (
                <div className="p-2 bg-orange-50 rounded-lg border border-orange-200 text-center">
                  <p className="text-[10px] font-bold text-orange-800">
                    Har bir kishi uchun to'lov:
                  </p>
                  <p className="text-sm font-black text-orange-950">
                    {formatSom(splitAmountPerPerson)}
                  </p>
                </div>
              )}

              {/* Cash change calculator */}
              <div className="pt-1 border-t border-zinc-100">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-zinc-500">Mijoz bergan summa:</span>
                  {changeDue !== null && (
                    <span className="text-xs font-black text-emerald-600">
                      Qaytim: {formatSom(changeDue)}
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  step="1000"
                  value={cashReceived}
                  onChange={e => setCashReceived(e.target.value)}
                  placeholder="Masalan: 100000"
                  className="w-full text-xs border border-zinc-200 rounded-lg px-2 py-1 font-bold text-zinc-800 focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
              </div>
            </div>
          )}
        </div>

        {/* Note */}
        <div className="px-4 py-1.5 border-t border-zinc-100">
          <textarea
            value={orderNote}
            onChange={e => setOrderNote(e.target.value)}
            placeholder="Izoh (ixtiyoriy)..."
            rows={1}
            className="w-full text-xs border border-zinc-200 rounded-xl px-2.5 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-orange-400 text-zinc-700 placeholder-zinc-300"
          />
        </div>

        {/* Payment method */}
        <div className="px-4 py-1.5">
          <div className="flex gap-2">
            {(['cash', 'card'] as const).map(method => (
              <button
                key={method}
                onClick={() => setPaymentMethod(method)}
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                  paymentMethod === method
                    ? 'bg-orange-500 text-white border-orange-500 shadow-xs'
                    : 'border-zinc-200 text-zinc-600 hover:border-orange-300'
                }`}
              >
                {method === 'cash' ? '💵 Naqd' : '💳 Karta'}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Total + Submit ─── */}
        <div className="px-4 pb-4 pt-2 border-t border-zinc-100">
          {/* Breakdown: Subtotal, Service charge, Discount (NO SOLIQ) */}
          <div className="space-y-1 mb-2.5 text-xs">
            <div className="flex justify-between text-zinc-500 font-bold">
              <span>Oraliq summa:</span>
              <span>{formatSom(subtotal)}</span>
            </div>

            {serviceChargeAmount > 0 && (
              <div className="flex justify-between text-zinc-600 font-bold">
                <span>Xizmat haqi ({servicePercent}%):</span>
                <span>+{formatSom(serviceChargeAmount)}</span>
              </div>
            )}

            {discountAmount > 0 && (
              <div className="flex justify-between text-rose-600 font-black">
                <span>Chegirma {discountType === 'percent' ? `(${discountPercent}%)` : ''}:</span>
                <span>-{formatSom(discountAmount)}</span>
              </div>
            )}

            <div className="flex justify-between items-baseline pt-1 border-t border-zinc-200">
              <span className="text-sm font-black text-zinc-800">JAMI:</span>
              <span className="text-xl font-black text-zinc-900">{formatSom(finalTotal)}</span>
            </div>
          </div>

          {error && (
            <div className="mb-2 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-1.5 font-bold border border-red-100">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="mb-2 text-xs text-green-700 bg-green-50 rounded-xl px-3 py-1.5 font-bold flex items-center gap-1.5 border border-green-100">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={cart.length === 0 || submitting}
            className={`w-full text-white font-black text-sm py-3 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xs active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed ${
              openOrderForSelectedTable && appendMode
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-orange-500 hover:bg-orange-600'
            }`}
          >
            {submitting ? (
              <span>Yuborilmoqda...</span>
            ) : openOrderForSelectedTable && appendMode ? (
              <>
                <PlusCircle className="w-4 h-4" />
                <span>Stol #{selectedTable} ga qo'shish</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Buyurtma yuborish</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
