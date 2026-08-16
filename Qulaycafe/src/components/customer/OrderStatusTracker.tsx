import { useCurrency } from '../../utils/CurrencyContext';
import React from 'react';
import { Order } from '../../types';
import { Clock, ChefHat, CheckCircle2 } from 'lucide-react';
import { Language, translations } from '../../lib/translations';

interface OrderStatusTrackerProps {
  activeOrder: Order | null;
  onViewDetails?: () => void;
  hasCartItems?: boolean;
  lang: Language;
}

export const OrderStatusTracker: React.FC<OrderStatusTrackerProps> = ({
  activeOrder,
  onViewDetails,
  hasCartItems = false,
  lang
}) => {
  const t = translations[lang];
  const { formatPrice } = useCurrency();
  if (!activeOrder || activeOrder.status === 'paid') return null;

  const getStatusStep = (status: string) => {
    switch (status) {
      case 'pending': return 1;
      case 'preparing': return 2;
      case 'ready': return 3;
      case 'out_for_delivery': return 3;
      case 'served': return 4;
      default: return 1;
    }
  };

  const currentStep = getStatusStep(activeOrder.status);

  return (
    <div className={`fixed left-2.5 right-2.5 max-w-lg mx-auto z-30 transition-all duration-300 animate-slideUp ${
      hasCartItems ? 'bottom-20' : 'bottom-3'
    }`}>
      <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl p-3 sm:p-4 shadow-xl">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2 mb-2">
          <div className="flex items-center space-x-2">
            <div className="p-1 bg-orange-50 text-orange-600 rounded-lg border border-orange-200">
              <ChefHat className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-black text-zinc-900">Order #{activeOrder.id}</span>
              <span className="text-[10px] text-zinc-500 ml-1.5 font-bold">
                {activeOrder.orderType === 'delivery'
                  ? '🛵 Dostavka'
                  : activeOrder.orderType === 'pickup'
                  ? '🥡 Olib ketish'
                  : `${t.table} #${activeOrder.tableNumber}`}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-1 text-orange-600 text-xs font-black">
            <Clock className="w-3.5 h-3.5" />
            <span>{t.estMins.replace('{mins}', String(activeOrder.estimatedMinutes))}</span>
          </div>
        </div>

        {activeOrder.orderType === 'delivery' && activeOrder.courierName && (
          <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2 mb-2 text-xs font-bold text-sky-800">
            🛵 Kuryer: {activeOrder.courierName}
          </div>
        )}

        {/* Progress Bar */}
        <div className="relative mb-2">
          <div className="overflow-hidden h-2 text-xs flex rounded-full bg-zinc-100 border border-zinc-200">
            <div
              style={{ width: `${(currentStep / 4) * 100}%` }}
              className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-orange-500 transition-all duration-500"
            />
          </div>

          <div className="flex justify-between text-[10px] text-zinc-400 font-bold mt-1.5 px-0.5">
            <span className={currentStep >= 1 ? 'text-orange-600' : ''}>{t.sentStep}</span>
            <span className={currentStep >= 2 ? 'text-orange-600' : ''}>{t.cookingStep}</span>
            <span className={currentStep >= 3 ? 'text-green-600' : ''}>
              {activeOrder.orderType === 'delivery' ? "Yo'lda" : activeOrder.orderType === 'pickup' ? 'Tayyor' : t.readyStep}
            </span>
            <span className={currentStep >= 4 ? 'text-green-600' : ''}>
              {activeOrder.orderType === 'delivery' ? 'Yetkazildi' : activeOrder.orderType === 'pickup' ? 'Olib ketildi' : t.servedStep}
            </span>
          </div>
        </div>

        {/* Status Text & Items Count */}
        <div className="flex items-center justify-between text-xs pt-0.5">
          <span className="text-zinc-600 text-[11px]">
            {t.itemsCount.replace('{count}', String(activeOrder.items.length))} • <strong className="text-zinc-900 font-black">{formatPrice(activeOrder.totalAmount)}</strong>
          </span>

          <span className="bg-orange-50 text-orange-800 text-[10px] sm:text-xs font-black px-2 py-0.5 rounded-md border border-orange-200">
            {activeOrder.status === 'pending' && t.orderReceived}
            {activeOrder.status === 'preparing' && t.chefCooking}
            {activeOrder.status === 'ready' &&
              (activeOrder.orderType === 'delivery'
                ? 'Kuryer kutilmoqda'
                : activeOrder.orderType === 'pickup'
                ? '🥡 Tayyor — kelib oling!'
                : t.readyForTable)}
            {activeOrder.status === 'out_for_delivery' && "🛵 Yo'lda"}
            {activeOrder.status === 'served' && t.enjoyMeal}
          </span>
        </div>

      </div>
    </div>
  );
};

