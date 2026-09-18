import { useCurrency } from '../../utils/CurrencyContext';
import React, { useState, useEffect } from 'react';
import { MenuItem, SelectedCustomization, CartItem } from '../../types';
import { X, Plus, Minus, Flame, Clock, Heart, ShoppingBag, Check } from 'lucide-react';
import { Language, translations, getLocalizedMenuItem } from '../../lib/translations';

interface ItemCustomizerModalProps {
  item: MenuItem | null;
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (cartItem: Omit<CartItem, 'cartItemId'>) => void;
  lang: Language;
}

export const ItemCustomizerModal: React.FC<ItemCustomizerModalProps> = ({
  item: rawItem,
  isOpen,
  onClose,
  onAddToCart,
  lang
}) => {
  const t = translations[lang];
  const { formatPrice } = useCurrency();
  const item = rawItem ? getLocalizedMenuItem(rawItem, lang) : null;
  const [quantity, setQuantity] = useState<number>(1);
  const [selectedCustomizations, setSelectedCustomizations] = useState<SelectedCustomization[]>([]);
  const [specialInstructions, setSpecialInstructions] = useState<string>('');

  useEffect(() => {
    if (rawItem && isOpen) {
      const localizedItem = getLocalizedMenuItem(rawItem, lang);
      setQuantity(1);
      setSpecialInstructions('');
      
      // Pre-select default options for required customization groups
      const defaults: SelectedCustomization[] = [];
      if (localizedItem.customizations) {
        localizedItem.customizations.forEach(group => {
          if (group.required && group.options.length > 0) {
            defaults.push({
              groupTitle: group.title,
              optionName: group.options[0].name,
              price: group.options[0].price
            });
          }
        });
      }
      setSelectedCustomizations(defaults);
    }
  }, [rawItem?.id, isOpen, lang]);

  if (!isOpen || !item) return null;

  // Calculate unit price including customizations
  const customizationExtraTotal = selectedCustomizations.reduce((acc, curr) => acc + curr.price, 0);
  const unitPrice = item.price + customizationExtraTotal;
  const itemTotal = unitPrice * quantity;

  const handleSelectOption = (groupTitle: string, optionName: string, price: number, isRequired: boolean) => {
    setSelectedCustomizations(prev => {
      if (isRequired) {
        // Replace existing selection in required group
        const filtered = prev.filter(c => c.groupTitle !== groupTitle);
        return [...filtered, { groupTitle, optionName, price }];
      } else {
        // Toggle optional selection
        const exists = prev.some(c => c.groupTitle === groupTitle && c.optionName === optionName);
        if (exists) {
          return prev.filter(c => !(c.groupTitle === groupTitle && c.optionName === optionName));
        } else {
          return [...prev, { groupTitle, optionName, price }];
        }
      }
    });
  };

  const handleAdd = () => {
    if (!item || !rawItem) return;
    onAddToCart({
      menuItem: rawItem,
      quantity,
      selectedCustomizations,
      specialInstructions: specialInstructions.trim(),
      itemTotal
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-900/60 dark:bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
        
        {/* Header Image Banner */}
        <div className="relative h-48 sm:h-56 w-full overflow-hidden bg-zinc-100">
          <img
            src={item.image}
            alt={item.name}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          
          <button
            onClick={onClose}
            className="absolute top-3 right-3 bg-white/80 dark:bg-zinc-900/80 hover:bg-white dark:hover:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-2 rounded-full backdrop-blur-md border border-zinc-200 dark:border-zinc-700 shadow-sm transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Price & Prep Badge */}
          <div className="absolute bottom-3 left-4 flex items-center space-x-2">
            <span className="bg-orange-500 text-white font-bold text-xs px-2.5 py-1 rounded-lg shadow-sm">
              {formatPrice(item.price)}
            </span>
            <span className="bg-black/60 text-white text-xs px-2.5 py-1 rounded-lg backdrop-blur-md flex items-center space-x-1 font-medium">
              <Clock className="w-3 h-3 text-orange-400" />
              <span>{item.prepTimeMinutes} {t.mins}</span>
            </span>
            {item.calories && (
              <span className="bg-black/60 text-white text-xs px-2.5 py-1 rounded-lg backdrop-blur-md font-medium">
                {item.calories} {t.kcal}
              </span>
            )}
          </div>
        </div>

        {/* Scrollable Modal Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5 custom-scrollbar">
          
          {/* Title & Description */}
          <div>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">{item.name}</h3>
            <p className="text-zinc-500 dark:text-zinc-400 text-xs sm:text-sm mt-1 leading-relaxed">
              {item.description}
            </p>
          </div>


          {/* Customization Options */}
          {item.customizations && item.customizations.map(group => (
            <div key={group.id} className="bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                  {group.title}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                  group.required ? 'bg-orange-100 dark:bg-orange-500/20 text-orange-800 dark:text-orange-300 border border-orange-200 dark:border-orange-500/20' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                }`}>
                  {group.required ? t.required : t.optional}
                </span>
              </div>

              <div className="space-y-1.5">
                {group.options.map(opt => {
                  const isSelected = selectedCustomizations.some(
                    c => c.groupTitle === group.title && c.optionName === opt.name
                  );

                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectOption(group.title, opt.name, opt.price, group.required)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-lg text-xs font-medium transition-all border ${
                        isSelected
                          ? 'bg-orange-50 dark:bg-orange-500/15 border-orange-300 dark:border-orange-500/40 text-orange-900 dark:text-orange-300 font-bold'
                          : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <div className={`w-4 h-4 rounded-${group.required ? 'full' : 'md'} border flex items-center justify-center ${
                          isSelected ? 'bg-orange-500 border-orange-500 text-white' : 'border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <span>{opt.name}</span>
                      </div>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {opt.price > 0 ? `+${formatPrice(opt.price)}` : t.free}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Special Kitchen Note Input */}
          <div>
            <label className="block text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-1.5">
              {t.specialInstructions}
            </label>
            <textarea
              value={specialInstructions}
              onChange={e => setSpecialInstructions(e.target.value)}
              placeholder={t.specialInstructionsPlaceholder}
              className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors resize-none h-20"
            />
          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between space-x-3">
          
          {/* Quantity Selector */}
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1 border border-zinc-200 dark:border-zinc-700">
            <button
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              className="p-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity(q => Math.min(50, q + 1))}
              className="p-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Submit Add Button */}
          <button
            onClick={handleAdd}
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-orange-500/20 flex items-center justify-between transition-all transform active:scale-98"
          >
            <span className="flex items-center space-x-2">
              <ShoppingBag className="w-4 h-4" />
              <span>{t.addToOrder}</span>
            </span>
            <span className="text-sm font-extrabold">{formatPrice(itemTotal)}</span>
          </button>

        </div>

      </div>
    </div>
  );
};

