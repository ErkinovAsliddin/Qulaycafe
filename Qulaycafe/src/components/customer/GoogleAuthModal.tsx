import React, { useState, useEffect, useRef } from 'react';
import { GoogleUser } from '../../types';
import { X, CheckCircle2, ShieldCheck, LogOut, Sparkles, Phone, User, ArrowRight } from 'lucide-react';
import { Language, translations } from '../../lib/translations';

declare global {
  interface Window {
    google?: any;
  }
}

interface GoogleAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: GoogleUser | null;
  onSignInSuccess: (user: GoogleUser) => void;
  onSignOut: () => void;
  lang: Language;
}

export const GoogleAuthModal: React.FC<GoogleAuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onSignInSuccess,
  onSignOut,
  lang
}) => {
  const t = translations[lang];
  const [authMethod, setAuthMethod] = useState<'google' | 'phone'>('google');
  const [phoneName, setPhoneName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  // Real Google Sign-In: verified server-side, not something a customer can
  // fake by typing an email into a text box (see server.ts /api/auth/google/verify).
  const handleCredentialResponse = async (response: { credential: string }) => {
    setErrorMsg(null);
    try {
      const res = await fetch('/api/auth/google/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error || 'Could not verify your Google sign-in. Please try again.');
        return;
      }
      const verifiedUser: GoogleUser = await res.json();
      onSignInSuccess(verifiedUser);
      onClose();
    } catch {
      setErrorMsg('Could not reach the server to verify sign-in.');
    }
  };

  useEffect(() => {
    if (!isOpen || authMethod !== 'google' || currentUser) return;

    let cancelled = false;

    const setup = async () => {
      try {
        const configRes = await fetch('/api/auth/google/config');
        const config = await configRes.json();
        if (cancelled) return;
        setGoogleConfigured(!!config.configured);
        if (!config.configured) return;

        if (!window.google) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Google script'));
            document.head.appendChild(script);
          });
        }
        if (cancelled || !window.google) return;

        window.google.accounts.id.initialize({
          client_id: config.clientId,
          callback: handleCredentialResponse,
          use_fedcm_for_prompt: true,
          ux_mode: 'popup',
          itp_support: true
        });
        if (googleButtonRef.current) {
          window.google.accounts.id.renderButton(googleButtonRef.current, {
            theme: 'outline',
            size: 'large',
            width: 320,
            text: 'signin_with'
          });
        }
        setGoogleReady(true);
      } catch {
        setErrorMsg('Could not load Google Sign-In. Please try again or use a phone number instead.');
      }
    };

    setup();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, authMethod, currentUser]);

  if (!isOpen) return null;

  const handlePhoneSignIn = () => {
    setErrorMsg(null);
    if (!phoneName.trim()) {
      setErrorMsg('Please enter your full name');
      return;
    }
    if (phoneNumber.replace(/\D/g, '').length < 7) {
      setErrorMsg('Please enter a valid phone number');
      return;
    }

    const signedInUser: GoogleUser = {
      id: 'phone-' + Date.now(),
      email: `${phoneNumber.replace(/\D/g, '')}@phone.prime`,
      phone: phoneNumber,
      name: phoneName.trim(),
      picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(phoneName)}&background=10b981&color=fff`,
      givenName: phoneName.trim().split(' ')[0]
    };

    onSignInSuccess(signedInUser);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white border border-zinc-200 text-zinc-900 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden relative p-6 space-y-5 max-h-[90vh] overflow-y-auto custom-scrollbar">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-2xl bg-orange-500 text-white flex items-center justify-center shadow-md shadow-orange-500/20 shrink-0 font-black">
              P
            </div>
            <div>
              <h3 className="text-base font-extrabold text-zinc-900">Sign In to Prime</h3>
              <p className="text-xs text-zinc-500 font-medium">Google OAuth & Phone Authentication</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-full transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Signed In User View */}
        {currentUser ? (
          <div className="bg-zinc-50 border border-zinc-200/90 rounded-2xl p-5 text-center space-y-4">
            <div className="relative inline-block">
              {currentUser.picture ? (
                <img
                  src={currentUser.picture}
                  alt={currentUser.name}
                  className="w-16 h-16 rounded-full mx-auto border-2 border-orange-500 shadow-sm"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-orange-500 text-white font-black text-2xl flex items-center justify-center mx-auto shadow-sm">
                  {currentUser.name.charAt(0)}
                </div>
              )}
              <div className="absolute bottom-0 right-0 bg-green-500 text-white p-1 rounded-full border-2 border-white shadow-xs">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-center space-x-1.5 text-zinc-900 font-extrabold text-base">
                <span>{currentUser.name}</span>
                <ShieldCheck className="w-4 h-4 text-orange-500" />
              </div>
              <p className="text-xs text-zinc-500 font-mono mt-0.5">{currentUser.phone || currentUser.email}</p>
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center justify-center space-x-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>{t.signedInAs}</span>
            </div>

            <button
              onClick={() => {
                onSignOut();
                onClose();
              }}
              className="w-full bg-zinc-200 hover:bg-zinc-300 text-zinc-800 font-extrabold py-2.5 rounded-xl text-xs flex items-center justify-center space-x-2 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>{t.googleSignOut}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Auth Method Toggle Tabs */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-100 rounded-2xl border border-zinc-200">
              <button
                onClick={() => {
                  setAuthMethod('google');
                  setErrorMsg(null);
                }}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 ${
                  authMethod === 'google'
                    ? 'bg-white text-zinc-900 shadow-xs border border-zinc-200/80'
                    : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.37 24 12 24z"/>
                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.15 0 9.99 0 12s.45 3.85 1.24 5.42l4.04-3.15z"/>
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                </svg>
                <span>Google OAuth</span>
              </button>

              <button
                onClick={() => {
                  setAuthMethod('phone');
                  setErrorMsg(null);
                }}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 ${
                  authMethod === 'phone'
                    ? 'bg-white text-zinc-900 shadow-xs border border-zinc-200/80'
                    : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <Phone className="w-3.5 h-3.5 text-emerald-600" />
                <span>Phone Number</span>
              </button>
            </div>

            {/* Google OAuth Tab Content */}
            {authMethod === 'google' ? (
              <div className="space-y-3.5">
                {googleConfigured === false ? (
                  <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 p-3 rounded-xl text-center">
                    Google Sign-In isn't set up yet for this restaurant. Please use a phone number to continue, or ask staff for help.
                  </p>
                ) : (
                  <div className="flex justify-center min-h-[44px]">
                    <div ref={googleButtonRef} />
                    {/* Already inside the "configured" branch, so only the
                        script-loading state is left to report. */}
                    {!googleReady && (
                      <span className="text-xs text-zinc-400">Loading Google Sign-In…</span>
                    )}
                  </div>
                )}

                {errorMsg && (
                  <p className="text-xs text-red-600 font-bold text-center bg-red-50 p-2.5 rounded-xl border border-red-200">{errorMsg}</p>
                )}
              </div>
            ) : (
              /* Phone Number Auth Content */
              <div className="bg-zinc-50 border border-zinc-200/90 rounded-2xl p-4 space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-600 mb-1">
                    Your Full Name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={phoneName}
                      onChange={(e) => setPhoneName(e.target.value)}
                      placeholder="Your full name"
                      className="w-full bg-white border border-zinc-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-900 outline-none font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-600 mb-1">
                    Phone Number (for SMS & Order Status)
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+998 90 123 45 67"
                      className="w-full bg-white border border-zinc-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-900 outline-none font-bold tracking-wide"
                    />
                  </div>
                </div>

                {errorMsg && (
                  <p className="text-xs text-red-600 font-bold">{errorMsg}</p>
                )}

                <button
                  onClick={handlePhoneSignIn}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-2.5 rounded-xl text-xs shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center space-x-2"
                >
                  <span>Sign In with Phone Number</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

          </div>
        )}

        <div className="p-3 bg-orange-50 border border-orange-100 rounded-xl text-[11px] text-orange-900 font-medium text-center">
          🔒 OAuth credentials and loyalty rewards are safely linked to your profile.
        </div>

      </div>
    </div>
  );
};

