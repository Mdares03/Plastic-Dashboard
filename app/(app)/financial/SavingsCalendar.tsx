"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import ChartSkeleton from "@/components/charts/ChartSkeleton";
import { useI18n } from "@/lib/i18n/useI18n";
import type { SavingsMonthPoint } from "./SavingsCumulativeChart";

const SavingsCumulativeChart = dynamic(() => import("./SavingsCumulativeChart"), {
  ssr: false,
  loading: () => <ChartSkeleton heightClass="h-full" />,
});

type ApiCurrency = {
  currency: string;
  total: number;
  months: Array<{ month: string; total: number; cumulative: number }>;
  byDay: Array<{ day: string; total: number }>;
};

type ApiRes = {
  ok: boolean;
  currencies?: ApiCurrency[];
  diagnostic?: { message?: string };
  error?: string;
};

type View = "cumulative" | "calendar";

function monthLabel(month: string, locale: string) {
  // month = "YYYY-MM" (UTC). Format in UTC so it doesn't drift across timezones.
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  return new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(d);
}

export default function SavingsCalendar({
  machineId,
  location,
}: {
  machineId?: string;
  location?: string;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<ApiCurrency | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>("cumulative");

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();

    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const qs = new URLSearchParams({ months: "24" });
        if (machineId) qs.set("machineId", machineId);
        if (location) qs.set("location", location);
        const res = await fetch(`/api/financial/savings-calendar?${qs.toString()}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        const json = (await res.json().catch(() => ({}))) as ApiRes;
        if (!alive) return;
        if (!res.ok || json.ok === false) {
          setErr(json.error ?? json.diagnostic?.message ?? t("financial.savings.error"));
          setData(null);
        } else {
          // Pick the dominant currency (most history), mirroring the page's "first summary".
          const currencies = json.currencies ?? [];
          const dominant = [...currencies].sort((a, b) => b.byDay.length - a.byDay.length)[0] ?? null;
          setData(dominant);
        }
      } catch (e) {
        if (!alive) return;
        if ((e as Error)?.name === "AbortError") return;
        setErr(t("common.networkError"));
        setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
      ac.abort();
    };
  }, [machineId, location, t]);

  const currency = data?.currency ?? "USD";

  const formatMoney = useMemo(
    () => (value: number) => {
      if (!Number.isFinite(value)) return "--";
      try {
        return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
      } catch {
        return `${Math.round(value)} ${currency}`;
      }
    },
    [currency, locale]
  );

  const formatAxis = useMemo(
    () => (value: number) => {
      if (!Number.isFinite(value)) return "";
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(value);
      } catch {
        return String(Math.round(value));
      }
    },
    [currency, locale]
  );

  const monthPoints: SavingsMonthPoint[] = useMemo(() => {
    if (!data) return [];
    return data.months.map((m) => ({
      month: m.month,
      label: monthLabel(m.month, locale),
      total: Math.round(m.total),
      cumulative: Math.round(m.cumulative),
    }));
  }, [data, locale]);

  const cumulativeTotal = data?.total ?? 0;

  // Calendar heatmap: months (rows) × day-of-month (1..31), colored by daily cost.
  const calendar = useMemo(() => {
    if (!data) return { rows: [] as Array<{ month: string; days: Array<{ dom: number; value: number } | null> }>, max: 0 };
    const byMonth = new Map<string, Map<number, number>>();
    let max = 0;
    for (const d of data.byDay) {
      const month = d.day.slice(0, 7);
      const dom = Number(d.day.slice(8, 10));
      if (!Number.isFinite(dom)) continue;
      const slot = byMonth.get(month) ?? new Map<number, number>();
      slot.set(dom, (slot.get(dom) ?? 0) + d.total);
      byMonth.set(month, slot);
      max = Math.max(max, slot.get(dom) ?? 0);
    }
    // Keep the same month order the API returned (chronological).
    const rows = data.months.map((m) => {
      const slot = byMonth.get(m.month);
      const days: Array<{ dom: number; value: number } | null> = [];
      for (let dom = 1; dom <= 31; dom++) {
        const value = slot?.get(dom) ?? 0;
        days.push(value > 0 ? { dom, value } : { dom, value: 0 });
      }
      return { month: m.month, days };
    });
    return { rows, max };
  }, [data]);

  function heatStyle(value: number, max: number) {
    if (value <= 0 || max <= 0) return { background: "rgba(255,255,255,0.04)" };
    const ratio = Math.min(1, value / max);
    // Low cost = soft green → high cost = red (cost is bad; greener is better).
    const hue = 150 - ratio * 150; // 150 (green) → 0 (red)
    const alpha = 0.25 + ratio * 0.6;
    return { background: `hsla(${hue}, 80%, 50%, ${alpha})` };
  }

  const hasData = Boolean(data && data.months.length > 0);

  const viewBtn = (value: View, label: string) => (
    <button
      type="button"
      onClick={() => setView(value)}
      className={
        view === value
          ? "rounded-full bg-emerald-500/20 px-3 py-1 text-xs text-emerald-200"
          : "rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10"
      }
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{t("financial.savings.title")}</h2>
          <p className="text-xs text-zinc-400">{t("financial.savings.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {viewBtn("cumulative", t("financial.savings.view.cumulative"))}
          {viewBtn("calendar", t("financial.savings.view.calendar"))}
        </div>
      </div>

      {hasData ? (
        <div className="mt-3 inline-flex items-baseline gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
          <span className="text-xs text-emerald-100/80">{t("financial.savings.total")}</span>
          <span className="text-lg font-semibold text-emerald-100">{formatMoney(cumulativeTotal)}</span>
          <span className="text-[11px] text-emerald-100/60">
            {t("financial.savings.totalHint", { months: data?.months.length ?? 0 })}
          </span>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 text-xs text-zinc-400">{t("financial.savings.loading")}</div>
      ) : err ? (
        <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">{err}</div>
      ) : !hasData ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-zinc-400">
          {t("financial.savings.noData")}
        </div>
      ) : view === "cumulative" ? (
        <div className="mt-4 h-72">
          <SavingsCumulativeChart data={monthPoints} formatMoney={formatMoney} formatAxis={formatAxis} />
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Day-of-month header */}
            <div className="grid items-center" style={{ gridTemplateColumns: "72px repeat(31, 1fr)" }}>
              <div />
              {Array.from({ length: 31 }, (_, i) => (
                <div key={i} className="pb-1 text-center text-[9px] text-zinc-500">
                  {(i + 1) % 2 === 1 ? i + 1 : ""}
                </div>
              ))}
            </div>
            {calendar.rows.map((row) => (
              <div
                key={row.month}
                className="grid items-center gap-[2px] py-[2px]"
                style={{ gridTemplateColumns: "72px repeat(31, 1fr)" }}
              >
                <div className="pr-2 text-right text-[11px] text-zinc-400">{monthLabel(row.month, locale)}</div>
                {row.days.map((d, idx) => {
                  const value = d?.value ?? 0;
                  const dom = idx + 1;
                  const title = `${row.month}-${String(dom).padStart(2, "0")} · ${formatMoney(value)}`;
                  return (
                    <div
                      key={idx}
                      title={title}
                      className="h-4 rounded-[3px] border border-white/5"
                      style={heatStyle(value, calendar.max)}
                    />
                  );
                })}
              </div>
            ))}
            {/* Legend */}
            <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400">
              <span>{t("financial.savings.legendLow")}</span>
              <span className="h-3 w-6 rounded-sm" style={heatStyle(0, 1)} />
              <span className="h-3 w-6 rounded-sm" style={heatStyle(0.34, 1)} />
              <span className="h-3 w-6 rounded-sm" style={heatStyle(0.67, 1)} />
              <span className="h-3 w-6 rounded-sm" style={heatStyle(1, 1)} />
              <span>{t("financial.savings.legendHigh")}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
