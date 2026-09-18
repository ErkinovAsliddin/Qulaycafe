import { useCurrency } from '../../utils/CurrencyContext';
import React from 'react';
import { LoyaltyMember, Order } from '../../types';
import { X, Sparkles, Award, ShoppingBag, Clock, CheckCircle2 } from 'lucide-react';
import { Language, translations } from '../../lib/translations';

interface OrderHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: LoyaltyMember | null;
  orders: Order[];
  lang: Language;
  /** False when the restaurant's points program is off — the modal then shows
      the guest's order history only, with no points card or points pitch. */
  loyaltyEnabled?: boolean;
}

export const OrderHistoryModal: React.FC<OrderHistoryModalProps> = ({
  isOpen,
  onClose,
  member,
  orders,
  lang,
  loyaltyEnabled = true
}) => {
  const t = translations[lang];
  const { formatPrice } = useCurrency();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 dark:bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden relative">
        
        {/* Header */}
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-zinc-900">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-orange-50 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 rounded-xl border border-orange-100 dark:border-orange-500/20">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-zinc-900 dark:text-zinc-100">
                {loyaltyEnabled ? t.loyaltyTitle : t.myOrders}
              </h2>
              <p className="text-zinc-500 dark:text-zinc-400 text-xs font-medium">
                {loyaltyEnabled ? t.trackPointsRewards : t.yourOrdersHistory}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1 custom-scrollbar">
          
          {/* Member Card — both the card and the "earn points" pitch below it
              are pointless when the restaurant gives no points at all. */}
          {!loyaltyEnabled ? null : member ? (
            <div className="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-xl p-4 text-zinc-900 dark:text-zinc-100 relative overflow-hidden shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <span className="bg-orange-500 text-white text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md">
                    {t.memberTier.replace('{tier}', member.tier)}
                  </span>
                  <h3 className="text-xl font-extrabold mt-2 text-zinc-900">{member.name}</h3>
                  <p className="text-zinc-500 text-xs font-medium">{member.phoneOrEmail}</p>
                </div>

                <div className="text-right">
                  <div className="text-2xl font-black text-orange-600">{member.pointsBalance}</div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">{t.loyaltyPoints}</div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-orange-200 flex justify-between text-xs text-zinc-700 font-medium">
                <span>{t.totalSpent}: <strong>{formatPrice(member.totalSpent)}</strong></span>
                <span>{t.ordersCount}: <strong>{member.ordersCount}</strong></span>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 text-center">
              <Sparkles className="w-8 h-8 text-orange-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{t.enterInfoAtCheckout}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 font-medium">
                {t.earnPointsDesc}
              </p>
            </div>
          )}

          {/* Past Orders List */}
          <div>
            <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-3">
              {t.yourOrdersHistory}
            </h4>

            {orders.length === 0 ? (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center py-6 font-medium">{t.noOrdersRecorded}</p>
            ) : (
              <div className="space-y-3">
                {orders.map((ord) => (
                  <div
                    key={ord.id}
                    className="bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3.5 space-y-2 shadow-sm"
                  >
                    <div className="flex justify-between items-center border-b border-zinc-100 dark:border-zinc-800 pb-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-xs text-zinc-900 dark:text-zinc-100">Order #{ord.id}</span>
                        <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold px-2 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700">
                          {t.table} #{ord.tableNumber}
                        </span>
                      </div>
                      <span className="text-xs font-extrabold text-orange-600 dark:text-orange-400">
                        {formatPrice(ord.totalAmount)}
                      </span>
                    </div>

                    <div className="space-y-1">
                      {ord.items.map((it, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-zinc-700 dark:text-zinc-300 font-medium">
                          <span>{it.quantity}x {it.menuItem.name}</span>
                          <span className="text-zinc-500 dark:text-zinc-400">{formatPrice(it.itemTotal)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 flex justify-between items-center text-[11px] text-zinc-400 font-medium">
                      <span>{new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-green-600 font-bold uppercase">{ord.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};

