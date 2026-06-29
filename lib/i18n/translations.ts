export type Locale = "en" | "es-MX";

export type Dictionary = Record<string, string>;

export const defaultLocale: Locale = "en";

export const LOCALE_COOKIE = "mis_locale";

export function coerceLocale(value: string | null | undefined): Locale {
  return value === "es-MX" ? "es-MX" : "en";
}

/** Interpolate `{token}` placeholders from `vars`. */
export function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, token) => {
    const value = vars[token];
    return value == null ? match : String(value);
  });
}

/**
 * Translate a key against an already-loaded dictionary. EN/ES are key-for-key
 * complete (verified equal key sets), so a missing key falls back to the raw key
 * rather than to the other locale — which lets us ship only the active locale to
 * the client instead of bundling both. The active dictionary is provided by
 * I18nProvider (seeded server-side from the locale cookie).
 */
export function translateWith(
  dict: Dictionary,
  key: string,
  vars?: Record<string, string | number>,
): string {
  return interpolate(dict[key] ?? key, vars);
}
