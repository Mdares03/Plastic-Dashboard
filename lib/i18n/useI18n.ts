"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultLocale, Locale, translate } from "./translations";

const LOCALE_COOKIE = "mis_locale";
const LOCALE_EVENT = "mis-locale-change";

function readCookieLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  if (!match) return null;
  const value = match.split("=")[1];
  if (value === "es-MX" || value === "en") return value;
  return null;
}

function readLocale(): Locale {
  if (typeof document === "undefined") return defaultLocale;
  const docLang = document.documentElement.getAttribute("lang");
  if (docLang === "es-MX" || docLang === "en") return docLang;
  return readCookieLocale() ?? defaultLocale;
}

export function useI18n() {
  const [locale, setLocale] = useState<Locale>(() => readLocale());

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail === "es-MX" || detail === "en") {
        setLocale(detail);
      }
    };
    window.addEventListener(LOCALE_EVENT, handler);
    return () => window.removeEventListener(LOCALE_EVENT, handler);
  }, []);

  const setLocaleAndPersist = useCallback(
    (next: Locale) => {
      document.documentElement.setAttribute("lang", next);
      document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
      setLocale(next);
      window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: next }));
    },
    [setLocale]
  );

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale]
  );

  return useMemo(
    () => ({
      locale,
      setLocale: setLocaleAndPersist,
      t,
    }),
    [locale, setLocaleAndPersist, t]
  );
}
