import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Utensils, Sparkles, MapPin, ChevronRight, Check } from 'lucide-react';
import { Language } from '../../lib/translations';

interface WelcomeSplashProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  onSelectLang: (lang: Language) => void;
  branding?: { restaurantName: string | null; contactAddress: string | null; logoUrl: string | null };
}

export const WelcomeSplash: React.FC<WelcomeSplashProps> = ({
  isOpen,
  onClose,
  lang,
  onSelectLang,
  branding
}) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isOpen) return;

    // Auto progress timer for auto-dismiss
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => onClose(), 150);
          return 100;
        }
        return prev + 2.5; // ~2.5s total time
      });
    }, 60);

    return () => clearInterval(interval);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, scale: 1.05 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/90 backdrop-blur-xl p-4 overflow-hidden"
      >
        {/* Glowing Background Decorative Gradients */}
        <div className="absolute -top-32 -left-32 w-80 h-80 bg-orange-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: 25, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          className="relative max-w-sm w-full bg-zinc-900/90 border border-zinc-800 text-white rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6 overflow-hidden"
        >
          {/* Top Badge */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.15, stiffness: 200 }}
            className="inline-flex items-center space-x-1.5 bg-orange-500/10 border border-orange-500/30 text-orange-400 px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-widest"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Digital Dining Experience</span>
          </motion.div>

          {/* Glowing Animated Logo Container */}
          <div className="relative mx-auto w-20 h-20 flex items-center justify-center">
            <motion.div
              animate={{
                scale: [1, 1.15, 1],
                opacity: [0.3, 0.6, 0.3],
              }}
              transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
              className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-orange-500 to-amber-500 blur-md opacity-40"
            />
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="relative w-20 h-20 rounded-3xl bg-gradient-to-tr from-orange-500 to-amber-600 text-white flex items-center justify-center shadow-xl shadow-orange-500/30 border border-orange-400/40 overflow-hidden"
            >
              {branding?.logoUrl ? (
                <img src={branding.logoUrl} alt="Logo" className="w-full h-full object-cover" />
              ) : (
                <Utensils className="w-9 h-9 stroke-[2.2]" />
              )}
            </motion.div>
          </div>

          {/* Title & Location */}
          <div className="space-y-1.5">
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-2xl font-black tracking-tight text-white uppercase"
            >
              {branding?.restaurantName || 'Qulaycafe'}
            </motion.h1>
            {branding?.contactAddress && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-xs text-orange-400 font-bold flex items-center justify-center space-x-1"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>{branding.contactAddress}</span>
              </motion.p>
            )}
          </div>

          {/* Quick Language Selector */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="space-y-2 pt-1"
          >
            <p className="text-[11px] text-zinc-400 font-extrabold uppercase tracking-wider">
              Select Language / Tilni tanlang
            </p>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-zinc-950/60 rounded-2xl border border-zinc-800">
              {(
                [
                  { code: 'uz', label: "O'zbek" },
                  { code: 'ru', label: 'Русский' },
                  { code: 'en', label: 'English' },
                ] as const
              ).map((item) => (
                <button
                  key={item.code}
                  onClick={() => onSelectLang(item.code)}
                  className={`py-2 px-1 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1 ${
                    lang === item.code
                      ? 'bg-orange-500 text-white shadow-xs'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
                  }`}
                >
                  <span>{item.label}</span>
                  {lang === item.code && <Check className="w-3 h-3 stroke-[3]" />}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Enter Button */}
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            onClick={onClose}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-extrabold py-3.5 px-6 rounded-2xl text-xs uppercase tracking-wider shadow-lg shadow-orange-500/25 flex items-center justify-center space-x-2 transition-all cursor-pointer"
          >
            <span>
              {lang === 'uz'
                ? "Menuga o'tish"
                : lang === 'ru'
                ? 'Перейти к меню'
                : 'Explore Menu'}
            </span>
            <ChevronRight className="w-4 h-4 stroke-[3]" />
          </motion.button>

          {/* Auto progress bar */}
          <div className="w-full bg-zinc-800 h-1 rounded-full overflow-hidden mt-4">
            <motion.div
              className="bg-orange-500 h-full rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
