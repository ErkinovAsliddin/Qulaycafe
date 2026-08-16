import React, { createContext, useContext, useState, useEffect } from 'react';
import { formatSom } from './currency';

type CurrencyCode = 'UZS' | 'USD' | 'RUB';

interface ExchangeRates {
  USD?: { rateToSom: number };
  RUB?: { rateToSom: number };
}

interface CurrencyContextValue {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  formatPrice: (somAmount: number) => string;
  ratesReady: boolean;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

// So'm is always the real, authoritative amount (what's actually stored and
// charged). USD/RUB are display-only conversions for the customer's
// convenience — this never changes what an order actually costs.
export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    const saved = localStorage.getItem('prime_restaurant_currency');
    return saved === 'USD' || saved === 'RUB' || saved === 'UZS' ? saved : 'UZS';
  });
  const [rates, setRates] = useState<ExchangeRates>({});
  const [ratesReady, setRatesReady] = useState(false);

  useEffect(() => {
    fetch('/api/exchange-rates')
      .then(r => (r.ok ? r.json() : {}))
      .then(data => {
        setRates(data || {});
        setRatesReady(true);
      })
      .catch(() => setRatesReady(true)); // fall back to UZS-only display if this fails
  }, []);

  const setCurrency = (c: CurrencyCode) => {
    setCurrencyState(c);
    localStorage.setItem('prime_restaurant_currency', c);
  };

  const formatPrice = (somAmount: number): string => {
    if (currency === 'UZS' || !ratesReady) return formatSom(somAmount);

    const rateInfo = currency === 'USD' ? rates.USD : rates.RUB;
    if (!rateInfo || !rateInfo.rateToSom) return formatSom(somAmount); // no rate available -> safe fallback

    const converted = somAmount / rateInfo.rateToSom;
    if (currency === 'USD') {
      return `$${converted.toFixed(2)}`;
    }
    // RUB: whole rubles with thousands separators, matching local convention
    const rounded = Math.round(converted);
    const withSeparators = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${withSeparators} ₽`;
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, formatPrice, ratesReady }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    // Safe fallback if a component is ever rendered outside the provider —
    // never throw, just behave as so'm-only.
    return { currency: 'UZS', setCurrency: () => {}, formatPrice: formatSom, ratesReady: true };
  }
  return ctx;
}
