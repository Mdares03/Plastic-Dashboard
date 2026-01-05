"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, LayoutGrid, LogOut, Settings, Wrench } from "lucide-react";
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

const items = [
  { href: "/overview", labelKey: "nav.overview", icon: LayoutGrid },
  { href: "/machines", labelKey: "nav.machines", icon: Wrench },
  { href: "/reports", labelKey: "nav.reports", icon: BarChart3 },
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [me, setMe] = useState<{
    user?: { name?: string | null; email?: string | null };
    org?: { name?: string | null };
    membership?: { role?: string | null };
  } | null>(null);

  useEffect(() => {
    let alive = true;
    async function loadMe() {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (alive && res.ok && data?.ok) {
          setMe(data);
        }
      } catch {
        if (alive) setMe(null);
      }
    }
    loadMe();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "light" || current === "dark") {
      setTheme(current);
    }
  }, []);

  function applyTheme(next: "light" | "dark") {
    document.documentElement.setAttribute("data-theme", next);
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setTheme(next);
  }

  function toggleTheme() {
    applyTheme(theme === "light" ? "dark" : "light");
  }

  async function onLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const roleKey = (me?.membership?.role || "MEMBER").toLowerCase();

  return (
    <aside className="relative z-20 hidden md:flex h-screen w-64 flex-col border-r border-white/10 bg-black/40">
      <div className="px-5 py-4">
        <div className="text-white font-semibold tracking-wide">{t("sidebar.productTitle")}</div>
        <div className="text-xs text-zinc-500">{t("sidebar.productSubtitle")}</div>
      </div>

      <nav className="px-3 py-2 flex-1 space-y-1">
        {items.map((it) => {
          const active = pathname === it.href || pathname.startsWith(it.href + "/");
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={[
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                active
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
                  : "text-zinc-300 hover:bg-white/5 hover:text-white",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              <span>{t(it.labelKey)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-white/10 space-y-3">
        <div>
          <div className="text-sm text-white">
            {me?.user?.name || me?.user?.email || t("sidebar.userFallback")}
          </div>
          <div className="text-xs text-zinc-500">
            {me?.org?.name
              ? `${me.org.name} - ${t(`sidebar.role.${roleKey}`)}`
              : t("sidebar.loadingOrg")}
          </div>
        </div>

        <div
          className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
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
          <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em]">
            <button
              type="button"
              onClick={() => {
                setLocale("en");
                router.refresh();
              }}
              aria-pressed={locale === "en"}
              className={locale === "en" ? "text-white" : "text-zinc-400 hover:text-white"}
            >
              EN
            </button>
            <span className="text-zinc-500">|</span>
            <button
              type="button"
              onClick={() => {
                setLocale("es-MX");
                router.refresh();
              }}
              aria-pressed={locale === "es-MX"}
              className={locale === "es-MX" ? "text-white" : "text-zinc-400 hover:text-white"}
            >
              ES
            </button>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
        >
          <span className="flex items-center justify-center gap-2">
            <LogOut className="h-4 w-4" />
            {t("sidebar.logout")}
          </span>
        </button>
      </div>
    </aside>
  );
}
