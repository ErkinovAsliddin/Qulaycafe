import React, { useState } from 'react';
import { Store, UtensilsCrossed, ChefHat, ArrowRight, Check, X } from 'lucide-react';
import { MenuItem, MenuCategory } from '../../types';

interface OnboardingWizardProps {
  restaurantName?: string | null;
  /** Live sections from /api/admin/categories — the wizard must offer the same list the menu uses. */
  categories?: MenuCategory[];
  onAddTable: (tableNumber: number, capacity: number, comment?: string) => Promise<void>;
  // Resolves to the created dish (or null on failure) so callers that also need
  // to set a cost price can reach it; the wizard itself ignores the value.
  onAddMenuItem: (newItem: Partial<MenuItem>) => Promise<MenuItem | null>;
  onUpdateKitchenPin: (newPin: string) => Promise<void>;
  onFinish: () => void;
}

// Only used until the category list arrives — the same slugs every new
// restaurant is seeded with, so a dish filed here is never orphaned.
const FALLBACK_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'birinchi_taom', label: 'Birinchi taom' },
  { value: 'ikkinchi_taom', label: 'Ikkinchi taom' },
  { value: 'garnir', label: 'Garnir' },
  { value: 'salat', label: 'Salat' },
  { value: 'nonushta', label: 'Nonushta' },
  { value: 'pizza', label: 'Pizza' },
  { value: 'ichimlik', label: 'Ichimlik' }
];

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  restaurantName,
  categories = [],
  onAddTable,
  onAddMenuItem,
  onUpdateKitchenPin,
  onFinish
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isSaving, setIsSaving] = useState(false);

  // Step 1: tables
  const [tableCount, setTableCount] = useState<number>(10);
  const [tableCapacity, setTableCapacity] = useState<number>(4);

  // Step 2: first menu item (optional)
  const [dishName, setDishName] = useState('');
  const [dishPrice, setDishPrice] = useState<number>(25000);
  const categoryOptions = categories.length
    ? [...categories]
        .filter(c => c.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(c => ({ value: c.id, label: `${c.icon} ${c.nameUz}` }))
    : FALLBACK_CATEGORY_OPTIONS;
  const [dishCategory, setDishCategory] = useState<string>('ikkinchi_taom');
  const effectiveDishCategory = categoryOptions.some(c => c.value === dishCategory)
    ? dishCategory
    : categoryOptions[0]?.value || dishCategory;

  // Step 3: kitchen PIN
  const [kitchenPin, setKitchenPin] = useState('');

  const handleCreateTables = async () => {
    if (tableCount < 1 || tableCount > 200) return;
    setIsSaving(true);
    try {
      for (let n = 1; n <= tableCount; n++) {
        await onAddTable(n, tableCapacity);
      }
      setStep(2);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddFirstDish = async () => {
    if (!dishName.trim()) {
      setStep(3);
      return;
    }
    setIsSaving(true);
    try {
      await onAddMenuItem({
        nameUz: dishName,
        nameRu: dishName,
        nameEn: dishName,
        price: dishPrice,
        category: effectiveDishCategory,
      });
      setStep(3);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetKitchenPin = async () => {
    if (kitchenPin.trim().length < 4) return;
    setIsSaving(true);
    try {
      await onUpdateKitchenPin(kitchenPin.trim());
      onFinish();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-md">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">

        <div className="text-center space-y-1">
          <div className="w-12 h-12 bg-orange-50 text-orange-600 border border-orange-200 rounded-2xl flex items-center justify-center mx-auto">
            {step === 1 ? <Store className="w-6 h-6" /> : step === 2 ? <UtensilsCrossed className="w-6 h-6" /> : <ChefHat className="w-6 h-6" />}
          </div>
          <h2 className="text-lg font-black text-zinc-900">
            {restaurantName ? `Xush kelibsiz, ${restaurantName}!` : 'Xush kelibsiz!'}
          </h2>
          <p className="text-xs text-zinc-500 font-medium">Tizimni ishga tushirish uchun 3 ta oddiy qadam</p>
        </div>

        {/* progress dots */}
        <div className="flex items-center justify-center space-x-2">
          {[1, 2, 3].map(s => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all ${
                s === step ? 'w-8 bg-orange-500' : s < step ? 'w-4 bg-orange-300' : 'w-4 bg-zinc-200'
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-700 mb-1">Restoraningizda nechta stol bor?</label>
              <input
                type="number"
                min={1}
                max={200}
                value={tableCount}
                onChange={e => setTableCount(Number(e.target.value))}
                className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2.5 text-sm font-bold text-zinc-900 outline-none"
              />
              <p className="text-[11px] text-zinc-400 mt-1">Stollar 1 dan {tableCount || 0} gacha raqamlanadi — keyinroq qo'shish/o'chirish mumkin.</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-700 mb-1">Har bir stolda nechta o'rin (o'rtacha)?</label>
              <input
                type="number"
                min={1}
                max={30}
                value={tableCapacity}
                onChange={e => setTableCapacity(Number(e.target.value))}
                className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2.5 text-sm font-bold text-zinc-900 outline-none"
              />
            </div>
            <button
              onClick={handleCreateTables}
              disabled={isSaving || tableCount < 1}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center space-x-2"
            >
              <span>{isSaving ? 'Yaratilmoqda...' : `${tableCount || 0} ta stol yaratish`}</span>
              {!isSaving && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500 font-medium">
              Birinchi taomni qo'shib ko'ring (xohlasangiz keyinroq ham qo'shishingiz mumkin).
            </p>
            <div>
              <label className="block text-xs font-bold text-zinc-700 mb-1">Taom nomi</label>
              <input
                type="text"
                value={dishName}
                onChange={e => setDishName(e.target.value)}
                placeholder="Masalan: Osh"
                className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2.5 text-sm text-zinc-900 outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">Narxi (so'm)</label>
                <input
                  type="number"
                  min={0}
                  value={dishPrice}
                  onChange={e => setDishPrice(Number(e.target.value))}
                  className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2.5 text-sm text-zinc-900 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">Turkum</label>
                <select
                  value={effectiveDishCategory}
                  onChange={e => setDishCategory(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2.5 text-sm text-zinc-900 outline-none"
                >
                  {categoryOptions.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setStep(3)}
                className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-3 rounded-xl text-sm"
              >
                Keyinroq qo'shaman
              </button>
              <button
                onClick={handleAddFirstDish}
                disabled={isSaving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center space-x-2"
              >
                <span>{isSaving ? 'Saqlanmoqda...' : 'Qo\'shish'}</span>
                {!isSaving && <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500 font-medium">
              Oshxona (kухня) uchun alohida PIN kod o'rnating — bu bilan kухня xodimi faqat buyurtmalarni ko'radi, admin sozlamalariga kirolmaydi.
            </p>
            <div>
              <label className="block text-xs font-bold text-zinc-700 mb-1">Kухня PIN kodi (kamida 4 ta belgi)</label>
              <input
                type="text"
                value={kitchenPin}
                onChange={e => setKitchenPin(e.target.value)}
                placeholder="Masalan: 4821"
                className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl px-3 py-2.5 text-sm text-zinc-900 outline-none"
              />
            </div>
            <div className="flex space-x-2">
              <button
                onClick={onFinish}
                className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-3 rounded-xl text-sm"
              >
                O'tkazib yuborish
              </button>
              <button
                onClick={handleSetKitchenPin}
                disabled={isSaving || kitchenPin.trim().length < 4}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center space-x-2"
              >
                <span>{isSaving ? 'Saqlanmoqda...' : 'Tayyor'}</span>
                {!isSaving && <Check className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        <button
          onClick={onFinish}
          className="w-full text-center text-[11px] font-bold text-zinc-400 hover:text-zinc-600 flex items-center justify-center space-x-1"
        >
          <X className="w-3 h-3" />
          <span>Sozlashni yopish, keyinroq davom etaman</span>
        </button>
      </div>
    </div>
  );
};
