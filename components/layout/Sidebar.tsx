"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const items = [
  { href: "/overview", label: "Overview", icon: "🏠" },
  { href: "/machines", label: "Machines", icon: "🏭" },
  { href: "/reports", label: "Reports", icon: "📊" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
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
  }

  return (
    <aside className="hidden md:flex h-screen w-64 flex-col border-r border-white/10 bg-black/40">
      <div className="px-5 py-4">
        <div className="text-white font-semibold tracking-wide">MIS</div>
        <div className="text-xs text-zinc-500">Control Tower</div>
      </div>

      <nav className="px-3 py-2 flex-1 space-y-1">
        {items.map((it) => {
          const active = pathname === it.href || pathname.startsWith(it.href + "/");
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
              <span className="text-lg">{it.icon}</span>
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-white/10 space-y-3">
        <div>
          <div className="text-sm text-white">{me?.user?.name || me?.user?.email || "User"}</div>
          <div className="text-xs text-zinc-500">
            {me?.org?.name ? `${me.org.name} - ${me?.membership?.role || "MEMBER"}` : "Loading..."}
          </div>
        </div>

        <button
          onClick={onLogout}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
        >
          🚪 Logout
        </button>
      </div>
    </aside>
  );
}
