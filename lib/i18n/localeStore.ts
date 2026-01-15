import type { Locale } from "./translations";

const LOCALE_COOKIE = "mis_locale";

let initialized = false;
let currentLocale: Locale = "en";
const listeners = new Set<() => void>();

const isBrowser = () => typeof document !== "undefined";

function readCookieLocale(): Locale | null {
  if (!isBrowser()) return null;

  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));

  if (!match) return null;
  const value = match.split("=")[1];
  if (value === "es-MX" || value === "en") return value;
  return null;
}

function readLocaleFromDocument(): Locale {
  if (!isBrowser()) return "en";

  const cookieLocale = readCookieLocale();
  if (cookieLocale) return cookieLocale;

  const docLang = document.documentElement.getAttribute("lang");
  if (docLang === "es-MX" || docLang === "en") return docLang;

  return "en";
}

function ensureInitialized() {
  if (initialized) return;
  currentLocale = readLocaleFromDocument();
  initialized = true;
}

export function getLocaleSnapshot(): Locale {
  if (!isBrowser()) return "en";
  ensureInitialized();
  return currentLocale;
}

export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLocale(next: Locale) {
  if (isBrowser()) {
    document.documentElement.setAttribute("lang", next);
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }
  currentLocale = next;
  listeners.forEach((listener) => listener());
}
