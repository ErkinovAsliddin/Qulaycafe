import { useCurrency } from '../../utils/CurrencyContext';
import React, { useState } from 'react';
import { MenuItem, MenuCategory, Category, DietaryTag, Order } from '../../types';
import { Search, Clock, Filter, Utensils, ShoppingBag, Plus, Check, SlidersHorizontal, ChefHat, Sparkles, QrCode, ArrowRight, Bell, BellRing, Globe, Coins, CalendarDays } from 'lucide-react';
import { Language, translations, getLocalizedMenuItem } from '../../lib/translations';

interface CustomerViewProps {
  menuItems: MenuItem[];
  /** Menu sections from the server. Inactive ones are filtered out below. */
  categories: MenuCategory[];
  tableNumber: number;
  tableComment?: string;
  lang: Language;
  onLanguageChange: (lang: Language) => void;
  onSelectItem: (item: MenuItem) => void;
  onDirectAddToCart: (item: MenuItem) => void;
  cartCount: number;
  cartSubtotal: number;
  onOpenCart: () => void;
  onOpenQRScanner: () => void;
  onOpenLocation?: () => void;
  onOpenGoogleAuth?: () => void;
  activeOrder?: Order | null;
  logoUrl?: string | null;
  brandColor?: string | null;
  restaurantName?: string | null;
  contactPhone?: string | null;
  contactAddress?: string | null;
  contactInstagram?: string | null;
  onCallWaiter?: (tableNumber: number) => Promise<boolean>;
  deliveryEnabled?: boolean;
  orderMode?: 'dine_in' | 'delivery' | 'pickup';
  onSetOrderMode?: (mode: 'dine_in' | 'delivery' | 'pickup') => void;
  /** Whether the menu request for this restaurant has settled yet. */
  menuState?: 'loading' | 'ready' | 'error';
  onRetryMenu?: () => void;
  /** Table booking is an opt-in per-restaurant feature; the button only exists when it is on. */
  reservationsEnabled?: boolean;
  onOpenReservation?: () => void;
}

export const CustomerView: React.FC<CustomerViewProps> = ({
  menuItems,
  categories,
  tableNumber,
  tableComment,
  onSelectItem,
  onDirectAddToCart,
  cartCount,
  cartSubtotal,
  onOpenCart,
  onOpenQRScanner,
  onOpenLocation,
  onOpenGoogleAuth,
  lang,
  onLanguageChange,
  activeOrder,
  logoUrl,
  brandColor,
  restaurantName,
  contactPhone,
  contactAddress,
  contactInstagram,
  onCallWaiter,
  deliveryEnabled,
  orderMode = 'dine_in',
  onSetOrderMode,
  menuState = 'ready',
  onRetryMenu,
  reservationsEnabled,
  onOpenReservation
}) => {
  const t = translations[lang];
  const { currency, setCurrency, formatPrice } = useCurrency();
  const [selectedCategory, setSelectedCategory] = useState<Category | 'all'>('all');
  const [selectedDietary, setSelectedDietary] = useState<DietaryTag | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [waiterCallState, setWaiterCallState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const accentColor = brandColor || '#f97316'; // falls back to the default orange-500 look

  const handleCallWaiterClick = async () => {
    if (!onCallWaiter || waiterCallState !== 'idle') return;
    setWaiterCallState('sending');
    const ok = await onCallWaiter(tableNumber);
    setWaiterCallState(ok ? 'sent' : 'idle');
    if (ok) {
      setTimeout(() => setWaiterCallState('idle'), 30000); // allow calling again after 30s
    }
  };
  
  // Track recently added item IDs for instant visual feedback
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);

  // Menu sections come from the admin's category list, not a hardcoded array.
  // Inactive sections are filtered out here as well as on the server: an
  // admin browsing the customer view holds the full list in state, and a
  // section they switched off must not show up for them either.
  const categoryTabs: { id: Category | 'all'; label: string; icon: string }[] = [
    { id: 'all', label: t.catAll, icon: '🍽️' },
    ...categories
      .filter(cat => cat.isActive)
      .map(cat => ({
        id: cat.id,
        label: (lang === 'ru' ? cat.nameRu : lang === 'en' ? cat.nameEn : cat.nameUz) || cat.nameUz,
        icon: cat.icon || '🍽️'
      }))
  ];

  // The admin can delete or deactivate the section the customer is currently
  // filtered to (it arrives live over SSE), which would otherwise leave the
  // menu looking empty with no tab highlighted. Fall back to "all" instead.
  const effectiveCategory: Category | 'all' = categoryTabs.some(cat => cat.id === selectedCategory)
    ? selectedCategory
    : 'all';

  const dietaryFilters: { id: DietaryTag | 'all'; label: string }[] = [
    { id: 'all', label: t.filterAll },
    { id: 'vegetarian', label: `${t.veg} 🥬` },
    { id: 'vegan', label: `${t.vegan} 🌱` },
    { id: 'gluten-free', label: `${t.glutenFree} 🌾` },
    { id: 'halal', label: `${t.halal} 🌙` },
    { id: 'spicy', label: `${t.spicy} 🔥` },
    { id: 'chef-recommendation', label: `${t.chefChoice} ⭐` }
  ];

  // Filtered menu logic
  const filteredItems = menuItems.filter(rawItem => {
    const item = getLocalizedMenuItem(rawItem, lang);
    const matchesCategory = effectiveCategory === 'all' || item.category === effectiveCategory;
    const matchesDietary = selectedDietary === 'all' || item.dietary.includes(selectedDietary as DietaryTag);
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          rawItem.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesDietary && matchesSearch;
  });

  // Featured Hero Item (first chef recommendation or special)
  const rawFeatured = menuItems.find(i => i.dietary.includes('chef-recommendation') && i.isAvailable) || menuItems[0];
  const featuredItem = rawFeatured ? getLocalizedMenuItem(rawFeatured, lang) : null;

  const handleQuickAdd = (e: React.MouseEvent, dish: MenuItem) => {
    e.stopPropagation();
    if (!dish.isAvailable) return;
    
    onDirectAddToCart(dish);
    setRecentlyAddedId(dish.id);
    setTimeout(() => {
      setRecentlyAddedId(null);
    }, 1200);
  };

  const getStatusStep = (status: string) => {
    switch (status) {
      case 'pending': return 1;
      case 'preparing': return 2;
      case 'ready': return 3;
      case 'served': return 4;
      default: return 1;
    }
  };

  const orderStep = activeOrder ? getStatusStep(activeOrder.status) : 0;

  return (
    <div className="pb-28 max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 pt-3 sm:pt-6 space-y-4 sm:space-y-6">

      {/* Clean top header, one framed card: table status + order mode on the
          left, the language/currency preference strip on the right, then the
          search row with the QR scan button. Language and currency used to sit
          in two separate places (and currency had an otherwise-empty row to
          itself); they are one strip now, which is what freed that row. */}
      <div className="bg-white border border-zinc-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
            {orderMode === 'delivery' ? (
              <span className="bg-sky-500 text-white font-black text-[10px] sm:text-xs px-2.5 py-0.5 rounded-lg uppercase tracking-wider shadow-xs">
                🛵 Dostavka
              </span>
            ) : orderMode === 'pickup' ? (
              <span className="bg-amber-500 text-white font-black text-[10px] sm:text-xs px-2.5 py-0.5 rounded-lg uppercase tracking-wider shadow-xs">
                🥡 Olib ketish
              </span>
            ) : (
              <span
                style={{ backgroundColor: accentColor }}
                className="text-white font-black text-[10px] sm:text-xs px-2.5 py-0.5 rounded-lg uppercase tracking-wider shadow-xs"
              >
                {t.table} #{tableNumber}
              </span>
            )}
            {orderMode === 'dine_in' && (
              <span className="text-[10px] sm:text-xs text-green-700 font-bold bg-green-50 px-2 py-0.5 rounded-lg border border-green-200 flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                <span>Kitchen Ready</span>
              </span>
            )}
            {/* Order-type switcher: at a table, the customer can still opt
                into delivery or pickup instead (e.g. from home, not scanning
                a table QR); once in delivery/pickup they can jump straight
                back to dine-in too. Only shown when this restaurant has
                opted into the delivery/pickup flow at all. */}
            {deliveryEnabled && onSetOrderMode && (
              <div className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 text-[10px] sm:text-xs font-bold">
                <button
                  onClick={() => onSetOrderMode('dine_in')}
                  className={`px-2 py-0.5 rounded-md transition-colors ${
                    orderMode === 'dine_in' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  🍽 Stolda
                </button>
                <button
                  onClick={() => onSetOrderMode('delivery')}
                  className={`px-2 py-0.5 rounded-md transition-colors ${
                    orderMode === 'delivery' ? 'bg-sky-500 text-white shadow-xs' : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  🛵 Dostavka
                </button>
                <button
                  onClick={() => onSetOrderMode('pickup')}
                  className={`px-2 py-0.5 rounded-md transition-colors ${
                    orderMode === 'pickup' ? 'bg-amber-500 text-white shadow-xs' : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  🥡 Olib ketish
                </button>
              </div>
            )}
          </div>

          {/* Display preferences — language and currency are the same kind of
              control (how the menu is shown to you), so they live in ONE strip
              instead of sitting in two places with a whole row to themselves.
              so'm stays first because it is the amount actually charged;
              USD/RUB are convenience conversions. */}
          <div className="flex items-center rounded-xl border border-zinc-200 bg-zinc-50 p-1 gap-1 shrink-0">
            <Globe className="w-3.5 h-3.5 text-zinc-400 shrink-0 ml-0.5" aria-hidden="true" />
            {(['uz', 'ru', 'en'] as const).map(code => (
              <button
                key={code}
                type="button"
                onClick={() => onLanguageChange(code)}
                aria-pressed={lang === code}
                aria-label={code === 'uz' ? "O'zbekcha" : code === 'ru' ? 'Русский' : 'English'}
                className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-colors ${
                  lang === code
                    ? 'bg-zinc-900 text-white shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 hover:bg-white'
                }`}
              >
                {code === 'uz' ? "O'z" : code === 'ru' ? 'Рус' : 'Eng'}
              </button>
            ))}

            <span className="w-px self-stretch bg-zinc-200 mx-0.5" aria-hidden="true" />

            <Coins className="w-3.5 h-3.5 text-zinc-400 shrink-0" aria-hidden="true" />
            {(['UZS', 'USD', 'RUB'] as const).map(code => (
              <button
                key={code}
                type="button"
                onClick={() => setCurrency(code)}
                aria-pressed={currency === code}
                aria-label={code === 'UZS' ? "so'm" : code}
                title={code === 'UZS' ? "so'm (UZS)" : code === 'USD' ? 'USD ($)' : 'RUB (₽)'}
                className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-colors ${
                  currency === code
                    ? 'bg-orange-500 text-white shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 hover:bg-white'
                }`}
              >
                {code === 'UZS' ? "so'm" : code === 'USD' ? '$' : '₽'}
              </button>
            ))}
          </div>
        </div>

        {tableComment && (
          <p className="text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1 inline-flex items-center gap-1">
            📍 {tableComment}
          </p>
        )}

        {/* Search + Scan row. The scan button is inline (icon beside its label)
            rather than stacked above it, so it matches the input's height and
            the card no longer needs a third row for the currency toggle. */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-9 pr-3 py-2.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 shadow-xs transition-colors"
            />
          </div>
          <button
            onClick={onOpenQRScanner}
            className="bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-orange-500 font-extrabold text-[11px] px-3 py-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-xs transition-colors shrink-0"
            title={t.scanQR}
            aria-label={t.scanQR}
          >
            <QrCode className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">{t.scanQR}</span>
          </button>
          {/* Table booking. Sits beside the scan button because it is the same
              kind of action — something you do to the visit, not to the menu.
              Only rendered when the restaurant has reservations switched on. */}
          {reservationsEnabled && onOpenReservation && (
            <button
              onClick={onOpenReservation}
              style={{ color: accentColor }}
              className="bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 font-extrabold text-[11px] px-3 py-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-xs transition-colors shrink-0"
              title={t.bookTable}
              aria-label={t.bookTable}
            >
              <CalendarDays className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">{t.bookTable}</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Order Tracker — only shown while an order is genuinely active */}
      {activeOrder && activeOrder.status !== 'paid' && (
        <div className="bg-gradient-to-br from-orange-500 to-amber-600 text-white border border-orange-400 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-white/20 pb-2 mb-2">
              <div className="flex items-center space-x-1.5">
                <ChefHat className="w-4 h-4 text-amber-200" />
                <span className="text-xs font-black">Order #{activeOrder.id}</span>
              </div>
              <span className="text-[10px] bg-white/20 backdrop-blur-md px-2 py-0.5 rounded-md font-bold">
                Est. {activeOrder.estimatedMinutes}m
              </span>
            </div>

            <div className="text-xs font-bold text-amber-100 mb-1">
              {activeOrder.status === 'pending' && 'Order Received at Kitchen'}
              {activeOrder.status === 'preparing' && 'Chef is Cooking Your Dish'}
              {activeOrder.status === 'ready' && 'Ready to be Served!'}
              {activeOrder.status === 'served' && 'Served at Table'}
            </div>

            {/* Progress bar */}
            <div className="w-full bg-black/20 h-2 rounded-full overflow-hidden mt-2 border border-white/10">
              <div
                className="bg-white h-full transition-all duration-500"
                style={{ width: `${(orderStep / 4) * 100}%` }}
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between text-[11px] font-semibold text-orange-100">
            <span>{activeOrder.items.length} items ordered</span>
            <span className="font-black text-white">{formatPrice(activeOrder.totalAmount)}</span>
          </div>
        </div>
      )}

      {/* 2. CATEGORY TABS & DIETARY CHIPS BENTO BAR */}
      <div className="bg-white border border-zinc-200/90 rounded-2xl p-3 shadow-xs space-y-2.5">
        
        {/* Category Tabs — hidden entirely while the restaurant has no
            sections yet (or they are still loading), since a lone "All" tab
            filters nothing. */}
        {categoryTabs.length > 1 && (
        <div className="relative">
          <div className="flex items-center space-x-2 overflow-x-auto pb-1.5 pt-0.5 px-0.5 custom-scrollbar touch-pan-x overscroll-x-contain">
            {categoryTabs.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all border shrink-0 ${
                  effectiveCategory === cat.id
                    ? 'bg-orange-500 text-white border-orange-500 shadow-xs'
                    : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100 active:scale-95'
                }`}
              >
                <span className="text-sm shrink-0">{cat.icon}</span>
                <span className="shrink-0">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Dietary Tag Filter Chips. The divider only makes sense when there
            are category tabs above it. */}
        <div
          className={`flex items-center space-x-1.5 overflow-x-auto custom-scrollbar touch-pan-x overscroll-x-contain ${
            categoryTabs.length > 1 ? 'pt-2 border-t border-zinc-100' : ''
          }`}
        >
          <span className="text-zinc-400 text-[11px] flex items-center space-x-1 shrink-0 font-semibold pl-1 pr-0.5">
            <Filter className="w-3 h-3 shrink-0" />
          </span>
          {dietaryFilters.map(d => (
            <button
              key={d.id}
              onClick={() => setSelectedDietary(d.id)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors whitespace-nowrap border shrink-0 ${
                selectedDietary === d.id
                  ? 'bg-orange-50 text-orange-800 border-orange-200'
                  : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:text-zinc-900 active:scale-95'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

      </div>

      {/* 3. FEATURED SPOTLIGHT BENTO HERO CARD (If available) */}
      {featuredItem && effectiveCategory === 'all' && !searchQuery && (
        <div
          onClick={() => onSelectItem(featuredItem)}
          className="bg-white border border-zinc-200/90 rounded-2xl p-3.5 sm:p-5 shadow-xs hover:border-orange-400 transition-all cursor-pointer group relative overflow-hidden"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div className="w-full h-40 sm:h-48 md:h-full bg-zinc-100 rounded-xl overflow-hidden relative">
              <img
                src={featuredItem.image}
                alt={featuredItem.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                referrerPolicy="no-referrer"
                decoding="async"
              />
              <span className="absolute top-2 left-2 bg-orange-500 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded-md shadow-xs">
                ⭐ {t.chefChoice}
              </span>
            </div>

            <div className="md:col-span-2 space-y-2 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-base sm:text-lg font-black text-zinc-900 group-hover:text-orange-600 transition-colors">
                    {featuredItem.name}
                  </h3>
                  <span className="text-base sm:text-xl font-black text-orange-600">
                    {formatPrice(featuredItem.price)}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-1 line-clamp-2 leading-relaxed font-medium">
                  {featuredItem.description}
                </p>
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-zinc-100">
                <div className="flex items-center space-x-1 text-xs text-zinc-400 font-semibold">
                  <Clock className="w-3.5 h-3.5 text-orange-500" />
                  <span>{t.prepTime.replace('{mins}', String(featuredItem.prepTimeMinutes))}</span>
                </div>

                <button
                  onClick={(e) => handleQuickAdd(e, featuredItem)}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-extrabold transition-all shadow-xs flex items-center space-x-1.5 active:scale-95"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>{t.addToOrder}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. DISHES BENTO GRID */}
      {menuState === 'loading' && menuItems.length === 0 ? (
        // Skeleton, not "no dishes found": an empty menu that is still
        // loading and a restaurant with no dishes look identical otherwise,
        // and guests were reloading the page thinking it was broken.
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 md:gap-5">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="bg-white border border-zinc-200/90 rounded-2xl p-2.5 sm:p-3.5 animate-pulse">
              <div className="w-full h-28 sm:h-36 bg-zinc-200 rounded-xl mb-2" />
              <div className="h-3 bg-zinc-200 rounded w-3/4 mb-1.5" />
              <div className="h-2.5 bg-zinc-100 rounded w-1/2" />
              <div className="mt-2.5 pt-2 border-t border-zinc-100">
                <div className="h-8 bg-zinc-100 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      ) : menuState === 'error' && menuItems.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-zinc-200/90 my-4 shadow-xs space-y-3">
          <Utensils className="w-10 h-10 text-zinc-400 mx-auto" />
          <p className="text-zinc-800 font-bold text-xs sm:text-sm">Menyuni yuklab bo'lmadi</p>
          <p className="text-[11px] text-zinc-500">Internet aloqasini tekshirib, qaytadan urinib ko'ring.</p>
          {onRetryMenu && (
            <button
              onClick={onRetryMenu}
              className="text-white font-bold text-xs px-4 py-2 rounded-xl"
              style={{ backgroundColor: accentColor }}
            >
              Qaytadan yuklash
            </button>
          )}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-zinc-200/90 my-4 shadow-xs">
          <Utensils className="w-10 h-10 text-zinc-400 mx-auto mb-2" />
          <p className="text-zinc-800 font-bold text-xs sm:text-sm">{t.noDishesFound}</p>
          <p className="text-[11px] text-zinc-500 mt-1">{t.tryResetFilters}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 md:gap-5">
          {filteredItems.map((rawDish) => {
            const dish = getLocalizedMenuItem(rawDish, lang);
            const isRecentlyAdded = recentlyAddedId === dish.id;

            return (
              <div
                key={dish.id}
                onClick={() => dish.isAvailable && onSelectItem(rawDish)}
                className={`group bg-white border border-zinc-200/90 hover:border-orange-400 rounded-2xl p-2.5 sm:p-3.5 shadow-xs transition-all duration-200 flex flex-col justify-between ${
                  !dish.isAvailable
                    ? 'opacity-60 cursor-not-allowed'
                    : 'cursor-pointer hover:shadow-md'
                }`}
              >
                <div>
                  {/* Food Image Container */}
                  <div className="w-full h-28 sm:h-36 bg-zinc-100 rounded-xl overflow-hidden relative mb-2">
                    <img
                      src={dish.image}
                      alt={dish.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      referrerPolicy="no-referrer"
                      // Photos are their own requests now, so the dishes below the
                      // fold cost nothing until they are scrolled to.
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>

                    {/* Availability Badge */}
                    <div className="absolute top-1.5 left-1.5 flex flex-col space-y-1">
                      {!dish.isAvailable && (
                        <span className="bg-zinc-900 text-white font-black text-[9px] px-1.5 py-0.5 rounded-md">
                          {t.soldOut}
                        </span>
                      )}
                    </div>

                    {/* Prep Time Badge */}
                    <div className="absolute top-1.5 right-1.5 flex items-center space-x-0.5 text-[9px] text-white bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded-md font-semibold">
                      <Clock className="w-2.5 h-2.5 text-orange-400" />
                      <span>{t.prepTime.replace('{mins}', String(dish.prepTimeMinutes))}</span>
                    </div>

                    {/* Price Tag */}
                    <div className="absolute bottom-1.5 left-2 text-white font-black text-sm sm:text-lg drop-shadow-md">
                      {formatPrice(dish.price)}
                    </div>

                    {/* Customizer Option Gear Trigger */}
                    {dish.isAvailable && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectItem(rawDish);
                        }}
                        className="absolute bottom-1.5 right-1.5 bg-black/60 hover:bg-black/80 text-white p-1 rounded-lg backdrop-blur-md transition-colors"
                        title="Customize Options"
                      >
                        <SlidersHorizontal className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Card Content */}
                  <div>
                    <h4 className="font-extrabold text-xs sm:text-sm text-zinc-900 group-hover:text-orange-600 transition-colors line-clamp-1 leading-snug">
                      {dish.name}
                    </h4>
                    <p className="text-[10px] sm:text-xs text-zinc-500 mt-0.5 line-clamp-2 leading-tight">
                      {dish.description}
                    </p>
                  </div>
                </div>

                {/* Card Bottom Direct Add Action */}
                <div className="mt-2.5 pt-2 border-t border-zinc-100">
                  {dish.isAvailable ? (
                    <button
                      onClick={(e) => handleQuickAdd(e, rawDish)}
                      className={`w-full py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center space-x-1 shadow-xs active:scale-95 ${
                        isRecentlyAdded
                          ? 'bg-green-600 text-white'
                          : 'bg-orange-500 hover:bg-orange-600 text-white'
                      }`}
                    >
                      {isRecentlyAdded ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>{t.added}</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5 stroke-[3]" />
                          <span>{t.addToOrder}</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      disabled
                      className="w-full bg-zinc-100 text-zinc-400 py-2 rounded-xl text-xs font-bold cursor-not-allowed"
                    >
                      {t.soldOut}
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Restaurant Info & Contacts Footer Card */}
      <div className="bg-white border border-zinc-200/90 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-zinc-100 pb-4">
          <div className="flex items-center space-x-3">
            {logoUrl ? (
              <img src={logoUrl} alt="Restaurant logo" className="w-10 h-10 rounded-2xl object-cover shadow-sm border border-zinc-200" />
            ) : (
              <div style={{ backgroundColor: accentColor }} className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-black text-lg shadow-sm">
                {(restaurantName || 'B').charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h3 className="font-black text-base text-zinc-900 uppercase tracking-tight">{restaurantName || t.appTitle}</h3>
              {contactAddress && (
                <p className="text-xs text-orange-600 font-bold flex items-center space-x-1">
                  <span>📍 {contactAddress}</span>
                </p>
              )}
            </div>
          </div>

          {onOpenLocation && (contactAddress || contactPhone || contactInstagram) && (
            <button
              onClick={onOpenLocation}
              className="bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-800 font-extrabold text-xs px-3 py-2 rounded-xl transition-colors shadow-2xs"
            >
              View Location & Map →
            </button>
          )}
        </div>

        {(contactInstagram || contactPhone) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {contactInstagram && (
              <a
                href={`https://instagram.com/${contactInstagram.replace(/^@/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3 bg-zinc-50 hover:bg-pink-50/80 border border-zinc-200/80 rounded-xl flex items-center space-x-2.5 text-xs font-extrabold text-zinc-800 transition-colors group"
              >
                <span className="p-2 bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white rounded-lg group-hover:scale-105 transition-transform">
                  📸
                </span>
                <div className="overflow-hidden">
                  <span className="text-[10px] text-zinc-400 font-bold block uppercase">Instagram</span>
                  <span className="truncate text-zinc-900 font-black">@{contactInstagram.replace(/^@/, '')}</span>
                </div>
              </a>
            )}

            {contactPhone && (
              <a
                href={`tel:${contactPhone}`}
                className="p-3 bg-zinc-50 hover:bg-orange-50/80 border border-zinc-200/80 rounded-xl flex items-center space-x-2.5 text-xs font-extrabold text-zinc-800 transition-colors group"
              >
                <span className="p-2 bg-orange-500 text-white rounded-lg group-hover:scale-105 transition-transform">
                  📞
                </span>
                <div className="overflow-hidden">
                  <span className="text-[10px] text-zinc-400 font-bold block uppercase">Phone Number</span>
                  <span className="truncate text-zinc-900 font-black">{contactPhone}</span>
                </div>
              </a>
            )}
          </div>
        )}
      </div>

      {/* Floating Bottom Cart Review Bar for Mobile */}
      {cartCount > 0 && (
        <div className="fixed bottom-3 left-2.5 right-2.5 max-w-lg mx-auto z-40 animate-slideUp">
          <button
            onClick={onOpenCart}
            className="w-full bg-zinc-900 hover:bg-black text-white font-bold p-3 rounded-2xl shadow-2xl flex items-center justify-between transition-all transform active:scale-98 border border-zinc-800"
          >
            <div className="flex items-center space-x-2.5">
              <div className="bg-orange-500 text-white font-black text-xs sm:text-sm w-8 h-8 rounded-xl flex items-center justify-center shrink-0">
                {cartCount}
              </div>
              <div className="text-left">
                <div className="text-[10px] uppercase tracking-wider text-orange-400 font-black">{t.yourCart}</div>
                <div className="text-[11px] text-zinc-300 font-medium">{t.table} #{tableNumber} • {t.reviewOrder}</div>
              </div>
            </div>

            <div className="text-right flex items-center space-x-2">
              <span className="text-base sm:text-lg font-black text-orange-400">{formatPrice(cartSubtotal)}</span>
              <span className="bg-zinc-800 p-1.5 rounded-xl text-white text-xs">→</span>
            </div>
          </button>
        </div>
      )}

      {/* Floating Waiter Call Button — deliberately placed on the side edge,
          not buried in the header, so it's unmistakable when a guest needs
          help but doesn't compete with the bottom cart bar. */}
      {orderMode === 'dine_in' && onCallWaiter && (
        <button
          onClick={handleCallWaiterClick}
          disabled={waiterCallState !== 'idle'}
          className={`fixed right-3 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center justify-center rounded-full shadow-lg transition-all active:scale-95 ${
            waiterCallState === 'sent'
              ? 'w-14 h-14 bg-green-500 text-white'
              : 'w-16 h-16 bg-orange-500 text-white hover:bg-orange-600'
          }`}
        >
          {waiterCallState === 'sent' ? (
            <>
              <BellRing className="w-5 h-5" />
              <span className="text-[9px] font-black mt-0.5">OK</span>
            </>
          ) : (
            <>
              {waiterCallState === 'idle' && (
                <span className="absolute inset-0 rounded-full bg-orange-500 animate-ping opacity-40"></span>
              )}
              <Bell className="w-6 h-6 relative z-10" />
              <span className="text-[8px] font-black mt-0.5 relative z-10 leading-none">
                {waiterCallState === 'sending' ? '...' : 'Chaqirish'}
              </span>
            </>
          )}
        </button>
      )}

    </div>
  );
};
