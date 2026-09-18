import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Order } from '../../types';
import { X, Star, Send, CheckCircle2, MessageSquare } from 'lucide-react';
import { Language, translations } from '../../lib/translations';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  lang: Language;
}

/**
 * The face a guest rates their meal through. One card per ordered dish, each
 * with a 1-5 star strip, plus an optional comment that reaches the owner's
 * Telegram even when every star is high.
 *
 * Submission is idempotent-ish by contract: the server refuses a second
 * review for the same order (ALREADY_REVIEWED), and this modal treats that
 * response as success-and-close rather than an error — the guest does not
 * care which attempt actually landed, only that it did.
 */
export const ReviewModal: React.FC<ReviewModalProps> = ({ isOpen, onClose, order, lang }) => {
  const t = translations[lang];
  // One rating per dish id, held as a plain map so re-renders never reshuffle.
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every (re)open and every submit, so a response from a request
  // the guest abandoned (closed mid-send, reopened) can never land in a
  // session it does not belong to — e.g. flipping a fresh modal straight to
  // the thank-you card for a review they never saw go through.
  const submitSeqRef = useRef(0);

  // Fresh state per open — and per order, so reopening with a different
  // ticket never shows the previous meal's stars.
  useEffect(() => {
    if (isOpen) {
      submitSeqRef.current += 1;
      setRatings({});
      setComment('');
      setSubmitting(false);
      setDone(false);
      setError(null);
    }
  }, [isOpen, order?.id]);

  // Same contract as CartDrawer: Escape closes the sheet, and the page behind
  // it stops scrolling while the modal is up — a modal over a scrollable menu
  // otherwise lets the menu slide underneath on touch.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  const dishes = useMemo(() => order?.items ?? [], [order]);
  const allRated = dishes.length > 0 && dishes.every(it => (ratings[it.menuItem.id] || 0) >= 1);

  if (!isOpen || !order) return null;

  const setRating = (menuItemId: string, value: number) => {
    // Tapping the same star again clears it — the standard undo for a fat finger.
    setRatings(prev => ({ ...prev, [menuItemId]: prev[menuItemId] === value ? 0 : value }));
  };

  const handleSubmit = async () => {
    if (!allRated || submitting) return;
    const seq = ++submitSeqRef.current;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          ratings: dishes.map(it => ({ menuItemId: it.menuItem.id, rating: ratings[it.menuItem.id] })),
          comment: comment.trim() || undefined
        })
      });
      if (seq !== submitSeqRef.current) return; // abandoned — a newer open/submit owns the modal
      if (res.ok) {
        setDone(true);
        // Let the guest actually see the thank-you card before the modal goes.
        window.setTimeout(onClose, 1600);
        return;
      }
      const body = await res.json().catch(() => ({} as any));
      if (seq !== submitSeqRef.current) return;
      // Already reviewed (double submit, flaky retry) is a success to the
      // guest: their feedback exists on the server either way.
      if (body?.code === 'ALREADY_REVIEWED') {
        setDone(true);
        window.setTimeout(onClose, 1600);
        return;
      }
      if (body?.code === 'ORDER_NOT_SERVED') {
        setError(t.reviewNotYetError);
      } else {
        setError(t.reviewSubmitError);
      }
    } catch {
      setError(t.reviewSubmitError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/70 dark:bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-2xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden relative">
        {/* Header */}
        <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-orange-50 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 rounded-xl border border-orange-100 dark:border-orange-500/20">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold">{t.reviewTitle}</h2>
              <p className="text-zinc-500 dark:text-zinc-400 text-[11px] font-medium">
                {t.reviewSubtitle.replace('{orderId}', order.id)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 rounded-full transition-colors"
            aria-label={t.bookClose}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <div className="p-8 text-center space-y-3">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
            <p className="text-lg font-extrabold">{t.reviewThanks}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t.reviewThanksSub}</p>
          </div>
        ) : (
          <>
            {/* Dish rating list */}
            <div className="p-5 overflow-y-auto space-y-3 flex-1 custom-scrollbar">
              {dishes.map(it => {
                const value = ratings[it.menuItem.id] || 0;
                return (
                  <div
                    key={it.menuItem.id}
                    className="bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black truncate">
                          {it.quantity}x {it.menuItem.name}
                        </p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {value >= 1 ? reviewLabel(value, t) : t.reviewRatePrompt}
                        </p>
                      </div>
                      <div className="flex items-center shrink-0" role="radiogroup" aria-label={t.reviewTitle}>
                        {[1, 2, 3, 4, 5].map(star => (
                          <button
                            key={star}
                            type="button"
                            role="radio"
                            aria-checked={value === star}
                            aria-label={`${star}`}
                            onClick={() => setRating(it.menuItem.id, star)}
                            className="p-0.5 transition-transform active:scale-90 focus:outline-none"
                          >
                            <Star
                              className={`w-6 h-6 transition-colors ${
                                star <= value
                                  ? 'text-amber-400 fill-amber-400'
                                  : 'text-zinc-300 dark:text-zinc-600'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Optional comment */}
              <div>
                <label
                  htmlFor="review-comment"
                  className="block text-[10px] font-extrabold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5"
                >
                  {t.reviewCommentLabel}
                </label>
                <textarea
                  id="review-comment"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder={t.reviewCommentPlaceholder}
                  className="w-full bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
                />
              </div>

              {error && <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 text-center">{error}</p>}
            </div>

            {/* Submit */}
            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={handleSubmit}
                disabled={!allRated || submitting}
                className={`w-full font-bold py-3 rounded-xl flex items-center justify-center space-x-2 transition-all text-sm ${
                  allRated && !submitting
                    ? 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/20 active:scale-[0.99]'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed'
                }`}
              >
                <Send className="w-4 h-4" />
                <span>{submitting ? t.reviewSending : t.reviewSubmit}</span>
              </button>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 text-center mt-2 font-medium">
                {t.reviewAnonymityNote}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/** Localized word for the star count a guest just tapped. */
function reviewLabel(value: number, t: (typeof translations)['uz']): string {
  switch (value) {
    case 1:
      return t.reviewLabel1;
    case 2:
      return t.reviewLabel2;
    case 3:
      return t.reviewLabel3;
    case 4:
      return t.reviewLabel4;
    default:
      return t.reviewLabel5;
  }
}
