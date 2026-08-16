import React, { useState } from 'react';
import { GoogleUser } from '../types';
import { Utensils, QrCode, MapPin, UserCheck, Menu, X, Phone, Instagram, ReceiptText } from 'lucide-react';
import { Language, translations } from '../lib/translations';

// Guest-facing header. It deliberately has NO notion of an app "view": the
// kitchen and admin surfaces live on their own hostnames
// (kitchen./admin.qulaycafe.uz) and have their own chrome, so there is
// nothing here for a guest to switch to, lock, or discover.
interface HeaderNavProps {
  tableNumber: number | null;
  onOpenQRScanner: () => void;
  onOpenLocation: () => void;
  onOpenGoogleAuth: () => void;
  googleUser: GoogleUser | null;
  cartCount: number;
  onOpenCart: () => void;
  onOpenOrderHistory?: () => void;
  loyaltyPoints?: number;
  /** False when the restaurant's points program is switched off — the menu
      entry stays (it is also the order history), the points wording goes. */
  loyaltyEnabled?: boolean;
  lang: Language;
  onLanguageChange: (lang: Language) => void;
  showTableTools?: boolean;
  branding?: {
    restaurantName: string | null;
    contactPhone: string | null;
    contactAddress: string | null;
    contactInstagram: string | null;
  };
}

export const HeaderNav: React.FC<HeaderNavProps> = ({
  tableNumber,
  onOpenQRScanner,
  onOpenLocation,
  onOpenGoogleAuth,
  googleUser,
  cartCount,
  onOpenCart,
  onOpenOrderHistory,
  loyaltyPoints,
  loyaltyEnabled = true,
  lang,
  onLanguageChange,
  showTableTools = true,
  branding
}) => {
  const t = translations[lang];
  const displayName = branding?.restaurantName || 'Qulaycafe';
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md text-zinc-900 border-b border-zinc-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16 gap-1.5 sm:gap-2">

            {/* Top Left: Hamburger 3-Dashes Menu + Logo */}
            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 text-zinc-700 hover:text-zinc-900 bg-zinc-100 hover:bg-zinc-200 rounded-xl transition-colors border border-zinc-200/80 shrink-0"
                title={t.navMenu}
                aria-label={t.navMenu}
                aria-expanded={isMobileMenuOpen}
              >
                {isMobileMenuOpen ? <X className="w-5 h-5 text-zinc-900" /> : <Menu className="w-5 h-5 text-zinc-900" />}
              </button>

              <div className="flex items-center space-x-1.5 text-left">
                <div className="w-7 h-7 sm:w-8 sm:h-8 bg-orange-500 rounded-lg sm:rounded-xl flex items-center justify-center text-white font-bold shadow-xs shrink-0 overflow-hidden">
                  <Utensils className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                </div>
                <div className="hidden min-[380px]:block">
                  <span className="font-black text-xs sm:text-sm tracking-tight text-zinc-900 uppercase truncate max-w-[140px] sm:max-w-none block">
                    {displayName}
                  </span>
                </div>
              </div>
            </div>

            {/* Right Action Items */}
            <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">

              {/* Location & Contact Button */}
              <button
                onClick={onOpenLocation}
                className="bg-orange-50 hover:bg-orange-100 text-orange-900 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg sm:rounded-xl border border-orange-200 text-xs font-bold flex items-center space-x-1 transition-colors shrink-0"
                title={t.locationAndContact}
                aria-label={t.locationAndContact}
              >
                <MapPin className="w-3.5 h-3.5 shrink-0 text-orange-500" />
              </button>

              {/* Google OAuth Login Button / Profile Badge */}
              <button
                onClick={onOpenGoogleAuth}
                className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg sm:rounded-xl border text-xs font-extrabold flex items-center space-x-1.5 transition-all shadow-xs shrink-0 ${
                  googleUser
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100'
                    : 'bg-white hover:bg-zinc-50 border-zinc-200 text-zinc-800'
                }`}
                title={googleUser ? `Gmail: ${googleUser.email}` : t.googleSignIn}
              >
                {googleUser ? (
                  <>
                    {googleUser.picture ? (
                      <img src={googleUser.picture} alt="" className="w-4 h-4 rounded-full border border-emerald-400 shrink-0" />
                    ) : (
                      <UserCheck className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                    )}
                    <span className="hidden sm:inline text-[11px] font-bold max-w-[80px] truncate">{googleUser.givenName || googleUser.name}</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.37 24 12 24z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.15 0 9.99 0 12s.45 3.85 1.24 5.42l4.04-3.15z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                      />
                    </svg>
                    <span className="hidden sm:inline text-[11px]">Gmail</span>
                  </>
                )}
              </button>

              {/* Language Switcher Buttons (Desktop) */}
              <div className="hidden sm:flex items-center bg-zinc-100 p-0.5 rounded-lg border border-zinc-200 shrink-0">
                {(['uz', 'ru', 'en'] as Language[]).map(code => (
                  <button
                    key={code}
                    onClick={() => onLanguageChange(code)}
                    className={`px-1.5 py-0.5 text-[10px] font-extrabold rounded-md transition-colors ${
                      lang === code ? 'bg-orange-500 text-white' : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                    title={code === 'uz' ? "O'zbekcha" : code === 'ru' ? 'Русский' : 'English'}
                    aria-pressed={lang === code}
                  >
                    {code.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Cart Button */}
              <button
                onClick={onOpenCart}
                className="relative bg-orange-500 hover:bg-orange-600 text-white font-bold p-1.5 sm:px-3 sm:py-1.5 rounded-lg sm:rounded-xl text-xs flex items-center space-x-1 shadow-md shadow-orange-500/20 transition-all transform active:scale-95 shrink-0"
                aria-label={t.cart}
              >
                <Utensils className="w-3.5 h-3.5 shrink-0" />
                {cartCount > 0 && (
                  <span className="bg-white text-orange-600 font-black text-[10px] px-1.5 rounded-full">
                    {cartCount}
                  </span>
                )}
              </button>

            </div>

          </div>
        </div>
      </header>

      {/* Slide-out Mobile Navigation Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex animate-fadeIn">
          {/* Overlay backdrop */}
          <div
            className="fixed inset-0 bg-zinc-900/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />

          {/* Drawer Sidebar Content */}
          <div className="relative w-full max-w-xs bg-white h-full shadow-2xl flex flex-col justify-between p-5 overflow-y-auto animate-slideRight">

            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
                <div className="flex items-center space-x-2.5 overflow-hidden">
                  <div className="w-9 h-9 bg-orange-500 text-white rounded-2xl flex items-center justify-center font-black text-base shadow-sm shrink-0">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="overflow-hidden">
                    <h2 className="font-extrabold text-base text-zinc-900 leading-tight uppercase truncate">{displayName}</h2>
                    {branding?.contactAddress && (
                      <p className="text-[11px] text-orange-600 font-bold truncate">{branding.contactAddress}</p>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-800 bg-zinc-100 rounded-full transition-colors shrink-0"
                  aria-label={t.bookClose}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Language Switcher Section */}
              <div className="space-y-2">
                <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider block">Language / Tillar</span>
                <div className="grid grid-cols-3 gap-1.5 bg-zinc-100 p-1 rounded-xl border border-zinc-200">
                  {([
                    ['uz', "🇺🇿 O'zbek"],
                    ['ru', '🇷🇺 Русский'],
                    ['en', '🇬🇧 English']
                  ] as [Language, string][]).map(([code, label]) => (
                    <button
                      key={code}
                      onClick={() => onLanguageChange(code)}
                      className={`py-1.5 text-xs font-black rounded-lg transition-all ${
                        lang === code ? 'bg-orange-500 text-white shadow-xs' : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                      aria-pressed={lang === code}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Gmail / Google Account Card */}
              <div className="space-y-2">
                <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider block">{t.googleSignIn}</span>
                <button
                  onClick={() => {
                    onOpenGoogleAuth();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 p-3 rounded-2xl flex items-center justify-between text-left transition-colors"
                >
                  <div className="flex items-center space-x-3 overflow-hidden">
                    {googleUser ? (
                      googleUser.picture ? (
                        <img src={googleUser.picture} alt="" className="w-9 h-9 rounded-full border-2 border-emerald-500 shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-emerald-500 text-white font-bold flex items-center justify-center shrink-0">
                          {googleUser.name.charAt(0)}
                        </div>
                      )
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-white border border-zinc-200 flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.37 24 12 24z" />
                          <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.15 0 9.99 0 12s.45 3.85 1.24 5.42l4.04-3.15z" />
                          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                        </svg>
                      </div>
                    )}
                    <div className="overflow-hidden">
                      <span className="text-xs font-black text-zinc-900 block truncate">
                        {googleUser ? googleUser.name : t.googleSignIn}
                      </span>
                      {/* The sub-label only ever advertised the points program,
                          so it goes when that program is switched off. */}
                      {(googleUser || loyaltyEnabled) && (
                        <span className="text-[11px] text-zinc-500 font-medium block truncate">
                          {googleUser ? googleUser.email : t.loyalty}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="text-xs font-bold text-orange-600 shrink-0">
                    {googleUser ? '⚙' : '→'}
                  </span>
                </button>
              </div>

              {/* Own order history + loyalty balance. Previously this modal
                  had no entry point anywhere in the guest UI. */}
              {onOpenOrderHistory && (
                <button
                  onClick={() => {
                    onOpenOrderHistory();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 p-3 rounded-2xl flex items-center justify-between text-left transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-xl bg-zinc-800 text-orange-400">
                      <ReceiptText className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-black text-zinc-900 block">{t.myOrders}</span>
                      {loyaltyEnabled && (
                        <span className="text-[11px] text-zinc-500 block">
                          {typeof loyaltyPoints === 'number' ? `${loyaltyPoints} ${t.points}` : t.loyalty}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )}

              {/* Table QR Selector — dine-in only; a delivery guest has no table */}
              {showTableTools && (
                <div className="space-y-2">
                  <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider block">{t.table}</span>
                  <button
                    onClick={() => {
                      onOpenQRScanner();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full bg-orange-50 hover:bg-orange-100 border border-orange-200/90 p-3 rounded-2xl flex items-center justify-between text-left transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="p-2 rounded-xl bg-orange-500 text-white">
                        <QrCode className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-xs font-black text-orange-950 block">{t.table} #{tableNumber || 1}</span>
                        <span className="text-[11px] text-orange-800 font-medium block">{t.scanQR}</span>
                      </div>
                    </div>
                  </button>
                </div>
              )}

              {/* Location & Contact Info */}
              <div className="space-y-2">
                <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider block">{displayName} — {t.locationAndContact}</span>

                <button
                  onClick={() => {
                    onOpenLocation();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 p-3 rounded-2xl flex items-center justify-between transition-colors text-left"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-xl bg-zinc-800 text-orange-400">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-black text-zinc-900 block">{branding?.contactAddress || t.locationAndContact}</span>
                      <span className="text-[11px] text-zinc-500 block">{t.openInMaps}</span>
                    </div>
                  </div>
                </button>

                {(branding?.contactPhone || branding?.contactInstagram) && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {branding?.contactPhone && (
                      <a
                        href={`tel:${branding.contactPhone}`}
                        className="p-2.5 bg-zinc-50 hover:bg-orange-50 border border-zinc-200 rounded-xl flex items-center space-x-2 text-xs font-bold text-zinc-800 transition-colors"
                      >
                        <Phone className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        <span className="truncate">{branding.contactPhone}</span>
                      </a>
                    )}
                    {branding?.contactInstagram && (
                      <a
                        href={`https://instagram.com/${branding.contactInstagram.replace(/^@/, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2.5 bg-zinc-50 hover:bg-pink-50 border border-zinc-200 rounded-xl flex items-center space-x-2 text-xs font-bold text-zinc-800 transition-colors"
                      >
                        <Instagram className="w-3.5 h-3.5 text-pink-600 shrink-0" />
                        <span className="truncate">Instagram</span>
                      </a>
                    )}
                  </div>
                )}
              </div>

            </div>

            {/* Bottom Footer */}
            <div className="pt-4 border-t border-zinc-100 text-center space-y-1">
              <p className="text-[11px] font-extrabold text-zinc-800">{displayName}{branding?.contactAddress ? ` • ${branding.contactAddress}` : ''}</p>
              <p className="text-[10px] text-zinc-400">Qulaycafe orqali ishlaydi</p>
            </div>

          </div>
        </div>
      )}
    </>
  );
};
