"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";

/**
 * Work Orders tab — completion & data-integrity audit. Per job it answers two
 * separate questions instead of one ambiguous "mismatch":
 *   1. Did the machine COUNT correctly? (countOk — cavities × its own cycle counter
 *      ≈ good parts, scrap tolerated). False = a real counter error → red.
 *   2. Did all the cycle rows REACH the cloud? (delivery). A gap means messages were
 *      lost in transit — the numbers aren't wrong, just incomplete. Shown amber with
 *      its cause (sensor outage / accepted / catching up); an UNEXPLAINED gap is the
 *      rare, real problem and offers admins an Acknowledge action.
 * Scrap never flags a job on its own.
 */

type DeliveryClass = "none" | "explained" | "recoverable" | "unexplained";

type Row = {
  machineId: string;
  workOrderId: string;
  machineName: string;
  sku: string | null;
  mold: string | null;
  status: string;
  isFinished: boolean;
  updatedAt: string;
  targetQty: number | null;
  activeCavities: number | null;
  cyclesCounted: number;
  reportedCycleCount: number;
  goodParts: number;
  scrapParts: number;
  partsMade: number;
  goodFromCycles: number;
  scrapFromCycles: number;
  countOk: boolean;
  countChecked: boolean;
  scrapTolerated: boolean;
  missing: number;
  delivery: DeliveryClass;
  deliveryLabel: string | null;
  counterDrift: boolean;
};

type AuditTone = "ok" | "amber" | "red";

const TONE_CLASS: Record<AuditTone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  red: "border-red-500/30 bg-red-500/10 text-red-200",
};

/** The headline pill: counter error and unexplained gaps read as problems (red),
 *  recoverable/explained as informational (amber), everything else clean (green). */
function auditTone(r: Row): AuditTone {
  if (!r.countOk) return "red";
  if (r.delivery === "unexplained") return "red";
  if (r.delivery === "recoverable" || r.delivery === "explained") return "amber";
  return "ok";
}

export default function WorkOrderCompletionClient() {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyAck, setBusyAck] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/work-orders/completion", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok && Array.isArray(body.rows)) {
        setRows(body.rows as Row[]);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const acknowledge = useCallback(
    async (r: Row) => {
      setBusyAck(`${r.machineId}::${r.workOrderId}`);
      setAckError(null);
      try {
        const res = await fetch("/api/work-orders/gap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineId: r.machineId, workOrderId: r.workOrderId, reason: "manual" }),
        });
        if (res.ok) {
          await load();
        } else if (res.status === 401 || res.status === 403) {
          setAckError(t("workOrders.ack.forbidden"));
        } else {
          setAckError(t("workOrders.ack.error"));
        }
      } catch {
        setAckError(t("workOrders.ack.error"));
      } finally {
        setBusyAck(null);
      }
    },
    [load, t],
  );

  const flagged = useMemo(
    () => (rows ?? []).filter((r) => !r.countOk || r.delivery === "unexplained").length,
    [rows],
  );

  const fmt = (n: number) => n.toLocaleString(locale);

  // Headline status text for the pill.
  const statusLabel = (r: Row): string => {
    if (!r.countOk) return t("workOrders.audit.counterError");
    if (r.delivery === "unexplained") return t("workOrders.audit.unverifiedGap", { missing: fmt(r.missing) });
    if (r.delivery === "recoverable") return t("workOrders.audit.catchingUp", { missing: fmt(r.missing) });
    if (r.delivery === "explained") return t("workOrders.audit.dataGap", { missing: fmt(r.missing) });
    return t("workOrders.audit.reconciled");
  };

  // The cause line shown in the expanded delivery block.
  const deliveryCause = (r: Row): string => {
    if (r.delivery === "none") return t("workOrders.delivery.complete");
    if (r.delivery === "recoverable") return t("workOrders.delivery.recoverable");
    if (r.delivery === "unexplained") return t("workOrders.delivery.unexplained");
    // explained: deliveryLabel is "ack:<reason>" or "outage:<iso>".
    const label = r.deliveryLabel ?? "";
    if (label.startsWith("outage:")) {
      const iso = label.slice("outage:".length);
      const date = new Date(iso);
      return t("workOrders.delivery.outage", {
        date: isNaN(date.getTime()) ? iso : date.toLocaleDateString(locale),
      });
    }
    if (label === "ack:outbox-freeze-prefix") return t("workOrders.delivery.acceptedPreFix");
    return t("workOrders.delivery.accepted");
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">{t("workOrders.title")}</h1>
          <p className="mt-1 text-sm text-zinc-400">{t("workOrders.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
        >
          {t("workOrders.refresh")}
        </button>
      </div>

      {rows && rows.length > 0 && (
        <div className="mb-4 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
          {flagged === 0
            ? t("workOrders.summary.ok", { total: rows.length })
            : t("workOrders.summary.flagged", { flagged, total: rows.length })}
        </div>
      )}

      {ackError && <div className="mb-3 text-xs text-red-300">{ackError}</div>}
      {loading && !rows && <div className="text-sm text-zinc-400">{t("common.loading")}</div>}
      {error && <div className="text-sm text-red-300">{t("workOrders.error")}</div>}
      {rows && rows.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
          {t("workOrders.empty")}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-left text-[11px] uppercase tracking-wide text-zinc-400">
                <th className="px-3 py-2 font-medium">{t("workOrders.col.job")}</th>
                <th className="px-3 py-2 font-medium">{t("workOrders.col.machine")}</th>
                <th className="px-3 py-2 font-medium">{t("workOrders.col.status")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("workOrders.col.cavities")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("workOrders.col.cycles")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("workOrders.col.made")}</th>
                <th className="px-3 py-2 font-medium">{t("workOrders.col.audit")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const id = `${r.machineId}::${r.workOrderId}`;
                const isOpen = expanded.has(id);
                const tone = auditTone(r);
                return (
                  <Fragment key={id}>
                    <tr
                      onClick={() => toggle(id)}
                      className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-white">{r.workOrderId}</div>
                        <div className="text-[11px] text-zinc-400">
                          {[r.sku, r.mold].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-zinc-300">{r.machineName}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${
                            r.isFinished
                              ? "border-white/15 bg-black/20 text-zinc-300"
                              : "border-sky-500/30 bg-sky-500/10 text-sky-200"
                          }`}
                        >
                          {r.isFinished ? t("workOrders.status.finished") : t("workOrders.status.active")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                        {r.activeCavities == null ? "—" : fmt(r.activeCavities)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{fmt(r.cyclesCounted)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-white">{fmt(r.partsMade)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${TONE_CLASS[tone]}`}>
                          {statusLabel(r)}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-white/5 bg-black/20">
                        <td colSpan={7} className="px-3 py-3">
                          <div className="grid gap-3 text-xs text-zinc-300 sm:grid-cols-2">
                            {/* Did the machine count correctly? */}
                            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                              <div className="mb-1.5 font-semibold text-white">
                                {t("workOrders.detail.counter")}
                              </div>
                              <p>
                                {!r.countChecked
                                  ? t("workOrders.detail.counterUnknown")
                                  : r.countOk
                                    ? t("workOrders.detail.counterOk", {
                                        cavities: r.activeCavities == null ? "—" : fmt(r.activeCavities),
                                        cycles: fmt(r.reportedCycleCount),
                                        good: fmt(r.goodParts),
                                      })
                                    : t("workOrders.detail.counterError", {
                                        cavities: r.activeCavities == null ? "—" : fmt(r.activeCavities),
                                        cycles: fmt(r.reportedCycleCount),
                                        good: fmt(r.goodParts),
                                      })}
                              </p>
                              {r.scrapTolerated && (
                                <p className="mt-1 text-[11px] text-zinc-400">
                                  {t("workOrders.detail.scrapTolerated", { scrap: fmt(r.scrapParts) })}
                                </p>
                              )}
                            </div>

                            {/* Did all the data reach the cloud? */}
                            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                              <div className="mb-1.5 font-semibold text-white">
                                {t("workOrders.detail.delivery")}
                              </div>
                              <p>{deliveryCause(r)}</p>
                              {r.missing > 0 && (
                                <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1">
                                  <span className="text-zinc-400">{t("workOrders.detail.metric")}</span>
                                  <span className="text-right text-zinc-400">{t("workOrders.detail.counterCol")}</span>
                                  <span className="text-right text-zinc-400">{t("workOrders.detail.deliveredCol")}</span>

                                  <span>{t("workOrders.detail.cyclesRow")}</span>
                                  <span className="text-right tabular-nums">{fmt(r.reportedCycleCount)}</span>
                                  <span className="text-right tabular-nums text-amber-300">{fmt(r.cyclesCounted)}</span>
                                </div>
                              )}
                              {r.delivery === "unexplained" && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      acknowledge(r);
                                    }}
                                    disabled={busyAck === id}
                                    className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/10 disabled:opacity-50"
                                  >
                                    {t("workOrders.ack.button")}
                                  </button>
                                  <span className="text-[11px] text-zinc-400">{t("workOrders.ack.hint")}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
