import React, { useEffect, useState } from 'react';
import {
  X,
  CalendarDays,
  Clock,
  Users,
  User,
  Phone,
  MessageSquare,
  CheckCircle2,
  Copy,
  Check,
  Send,
  Loader2,
  Utensils
} from 'lucide-react';
import { Language, translations } from '../../lib/translations';

// ---------------------------------------------------------------------------
// Table booking for guests who do NOT use the Telegram bot — the tourist with
// no Uzbek, the walk-by who scanned a QR, anyone who just wants a table
// without installing anything. Same reservations table, same admin queue, same
// confirm/decline flow as the bot: only `source: 'web'` differs server-side.
//
// There is no account and no login here. A booking is identified by the opaque
// token the server hands back, which the app remembers in localStorage and can
// also be carried in a /book/<slug>?b=<token> link, so the guest can reopen
// their booking (and cancel it) from the same phone or another one.
// ---------------------------------------------------------------------------

// The restaurant's own clock. The server books against a fixed UTC+5 (see
// RESERVATION_UTC_OFFSET_HOURS) so a guest whose phone is set to another
// timezone still gets offered the slots the restaurant actually means, and
// client-side validation agrees with the server's.
const RESTAURANT_UTC_OFFSET_HOURS = 5;
const BOOKING_HORIZON_DAYS = 60;

function restaurantNow(): Date {
  return new Date(Date.now() + RESTAURANT_UTC_OFFSET_HOURS * 3600_000);
}

/** YYYY-MM-DD of an already offset-shifted date (read as UTC on purpose). */
function isoDay(shifted: Date): string {
  return shifted.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nowHHMM(): string {
  return restaurantNow().toISOString().slice(11, 16);
}

// Half-hour slots across a normal service day. A guest who wants something
// outside these taps "other time" and types it — the server is the authority
// on what it accepts, this list is only a shortcut.
const SLOT_TIMES: string[] = (() => {
  const out: string[] = [];
  for (let minutes = 9 * 60; minutes <= 23 * 60; minutes += 30) {
    out.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  return out;
})();

const PARTY_CHIPS = [1, 2, 3, 4, 5, 6, 8];

interface Booking {
  token: string;
  code: string;
  status: string;
  reservedDate: string;
  reservedTime: string;
  partySize: number;
  guestName: string;
  tableNumber: number | null;
  restaurantName: string | null;
  telegramDeepLink: string | null;
  telegramLinked?: boolean;
  canCancel?: boolean;
  note?: string | null;
}

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  brandColor?: string | null;
  restaurantName?: string | null;
  /** Slug behind /book/<slug>, used to build the guest's shareable status link. */
  bookingSlug?: string | null;
  /** An existing booking's token (remembered locally, or from ?b=). */
  initialToken?: string | null;
  onTokenIssued?: (token: string) => void;
  /** Called when a remembered token turns out to be unknown to the server. */
  onTokenInvalid?: () => void;
  /** Only passed on the standalone /book/<slug> page, where there is no menu behind the modal. */
  onViewMenu?: () => void;
}

export const ReservationModal: React.FC<ReservationModalProps> = ({
  isOpen,
  onClose,
  lang,
  brandColor,
  restaurantName,
  bookingSlug,
  initialToken,
  onTokenIssued,
  onTokenInvalid,
  onViewMenu
}) => {
  const t = translations[lang];
  const accentColor = brandColor || '#f97316';

  const today = isoDay(restaurantNow());
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [customTime, setCustomTime] = useState(false);
  const [partySize, setPartySize] = useState(2);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [note, setNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loadingBooking, setLoadingBooking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reopening an existing booking: the token is all the server needs, and it
  // travels in a POST body so it never lands in an access log.
  useEffect(() => {
    if (!isOpen || !initialToken || booking) return;
    let cancelled = false;
    setLoadingBooking(true);
    fetch('/api/reservations/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: initialToken })
    })
      .then(async res => {
        if (cancelled) return;
        if (res.status === 404) {
          // The remembered token points at nothing (wrong link, or a booking
          // the restaurant purged) — forget it and show a blank form.
          setError(t.bookNotFound);
          onTokenInvalid?.();
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        setBooking({ ...data, token: initialToken });
      })
      .catch(() => {
        /* offline: the blank form is still usable */
      })
      .finally(() => {
        if (!cancelled) setLoadingBooking(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialToken]);

  if (!isOpen) return null;

  const maxDate = addDaysIso(today, BOOKING_HORIZON_DAYS);
  const isToday = date === today;
  // Slots that have already passed are hidden rather than shown-and-rejected.
  const slots = isToday ? SLOT_TIMES.filter(slot => slot > nowHHMM()) : SLOT_TIMES;

  const statusLabels: Record<string, string> = {
    pending: t.reservationStatusPending,
    confirmed: t.reservationStatusConfirmed,
    declined: t.reservationStatusDeclined,
    cancelled: t.reservationStatusCancelled,
    seated: t.reservationStatusSeated,
    no_show: t.reservationStatusNoShow
  };

  const shareLink = bookingSlug && booking ? `${window.location.origin}/book/${bookingSlug}?b=${booking.token}` : null;

  const dayChips = [
    { value: today, label: t.bookToday },
    { value: addDaysIso(today, 1), label: t.bookTomorrow },
    {
      value: addDaysIso(today, 2),
      label: new Date(`${addDaysIso(today, 2)}T00:00:00Z`).toLocaleDateString(
        lang === 'uz' ? 'uz-UZ' : lang === 'ru' ? 'ru-RU' : 'en-GB',
        { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }
      )
    }
  ];

  const errorForResponse = (status: number, body: { error?: string; code?: string }): string => {
    if (status === 403) return t.bookErrDisabled;
    if (body.code === 'DUPLICATE_RESERVATION') return t.bookErrDuplicate;
    if (body.code === 'TOO_MANY_OPEN_RESERVATIONS') return t.bookErrTooManyOpen;
    if (body.code === 'DAILY_LIMIT_REACHED') return t.bookErrDailyLimit;
    if (status === 429) return t.bookErrDailyLimit;
    return body.error || t.bookFailed;
  };

  const handleSubmit = async () => {
    setError(null);
    if (!date || !time) {
      setError(t.bookPickDateTime);
      return;
    }
    if (guestName.trim().length < 2) {
      setError(t.bookNameRequired);
      return;
    }
    const normalizedPhone = guestPhone.replace(/[\s()\-.]/g, '');
    if (!/^\+?[0-9]{7,15}$/.test(normalizedPhone)) {
      setError(t.bookPhoneInvalid);
      return;
    }
    if (date > maxDate) {
      setError(t.bookErrTooFar);
      return;
    }
    if (date < today || (isToday && time <= nowHHMM())) {
      setError(t.bookErrPastTime);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservedDate: date,
          reservedTime: time,
          partySize,
          guestName: guestName.trim(),
          guestPhone: normalizedPhone,
          note: note.trim() || undefined
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorForResponse(res.status, body));
        return;
      }
      setBooking({ ...body, canCancel: true, telegramLinked: false });
      onTokenIssued?.(body.token);
    } catch {
      setError(t.bookFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelBooking = async () => {
    if (!booking) return;
    setError(null);
    setCancelling(true);
    try {
      const res = await fetch('/api/reservations/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: booking.token })
      });
      if (!res.ok) {
        setError(t.bookCancelFailed);
        return;
      }
      const body = await res.json();
      setBooking({ ...booking, status: body.status || 'cancelled', canCancel: false });
    } catch {
      setError(t.bookCancelFailed);
    } finally {
      setCancelling(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (http, old in-app browser) — the link is still visible on screen */
    }
  };

  const startNewBooking = () => {
    setBooking(null);
    setError(null);
    setTime('');
    setNote('');
    setDate(today);
  };

  const inputClass =
    'w-full bg-white border border-zinc-200 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5 rounded-xl px-3 py-2.5 text-sm text-zinc-900 outline-none font-semibold';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white border border-zinc-200 text-zinc-900 rounded-t-3xl sm:rounded-3xl max-w-md w-full shadow-2xl overflow-hidden relative max-h-[92vh] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 pb-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-md"
              style={{ backgroundColor: accentColor, boxShadow: `0 6px 16px -6px ${accentColor}` }}
            >
              <CalendarDays className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-extrabold text-zinc-900 truncate">
                {booking ? t.bookMyBooking : t.bookTable}
              </h3>
              <p className="text-xs text-zinc-500 font-medium truncate">
                {booking?.restaurantName || restaurantName || t.bookTableSub}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t.bookClose}
            className="p-2 text-zinc-400 hover:text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-full transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loadingBooking && !booking ? (
          <div className="p-10 flex items-center justify-center text-zinc-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : booking ? (
          /* ---------- Booking status view ---------- */
          <div className="p-5 space-y-4">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-center space-y-3">
              {booking.status === 'pending' || booking.status === 'confirmed' ? (
                <CheckCircle2 className="w-10 h-10 mx-auto" style={{ color: accentColor }} />
              ) : null}
              <div>
                <p className="text-sm font-extrabold text-zinc-900">
                  {booking.status === 'pending' ? t.bookSuccessTitle : statusLabels[booking.status] || booking.status}
                </p>
                {booking.status === 'pending' && (
                  <p className="text-xs text-zinc-500 font-medium mt-0.5">{t.bookSuccessBody}</p>
                )}
              </div>
              <div className="inline-flex items-baseline gap-2 bg-white border border-zinc-200 rounded-xl px-4 py-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">{t.bookCode}</span>
                <span className="text-lg font-black tracking-widest text-zinc-900">{booking.code}</span>
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200 divide-y divide-zinc-100 text-sm">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-zinc-500 font-medium">{t.bookDate}</span>
                <span className="font-bold text-zinc-900">{booking.reservedDate}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-zinc-500 font-medium">{t.bookTime}</span>
                <span className="font-bold text-zinc-900">{booking.reservedTime}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-zinc-500 font-medium">{t.bookGuests}</span>
                <span className="font-bold text-zinc-900">{booking.partySize}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-zinc-500 font-medium">{t.bookName}</span>
                <span className="font-bold text-zinc-900 truncate max-w-[60%]">{booking.guestName}</span>
              </div>
              {booking.tableNumber ? (
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-zinc-500 font-medium">{t.table}</span>
                  <span className="font-bold text-zinc-900">{booking.tableNumber}</span>
                </div>
              ) : null}
            </div>

            {error && (
              <p className="text-xs text-red-600 font-bold bg-red-50 border border-red-200 rounded-xl p-2.5">{error}</p>
            )}

            {/* Optional: attach Telegram so the confirm/decline arrives as a push
                message instead of the guest having to reopen this page. */}
            {booking.telegramDeepLink && !booking.telegramLinked && (
              <a
                href={booking.telegramDeepLink}
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white font-extrabold py-3 rounded-xl text-sm transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>{t.bookGetTelegram}</span>
              </a>
            )}

            {shareLink && (
              <button
                onClick={handleCopyLink}
                className="w-full flex items-center justify-center gap-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-extrabold py-3 rounded-xl text-sm transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? t.bookLinkCopied : t.bookCopyLink}</span>
              </button>
            )}

            {booking.canCancel && booking.status !== 'cancelled' ? (
              <button
                onClick={handleCancelBooking}
                disabled={cancelling}
                className="w-full flex items-center justify-center gap-2 border border-red-200 text-red-600 hover:bg-red-50 font-extrabold py-3 rounded-xl text-sm transition-colors disabled:opacity-60"
              >
                {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>{t.bookCancelBooking}</span>
              </button>
            ) : booking.status === 'cancelled' ? (
              <p className="text-xs text-zinc-500 font-semibold text-center">{t.bookCancelConfirmed}</p>
            ) : null}

            <div className="flex gap-2">
              <button
                onClick={startNewBooking}
                className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-white font-extrabold py-3 rounded-xl text-sm transition-colors"
              >
                {t.bookNewBooking}
              </button>
              {onViewMenu && (
                <button
                  onClick={onViewMenu}
                  className="flex-1 flex items-center justify-center gap-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-extrabold py-3 rounded-xl text-sm transition-colors"
                >
                  <Utensils className="w-4 h-4" />
                  <span>{t.bookViewMenu}</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          /* ---------- Booking form ---------- */
          <div className="p-5 space-y-4">
            {/* Date */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                <CalendarDays className="w-3.5 h-3.5" />
                {t.bookDate}
              </label>
              <div className="flex flex-wrap gap-2">
                {dayChips.map(chip => (
                  <button
                    key={chip.value}
                    onClick={() => {
                      setDate(chip.value);
                      setTime('');
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                      date === chip.value ? 'text-white border-transparent' : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                    }`}
                    style={date === chip.value ? { backgroundColor: accentColor } : undefined}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={date}
                min={today}
                max={maxDate}
                onChange={e => {
                  setDate(e.target.value);
                  setTime('');
                }}
                className={inputClass}
              />
            </div>

            {/* Time */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                <Clock className="w-3.5 h-3.5" />
                {t.bookTime}
              </label>
              {!customTime && slots.length === 0 && (
                <p className="text-xs text-zinc-500 font-semibold">{t.bookNoSlotsToday}</p>
              )}
              {!customTime && slots.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {slots.map(slot => (
                    <button
                      key={slot}
                      onClick={() => setTime(slot)}
                      className={`py-2 rounded-xl text-xs font-bold border transition-colors ${
                        time === slot ? 'text-white border-transparent' : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                      }`}
                      style={time === slot ? { backgroundColor: accentColor } : undefined}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              )}
              {customTime ? (
                <input type="time" value={time} onChange={e => setTime(e.target.value)} className={inputClass} />
              ) : (
                <button
                  onClick={() => setCustomTime(true)}
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
                >
                  {t.bookOtherTime}
                </button>
              )}
            </div>
            {/* Party size */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                <Users className="w-3.5 h-3.5" />
                {t.bookGuests}
              </label>
              <div className="flex flex-wrap gap-2">
                {PARTY_CHIPS.map(size => (
                  <button
                    key={size}
                    onClick={() => setPartySize(size)}
                    className={`w-10 h-10 rounded-xl text-xs font-bold border transition-colors ${
                      partySize === size ? 'text-white border-transparent' : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                    }`}
                    style={partySize === size ? { backgroundColor: accentColor } : undefined}
                  >
                    {size}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={partySize}
                  onChange={e => setPartySize(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  className="w-16 bg-white border border-zinc-200 focus:border-zinc-400 rounded-xl px-2 py-2 text-sm text-center text-zinc-900 outline-none font-bold"
                  aria-label={t.bookGuests}
                />
              </div>
            </div>

            {/* Guest */}
            <div className="space-y-3">
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1">
                  <User className="w-3.5 h-3.5" />
                  {t.bookName}
                </label>
                <input
                  type="text"
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  maxLength={80}
                  className={inputClass}
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1">
                  <Phone className="w-3.5 h-3.5" />
                  {t.bookPhone}
                </label>
                <input
                  type="tel"
                  value={guestPhone}
                  onChange={e => setGuestPhone(e.target.value)}
                  placeholder="+998 90 123 45 67"
                  maxLength={20}
                  className={inputClass}
                  autoComplete="tel"
                />
                <p className="text-[11px] text-zinc-400 font-medium mt-1">{t.bookPhoneHint}</p>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {t.bookNote}
                </label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder={t.bookNotePlaceholder}
                  className={`${inputClass} resize-none`}
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-600 font-bold bg-red-50 border border-red-200 rounded-xl p-2.5">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 text-white font-extrabold py-3.5 rounded-xl text-sm transition-opacity disabled:opacity-60"
              style={{ backgroundColor: accentColor }}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{submitting ? t.bookSending : t.bookSubmit}</span>
            </button>

            {onViewMenu && (
              <button
                onClick={onViewMenu}
                className="w-full flex items-center justify-center gap-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-extrabold py-3 rounded-xl text-sm transition-colors"
              >
                <Utensils className="w-4 h-4" />
                <span>{t.bookViewMenu}</span>
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
