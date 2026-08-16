import React from 'react';
import { X, MapPin, Phone, Instagram, Clock, Navigation } from 'lucide-react';

interface RestaurantLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  branding?: {
    restaurantName: string | null;
    contactPhone: string | null;
    contactAddress: string | null;
    contactInstagram: string | null;
    workingHours?: string | null;
  };
}

export const RestaurantLocationModal: React.FC<RestaurantLocationModalProps> = ({ isOpen, onClose, branding }) => {
  if (!isOpen) return null;

  const displayName = branding?.restaurantName || 'Restoran';
  const hasAnyContactInfo = !!(branding?.contactAddress || branding?.contactPhone || branding?.contactInstagram || branding?.workingHours);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/70 backdrop-blur-md animate-fadeIn">
      <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-900 p-1.5 rounded-full bg-zinc-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center space-y-1 pt-2">
          <div className="w-12 h-12 bg-orange-50 text-orange-600 border border-orange-200 rounded-2xl flex items-center justify-center mx-auto">
            <MapPin className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-black text-zinc-900">{displayName}</h3>
        </div>

        {!hasAnyContactInfo ? (
          <p className="text-xs text-zinc-400 text-center py-6">
            Bu restoran hali aloqa ma'lumotlarini kiritmagan.
          </p>
        ) : (
          <div className="space-y-2.5 pt-1">
            {branding?.contactAddress && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branding.contactAddress)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-start space-x-3 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded-xl p-3 transition-colors"
              >
                <MapPin className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-zinc-900">{branding.contactAddress}</p>
                  <p className="text-[11px] text-zinc-500 flex items-center space-x-1 mt-0.5">
                    <Navigation className="w-3 h-3" />
                    <span>Xaritada ochish</span>
                  </p>
                </div>
              </a>
            )}

            {branding?.workingHours && (
              <div className="flex items-center space-x-3 bg-zinc-50 border border-zinc-200 rounded-xl p-3">
                <Clock className="w-4 h-4 text-orange-500 shrink-0" />
                <p className="text-xs font-bold text-zinc-900">{branding.workingHours}</p>
              </div>
            )}

            {branding?.contactPhone && (
              <a
                href={`tel:${branding.contactPhone}`}
                className="flex items-center space-x-3 bg-zinc-50 hover:bg-orange-50 border border-zinc-200 rounded-xl p-3 transition-colors"
              >
                <Phone className="w-4 h-4 text-orange-500 shrink-0" />
                <p className="text-xs font-bold text-zinc-900">{branding.contactPhone}</p>
              </a>
            )}

            {branding?.contactInstagram && (
              <a
                href={`https://instagram.com/${branding.contactInstagram.replace(/^@/, '')}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center space-x-3 bg-zinc-50 hover:bg-pink-50 border border-zinc-200 rounded-xl p-3 transition-colors"
              >
                <Instagram className="w-4 h-4 text-pink-600 shrink-0" />
                <p className="text-xs font-bold text-zinc-900">@{branding.contactInstagram.replace(/^@/, '')}</p>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
