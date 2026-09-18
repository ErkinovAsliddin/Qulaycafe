import { useCurrency } from '../../utils/CurrencyContext';
import React from 'react';
import { Order } from '../../types';
import { Clock, ChefHat, CheckCircle2, Star } from 'lucide-react';
import { Language, translations } from '../../lib/translations';

interface OrderStatusTrackerProps {
  activeOrder: Order | null;
  onViewDetails?: () => void;
  hasCartItems?: boolean;
  lang: Language;
  /** Id of the guest's most recent served-but-unrated order, when there is one. */
  pendingReviewOrderId?: string | null;
  /** Opens the review form for that order. */
  onOpenReview?: () => void;
}

export const OrderStatusTracker: React.FC<OrderStatusTrackerProps> = ({
  activeOrder,
  onViewDetails,
  hasCartItems = false,
  lang,
  pendingReviewOrderId,
  onOpenReview
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
  // The rate prompt rides on this card only while the very order it belongs to
  // is the one awaiting feedback — never on an older ticket's card.
  const showReviewPrompt = !!onOpenReview && activeOrder.status === 'served' && pendingReviewOrderId === activeOrder.id;

  return (
    <div className={`fixed left-2.5 right-2.5 max-w-lg mx-auto z-30 transition-all duration-300 animate-slideUp ${
      hasCartItems ? 'bottom-20' : 'bottom-3'
    }`}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-2xl p-3 sm:p-4 shadow-xl dark:shadow-black/40">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2 mb-2">
          <div className="flex items-center space-x-2">
            <div className="p-1 bg-orange-50 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 rounded-lg border border-orange-200 dark:border-orange-500/20">
              <ChefHat className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-black">Order #{activeOrder.id}</span>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 ml-1.5 font-bold">
                {activeOrder.orderType === 'delivery'
                  ? '🛵 Dostavka'
                  : activeOrder.orderType === 'pickup'
                  ? '🥡 Olib ketish'
                  : `${t.table} #${activeOrder.tableNumber}`}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-1 text-orange-600 dark:text-orange-400 text-xs font-black">
            <Clock className="w-3.5 h-3.5" />
            <span>{t.estMins.replace('{mins}', String(activeOrder.estimatedMinutes))}</span>
          </div>
        </div>

        {activeOrder.orderType === 'delivery' && activeOrder.courierName && (
          <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 rounded-xl px-3 py-2 mb-2 text-xs font-bold text-sky-800 dark:text-sky-300">
            🛵 Kuryer: {activeOrder.courierName}
          </div>
        )}

        {/* Progress Bar */}
        <div className="relative mb-2">
          <div className="overflow-hidden h-2 text-xs flex rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
            <div
              style={{ width: `${(currentStep / 4) * 100}%` }}
              className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-orange-500 transition-all duration-500"
            />
          </div>

          <div className="flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500 font-bold mt-1.5 px-0.5">
            <span className={currentStep >= 1 ? 'text-orange-600 dark:text-orange-400' : ''}>{t.sentStep}</span>
            <span className={currentStep >= 2 ? 'text-orange-600 dark:text-orange-400' : ''}>{t.cookingStep}</span>
            <span className={currentStep >= 3 ? 'text-green-600 dark:text-green-400' : ''}>
              {activeOrder.orderType === 'delivery' ? "Yo'lda" : activeOrder.orderType === 'pickup' ? 'Tayyor' : t.readyStep}
            </span>
            <span className={currentStep >= 4 ? 'text-green-600 dark:text-green-400' : ''}>
              {activeOrder.orderType === 'delivery' ? 'Yetkazildi' : activeOrder.orderType === 'pickup' ? 'Olib ketildi' : t.servedStep}
            </span>
          </div>
        </div>

        {/* Status Text & Items Count */}
        <div className="flex items-center justify-between text-xs pt-0.5">
          <span className="text-zinc-600 dark:text-zinc-300 text-[11px]">
            {t.itemsCount.replace('{count}', String(activeOrder.items.length))} • <strong className="text-zinc-900 dark:text-zinc-100 font-black">{formatPrice(activeOrder.totalAmount)}</strong>
          </span>

          <span className="bg-orange-50 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300 text-[10px] sm:text-xs font-black px-2 py-0.5 rounded-md border border-orange-200 dark:border-orange-500/20">
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

        {/* Rate your meal — one gentle prompt once the food has arrived, for
            the order this card is actually showing. */}
        {showReviewPrompt && (
          <button
            onClick={onOpenReview}
            className="w-full mt-3 bg-amber-400 hover:bg-amber-300 text-amber-950 font-black py-2.5 rounded-xl text-xs flex items-center justify-center space-x-1.5 transition-colors active:scale-[0.99]"
          >
            <Star className="w-4 h-4 fill-amber-950" />
            <span>{t.reviewCta}</span>
          </button>
        )}

      </div>
    </div>
  );
};
