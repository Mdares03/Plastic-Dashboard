"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/useI18n";

const THEME_COOKIE = "mis_theme";

const SunIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="M4.93 4.93l1.41 1.41" />
    <path d="M17.66 17.66l1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="M4.93 19.07l1.41-1.41" />
    <path d="M17.66 6.34l1.41-1.41" />
  </svg>
);

const MoonIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12.5A8.5 8.5 0 0 1 11.5 3a8.5 8.5 0 1 0 9.5 9.5z" />
  </svg>
);

type UtilityControlsProps = {
  className?: string;
  initialTheme?: "dark" | "light";
};

export function UtilityControls({ className, initialTheme = "dark" }: UtilityControlsProps) {
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const [theme, setTheme] = useState<"dark" | "light">(initialTheme);

  function applyTheme(next: "light" | "dark") {
    document.documentElement.setAttribute("data-theme", next);
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setTheme(next);
  }

  function toggleTheme() {
    applyTheme(theme === "light" ? "dark" : "light");
  }

  function switchLocale(nextLocale: "en" | "es-MX") {
    setLocale(nextLocale);
    router.refresh();
  }

  return (
    <div
      className={[
        "pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1 sm:gap-3 sm:px-3 sm:py-2",
        className ?? "",
      ].join(" ")}
      title={t("sidebar.themeTooltip")}
    >
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === "light" ? t("sidebar.switchToDark") : t("sidebar.switchToLight")}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white hover:bg-white/10 transition"
      >
        {theme === "light" ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
      </button>
      <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.2em] sm:text-[11px]">
        <button
          type="button"
          onClick={() => switchLocale("en")}
          aria-pressed={locale === "en"}
          className={locale === "en" ? "text-white" : "text-zinc-400 hover:text-white"}
        >
          EN
        </button>
        <span className="text-zinc-500">|</span>
        <button
          type="button"
          onClick={() => switchLocale("es-MX")}
          aria-pressed={locale === "es-MX"}
          className={locale === "es-MX" ? "text-white" : "text-zinc-400 hover:text-white"}
        >
          ES
        </button>
      </div>
    </div>
  );
}
