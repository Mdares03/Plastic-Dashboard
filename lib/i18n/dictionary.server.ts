import en from "./en.json";
import esMX from "./es-MX.json";
import type { Dictionary, Locale } from "./translations";

/**
 * Server-only access to the full locale dictionaries. Both JSON files are bundled
 * here, but this module is imported EXCLUSIVELY by the root layout (a Server
 * Component) — so neither ships in the client bundle. The root layout passes just
 * the active locale's dictionary to I18nProvider as a prop. Do not import this
 * from any "use client" module (it would re-bundle both locales on the client).
 */
export function getDictionary(locale: Locale): Dictionary {
  return locale === "es-MX" ? (esMX as Dictionary) : (en as Dictionary);
}
