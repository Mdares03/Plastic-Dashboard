"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/useI18n";

/**
 * Shared renderer for the live integrity / congruence checks. Fetches the two
 * admin health endpoints and renders status cards. Used by Settings → Integrity
 * and the client-facing /trust page, so the "numbers reconcile" proof looks the
 * same everywhere. Non-admins get a 403 → the adminOnly notice.
 *
 * Every failing check expands to a plain-language "what this means / likely cause
 * / what to do" playbook, a deep-link to the page that fixes it, and — for the two
 * cases safe to auto-correct from the cloud — a confirm-then-fix button.
 */

type FixKind = "stuck_mold" | "downtime_cap" | "cycle_backfill";

type HealthCheck = {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  detailKey?: string;
  detailVars?: Record<string, string | number>;
  fix?: FixKind;
};

// Stable check names (from /api/health/consistency + /metric-consistency) → i18n
// title key. Unknown names fall back to a humanized form of the raw name.
const HEALTH_CHECK_TITLE_KEY: Record<string, string> = {
  recap_vs_authority: "settings.integrity.check.recap_vs_authority",
  reports_vs_authority: "settings.integrity.check.reports_vs_authority",
  financial_vs_authority: "settings.integrity.check.financial_vs_authority",
  downtime_cap: "settings.integrity.check.downtime_cap",
  downtime_capacity: "settings.integrity.check.downtime_capacity",
  counter_drift: "settings.integrity.check.counter_drift",
  cycle_delivery: "settings.integrity.check.cycle_delivery",
  delivery_pipeline: "settings.integrity.check.delivery_pipeline",
  stuck_mold: "settings.integrity.check.stuck_mold",
  clock_sync: "settings.integrity.check.clock_sync",
  reader_link: "settings.integrity.check.reader_link",
  no_machines: "settings.integrity.check.no_machines",
};

// Deep-link to the page that lets the operator act on a failing check.
const DEEP_LINK: Record<string, { href: string; labelKey: string }> = {
  counter_drift: { href: "/work-orders", labelKey: "health.fix.link.workOrders" },
  cycle_delivery: { href: "/work-orders", labelKey: "health.fix.link.workOrders" },
  delivery_pipeline: { href: "/machines", labelKey: "health.fix.link.machines" },
  downtime_cap: { href: "/downtime", labelKey: "health.fix.link.downtime" },
  recap_vs_authority: { href: "/downtime", labelKey: "health.fix.link.downtime" },
  reports_vs_authority: { href: "/downtime", labelKey: "health.fix.link.downtime" },
  no_machines: { href: "/machines", labelKey: "health.fix.link.machines" },
};

function linkFor(check: HealthCheck): { href: string; labelKey: string } | null {
  if (check.name === "financial_vs_authority" && check.status === "warn") {
    return { href: "/settings", labelKey: "health.fix.link.financial" };
  }
  return DEEP_LINK[check.name] ?? null;
}

// The remediation copy group (health.fix.<group>.{meaning,cause,todo}). The three
// "screen shows a different number" checks share one playbook; financial has a
// distinct one for the unset-cost-rates warning.
function fixGroup(check: HealthCheck): string {
  if (check.name === "financial_vs_authority") {
    return check.status === "warn" ? "financial_rates" : "screen_mismatch";
  }
  if (check.name === "recap_vs_authority" || check.name === "reports_vs_authority") {
    return "screen_mismatch";
  }
  return check.name;
}

const FIX_ROUTE: Record<FixKind, string> = {
  stuck_mold: "/api/health/fix/stuck-mold",
  downtime_cap: "/api/health/fix/downtime-cap",
  cycle_backfill: "/api/health/fix/cycle-backfill",
};
const FIX_ACTION_KEY: Record<FixKind, string> = {
  stuck_mold: "health.fix.action.stuckMold",
  downtime_cap: "health.fix.action.downtimeCap",
  cycle_backfill: "health.fix.action.cycleBackfill",
};
const FIX_CONFIRM_KEY: Record<FixKind, string> = {
  stuck_mold: "health.fix.confirm.stuckMold",
  downtime_cap: "health.fix.confirm.downtimeCap",
  cycle_backfill: "health.fix.confirm.cycleBackfill",
};

export type HealthOverall = "ok" | "warn" | "fail" | null;

export default function HealthChecks({
  className,
  onOverall,
}: {
  className?: string;
  /** Reports the worst status across checks (or null while loading / for non-admins). */
  onOverall?: (status: HealthOverall) => void;
}) {
  const { t, locale } = useI18n();
  const [admin, setAdmin] = useState(true);
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyFix, setBusyFix] = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<Record<string, "ok" | "error">>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [integrity, congruence] = await Promise.all([
        fetch("/api/health/consistency", { cache: "no-store" }),
        fetch("/api/health/metric-consistency", { cache: "no-store" }),
      ]);
      if (integrity.status === 401 || integrity.status === 403) {
        setAdmin(false);
        setChecks(null);
        onOverall?.(null);
        return;
      }
      const [integrityBody, congruenceBody] = await Promise.all([
        integrity.json().catch(() => null),
        congruence.json().catch(() => null),
      ]);
      const next: HealthCheck[] = [];
      if (integrityBody && Array.isArray(integrityBody.checks)) next.push(...(integrityBody.checks as HealthCheck[]));
      if (congruenceBody && Array.isArray(congruenceBody.checks)) next.push(...(congruenceBody.checks as HealthCheck[]));
      if (next.length > 0) {
        setAdmin(true);
        setChecks(next);
        setGeneratedAt(typeof integrityBody?.generatedAt === "string" ? integrityBody.generatedAt : null);
        const worst = next.some((c) => c.status === "fail")
          ? "fail"
          : next.some((c) => c.status === "warn")
            ? "warn"
            : "ok";
        onOverall?.(worst);
      }
    } catch {
      // Network error — leave it blank rather than show a broken panel.
    } finally {
      setLoading(false);
    }
  }, [onOverall]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback((name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const runFix = useCallback(
    async (check: HealthCheck) => {
      if (!check.fix) return;
      if (!window.confirm(t(FIX_CONFIRM_KEY[check.fix]))) return;
      setBusyFix(check.name);
      setFixResult((prev) => {
        const next = { ...prev };
        delete next[check.name];
        return next;
      });
      try {
        const res = await fetch(FIX_ROUTE[check.fix], { method: "POST" });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.ok) {
          setFixResult((prev) => ({ ...prev, [check.name]: "ok" }));
          await load();
        } else {
          setFixResult((prev) => ({ ...prev, [check.name]: "error" }));
        }
      } catch {
        setFixResult((prev) => ({ ...prev, [check.name]: "error" }));
      } finally {
        setBusyFix(null);
      }
    },
    [load, t],
  );

  if (!admin) {
    return (
      <div className={className}>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
          {t("settings.integrity.adminOnly")}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-end">
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white hover:bg-white/10 disabled:opacity-50"
        >
          {t("settings.integrity.refresh")}
        </button>
      </div>

      {!checks && loading && (
        <div className="space-y-2" aria-busy="true" aria-label={t("settings.integrity.checking")}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-white/20" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="h-3 w-40 animate-pulse rounded bg-white/15" />
                    <div className="h-4 w-12 animate-pulse rounded-full bg-white/10" />
                  </div>
                  <div className="mt-2 h-2.5 w-3/4 animate-pulse rounded bg-white/10" />
                </div>
              </div>
            </div>
          ))}
          <div className="pt-1 text-[11px] text-zinc-400">{t("settings.integrity.checking")}</div>
        </div>
      )}

      {checks && (
        <>
          <div className="space-y-2">
            {checks.map((check) => {
              const tone =
                check.status === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : check.status === "warn"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    : "border-red-500/30 bg-red-500/10 text-red-200";
              const dot =
                check.status === "ok"
                  ? "bg-emerald-400"
                  : check.status === "warn"
                    ? "bg-amber-400"
                    : "bg-red-400";
              const titleKey = HEALTH_CHECK_TITLE_KEY[check.name];
              const resolvedTitle = titleKey ? t(titleKey) : null;
              const title =
                resolvedTitle && resolvedTitle !== titleKey ? resolvedTitle : check.name.replace(/_/g, " ");
              const statusLabel = t(`settings.integrity.status.${check.status}`);
              const localizedDetail = check.detailKey ? t(check.detailKey, check.detailVars) : check.detail;
              const detail =
                check.detailKey && localizedDetail === check.detailKey ? check.detail : localizedDetail;

              const hasRemediation = check.status !== "ok";
              const isOpen = expanded.has(check.name);
              const group = fixGroup(check);
              const link = linkFor(check);
              const result = fixResult[check.name];

              return (
                <div key={check.name} className={`rounded-xl border p-3 ${tone}`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-white">{title}</div>
                        <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px]">
                          {statusLabel}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-300">{detail}</div>

                      {hasRemediation && (
                        <button
                          type="button"
                          onClick={() => toggle(check.name)}
                          className="mt-2 text-[11px] font-medium text-white/80 underline underline-offset-2 hover:text-white"
                          aria-expanded={isOpen}
                        >
                          {t("health.fix.toggle")}
                        </button>
                      )}

                      {hasRemediation && isOpen && (
                        <div className="mt-2 space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
                          <div className="space-y-1.5 text-xs text-zinc-200">
                            <p>
                              <span className="font-semibold text-white">{t("health.fix.label.meaning")}</span>{" "}
                              {t(`health.fix.${group}.meaning`)}
                            </p>
                            <p>
                              <span className="font-semibold text-white">{t("health.fix.label.cause")}</span>{" "}
                              {t(`health.fix.${group}.cause`)}
                            </p>
                            <p>
                              <span className="font-semibold text-white">{t("health.fix.label.todo")}</span>{" "}
                              {t(`health.fix.${group}.todo`)}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 pt-1">
                            {link && (
                              <Link
                                href={link.href}
                                className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/10"
                              >
                                {t(link.labelKey)}
                              </Link>
                            )}
                            {check.fix && (
                              <button
                                type="button"
                                onClick={() => runFix(check)}
                                disabled={busyFix === check.name}
                                className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
                              >
                                {t(FIX_ACTION_KEY[check.fix])}
                              </button>
                            )}
                            {result === "ok" && (
                              <span className="text-[11px] text-emerald-300">{t("health.fix.result.ok")}</span>
                            )}
                            {result === "error" && (
                              <span className="text-[11px] text-red-300">{t("health.fix.result.error")}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {generatedAt && (
            <div className="mt-3 text-[11px] text-zinc-400">
              {t("settings.integrity.checkedAt", { date: new Date(generatedAt).toLocaleString(locale) })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
