"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { LOCALE_COOKIE, defaultLocale, translateWith, type Dictionary, type Locale } from "./translations";

type I18nValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Holds the active locale + its dictionary in context. The dictionary is seeded
 * server-side (root layout → only the active locale ships to the client). Switching
 * locale dynamically imports the other locale's JSON on demand, so we never bundle
 * both up front. The hook API ({ locale, setLocale, t }) is unchanged from the old
 * cookie-based useI18n, so no consumer needs to change.
 */
export function I18nProvider({
  initialLocale,
  initialDict,
  children,
}: {
  initialLocale: Locale;
  initialDict: Dictionary;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [dict, setDict] = useState<Dictionary>(initialDict);
  // Cache loaded dictionaries so toggling back and forth doesn't re-fetch.
  const cacheRef = useRef<Partial<Record<Locale, Dictionary>>>({ [initialLocale]: initialDict });

  const setLocale = useCallback((next: Locale) => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("lang", next);
      document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
    const cached = cacheRef.current[next];
    if (cached) {
      setDict(cached);
      setLocaleState(next);
      return;
    }
    const load = next === "es-MX" ? import("./es-MX.json") : import("./en.json");
    void load.then((mod) => {
      const loaded = ((mod as { default?: Dictionary }).default ?? mod) as Dictionary;
      cacheRef.current[next] = loaded;
      setDict(loaded);
      setLocaleState(next);
    });
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translateWith(dict, key, vars),
    [dict],
  );

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// Empty fallback so a stray useI18n() outside the provider degrades to raw keys
// instead of crashing. The root layout wraps every route, so this is only a guard.
const FALLBACK: I18nValue = {
  locale: defaultLocale,
  setLocale: () => {},
  t: (key) => key,
};

export function useI18n(): I18nValue {
  return useContext(I18nContext) ?? FALLBACK;
}
