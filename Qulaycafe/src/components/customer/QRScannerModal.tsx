import React, { useState, useRef, useEffect } from 'react';
import { Camera, X, QrCode, CheckCircle2, AlertCircle } from 'lucide-react';
import { Language, translations } from '../../lib/translations';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTable: (tableNum: number) => void;
  lang: Language;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onSelectTable,
  lang
}) => {
  const t = translations[lang];
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraActive(true);
    } catch (err) {
      console.error('Camera access error:', err);
      setCameraError('Camera access unavailable or blocked. Please select table number manually below.');
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const handleTableClick = (tableNum: number) => {
    stopCamera();
    onSelectTable(tableNum);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white border border-zinc-200 text-zinc-900 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 relative overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-orange-50 text-orange-600 rounded-xl border border-orange-100">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-zinc-900 text-base">{t.scanTitle}</h3>
              <p className="text-zinc-500 text-xs font-medium">{t.scanDesc}</p>
            </div>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1.5 text-zinc-400 hover:text-zinc-900 bg-zinc-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video / Camera View Box */}
        <div className="relative bg-zinc-950 rounded-xl overflow-hidden aspect-video flex items-center justify-center border border-zinc-800">
          {isCameraActive ? (
            <div className="relative w-full h-full">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              {/* Scan Overlay Crosshair Target */}
              <div className="absolute inset-0 border-2 border-dashed border-orange-500/80 rounded-xl m-6 pointer-events-none animate-pulse flex items-center justify-center">
                <span className="bg-orange-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-md">
                  Align Table QR Here
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center p-6 space-y-3">
              <Camera className="w-10 h-10 text-orange-500 mx-auto" />
              {cameraError ? (
                <div className="flex items-center justify-center space-x-1 text-xs text-rose-400 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{cameraError}</span>
                </div>
              ) : (
                <p className="text-xs text-zinc-400 font-medium">
                  Click below to activate camera to scan table QR code
                </p>
              )}
              <button
                onClick={startCamera}
                className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-md transition-all inline-flex items-center space-x-1.5"
              >
                <Camera className="w-4 h-4" />
                <span>{t.startCamera}</span>
              </button>
            </div>
          )}
        </div>

        {isCameraActive && (
          <button
            onClick={stopCamera}
            className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs py-2 rounded-xl border border-zinc-200"
          >
            {t.stopCamera}
          </button>
        )}

        {/* Quick Table Buttons Selector */}
        <div className="pt-2 border-t border-zinc-100">
          <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
            {t.manualSelect}
          </label>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
              <button
                key={num}
                onClick={() => handleTableClick(num)}
                className="bg-zinc-50 hover:bg-orange-500 hover:text-white border border-zinc-200 hover:border-orange-500 rounded-xl p-2.5 text-xs font-extrabold transition-all text-center flex flex-col items-center justify-center shadow-xs"
              >
                <span className="text-[10px] opacity-75">T-#{num}</span>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};
