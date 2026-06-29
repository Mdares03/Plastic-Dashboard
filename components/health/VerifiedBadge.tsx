"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";
import { formatElapsedSince } from "@/lib/time/elapsed";

/**
 * Persistent "Verified ✓" trust badge in the app header. Polls the cheap, cached
 * /api/health/summary rollup so the decision-maker sees, on every screen, that the
 * numbers reconcile — turning the (previously admin-only, buried) congruence proof
 * into an always-on signal. Links to /trust. Hidden for non-admins (summary 403)
 * and until the first result lands.
 */

type Summary = {
  status: "ok" | "warn" | "fail";
  counts: { ok: number; warn: number; fail: number };
  total: number;
  generatedAt: string;
};

const POLL_MS = 5 * 60 * 1000;

export default function VerifiedBadge() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/health/summary", { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          if (alive) setHidden(true);
          return;
        }
        const data = (await res.json().catch(() => null)) as (Summary & { ok?: boolean }) | null;
        if (alive && data && typeof data.status === "string") setSummary(data);
      } catch {
        /* leave last-known state; don't flash an error in the chrome */
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (hidden || !summary) return null;

  const tone =
    summary.status === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
      : summary.status === "warn"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15"
        : "border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/15";

  const label =
    summary.status === "ok"
      ? t("trust.badge.verified")
      : summary.status === "warn"
        ? t("trust.badge.attention")
        : t("trust.badge.drift");

  const Icon = summary.status === "ok" ? ShieldCheck : ShieldAlert;
  const checkedAgo = formatElapsedSince(summary.generatedAt, "", { maxUnits: 1 });
  const title = checkedAgo ? t("trust.badge.checked", { ago: checkedAgo }) : label;

  return (
    <Link
      href="/trust"
      prefetch={false}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
