import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';

interface QRCodeImageProps {
  value: string;
  size?: number;
  className?: string;
  alt?: string;
}

export const QRCodeImage: React.FC<QRCodeImageProps> = ({
  value,
  size = 300,
  className = 'w-full h-full object-contain',
  alt = 'QR Code'
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M'
    })
      .then((url) => {
        if (isMounted) {
          setDataUrl(url);
          setError(false);
        }
      })
      .catch((err) => {
        console.error('Failed to generate real QR code:', err);
        if (isMounted) setError(true);
      });

    return () => {
      isMounted = false;
    };
  }, [value, size]);

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-rose-50 border border-rose-200 text-rose-700 p-2 text-[10px] font-bold rounded-lg text-center">
        <span>Failed to load QR</span>
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-zinc-100 animate-pulse rounded-lg text-[10px] text-zinc-400 font-bold">
        <span>Generating QR...</span>
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      className={className}
    />
  );
};

export async function generateTableQRDataUrlAsync(tableNumber: number, appUrl: string, restaurantId?: string): Promise<string> {
  const base = `${appUrl.replace(/\/$/, '')}?table=${tableNumber}`;
  const fullUrl = restaurantId && restaurantId !== 'default' ? `${base}&r=${encodeURIComponent(restaurantId)}` : base;
  return QRCode.toDataURL(fullUrl, {
    width: 400,
    margin: 1,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
    errorCorrectionLevel: 'M'
  });
}
