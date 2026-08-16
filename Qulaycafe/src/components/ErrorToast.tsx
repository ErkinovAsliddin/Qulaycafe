import React, { useCallback, useEffect, useRef, useState } from 'react';

// A single visible error slot, shared by every surface. It exists so a failed
// action is never silently swallowed or faked as a success.
export function useErrorToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const showError = useCallback((text: string) => {
    setMessage(text);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 5000);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  return { errorToast: message, showError };
}

export const ErrorToast: React.FC<{ message: string | null }> = ({ message }) => {
  if (!message) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-red-600 text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-md text-center"
    >
      {message}
    </div>
  );
};
