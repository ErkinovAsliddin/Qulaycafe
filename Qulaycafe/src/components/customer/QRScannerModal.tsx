import React, { useState, useRef, useEffect } from 'react';
import { Camera, X, QrCode, CheckCircle2, AlertCircle } from 'lucide-react';
import jsQR from 'jsqr';
import { Table } from '../../types';
import { Language, translations } from '../../lib/translations';
import { getRestaurantId } from '../../utils/restaurantContext';
import { parseTableQrPayload } from '../../utils/qrGenerator';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTable: (tableNum: number) => void;
  /** Every table this restaurant has, from /api/tables — not a fixed 1..N. */
  tables: Table[];
  /** Highlighted in the grid so the guest can see where they already are. */
  currentTable?: number | null;
  lang: Language;
}

// A table QR is a still sticker, so a few frames a second is plenty. Running
// jsQR on every animation frame would just flatten the battery of the phone
// that is already holding the camera open.
const SCAN_INTERVAL_MS = 200;
// Frames are downscaled before decoding: jsQR's cost grows with pixel count,
// and a printed table QR is large enough in frame to survive it.
const MAX_SCAN_DIMENSION = 720;
// How long the "Table #N detected" confirmation stays up. The guest is moved to
// the table immediately; this delay is only so they get to see why the camera
// closed itself.
const CONFIRM_DISPLAY_MS = 700;

/** The slug of the restaurant this page is showing, from /order/<slug>. */
function currentOrderSlug(): string | null {
  return window.location.pathname.match(/^\/order\/([a-zA-Z0-9-]+)\/?$/)?.[1] ?? null;
}

/**
 * Reads one QR code out of the current video frame, or null when there isn't
 * one in view. The canvas is off-screen and reused between frames.
 */
function decodeQrFromVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight) return null;

  const scale = Math.min(1, MAX_SCAN_DIMENSION / Math.max(videoWidth, videoHeight));
  const width = Math.max(1, Math.round(videoWidth * scale));
  const height = Math.max(1, Math.round(videoHeight * scale));

  canvas.width = width;
  canvas.height = height;
  // willReadFrequently keeps getImageData off the GPU readback path, which is
  // repeatedly warned about in Chrome once a canvas is sampled every frame.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const result = jsQR(data, width, height);
  return result?.data ? result.data : null;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onSelectTable,
  tables,
  currentTable,
  lang
}) => {
  const t = translations[lang];
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [detectedTable, setDetectedTable] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScanAtRef = useRef<number>(0);
  // A QR can stay in frame for many frames, and both the scan and a manual tap
  // can want to answer in the same tick. Whoever gets here first wins, so the
  // guest can never end up at the table the camera saw after tapping a
  // different one.
  const resolvedRef = useRef<boolean>(false);
  const closeTimerRef = useRef<number | null>(null);

  const sortedTables = [...tables].sort((a, b) => a.tableNumber - b.tableNumber);
  const knownTableNumbers = sortedTables.map(tbl => tbl.tableNumber);

  // The restaurant's own table list, in order. Table numbers are not
  // necessarily 1..N (an admin can delete #3 or add #12), so the grid is built
  // from what the server actually returns. If that request failed we fall back
  // to a plain 1..8 range so the guest is never left with an unusable picker.
  const tableOptions = sortedTables.length > 0
    ? sortedTables.map(tbl => ({ tableNumber: tbl.tableNumber, capacity: tbl.capacity }))
    : [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ tableNumber: n, capacity: undefined as number | undefined }));

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsCameraActive(false);
  };

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  /** The guest picked a table by hand — switch and get out of the way. */
  const handleTableClick = (tableNum: number) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    clearCloseTimer();
    stopCamera();
    onSelectTable(tableNum);
    onClose();
  };

  /** A QR was read: move the guest to that table, then show why for a moment. */
  const handleDecodedQr = (text: string) => {
    if (resolvedRef.current) return;

    const parsed = parseTableQrPayload(text, {
      currentRestaurantId: getRestaurantId(),
      currentSlug: currentOrderSlug(),
      knownTableNumbers
    });

    // Written as `=== false`, not `!parsed.ok`: without strictNullChecks this
    // project widens boolean literal types, so negating the discriminant does
    // not narrow the union and `parsed.reason` stops type-checking.
    if (parsed.ok === false) {
      // Nothing is in this camera's view by accident more than once, so keep
      // scanning — the guest is very likely pointing at the right sticker and
      // just needs to hold still. The message is cleared on the next success.
      const message =
        parsed.reason === 'other_restaurant'
          ? t.scanOtherRestaurant
          : parsed.reason === 'unknown_table'
          ? t.scanUnknownTable.replace('{num}', String(parsed.tableNumber ?? ''))
          : t.scanNotTableQr;
      setScanError(message);
      return;
    }

    resolvedRef.current = true;
    setScanError(null);
    setDetectedTable(parsed.tableNumber);
    stopCamera();
    onSelectTable(parsed.tableNumber);
    closeTimerRef.current = window.setTimeout(() => onClose(), CONFIRM_DISPLAY_MS);
  };

  // Kept in a ref so the running animation frame always calls the newest
  // version of the handler — otherwise the loop would freeze the table list and
  // translations as they were when the camera started.
  const scanLoopRef = useRef<() => void>(() => {});
  scanLoopRef.current = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const now = window.performance.now();
    if (now - lastScanAtRef.current < SCAN_INTERVAL_MS) return;
    lastScanAtRef.current = now;

    const canvas = canvasRef.current ?? (canvasRef.current = document.createElement('canvas'));
    const text = decodeQrFromVideo(video, canvas);
    if (text) handleDecodedQr(text);
  };

  const startCamera = async () => {
    setCameraError(null);
    setScanError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      // Reached over plain http, or an in-app browser without camera access —
      // say so plainly instead of failing silently.
      setCameraError('Camera is not available in this browser. Please select table number manually below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      setIsCameraActive(true);
    } catch (err) {
      console.error('Camera access error:', err);
      setCameraError('Camera access unavailable or blocked. Please select table number manually below.');
      setIsCameraActive(false);
    }
  };

  // The <video> element is only in the tree once isCameraActive is true, so the
  // stream has to be attached after that render. Attaching it inside
  // startCamera ran while the element was still unmounted: videoRef was null,
  // the preview stayed black, and every frame the decoder could see was empty.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!isCameraActive || !video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    // Some mobile browsers still gate a live stream behind an explicit play()
    // even with autoPlay set; the element is muted so this is normally allowed.
    video.play().catch(() => {});
  }, [isCameraActive]);

  // The decode loop. It exists only while the camera is live, and every exit
  // path (success, manual tap, close, unmount) cancels it.
  useEffect(() => {
    if (!isOpen || !isCameraActive) return;
    let running = true;

    const tick = () => {
      if (!running) return;
      scanLoopRef.current();
      if (running) {
        rafRef.current = window.requestAnimationFrame(tick);
      }
    };
    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      running = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isOpen, isCameraActive]);

  // Reopening must not show the previous visit's result, and closing must
  // release the camera and any pending auto-close.
  useEffect(() => {
    if (isOpen) {
      setDetectedTable(null);
      setScanError(null);
      setCameraError(null);
      resolvedRef.current = false;
    } else {
      stopCamera();
      clearCloseTimer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    return () => {
      stopCamera();
      clearCloseTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 dark:bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 relative overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-orange-50 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 rounded-xl border border-orange-100 dark:border-orange-500/20">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-zinc-900 dark:text-zinc-100 text-base">{t.scanTitle}</h3>
              <p className="text-zinc-500 dark:text-zinc-400 text-xs font-medium">{t.scanDesc}</p>
            </div>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video / Camera View Box */}
        <div className="relative bg-zinc-950 rounded-xl overflow-hidden aspect-video flex items-center justify-center border border-zinc-800">
          {detectedTable !== null ? (
            <div className="text-center p-6 space-y-2">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
              <p className="text-sm font-black text-white">
                {t.scanDetected.replace('{num}', String(detectedTable))}
              </p>
            </div>
          ) : isCameraActive ? (
            <div className="relative w-full h-full">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              {/* Scan Overlay Crosshair Target */}
              <div className="absolute inset-0 border-2 border-dashed border-orange-500/80 rounded-xl m-6 pointer-events-none animate-pulse flex items-center justify-center">
                <span className="bg-orange-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-md">
                  {t.scanning}
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
                  {t.scanDesc}
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

        {/* A code that read fine but isn't this restaurant's table — the camera
            keeps running, so this is advice, not a dead end. */}
        {isCameraActive && scanError && (
          <div className="flex items-center justify-center space-x-1 text-xs text-rose-600 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{scanError}</span>
          </div>
        )}

        {isCameraActive && (
          <button
            onClick={stopCamera}
            className="w-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold text-xs py-2 rounded-xl border border-zinc-200 dark:border-zinc-700"
          >
            {t.stopCamera}
          </button>
        )}

        {/* Quick Table Buttons Selector */}
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            {t.manualSelect}
          </label>
          {/* Scrollable so a restaurant with more tables than fit on a phone
              screen still shows every one of them, down to the last number. */}
          <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto p-0.5 custom-scrollbar">
            {tableOptions.map(({ tableNumber, capacity }) => (
              <button
                key={tableNumber}
                onClick={() => handleTableClick(tableNumber)}
                title={capacity ? t.capacityGuests.replace('{cap}', String(capacity)) : undefined}
                className={`border rounded-xl p-2.5 text-xs font-extrabold transition-all text-center flex flex-col items-center justify-center shadow-xs ${
                  currentTable === tableNumber
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-zinc-50 dark:bg-zinc-800 hover:bg-orange-500 hover:text-white border-zinc-200 dark:border-zinc-700 hover:border-orange-500'
                }`}
              >
                <span className="text-[10px] opacity-75">T-#{tableNumber}</span>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};
