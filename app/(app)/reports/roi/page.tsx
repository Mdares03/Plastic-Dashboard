"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type RoiPeriod = { start: string; end: string; days: number; unplannedMin: number; unplannedMinPerDay: number };
type RoiTrendBucket = { start: string; end: string; unplannedMinPerDay: number | null };
type Roi = {
  baseline: RoiPeriod;
  current: RoiPeriod;
  targetReductionPct: number;
  achievedReductionPct: number | null;
  meetsTarget: boolean;
  costPerMin: number;
  estimatedMonthlySavings: number;
  currency: string;
  costRatesArePlaceholder: boolean;
  trend: RoiTrendBucket[];
};

function fmtMin(v: number) {
  return `${v.toFixed(0)} min`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

function isoToDateInput(iso: string) {
  return iso.slice(0, 10);
}

export default function RoiTrackerPage() {
  const [roi, setRoi] = useState<Roi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Baseline config form (admin-editable).
  const [showConfig, setShowConfig] = useState(false);
  const [cfgStart, setCfgStart] = useState("");
  const [cfgEnd, setCfgEnd] = useState("");
  const [cfgTarget, setCfgTarget] = useState("20");
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgError, setCfgError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch("/api/reports/roi", { cache: "no-cache", credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) {
        setError(j?.error ?? "Failed to load ROI");
        return null;
      }
      const next = j.roi as Roi;
      setRoi(next);
      return next;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const next = await load();
      if (!alive || !next) return;
      // Prefill the form with the currently effective window + target.
      setCfgStart(isoToDateInput(next.baseline.start));
      setCfgEnd(isoToDateInput(next.baseline.end));
      setCfgTarget(String(next.targetReductionPct));
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function saveConfig() {
    setCfgSaving(true);
    setCfgError(null);
    try {
      const r = await fetch("/api/reports/roi/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          baselineStart: cfgStart ? new Date(`${cfgStart}T00:00:00Z`).toISOString() : null,
          baselineEnd: cfgEnd ? new Date(`${cfgEnd}T00:00:00Z`).toISOString() : null,
          targetReductionPct: Number(cfgTarget),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) {
        setCfgError(r.status === 403 ? "Only an admin/owner can change the baseline." : j?.error ?? "Failed to save");
        setCfgSaving(false);
        return;
      }
      setShowConfig(false);
      setLoading(true);
      await load();
    } catch (e: unknown) {
      setCfgError(e instanceof Error ? e.message : "Network error");
    } finally {
      setCfgSaving(false);
    }
  }

  const maxTrend = roi ? Math.max(1, ...roi.trend.map((b) => b.unplannedMinPerDay ?? 0)) : 1;
  const money = (v: number) => `${roi?.currency ?? ""} ${v.toLocaleString()}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">ROI tracker — downtime reduction</h1>
        <Link href="/methodology" className="text-xs text-zinc-400 underline hover:text-zinc-200">
          How this is calculated
        </Link>
      </div>
      <p className="mt-2 text-sm text-zinc-400">
        Unplanned downtime now vs the baseline period — the same downtime number the dashboard shows.
      </p>

      <div className="mt-4">
        <button
          type="button"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10"
          onClick={() => setShowConfig((v) => !v)}
        >
          {showConfig ? "Close" : "Configure baseline & target"}
        </button>

        {showConfig ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-xs uppercase tracking-wide text-zinc-400">Baseline period &amp; target</div>
            <p className="mt-1 text-xs text-zinc-500">
              The &quot;before&quot; period we measure improvement against. Pick a representative month of normal
              operation. Current downtime is always the last 30 days.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs text-zinc-400">Baseline start</span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                  value={cfgStart}
                  onChange={(e) => setCfgStart(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-400">Baseline end</span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                  value={cfgEnd}
                  onChange={(e) => setCfgEnd(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-400">Target reduction (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                  value={cfgTarget}
                  onChange={(e) => setCfgTarget(e.target.value)}
                />
              </label>
            </div>
            {cfgError ? <div className="mt-3 text-xs text-red-400">{cfgError}</div> : null}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
                disabled={cfgSaving}
                onClick={saveConfig}
              >
                {cfgSaving ? "Saving…" : "Save baseline"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-8 text-sm text-zinc-400">Loading…</div>
      ) : error ? (
        <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
      ) : roi ? (
        <div className="mt-8 space-y-6">
          {/* Headline */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="text-xs uppercase tracking-wide text-zinc-400">Reduction achieved vs target</div>
            <div className="mt-2 flex items-end gap-3">
              <div className={`text-5xl font-bold ${roi.meetsTarget ? "text-emerald-300" : "text-amber-300"}`}>
                {roi.achievedReductionPct == null ? "—" : `${roi.achievedReductionPct.toFixed(1)}%`}
              </div>
              <div className="pb-2 text-sm text-zinc-400">target ≥ {roi.targetReductionPct}%</div>
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {roi.achievedReductionPct == null
                ? "No baseline downtime to compare against."
                : roi.meetsTarget
                  ? "On or above target."
                  : roi.achievedReductionPct < 0
                    ? "Downtime increased vs baseline."
                    : "Below target."}
            </div>
          </div>

          {/* Baseline vs current */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs text-zinc-400">Baseline</div>
              <div className="mt-2 text-2xl font-semibold text-white">{roi.baseline.unplannedMinPerDay.toFixed(0)} min/day</div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {fmtDate(roi.baseline.start)} – {fmtDate(roi.baseline.end)} · {fmtMin(roi.baseline.unplannedMin)} total
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs text-zinc-400">Current</div>
              <div className="mt-2 text-2xl font-semibold text-white">{roi.current.unplannedMinPerDay.toFixed(0)} min/day</div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {fmtDate(roi.current.start)} – {fmtDate(roi.current.end)} · {fmtMin(roi.current.unplannedMin)} total
              </div>
            </div>
          </div>

          {/* Savings */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="text-xs uppercase tracking-wide text-zinc-400">Estimated monthly savings</div>
            <div className="mt-2 text-3xl font-semibold text-emerald-300">{money(roi.estimatedMonthlySavings)}</div>
            <div className="mt-1 text-xs text-zinc-500">
              {roi.costPerMin.toFixed(2)} {roi.currency}/min stopped × downtime removed, projected to 30 days.
            </div>
            {roi.costRatesArePlaceholder ? (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                ⚠️ Cost rates are not configured yet (placeholder). The downtime minutes are real, but the money
                figure is illustrative until real rates are set in Settings → Financial.
              </div>
            ) : null}
          </div>

          {/* 90-day trend */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="text-xs uppercase tracking-wide text-zinc-400">Unplanned downtime — last 13 weeks (min/day)</div>
            <div className="mt-4 flex h-32 items-end gap-1">
              {roi.trend.map((b) => {
                const v = b.unplannedMinPerDay ?? 0;
                const h = Math.round((v / maxTrend) * 100);
                return (
                  <div
                    key={b.start}
                    className="flex-1 rounded-t bg-emerald-500/40"
                    style={{ height: `${Math.max(2, h)}%` }}
                    title={`${fmtDate(b.start)}: ${v.toFixed(0)} min/day`}
                  />
                );
              })}
            </div>
            <div className="mt-2 text-[11px] text-zinc-500">Lower is better. Track the trend, not a single week.</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
