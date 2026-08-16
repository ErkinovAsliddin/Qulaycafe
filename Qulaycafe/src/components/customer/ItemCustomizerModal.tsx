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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative">
        
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
            className="absolute top-3 right-3 bg-white/80 hover:bg-white text-zinc-900 p-2 rounded-full backdrop-blur-md border border-zinc-200 shadow-sm transition-colors"
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
            <h3 className="text-xl font-bold text-zinc-900 tracking-tight">{item.name}</h3>
            <p className="text-zinc-500 text-xs sm:text-sm mt-1 leading-relaxed">
              {item.description}
            </p>
          </div>


          {/* Customization Options */}
          {item.customizations && item.customizations.map(group => (
            <div key={group.id} className="bg-zinc-50 border border-zinc-200 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-800 uppercase tracking-wider">
                  {group.title}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                  group.required ? 'bg-orange-100 text-orange-800 border border-orange-200' : 'bg-zinc-200 text-zinc-600'
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
                          ? 'bg-orange-50 border-orange-300 text-orange-900 font-bold'
                          : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <div className={`w-4 h-4 rounded-${group.required ? 'full' : 'md'} border flex items-center justify-center ${
                          isSelected ? 'bg-orange-500 border-orange-500 text-white' : 'border-zinc-300 bg-white'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <span>{opt.name}</span>
                      </div>
                      <span className="text-zinc-500">
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
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
              {t.specialInstructions}
            </label>
            <textarea
              value={specialInstructions}
              onChange={e => setSpecialInstructions(e.target.value)}
              placeholder={t.specialInstructionsPlaceholder}
              className="w-full bg-white border border-zinc-200 rounded-xl p-3 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors resize-none h-20"
            />
          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-white border-t border-zinc-200 flex items-center justify-between space-x-3">
          
          {/* Quantity Selector */}
          <div className="flex items-center bg-zinc-100 rounded-xl p-1 border border-zinc-200">
            <button
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              className="p-2 text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center text-sm font-bold text-zinc-900">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity(q => Math.min(50, q + 1))}
              className="p-2 text-zinc-600 hover:text-zinc-900 transition-colors"
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

