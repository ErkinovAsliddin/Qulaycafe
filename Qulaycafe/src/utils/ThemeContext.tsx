import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Dark mode for the guest surface.
//
// Tailwind v4 needs no config file: the `dark:` variant keys off a `.dark`
// class on <html> out of the box (media-query strategy is the default, and a
// custom variant line in index.css switches that to class-based). This module
// owns that class and nothing else.
//
// Choice is the guest's, in this order:
//   1. An explicit toggle in the menu (light / dark / follow the phone) —
//      persisted in localStorage so their pick survives a reload.
//   2. No pick made: follow the device's prefers-color-scheme, live — a guest
//      whose phone flips at sunset sees the menu flip with it.
//
// A cafe guest surface is read in a dim room far more often than an office,
// which is why this ships for guests first; the staff surfaces keep their own
// fixed high-contrast chrome.
// ---------------------------------------------------------------------------

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'qulaycafe_theme';

function readStoredChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** The resolved theme actually applied to the document. */
export interface ThemeContextValue {
  /** What the guest picked (or the default 'system'). */
  choice: ThemeChoice;
  /** What that choice currently resolves to on screen. */
  isDark: boolean;
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  choice: 'system',
  isDark: false,
  setChoice: () => {}
});

function applyTheme(choice: ThemeChoice): boolean {
  const dark = choice === 'dark' || (choice === 'system' && systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  // Also set the color-scheme so form controls, scrollbars and the browser UI
  // (where the OS supports it) match — a white <select> popup on a dark menu
  // is exactly the half-done dark mode this is meant to avoid.
  root.style.colorScheme = dark ? 'dark' : 'light';
  return dark;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredChoice);
  const [isDark, setIsDark] = useState<boolean>(() => {
    const c = readStoredChoice();
    return c === 'dark' || (c === 'system' && systemPrefersDark());
  });

  // Follow the OS while on 'system', including changes made mid-visit.
  useEffect(() => {
    setIsDark(applyTheme(choice));
    if (choice !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setIsDark(applyTheme('system'));
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked — the toggle still works for this page view */
    }
  }, []);

  return <ThemeContext.Provider value={{ choice, isDark, setChoice }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
