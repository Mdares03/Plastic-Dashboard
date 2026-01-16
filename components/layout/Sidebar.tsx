"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Bell, DollarSign, LayoutGrid, LogOut, Settings, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";

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
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
];

type SidebarProps = {
  variant?: "desktop" | "drawer";
  onNavigate?: () => void;
  onClose?: () => void;
};

export function Sidebar({ variant = "desktop", onNavigate, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
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
  const visibleItems = useMemo(() => items.filter((it) => !it.ownerOnly || isOwner), [isOwner]);

  useEffect(() => {
    visibleItems.forEach((it) => {
      router.prefetch(it.href);
    });
  }, [router, visibleItems]);
  const shellClass = [
    "relative z-20 flex flex-col border-r border-white/10 bg-black/40",
    variant === "desktop" ? "hidden md:flex h-screen w-64" : "flex h-full w-72 max-w-[85vw]",
  ].join(" ");

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

      <nav className="px-3 py-2 flex-1 space-y-1">
        {visibleItems.map((it) => {
          const active = pathname === it.href || pathname.startsWith(it.href + "/");
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              onMouseEnter={() => router.prefetch(it.href)}
              onClick={onNavigate}
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
