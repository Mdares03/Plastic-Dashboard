"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  BarChart3,
  Bell,
  DollarSign,
  LayoutGrid,
  Loader2,
  LogOut,
  Settings,
  Sunrise,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";
import { useScreenlessMode } from "@/lib/ui/screenlessMode";

const PERF_ENABLED = process.env.NEXT_PUBLIC_PERF_LOGS === "1";
const NAV_MARK_KEY = "perf_nav_start";

type NavItem = {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
};

const items: NavItem[] = [
  { href: "/overview", labelKey: "nav.overview", icon: LayoutGrid },
  { href: "/machines", labelKey: "nav.machines", icon: Wrench },
  { href: "/reports", labelKey: "nav.reports", icon: BarChart3 },
  { href: "/alerts", labelKey: "nav.alerts", icon: Bell },
  { href: "/financial", labelKey: "nav.financial", icon: DollarSign, ownerOnly: true },
  { href: "/downtime", labelKey: "nav.downtime", icon: BarChart3 },
  { href: "/recap", labelKey: "nav.recap", icon: Sunrise },
];
const settingsItem: NavItem = { href: "/settings", labelKey: "nav.settings", icon: Settings };

type SidebarProps = {
  variant?: "desktop" | "drawer";
  onNavigate?: () => void;
  onClose?: () => void;
};

export function Sidebar({ variant = "desktop", onNavigate, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const { screenlessMode } = useScreenlessMode();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
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

  async function onLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
    onNavigate?.();
  }

  const roleKey = (me?.membership?.role || "MEMBER").toLowerCase();
  const isOwner = roleKey === "owner";
  const visibleItems = useMemo(() => {
    return items.filter((it) => {
      if (it.ownerOnly && !isOwner) return false;
      if (screenlessMode && it.href === "/downtime") return false;
      return true;
    });
  }, [isOwner, screenlessMode]);

  useEffect(() => {
    if (screenlessMode && pathname.startsWith("/downtime")) {
      router.replace("/overview");
    }
  }, [screenlessMode, pathname, router]);

  useEffect(() => {
    if (!screenlessMode) return;
    if (pathname === "/downtime" || pathname.startsWith("/downtime/")) {
      router.replace("/overview");
    }
  }, [screenlessMode, pathname, router]);

  const markNavStart = (href: string, ts: number) => {
    if (!PERF_ENABLED) return;
    try {
      sessionStorage.setItem(
        NAV_MARK_KEY,
        JSON.stringify({
          href,
          from: pathname,
          ts,
        })
      );
    } catch {
      // ignore
    }
  };

  // Prefetch disabled: Next.js 16 has RSC prefetch bugs that can cause 404 on
  // client-side navigation (see e.g. vercel/next.js#85374). Use fresh fetch on click.
  const shellClass = [
    "relative z-20 flex flex-col border-r border-white/10 bg-black/40 shrink-0",
    variant === "desktop" ? "hidden md:flex h-screen w-64" : "flex h-full w-72 max-w-[85vw]",
  ].join(" ");
  const navLocked = isPending;

  const renderNavItem = (it: NavItem) => {
    const isCurrent = pathname === it.href;
    const active = isCurrent || pathname.startsWith(it.href + "/");
    const isPendingItem = isPending && pendingHref === it.href;
    const Icon = it.icon;
    return (
      <Link
        key={it.href}
        href={it.href}
        prefetch={false}
        aria-disabled={navLocked}
        onClick={(event) => {
          if (
            navLocked ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.altKey ||
            event.ctrlKey ||
            event.shiftKey
          ) {
            return;
          }
          if (isCurrent) {
            onNavigate?.();
            return;
          }
          event.preventDefault();
          markNavStart(it.href, Math.round(performance.timeOrigin + event.timeStamp));
          setPendingHref(it.href);
          startTransition(() => {
            router.push(it.href);
          });
          onNavigate?.();
        }}
        className={[
          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
          active
            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
            : "text-zinc-300 hover:bg-white/5 hover:text-white",
          navLocked ? "pointer-events-none" : "",
          navLocked && !isPendingItem ? "opacity-60" : "",
        ].join(" ")}
      >
        <Icon className="h-4 w-4" />
        <span>{t(it.labelKey)}</span>
        {isPendingItem ? <Loader2 className="ml-auto h-4 w-4 animate-spin text-emerald-300" /> : null}
      </Link>
    );
  };

  return (
    <aside className={shellClass} aria-label={t("sidebar.productTitle")}>
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-white font-semibold tracking-wide">{t("sidebar.productTitle")}</div>
          <div className="text-xs text-zinc-500">{t("sidebar.productSubtitle")}</div>
        </div>
        {variant === "drawer" && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-300 hover:bg-white/10 hover:text-white md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="px-3 py-2 flex-1 flex flex-col gap-2">
        <div className="space-y-1">{visibleItems.map(renderNavItem)}</div>
        <div className="mt-auto space-y-1 border-t border-white/10 pt-2">{renderNavItem(settingsItem)}</div>
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
