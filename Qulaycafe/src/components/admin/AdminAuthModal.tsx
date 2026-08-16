import React, { useEffect, useState } from 'react';
import { Lock, KeyRound, ShieldAlert, X, ChefHat, Phone, Store, Send, MessageCircle } from 'lucide-react';
import { Language, translations } from '../../lib/translations';

interface AdminAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticate: (phone: string, password: string) => Promise<boolean>;
  onRegister?: (name: string, phone: string, password: string, deliveryEnabled: boolean) => Promise<boolean>;
  lang: Language;
  targetView?: 'kitchen' | 'admin';
}

interface RegistrationInfo {
  selfRegistrationEnabled: boolean;
  contactPhone: string | null;
  contactTelegram: string | null;
}

export const AdminAuthModal: React.FC<AdminAuthModalProps> = ({
  isOpen,
  onClose,
  onAuthenticate,
  onRegister,
  lang,
  targetView = 'admin'
}) => {
  const t = translations[lang];
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState<string>('');
  const [restaurantName, setRestaurantName] = useState<string>('');
  const [wantsDelivery, setWantsDelivery] = useState<boolean>(false);
  const [password, setPassword] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [registrationInfo, setRegistrationInfo] = useState<RegistrationInfo | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/registration-info')
      .then(r => (r.ok ? r.json() : null))
      .then(setRegistrationInfo)
      .catch(() => setRegistrationInfo(null));
  }, [isOpen]);

  if (!isOpen) return null;

  const isKitchen = targetView === 'kitchen';
  const canSelfRegister = !!registrationInfo?.selfRegistrationEnabled && !!onRegister;
  const isRegisterMode = mode === 'register' && !isKitchen && canSelfRegister;
  const showContactCard = mode === 'register' && !isKitchen && !canSelfRegister;

  const resetAndClose = () => {
    setPassword('');
    setErrorMsg(null);
    setMode('login');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (isRegisterMode && onRegister) {
        const success = await onRegister(restaurantName, phone, password, wantsDelivery);
        if (success) {
          setPassword('');
          setErrorMsg(null);
        } else {
          setErrorMsg("Bu telefon raqam bilan restoran allaqachon ro'yxatdan o'tgan yoki xatolik yuz berdi.");
        }
        return;
      }
      const success = await onAuthenticate(phone, password);
      if (success) {
        setPassword('');
        setErrorMsg(null);
      } else {
        setErrorMsg(isKitchen ? t.invalidKitchenPin : "Telefon raqam yoki parol xato");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/70 backdrop-blur-md animate-fadeIn">
      <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4 relative overflow-hidden">

        <button
          onClick={resetAndClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-900 p-1.5 rounded-full bg-zinc-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center space-y-2 pt-2">
          <div className="w-12 h-12 bg-orange-50 text-orange-600 border border-orange-200 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
            {isKitchen ? <ChefHat className="w-6 h-6" /> : showContactCard ? <MessageCircle className="w-6 h-6" /> : isRegisterMode ? <Store className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
          </div>
          <h3 className="text-lg font-black text-zinc-900">
            {isKitchen
              ? t.kitchenLoginTitle
              : showContactCard
              ? "Yangi restoran ochish"
              : isRegisterMode
              ? "Yangi restoran ro'yxatdan o'tkazish"
              : t.adminLoginTitle}
          </h3>
          <p className="text-xs text-zinc-500 font-medium px-2 leading-relaxed">
            {isKitchen
              ? t.kitchenLoginDesc
              : showContactCard
              ? "Tizimga ulanish uchun administrator bilan bog'laning — u sizga login va parol beradi."
              : isRegisterMode
              ? "Restoran nomi, telefon raqami va parol kiriting — 14 kunlik bepul sinov muddati bilan boshlaysiz."
              : t.adminLoginDesc}
          </p>
        </div>

        {showContactCard && (
          <div className="space-y-3 pt-2">
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-2.5">
              {registrationInfo?.contactPhone && (
                <a
                  href={`tel:${registrationInfo.contactPhone}`}
                  className="flex items-center space-x-2.5 text-sm font-bold text-zinc-800 hover:text-orange-600 transition-colors"
                >
                  <Phone className="w-4 h-4 text-orange-500 shrink-0" />
                  <span>{registrationInfo.contactPhone}</span>
                </a>
              )}
              {registrationInfo?.contactTelegram && (
                <a
                  href={`https://t.me/${registrationInfo.contactTelegram.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center space-x-2.5 text-sm font-bold text-zinc-800 hover:text-orange-600 transition-colors"
                >
                  <Send className="w-4 h-4 text-orange-500 shrink-0" />
                  <span>@{registrationInfo.contactTelegram.replace(/^@/, '')}</span>
                </a>
              )}
              {!registrationInfo?.contactPhone && !registrationInfo?.contactTelegram && (
                <p className="text-xs text-zinc-500">Administrator kontaktlari hozircha sozlanmagan.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setMode('login')}
              className="w-full text-center text-xs font-bold text-orange-600 hover:text-orange-700 transition-colors"
            >
              Restoranim allaqachon bor — kirish
            </button>
          </div>
        )}

        {!showContactCard && (
        <form onSubmit={handleSubmit} className="space-y-3 pt-2">
          {isRegisterMode && (
            <div>
              <label className="block text-xs font-bold text-zinc-700 mb-1">Restoran nomi</label>
              <div className="relative">
                <Store className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={restaurantName}
                  onChange={(e) => {
                    setRestaurantName(e.target.value);
                    setErrorMsg(null);
                  }}
                  placeholder="Masalan: Old City Restaurant"
                  className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 rounded-xl pl-9 pr-3 py-2.5 text-xs text-zinc-900 outline-none transition-all"
                />
              </div>
            </div>
          )}

          {isRegisterMode && (
            <label className="flex items-start space-x-2.5 bg-zinc-50 border border-zinc-200 rounded-xl p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={wantsDelivery}
                onChange={(e) => setWantsDelivery(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-orange-500"
              />
              <span className="text-xs text-zinc-600 font-medium">
                🛵 Dostavka xizmatini ham yoqish (kuryerlar Telegram orqali buyurtma qabul qiladi)
              </span>
            </label>
          )}

          <div>
            <label className="block text-xs font-bold text-zinc-700 mb-1">Telefon raqam</label>
            <div className="relative">
              <Phone className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="+998901234567"
                className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 rounded-xl pl-9 pr-3 py-2.5 text-xs text-zinc-900 outline-none transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-700 mb-1">
              {isKitchen ? t.kitchenPinLabel : isRegisterMode ? 'Parol yarating' : t.passwordLabel}
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder={isKitchen ? t.kitchenPinPlaceholder : t.passwordPlaceholder}
                className="w-full bg-zinc-50 border border-zinc-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 rounded-xl pl-9 pr-3 py-2.5 text-xs text-zinc-900 outline-none transition-all"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold flex items-center space-x-1.5">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-xs shadow-md shadow-orange-500/20 transition-all"
          >
            {isSubmitting ? '...' : isKitchen ? t.unlockKitchen : isRegisterMode ? "Ro'yxatdan o'tish" : t.unlockAdmin}
          </button>
        </form>
        )}

        {isRegisterMode && (
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg(null);
            }}
            className="w-full text-center text-xs font-bold text-orange-600 hover:text-orange-700 transition-colors"
          >
            Restoranim allaqachon bor — kirish
          </button>
        )}

        {!isKitchen && mode === 'login' && (
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMsg(null);
            }}
            className="w-full text-center text-xs font-bold text-orange-600 hover:text-orange-700 transition-colors"
          >
            Restoranim yo'q — yangi restoran ochish
          </button>
        )}

        <div className="text-center text-[11px] text-zinc-400 font-medium pt-1 border-t border-zinc-100 flex items-center justify-center space-x-1">
          <span>🔒</span>
          <span>{t.securityPrivateNotice || 'Restricted system access. Authorized personnel only.'}</span>
        </div>

      </div>
    </div>
  );
};
