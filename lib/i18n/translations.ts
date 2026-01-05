import en from "./en.json";
import esMX from "./es-MX.json";

export type Locale = "en" | "es-MX";

type Dictionary = Record<string, string>;

export const translations: Record<Locale, Dictionary> = {
  en,
  "es-MX": esMX,
};

export const defaultLocale: Locale = "en";

export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>
): string {
  const table = translations[locale] ?? translations[defaultLocale];
  const fallback = translations[defaultLocale];
  let text = table[key] ?? fallback[key] ?? key;
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (match, token) => {
      const value = vars[token];
      return value == null ? match : String(value);
    });
  }
  return text;
}
