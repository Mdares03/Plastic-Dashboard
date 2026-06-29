"use client";

// The i18n hook now reads the active locale + dictionary from I18nProvider context
// (seeded server-side so only the active locale ships to the client). Re-exported
// here so the many `@/lib/i18n/useI18n` import sites keep working unchanged.
export { useI18n } from "./I18nProvider";
