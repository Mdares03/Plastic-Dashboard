"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * API SHAPES (from your route.ts)
 */
type ApiParetoRow = {
  reasonCode: string;
  reasonLabel: string;
  minutesLost?: number;
  scrapQty?: number;
  pctOfTotal: number; // percent 0..100
  cumulativePct: number; // percent 0..100
  count: number;
};

type ApiParetoRes = {
  ok: boolean;
  error?: string;
  orgId?: string;
  machineId?: string | null;
  kind?: "downtime" | "scrap";
  range?: "24h" | "7d" | "30d";
  start?: string;
  totalMinutesLost?: number;
  totalScrap?: number;
  rows?: ApiParetoRow[];
  top3?: ApiParetoRow[];
  threshold80?: { index: number; reasonCode: string; reasonLabel: string } | null;
  total?: number;
};

type ApiDowntimeEvent = {
  id: string;
  episodeId: string | null;
  machineId: string;
  machineName: string | null;

  reasonCode: string;
  reasonLabel: string;
  reasonText: string | null;

  durationSeconds: number | null;
  durationMinutes: number | null;

  startAt: string | null;
  endAt: string | null;
  capturedAt: string | null;

  workOrderId: string | null;
  meta: any | null;
  createdAt: string | null;
};

type ApiDowntimeEventsRes = {
  ok: boolean;
  error?: string;
  orgId?: string;
  range?: "24h" | "7d" | "30d";
  start?: string;
  machineId?: string | null;
  reasonCode?: string | null;
  limit?: number;
  before?: string | null;
  nextBefore?: string | null;
  events?: ApiDowntimeEvent[];
};

function fmtDT(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { hour12: true });
}


type ApiCoverageRes = {
  ok: boolean;
  error?: string;
  orgId?: string;
  machineId?: string | null;
  range?: "24h" | "7d" | "30d";
  start?: string;
  receivedEpisodes?: number;
  receivedMinutes?: number;
  note?: string;
};

type Range = "24h" | "7d" | "30d";
type Metric = "minutes" | "count";

type MetricRow = {
  reasonCode: string;
  reasonLabel: string;
  value: number; // minutes OR count
  count: number; // always count (stops)
  pctOfTotal: number; // percent 0..100 in selected metric
  cumulativePct: number; // percent 0..100 in selected metric
  minutesLost?: number; // if available
};

function fmtNum(n: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

function fmtPct(pct: number, digits = 0) {
  return `${fmtNum(pct, digits)}%`;
}

function fmtHoursFromMinutes(min: number) {
  const hrs = min / 60;
  return hrs >= 10 ? `${fmtNum(hrs, 0)} hrs` : `${fmtNum(hrs, 1)} hrs`;
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function buildSearch(params: URLSearchParams, patch: Record<string, string | null>) {
  const next = new URLSearchParams(params.toString());
  Object.entries(patch).forEach(([k, v]) => {
    if (v === null) next.delete(k);
    else next.set(k, v);
  });
  return next.toString();
}

/**
 * Derive a Pareto set for Minutes or Count from the same API response.
 * - Your API always returns rows sorted by VALUE (minutes for downtime, scrapQty for scrap).
 * - For Metric=COUNT, we re-sort by count and recompute pct/cum on client.
 */
function computeMetricRows(base: ApiParetoRow[], metric: Metric): MetricRow[] {
  const safe = base ?? [];

  if (metric === "minutes") {
    const rows: MetricRow[] = safe.map((r) => ({
      reasonCode: r.reasonCode,
      reasonLabel: r.reasonLabel,
      value: r.minutesLost ?? 0,
      count: r.count ?? 0,
      pctOfTotal: r.pctOfTotal ?? 0,
      cumulativePct: r.cumulativePct ?? 0,
      minutesLost: r.minutesLost ?? 0,
    }));
    return rows;
  }

  // metric === "count"
  const sorted = [...safe].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const total = sorted.reduce((acc, r) => acc + (r.count ?? 0), 0);

  let cum = 0;
  const out: MetricRow[] = sorted.map((r) => {
    const v = r.count ?? 0;
    const pct = total > 0 ? (v / total) * 100 : 0;
    cum += v;
    const cumPct = total > 0 ? (cum / total) * 100 : 0;

    return {
      reasonCode: r.reasonCode,
      reasonLabel: r.reasonLabel,
      value: v,
      count: v,
      pctOfTotal: pct,
      cumulativePct: cumPct,
      minutesLost: r.minutesLost ?? 0,
    };
  });

  return out;
}

function findUnclassifiedPct(rows: MetricRow[]) {
  const hit = rows.find((r) => {
    const code = (r.reasonCode ?? "").toLowerCase();
    const label = (r.reasonLabel ?? "").toLowerCase();
    return code.includes("unclass") || code.includes("unknown") || label.includes("unclass") || label.includes("unknown");
  });
  return hit ? hit.pctOfTotal : 0;
}

/**
 * Right-side drawer (investigation)
 * Built in the same style as MachineDetailClient’s Modal overlay.
 */
function ReasonDrawer({
  open,
  onClose,
  row,
  metric,
}: {
  open: boolean;
  onClose: () => void;
  row: MetricRow | null;
  metric: Metric;
}) {
  if (!open || !row) return null;

  const avgMin =
    row.count > 0 && row.minutesLost != null ? row.minutesLost / row.count : null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[520px] overflow-hidden border-l border-white/10 bg-zinc-950/70 backdrop-blur-xl">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(900px 500px at 20% 10%, rgba(16,185,129,.18), transparent 60%)," +
              "radial-gradient(900px 500px at 85% 30%, rgba(59,130,246,.12), transparent 60%)," +
              "radial-gradient(900px 600px at 50% 100%, rgba(244,63,94,.10), transparent 60%)",
          }}
        />
        <div className="relative flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">Reason detail</div>
              <div className="mt-1 truncate text-xs text-zinc-400">{row.reasonLabel}</div>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 no-scrollbar">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-zinc-400">
                  {metric === "minutes" ? "Downtime" : "Stops"}
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {metric === "minutes" ? `${fmtNum(row.value, 1)} min` : fmtNum(row.value, 0)}
                </div>
                <div className="mt-1 text-xs text-zinc-400">{fmtPct(row.pctOfTotal, 1)} share</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-zinc-400">Stops</div>
                <div className="mt-2 text-2xl font-semibold text-white">{fmtNum(row.count, 0)}</div>
                <div className="mt-1 text-xs text-zinc-400">
                  {avgMin == null ? "Avg duration —" : `Avg ${fmtNum(avgMin, 1)} min`}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-semibold text-white">Investigation (next)</div>
              <div className="mt-1 text-xs text-zinc-400">
                Hook the following panels once you add endpoints for events + breakdowns:
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-zinc-300">
                <li>Last 10 events (timestamp, duration, operator note)</li>
                <li>Breakdown by machine / shift / work order</li>
                <li>Duration histogram (micro vs macro)</li>
                <li>Create action (owner, due date, status)</li>
              </ul>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4 text-xs text-zinc-400">
              Tip: keep this drawer “fast”. The table + drawer combo is what makes the page feel like a tool.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "emerald" | "yellow" | "rose" | "zinc";
}) {
  const ring =
    accent === "emerald"
      ? "border-emerald-500/20"
      : accent === "yellow"
      ? "border-yellow-500/20"
      : accent === "rose"
      ? "border-rose-500/20"
      : "border-white/10";

  return (
    <div className={cn("rounded-2xl border bg-white/5 p-5", ring)}>
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
      {sub ? <div className="mt-2 text-xs text-zinc-400">{sub}</div> : null}
    </div>
  );
}
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function nextHourBoundary(d: Date) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  x.setHours(x.getHours() + 1);
  return x;
}

function getEventInterval(e: ApiDowntimeEvent): { start: Date | null; end: Date | null } {
  const startIso = e.startAt ?? e.capturedAt;
  if (!startIso) return { start: null, end: null };

  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return { start: null, end: null };

  // Prefer endAt if present
  if (e.endAt) {
    const end = new Date(e.endAt);
    if (!Number.isNaN(end.getTime()) && end > start) return { start, end };
  }

  // Fall back to duration fields
  const durMin =
    e.durationMinutes ??
    (e.durationSeconds != null ? e.durationSeconds / 60 : null);

  if (durMin != null && durMin > 0) {
    const end = new Date(start.getTime() + durMin * 60_000);
    return { start, end };
  }

  return { start, end: null };
}

/**
 * Build heatmap matrix [7 days][24 hours]
 * - metric="minutes": distributes duration across hour buckets (accurate)
 * - metric="count": increments the start hour bucket
 */
function buildHeatmapMatrix(events: ApiDowntimeEvent[], metric: Metric) {
  const m = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

  for (const e of events) {
    const { start, end } = getEventInterval(e);
    if (!start) continue;

    if (metric === "count") {
      m[start.getDay()][start.getHours()] += 1;
      continue;
    }

    if (!end) continue;

    let t = start;
    while (t < end) {
      const day = t.getDay();
      const hour = t.getHours();

      const boundary = nextHourBoundary(t);
      const segEnd = boundary < end ? boundary : end;
      const segMin = (segEnd.getTime() - t.getTime()) / 60_000;

      m[day][hour] += segMin;
      t = segEnd;
    }
  }

  let max = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) max = Math.max(max, m[d][h]);
  }

  return { matrix: m, max };
}

function eventTouchesSlot(e: ApiDowntimeEvent, slotDay: number, slotHour: number) {
  const { start, end } = getEventInterval(e);
  if (!start) return false;

  // Count metric: consider start bucket
  if (!end) return start.getDay() === slotDay && start.getHours() === slotHour;

  // Minutes metric: any overlap with that (day, hour) bucket
  let t = start;
  while (t < end) {
    if (t.getDay() === slotDay && t.getHours() === slotHour) return true;
    const boundary = nextHourBoundary(t);
    t = boundary < end ? boundary : end;
  }
  return false;
}

function heatColor(v: number, metric: Metric) {
  // "Good" = green even when v=0
  if (v <= 0) return { bg: "rgba(34,197,94,0.18)", label: "Good" };

  if (metric === "minutes") {
    // per-hour downtime minutes severity
    if (v < 2)  return { bg: "rgba(34,197,94,0.45)", label: "Low" };
    if (v < 6)  return { bg: "rgba(234,179,8,0.55)", label: "Watch" };   // yellow
    if (v < 15) return { bg: "rgba(249,115,22,0.65)", label: "High" };    // orange
    return        { bg: "rgba(239,68,68,0.75)", label: "Critical" };      // red
  }

  // metric === "count"
  if (v <= 1) return { bg: "rgba(34,197,94,0.45)", label: "Low" };
  if (v <= 3) return { bg: "rgba(234,179,8,0.55)", label: "Watch" };
  if (v <= 6) return { bg: "rgba(249,115,22,0.65)", label: "High" };
  return        { bg: "rgba(239,68,68,0.75)", label: "Critical" };
}

function Heatmap({
  events,
  metric,
  selected,
  onSelect,
  onClear,
}: {
  events: ApiDowntimeEvent[];
  metric: Metric;
  selected: { day: number; hour: number } | null;
  onSelect: (day: number, hour: number) => void;
  onClear: () => void;
}) {
  const { matrix, max } = useMemo(() => buildHeatmapMatrix(events, metric), [events, metric]);

  const hourLabels = Array.from({ length: 24 }, (_, h) =>
    h % 2 === 0 ? String(h).padStart(2, "0") : ""
  );

  const hasData = max > 0;

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="min-w-[860px]">
        <div className="flex items-center justify-between pb-3">
          <div className="text-[11px] text-zinc-500">
            Click a cell to filter Event list by day/hour
          </div>
          {selected ? (
            <button
              onClick={onClear}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10"
            >
              Clear heatmap filter
            </button>
          ) : null}
        </div>

        {/* Header row */}
        <div className="grid" style={{ gridTemplateColumns: "56px repeat(24, 28px)" }}>
          <div />
          {hourLabels.map((t, h) => (
            <div key={h} className="pb-2 text-center text-[10px] text-zinc-500">
              {t}
            </div>
          ))}
        </div>

        {/* Rows */}
        {matrix.map((row, dayIdx) => (
          <div
            key={dayIdx}
            className="grid items-center"
            style={{ gridTemplateColumns: "56px repeat(24, 28px)" }}
          >
            <div className="pr-2 text-right text-[11px] text-zinc-500">
              {DAY_LABELS[dayIdx]}
            </div>

            {row.map((v, hour) => {
              const c = heatColor(v, metric);
              const isSelected = selected?.day === dayIdx && selected?.hour === hour;

              const title = `${DAY_LABELS[dayIdx]} ${String(hour).padStart(2, "0")}:00–${String(
                (hour + 1) % 24
              ).padStart(2, "0")}:00\n${
                metric === "minutes" ? `${fmtNum(v, 1)} min` : `${fmtNum(v, 0)} stops`
              }\n${c.label}`;

              return (
                <button
                  key={hour}
                  title={title}
                  onClick={() => onSelect(dayIdx, hour)}
                  className={cn(
                    "h-[22px] w-[22px] rounded-md border border-white/5 transition",
                    "hover:brightness-110",
                    isSelected && "ring-2 ring-emerald-400/60"
                  )}
                  style={{
                    background: c.bg,
                    boxShadow: isSelected ? "0 0 0 1px rgba(16,185,129,0.35)" : undefined,
                  }}
                />
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: "rgba(34,197,94,0.18)" }} />
            Good
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: "rgba(234,179,8,0.55)" }} />
            Watch
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: "rgba(249,115,22,0.65)" }} />
            High
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: "rgba(239,68,68,0.75)" }} />
            Critical
          </div>

          <div className="ml-auto">
            {events.length === 0
              ? "No events loaded for this scope"
              : hasData
              ? `Max cell: ${metric === "minutes" ? `${fmtNum(max, 1)} min` : `${fmtNum(max, 0)} stops`}`
              : "Events loaded, but no usable durations/endAt yet"}
          </div>
        </div>
      </div>
    </div>
  );
}

type ActionStatus = "open" | "in_progress" | "blocked" | "done";
type ActionPriority = "low" | "medium" | "high";

type HeatmapSel = { day: number; hour: number };

type ActionItem = {
  id: string;
  createdAt: string;
  updatedAt: string;

  machineId: string | null;
  reasonCode: string | null;
  hmDay: number | null;
  hmHour: number | null;

  title: string;
  notes: string;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  dueDate: string | null; // YYYY-MM-DD
  status: ActionStatus;
  priority: ActionPriority;
};

type MemberOption = {
  id: string;
  name?: string | null;
  email: string;
  role: string;
  isActive: boolean;
};

function statusPill(status: ActionStatus) {
  switch (status) {
    case "done":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
    case "blocked":
      return "border-rose-500/25 bg-rose-500/10 text-rose-200";
    case "in_progress":
      return "border-sky-500/25 bg-sky-500/10 text-sky-200";
    default:
      return "border-amber-500/25 bg-amber-500/10 text-amber-200";
  }
}

function priorityPill(p: ActionPriority) {
  switch (p) {
    case "high":
      return "border-rose-500/25 bg-rose-500/10 text-rose-200";
    case "medium":
      return "border-yellow-500/25 bg-yellow-500/10 text-yellow-200";
    default:
      return "border-white/10 bg-white/5 text-zinc-200";
  }
}

function isValidNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n);
}

function ActionModal({
  open,
  onClose,
  initial,
  onSave,
  onDelete,
  members,
  isNew,
}: {
  open: boolean;
  onClose: () => void;
  initial: ActionItem;
  onSave: (a: ActionItem, isNew: boolean) => Promise<{ ok: boolean; error?: string }>;
  onDelete?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  members: MemberOption[];
  isNew: boolean;
}) {
  const [draft, setDraft] = React.useState<ActionItem>(initial);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const availableMembers = React.useMemo(() => members, [members]);

  React.useEffect(() => {
    setDraft(initial);
    setSaveError(null);
  }, [initial]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-[560px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/80 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Action</div>
            <div className="mt-1 text-xs text-zinc-400">
              Assign ownership + due date. Keep it short and clear.
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <div className="text-[11px] text-zinc-500">Title</div>
            <input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="e.g. Add checklist for material feed before start-up"
              className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-zinc-500">Owner</div>
              <select
                value={draft.ownerUserId ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    ownerUserId: e.target.value ? e.target.value : null,
                  }))
                }
                className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
              >
                <option value="">Unassigned</option>
                {availableMembers.map((member) => {
                  const label = member.name ? `${member.name} (${member.email})` : member.email;
                  const suffix = member.isActive ? "" : " (inactive)";
                  return (
                    <option key={member.id} value={member.id}>
                      {label}{suffix}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <div className="text-[11px] text-zinc-500">Due date</div>
              <input
                type="date"
                value={draft.dueDate ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value || null }))}
                className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-zinc-500">Status</div>
              <select
                value={draft.status}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as ActionStatus }))}
                className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
              </select>
            </div>

            <div>
              <div className="text-[11px] text-zinc-500">Priority</div>
              <select
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as ActionPriority }))}
                className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div>
            <div className="text-[11px] text-zinc-500">Notes</div>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              placeholder="Context, hypothesis, what to verify, etc."
              className="mt-1 h-24 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500"
            />
          </div>

          {saveError ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {saveError}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            {draft.machineId ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">Machine</span> : null}
            {draft.reasonCode ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">Reason</span> : null}
            {draft.hmDay != null && draft.hmHour != null ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">Heatmap bucket</span>
            ) : null}
          </div>

          <div className="flex items-center justify-between pt-2">
            <div>
              {onDelete && !isNew ? (
                <button
                  onClick={async () => {
                    if (!draft.id) return;
                    setSaving(true);
                    setSaveError(null);
                    const result = await onDelete(draft.id);
                    if (!result.ok) {
                      setSaveError(result.error || "Failed to delete action");
                      setSaving(false);
                      return;
                    }
                    setSaving(false);
                    onClose();
                  }}
                  disabled={saving}
                  className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Delete
                </button>
              ) : null}
            </div>

            <button
              onClick={async () => {
                setSaving(true);
                setSaveError(null);
                const now = new Date().toISOString();
                const next: ActionItem = { ...draft, updatedAt: now };
                const result = await onSave(next, isNew);
                if (!result.ok) {
                  setSaveError(result.error || "Failed to save action");
                  setSaving(false);
                  return;
                }
                setSaving(false);
                onClose();
              }}
              disabled={saving}
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save action"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionsOwnershipPanel({
  machineId,
  reasonCode,
  heatmapSel,
  onFocusReason,
}: {
  machineId: string | null;
  reasonCode: string | null;
  heatmapSel: HeatmapSel | null;
  onFocusReason: (code: string) => void;
}) {
  const [items, setItems] = React.useState<ActionItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [members, setMembers] = React.useState<MemberOption[]>([]);

  const hmDay = heatmapSel?.day ?? null;
  const hmHour = heatmapSel?.hour ?? null;

  const loadActions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (machineId) params.set("machineId", machineId);
      if (reasonCode) params.set("reasonCode", reasonCode);
      if (hmDay != null && hmHour != null) {
        params.set("hmDay", String(hmDay));
        params.set("hmHour", String(hmHour));
      }
      const qs = params.toString();
      const res = await fetch(`/api/downtime/actions${qs ? `?${qs}` : ""}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        actions?: ActionItem[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to load actions");
      }
      setItems(Array.isArray(data.actions) ? data.actions : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load actions");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [machineId, reasonCode, hmDay, hmHour]);

  useEffect(() => {
    loadActions();
  }, [loadActions]);

  useEffect(() => {
    let alive = true;
    async function loadMembers() {
      try {
        const res = await fetch("/api/org/members", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          members?: MemberOption[];
        };
        if (!alive) return;
        if (res.ok && data.ok) {
          setMembers(Array.isArray(data.members) ? data.members : []);
        }
      } catch {
        if (alive) setMembers([]);
      }
    }
    loadMembers();
    return () => {
      alive = false;
    };
  }, []);

  const openItems = React.useMemo(() => items.filter((a) => a.status !== "done"), [items]);

  const now = new Date();
  const dueSoon = React.useMemo(() => {
    return openItems.filter((a) => {
      if (!a.dueDate) return false;
      const d = new Date(a.dueDate + "T00:00:00");
      const diffDays = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 3;
    });
  }, [openItems, now]);

  const overdue = React.useMemo(() => {
    return openItems.filter((a) => {
      if (!a.dueDate) return false;
      const d = new Date(a.dueDate + "T00:00:00");
      return d.getTime() < new Date(now.toDateString()).getTime();
    });
  }, [openItems, now]);

  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ActionItem | null>(null);

  const initialNew: ActionItem = React.useMemo(() => {
    const ts = new Date().toISOString();
    return {
      id: "",
      createdAt: ts,
      updatedAt: ts,
      machineId,
      reasonCode,
      hmDay,
      hmHour,
      title: "",
      notes: "",
      ownerUserId: null,
      ownerName: null,
      ownerEmail: null,
      dueDate: null,
      status: "open",
      priority: "medium",
    };
  }, [machineId, reasonCode, hmDay, hmHour]);

  const saveAction = useCallback(
    async (next: ActionItem, isNew: boolean) => {
      const payload = {
        machineId: next.machineId,
        reasonCode: next.reasonCode,
        hmDay: next.hmDay,
        hmHour: next.hmHour,
        title: next.title.trim(),
        notes: next.notes.trim(),
        ownerUserId: next.ownerUserId,
        dueDate: next.dueDate,
        status: next.status,
        priority: next.priority,
      };
      const url = isNew ? "/api/downtime/actions" : `/api/downtime/actions/${next.id}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        action?: ActionItem;
      };
      if (!res.ok || !data.ok || !data.action) {
        return { ok: false, error: data.error || "Failed to save action" };
      }
      setItems((prev) => {
        if (isNew) return [data.action as ActionItem, ...prev];
        const i = prev.findIndex((x) => x.id === data.action?.id);
        if (i === -1) return [data.action as ActionItem, ...prev];
        const copy = [...prev];
        copy[i] = data.action as ActionItem;
        return copy;
      });
      return { ok: true };
    },
    []
  );

  const deleteAction = useCallback(async (id: string) => {
    const res = await fetch(`/api/downtime/actions/${id}`, { method: "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || "Failed to delete action" };
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
    return { ok: true };
  }, []);

  const list = items
    .slice()
    .sort((a, b) => (a.status === "done" ? 1 : -1) - (b.status === "done" ? 1 : -1));

  return (
    <div className="mt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-zinc-400">
            Convert insights into ownership (who + when).
          </div>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white hover:bg-white/10"
        >
          + New action
        </button>
      </div>

      {/* mini KPIs */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="text-[11px] text-zinc-400">Open</div>
          <div className="mt-1 text-base font-semibold text-white">{fmtNum(openItems.length, 0)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="text-[11px] text-zinc-400">Due soon (3d)</div>
          <div className="mt-1 text-base font-semibold text-white">{fmtNum(dueSoon.length, 0)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="text-[11px] text-zinc-400">Overdue</div>
          <div className="mt-1 text-base font-semibold text-white">{fmtNum(overdue.length, 0)}</div>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
        <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-[11px] text-zinc-500">
          <div className="col-span-6">Action</div>
          <div className="col-span-3">Owner</div>
          <div className="col-span-3 text-right">Status</div>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-zinc-400">Loading actions…</div>
        ) : list.length === 0 ? (
          <div className="p-4 text-sm text-zinc-400">
            No actions yet. Create one from the current selection (Reason / Heatmap / Machine).
          </div>
        ) : (
          list.slice(0, 8).map((a) => (
            <div
              key={a.id}
              className="grid grid-cols-12 gap-2 border-b border-white/5 px-4 py-3 hover:bg-white/5"
            >
              <button
                onClick={() => {
                  setEditing(a);
                  setModalOpen(true);
                }}
                className="col-span-6 text-left"
              >
                <div className="truncate text-sm text-white">{a.title || "Untitled action"}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                  {a.reasonCode ? (
                    <button
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 hover:bg-white/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFocusReason(a.reasonCode!);
                      }}
                      title="Focus this reason"
                    >
                      {a.reasonCode}
                    </button>
                  ) : null}
                  {a.dueDate ? <span>Due {new Date(a.dueDate).toLocaleDateString()}</span> : <span>No due date</span>}
                  <span className={cn("rounded-full border px-2 py-0.5", priorityPill(a.priority))}>
                    {a.priority}
                  </span>
                </div>
              </button>

              <div className="col-span-3 flex items-center text-sm text-zinc-200">
                {a.ownerName || a.ownerEmail || "—"}
              </div>

              <div className="col-span-3 flex items-center justify-end gap-2">
                <span className={cn("rounded-full border px-2 py-1 text-[11px]", statusPill(a.status))}>
                  {a.status.replace("_", " ")}
                </span>

                {a.status !== "done" ? (
                  <button
                    onClick={async () => {
                      const result = await saveAction(
                        { ...a, status: "done", updatedAt: new Date().toISOString() },
                        false
                      );
                      if (!result.ok) {
                        setError(result.error || "Failed to update action");
                      }
                    }}
                    className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/15"
                    title="Mark done"
                  >
                    Done
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}

        {list.length > 8 ? (
          <div className="p-3 text-[11px] text-zinc-500">
            Showing 8 / {list.length}. (Later: pagination + filters)
          </div>
        ) : null}
      </div>

      <ActionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initial={editing ?? initialNew}
        onSave={saveAction}
        onDelete={(id) => deleteAction(id)}
        members={members}
        isNew={!editing}
      />
    </div>
  );
}

export default function DowntimePageClient() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // URL-backed filters
  const range = (sp.get("range") as Range) || "30d";
  const machineId = sp.get("machineId") || null;

  // client-only filters (shareable)
  const metric = ((sp.get("metric") as Metric) || "minutes") as Metric;
  const reasonCode = sp.get("reasonCode") || null;

  const hmDay = sp.get("hmDay");
  const hmHour = sp.get("hmHour");

  const heatmapSel =
    hmDay != null && hmHour != null && isValidNum(hmDay) && isValidNum(hmHour)
      ? { day: Number(hmDay), hour: Number(hmHour) }
      : null;


  const [pareto, setPareto] = useState<ApiParetoRes | null>(null);
  const [coverage, setCoverage] = useState<ApiCoverageRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [eventsRes, setEventsRes] = useState<ApiDowntimeEventsRes | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsErr, setEventsErr] = useState<string | null>(null);

  const [eventsLimit, setEventsLimit] = useState<number>(200);
  const [eventsBefore, setEventsBefore] = useState<string | null>(null);

  // simple client filter (fast): text search on machine/reason/wo
  const [eventSearch, setEventSearch] = useState("");


  const [drawer, setDrawer] = useState<{ open: boolean; row: MetricRow | null }>({
    open: false,
    row: null,
  });

  function fmtMxn(n: number) {
    return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: 0,
    }).format(n);
    }

  function setParams(patch: Record<string, string | null>) {
    const next = buildSearch(sp, patch);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  const mxnPerMin = Number(sp.get("mxnPerMin") || "0");
    const [mxnPerMinInput, setMxnPerMinInput] = useState<string>(sp.get("mxnPerMin") ?? "");

    useEffect(() => {
    setMxnPerMinInput(String(mxnPerMin || ""));
    }, [mxnPerMin]);
  

  // Fetch (real)
  useEffect(() => {
    let alive = true;
    const ac = new AbortController();

    async function run() {
      setLoading(true);
      setErr(null);

      try {
        const qs = new URLSearchParams();
        qs.set("kind", "downtime");
        qs.set("range", range);
        if (machineId) qs.set("machineId", machineId);

        const [r1, r2] = await Promise.all([
          fetch(`/api/analytics/pareto?${qs.toString()}`, {
            cache: "no-cache",
            credentials: "include",
            signal: ac.signal,
          }),
          fetch(`/api/analytics/coverage?${qs.toString()}`, {
            cache: "no-cache",
            credentials: "include",
            signal: ac.signal,
          }),
        ]);

        const j1 = (await r1.json().catch(() => ({}))) as ApiParetoRes;
        const j2 = (await r2.json().catch(() => ({}))) as ApiCoverageRes;

        if (!alive) return;

        if (!r1.ok || j1.ok === false) {
          setErr(j1?.error ?? "Failed to load pareto");
          setPareto(null);
          setCoverage(null);
          setLoading(false);
          return;
        }

        if (!r2.ok || j2.ok === false) {
          // coverage is “nice to have” — don’t kill the page
          setCoverage(null);
        } else {
          setCoverage(j2);
        }

        setPareto(j1);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Network error");
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
      ac.abort();
    };
  }, [range, machineId]);
    useEffect(() => {
        let alive = true;
        const ac = new AbortController();

        async function run() {
            setEventsLoading(true);
            setEventsErr(null);

            try {
            const qs = new URLSearchParams();
            qs.set("range", range);
            qs.set("limit", String(eventsLimit));
            if (machineId) qs.set("machineId", machineId);
            if (reasonCode) qs.set("reasonCode", reasonCode);
            if (eventsBefore) qs.set("before", eventsBefore);

            const r = await fetch(`/api/analytics/downtime-events?${qs.toString()}`, {
                cache: "no-cache",
                credentials: "include",
                signal: ac.signal,
            });

            const j = (await r.json().catch(() => ({}))) as ApiDowntimeEventsRes;
            if (!alive) return;

            if (!r.ok || j.ok === false) {
                setEventsErr(j?.error ?? "Failed to load events");
                setEventsRes(null);
                setEventsLoading(false);
                return;
            }

            setEventsRes(j);
            setEventsLoading(false);
            } catch (e: any) {
            if (!alive) return;
            setEventsErr(e?.message ?? "Network error");
            setEventsLoading(false);
            }
        }

        run();
        return () => {
            alive = false;
            ac.abort();
        };
        }, [range, machineId, reasonCode, eventsLimit, eventsBefore]);

  // Derived data
  const baseRows = pareto?.rows ?? [];
  const metricRowsAll = useMemo(() => computeMetricRows(baseRows, metric), [baseRows, metric]);

  const metricRowsFiltered = useMemo(() => {
    if (!reasonCode) return metricRowsAll;
    return metricRowsAll.filter((r) => r.reasonCode === reasonCode);
  }, [metricRowsAll, reasonCode]);

  const totalMinutes = pareto?.totalMinutesLost ?? 0;
  const totalStops = useMemo(
    () => baseRows.reduce((acc, r) => acc + (r.count ?? 0), 0),
    [baseRows]
  );

  const top3Share = useMemo(() => {
    const top3 = metricRowsAll.slice(0, 3);
    return top3.reduce((acc, r) => acc + (r.pctOfTotal ?? 0), 0);
  }, [metricRowsAll]);

  const unclassifiedPct = useMemo(() => findUnclassifiedPct(metricRowsAll), [metricRowsAll]);

  const threshold80Index = useMemo(() => {
    // If API threshold80 exists, it’s based on minutes. For count metric, compute locally.
    if (metric === "minutes") return pareto?.threshold80?.index ?? null;
    const idx = metricRowsAll.findIndex((r) => (r.cumulativePct ?? 0) >= 80);
    return idx >= 0 ? idx : null;
  }, [metric, pareto?.threshold80?.index, metricRowsAll]);

  const heroData = useMemo(() => {
    // Keep hero readable: top 12 (like your screenshot)
    const slice = metricRowsAll.slice(0, 12);
    return slice.map((r, i) => ({
      i,
      code: r.reasonCode,
      label: r.reasonLabel,
      value: r.value,
      cum: r.cumulativePct,
      pct: r.pctOfTotal,
      count: r.count,
    }));
  }, [metricRowsAll]);

const totalDowntimeMin = pareto?.totalMinutesLost ?? 0;
const events = eventsRes?.events ?? [];

useEffect(() => {
  setEventsBefore(null);
}, [range, machineId, reasonCode]);

const filteredEvents = useMemo(() => {
  let list = events;

  // Heatmap filter (day/hour) — filters by overlap with that hour bucket
  if (heatmapSel) {
    list = list.filter((e) => eventTouchesSlot(e, heatmapSel.day, heatmapSel.hour));
  }

  const q = eventSearch.trim().toLowerCase();
  if (!q) return list;

  return list.filter((e) => {
    const hay = [
      e.machineName ?? "",
      e.reasonLabel ?? "",
      e.reasonCode ?? "",
      e.workOrderId ?? "",
      e.episodeId ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}, [events, eventSearch, heatmapSel]);



// Use distinct episodes as "stops" (best available now)
const stops = coverage?.receivedEpisodes ?? totalStops;

// Window minutes for MTBF/Availability
const windowMin =
  range === "24h" ? 24 * 60 :
  range === "7d"  ? 7 * 24 * 60 :
  range === "30d" ? 30 * 24 * 60 : 0;

// Availability loss % (downtime / window)
const availabilityLossPct = windowMin > 0 ? (totalDowntimeMin / windowMin) * 100 : 0;

// MTTR proxy = avg stop duration
const mttrMin = stops > 0 ? totalDowntimeMin / stops : 0;

// MTBF proxy = avg run time between stops
const mtbfHours = stops > 0 ? (Math.max(0, windowMin - totalDowntimeMin) / stops) / 60 : 0;

// Impact (MXN) if rate is given
const rate = Number(mxnPerMinInput || "0");
const estImpactMxn = rate > 0 ? totalDowntimeMin * rate : 0;



  function exportCSV() {
    const rows = metricRowsAll;
    const header = [
    "reasonCode",
    "reasonLabel",
    metric === "minutes" ? "minutesLost" : "count",
    "stops",
    "pctOfTotal",
    "cumulativePct",
    ];
    const lines = [header.join(",")];

    rows.forEach((r) => {
      const v = metric === "minutes" ? (r.value ?? 0) : (r.value ?? 0);
      const cells = [
        `"${String(r.reasonCode ?? "").replaceAll('"', '""')}"`,
        `"${String(r.reasonLabel ?? "").replaceAll('"', '""')}"`,
        String(v),
        String(r.count ?? 0),
        String(r.pctOfTotal ?? 0),
        String(r.cumulativePct ?? 0),
      ];
      lines.push(cells.join(","));
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `downtime_pareto_${metric}_${range}${machineId ? `_machine_${machineId}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function shareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      // silent (you can add a toast later)
    } catch {
      // ignore
    }
  }


  const scopeChips = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-zinc-400">Scope:</span>
      <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
        Org
      </span>
      {machineId ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white">
          Machine filtered
          <button
            className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-white/10"
            onClick={() => setParams({ machineId: null, reasonCode: null })}
          >
            ✕
          </button>
        </span>
      ) : (
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-200">
          All machines
        </span>
      )}
      {reasonCode ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white">
          Reason: {reasonCode}
          <button
            className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-white/10"
            onClick={() => setParams({ reasonCode: null })}
          >
            ✕
          </button>
        </span>
      ) : null}
      {heatmapSel ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white">
            Heatmap: {DAY_LABELS[heatmapSel.day]} {String(heatmapSel.hour).padStart(2, "0")}:00
            <button
            className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-white/10"
            onClick={() => setParams({ hmDay: null, hmHour: null })}
            >
            ✕
            </button>
        </span>
        ) : null}

    </div>
  );
  

    const shift = sp.get("shift") || "all";
    const planned = (sp.get("planned") as "all" | "planned" | "unplanned") || "all";
    const microstopLtMin = sp.get("microstopLtMin") || "2";
    

    const filtersRow = (
    <div className="mt-4 flex items-center justify-between gap-4">
        {/* LEFT: range + metric + reset (never wrap) */}
        <div className="flex items-center gap-2 flex-nowrap overflow-x-auto no-scrollbar">
        <button
            onClick={() => setParams({ range: "24h" })}
            className={cn(
            "h-9 rounded-xl border px-3 text-xs",
            range === "24h"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
            )}
        >
            Today
        </button>
        <button
            onClick={() => setParams({ range: "7d" })}
            className={cn(
            "h-9 rounded-xl border px-3 text-xs",
            range === "7d"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
            )}
        >
            7D
        </button>
        <button
            onClick={() => setParams({ range: "30d" })}
            className={cn(
            "h-9 rounded-xl border px-3 text-xs",
            range === "30d"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
            )}
        >
            30D
        </button>

        <div className="mx-2 h-6 w-px bg-white/10" />

        <button
            onClick={() => setParams({ metric: "minutes" })}
            className={cn(
            "h-9 rounded-xl border px-3 text-xs",
            metric === "minutes"
                ? "border-white/10 bg-white/10 text-white"
                : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
            )}
        >
            Minutes
        </button>
        <button
            onClick={() => setParams({ metric: "count" })}
            className={cn(
            "h-9 rounded-xl border px-3 text-xs",
            metric === "count"
                ? "border-white/10 bg-white/10 text-white"
                : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
            )}
        >
            Count
        </button>

        <div className="mx-2 h-6 w-px bg-white/10" />

        <button
            onClick={() =>
            setParams({
                range: "30d",
                metric: "minutes",
                shift: "all",
                planned: "all",
                microstopLtMin: "2",
                reasonCode: null,
                mxnPerMin: null,
            })
            }
            className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 hover:bg-white/10"
        >
            Reset filters
        </button>
        </div>

        {/* RIGHT: shift + planned/unplanned + microstop (also never wrap) */}
        <div className="flex items-center gap-2 flex-nowrap overflow-x-auto no-scrollbar">
        <select
            value={shift}
            onChange={(e) => setParams({ shift: e.target.value })}
            className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 outline-none hover:bg-white/10"
        >
            <option value="all">All shifts</option>
            <option value="A">Shift A</option>
            <option value="B">Shift B</option>
            <option value="C">Shift C</option>
        </select>

        <select
            value={planned}
            onChange={(e) => setParams({ planned: e.target.value })}
            className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 outline-none hover:bg-white/10"
        >
            <option value="all">Planned + Unplanned</option>
            <option value="planned">Planned</option>
            <option value="unplanned">Unplanned</option>
        </select>

        <div className="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200">
            <span className="text-zinc-400">Microstop &lt;</span>
            <input
            value={microstopLtMin}
            onChange={(e) => setParams({ microstopLtMin: e.target.value })}
            className="w-10 bg-transparent text-right text-xs text-white outline-none"
            />
            <span className="text-zinc-400">min</span>
        </div>
        </div>
    </div>
    );

  function HeroTooltip({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ payload?: any }>;
  }) {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload;
    if (!p) return null;

    return (
      <div className="rounded-xl border border-white/10 bg-zinc-950/95 px-4 py-3 shadow-lg">
        <div className="text-sm font-semibold text-white">{p.label}</div>
        <div className="mt-2 space-y-1 text-xs text-zinc-300">
          <div>
            Value:{" "}
            <span className="text-white">
              {metric === "minutes" ? `${fmtNum(p.value, 1)} min` : fmtNum(p.value, 0)}
            </span>
          </div>
          <div>
            Share: <span className="text-white">{fmtPct(p.pct, 1)}</span>
          </div>
          <div>
            Stops: <span className="text-white">{fmtNum(p.count, 0)}</span>
          </div>
          <div>
            Cumulative: <span className="text-white">{fmtPct(p.cum, 0)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/40 p-6 backdrop-blur-xl">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(900px 500px at 20% 10%, rgba(16,185,129,.18), transparent 60%)," +
              "radial-gradient(900px 500px at 85% 30%, rgba(59,130,246,.12), transparent 60%)," +
              "radial-gradient(900px 600px at 50% 100%, rgba(244,63,94,.10), transparent 60%)",
          }}
        />

        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-2xl font-semibold text-white">Downtime Pareto — Full Report</div>
            <div className="mt-1 text-sm text-zinc-400">
              Analyze downtime patterns and prioritize improvements
            </div>

            <div className="mt-4">{scopeChips}</div>
            {filtersRow}
          </div>

          <div className="relative flex flex-wrap items-center gap-2 lg:justify-end">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <span className="text-xs text-zinc-400">MXN/min</span>
            <input
                value={mxnPerMinInput}
                onChange={(e) => setMxnPerMinInput(e.target.value.replace(/[^\d]/g, ""))}
                onBlur={() => setParams({ mxnPerMin: mxnPerMinInput ? mxnPerMinInput : null })}
                placeholder="0"
                className="w-20 bg-transparent text-right text-sm text-white outline-none"
            />
            </div>

            <button
              onClick={exportCSV}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
            >
              Export
            </button>
            <button
              onClick={shareLink}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
            >
              Share
            </button>

            <span className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-400">
              Plant select (soon)
            </span>

            {machineId ? (
              <Link
                href={`/machines/${encodeURIComponent(machineId)}`}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20"
              >
                Back to machine →
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {/* Loading / error */}
      {loading ? (
        <div className="mt-6 text-sm text-zinc-400">Loading downtime pareto…</div>
      ) : err ? (
        <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      {!loading && !err && (
        <>
          {/* KPI strip */}
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-8">
            <KPI
                label="Total downtime"
                value={fmtHoursFromMinutes(totalDowntimeMin)}
                sub={`${fmtNum(totalDowntimeMin, 1)} min`}
                accent="emerald"
            />
            <KPI
                label="Stops count"
                value={fmtNum(stops, 0)}
                sub="Distinct episodes (coverage)"
                accent="zinc"
            />
            <KPI
                label="Top reason share"
                value={metricRowsAll[0] ? fmtPct(metricRowsAll[0].pctOfTotal, 1) : "—"}
                sub={metricRowsAll[0] ? metricRowsAll[0].reasonLabel : ""}
                accent="yellow"
            />
            <KPI
                label="MTBF"
                value={stops > 0 ? `${fmtNum(mtbfHours, 1)} hrs` : "—"}
                sub="Proxy (window-based)"
            />
            <KPI
                label="MTTR"
                value={stops > 0 ? `${fmtNum(mttrMin, 1)} min` : "—"}
                sub="Avg stop duration"
            />
            <KPI
                label="Availability loss"
                value={windowMin > 0 ? `${fmtNum(availabilityLossPct, 1)}%` : "—"}
                sub="Downtime / window"
                accent="rose"
            />
            <KPI
                label="Est. impact (MXN)"
                value={rate > 0 ? fmtMxn(estImpactMxn) : "—"}
                sub={rate > 0 ? `Rate: ${fmtMxn(rate)}/min` : "Set MXN/min"}
                accent="rose"
            />
            <KPI
                label="Unclassified"
                value={`${fmtNum(unclassifiedPct, 0)}%`}
                sub="Data quality signal"
            />
            </div>


          {/* Hero + breakdown */}
          <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Hero chart */}
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 xl:col-span-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-lg font-semibold text-white">Downtime Pareto Analysis</div>
                  <div className="mt-1 text-xs text-zinc-400">
                    Top reasons by impact · {range} · metric: {metric}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-zinc-300">
                  <div className="text-white">
                    Top 3 reasons explain{" "}
                    <span className="font-semibold">{fmtPct(top3Share, 1)}</span>
                  </div>
                  <div className="mt-1 text-zinc-400">
                    Fix these first = highest ROI
                  </div>
                </div>
              </div>

              <div
                className="mt-4 h-[360px] rounded-3xl border border-white/10 bg-black/30 p-4 backdrop-blur"
                style={{ boxShadow: "var(--app-chart-shadow)" }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={heroData}
                    onClick={(st: any) => {
                      const p = st?.activePayload?.[0]?.payload;
                      if (!p?.code) return;
                      setParams({ reasonCode: p.code });
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
                    <XAxis
                      dataKey="label"
                      interval={0}
                      tick={{ fill: "var(--app-chart-tick)" }}
                      tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 14)}…` : v)}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fill: "var(--app-chart-tick)" }}
                      tickFormatter={(v: number) =>
                        metric === "minutes" ? `${v}` : `${v}`
                      }
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      domain={[0, 100]}
                      tick={{ fill: "var(--app-chart-tick)" }}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip content={<HeroTooltip />} cursor={{ stroke: "var(--app-chart-grid)" }} />

                    <Bar
                      yAxisId="left"
                      dataKey="value"
                      radius={[10, 10, 0, 0]}
                      isAnimationActive={false}
                      fill="rgba(16,185,129,0.85)"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="cum"
                      stroke="rgba(110,231,183,0.95)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <ReferenceLine
                      yAxisId="right"
                      y={80}
                      stroke="rgba(255,255,255,0.25)"
                      strokeDasharray="6 6"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {threshold80Index != null && metricRowsAll[threshold80Index] ? (
                <div className="mt-3 text-xs text-zinc-400">
                  80% threshold reached at{" "}
                  <span className="text-white">{metricRowsAll[threshold80Index].reasonLabel}</span>
                </div>
              ) : null}
            </div>

            {/* Reason breakdown */}
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">Reason Breakdown</div>
                  <div className="mt-1 text-xs text-zinc-400">Click row for details</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300">
                  Top {Math.min(12, metricRowsAll.length)}
                </div>
              </div>

              <div className="mt-4 max-h-[360px] overflow-y-auto no-scrollbar rounded-2xl border border-white/10 bg-black/20">
                <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-[11px] text-zinc-500">
                  <div className="col-span-8">Reason</div>
                  <div className="col-span-4 text-right">{metric === "minutes" ? "Minutes" : "Count"}</div>
                </div>

                {metricRowsAll.slice(0, 12).map((r) => {
                  const active = reasonCode === r.reasonCode;
                  return (
                    <button
                      key={r.reasonCode}
                      className={cn(
                        "grid w-full grid-cols-12 gap-2 px-4 py-3 text-left text-sm transition",
                        "border-b border-white/5 hover:bg-white/5",
                        active && "bg-emerald-500/10"
                      )}
                      onClick={() => {
                        setDrawer({ open: true, row: r });
                        setParams({ reasonCode: r.reasonCode });
                      }}
                    >
                      <div className="col-span-8">
                        <div className="truncate text-white">{r.reasonLabel}</div>
                        <div className="mt-1 text-[11px] text-zinc-400">
                          {fmtPct(r.pctOfTotal, 1)} · {fmtNum(r.count, 0)} stops
                        </div>
                      </div>
                      <div className="col-span-4 text-right">
                        <div className="text-white">
                          {metric === "minutes" ? `${fmtNum(r.value, 1)}m` : fmtNum(r.value, 0)}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500">
                          cum {fmtPct(r.cumulativePct, 0)}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {metricRowsAll.length === 0 ? (
                  <div className="p-4 text-sm text-zinc-400">No data for this range.</div>
                ) : null}
              </div>

              {/* Coverage mini */}
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold text-white">Coverage received</div>
                <div className="mt-1 text-xs text-zinc-400">
                  Sync health from Control Tower ingest
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-zinc-400">Episodes</div>
                    <div className="mt-1 text-base font-semibold text-white">
                      {coverage?.receivedEpisodes != null ? fmtNum(coverage.receivedEpisodes, 0) : "—"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-zinc-400">Minutes</div>
                    <div className="mt-1 text-base font-semibold text-white">
                      {coverage?.receivedMinutes != null ? fmtNum(coverage.receivedMinutes, 1) : "—"}
                    </div>
                  </div>
                </div>

                {coverage?.note ? (
                  <div className="mt-3 text-[11px] text-zinc-500">{coverage.note}</div>
                ) : null}
              </div>
            </div>
          </div>
          

          {/* Drilldown table */}
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-lg font-semibold text-white">Drilldown table</div>
                <div className="mt-1 text-xs text-zinc-400">
                  Sortable later · click row opens drawer
                </div>
              </div>
              <div className="text-xs text-zinc-400">
                Showing {metricRowsFiltered.length} / {metricRowsAll.length}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-white/10 text-[11px] text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3 text-right">Downtime (min)</th>
                    <th className="px-4 py-3 text-right">Stops</th>
                    <th className="px-4 py-3 text-right">Avg (min)</th>
                    <th className="px-4 py-3 text-right">% share</th>
                    <th className="px-4 py-3 text-right">Cum %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {metricRowsFiltered.map((r) => {
                    const avg =
                      r.count > 0 && r.minutesLost != null ? r.minutesLost / r.count : null;

                    return (
                      <tr
                        key={r.reasonCode}
                        className={cn(
                          "cursor-pointer hover:bg-white/5",
                          reasonCode === r.reasonCode && "bg-emerald-500/10"
                        )}
                        onClick={() => {
                          setDrawer({ open: true, row: r });
                          setParams({ reasonCode: r.reasonCode });
                        }}
                      >
                        <td className="px-4 py-3">
                          <div className="truncate text-white">{r.reasonLabel}</div>
                          <div className="mt-1 text-[11px] text-zinc-500">{r.reasonCode}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-white">
                          {r.minutesLost != null ? fmtNum(r.minutesLost, 1) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-white">{fmtNum(r.count, 0)}</td>
                        <td className="px-4 py-3 text-right text-zinc-200">
                          {avg == null ? "—" : fmtNum(avg, 1)}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-200">{fmtPct(r.pctOfTotal, 1)}</td>
                        <td className="px-4 py-3 text-right text-zinc-200">{fmtPct(r.cumulativePct, 0)}</td>
                      </tr>
                    );
                  })}

                  {metricRowsFiltered.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-sm text-zinc-400" colSpan={6}>
                        No rows.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {/* Patterns + Events + Actions (layout placeholders, no endpoints yet) */}
          <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 xl:col-span-2">
              <div className="text-lg font-semibold text-white">Patterns (heatmaps)</div>
              <div className="mt-1 text-xs text-zinc-400">
                Add endpoints later: hour-of-day × day heatmap, shift comparisons
              </div>
              <Heatmap
                events={events}
                metric={metric}
                selected={heatmapSel}
                onSelect={(day, hour) => setParams({ hmDay: String(day), hmHour: String(hour) })}
                onClear={() => setParams({ hmDay: null, hmHour: null })}
                />

            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-lg font-semibold text-white">Actions & ownership</div>
              <div className="mt-1 text-xs text-zinc-400">
                Next: create action from reason/event (owner, due date, status)
              </div>
              <ActionsOwnershipPanel
                machineId={machineId}
                reasonCode={reasonCode}
                heatmapSel={heatmapSel}
                onFocusReason={(code) => setParams({ reasonCode: code })}
                />

            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                <div className="text-lg font-semibold text-white">Event list (audit trail)</div>
                <div className="mt-1 text-xs text-zinc-400">
                    Real downtime episodes · filtered by scope + reason
                </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                <input
                    value={eventSearch}
                    onChange={(e) => setEventSearch(e.target.value)}
                    placeholder="Search machine / reason / WO / episode…"
                    className="h-9 w-[260px] rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-white outline-none placeholder:text-zinc-500"
                />

                <select
                    value={String(eventsLimit)}
                    onChange={(e) => {
                    setEventsBefore(null);
                    setEventsLimit(Number(e.target.value));
                    }}
                    className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 outline-none hover:bg-white/10"
                >
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="300">300</option>
                    <option value="500">500</option>
                </select>

                <button
                    onClick={() => setEventsBefore(null)}
                    className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 hover:bg-white/10"
                >
                    Newest
                </button>

                <button
                    disabled={!eventsRes?.nextBefore}
                    onClick={() => setEventsBefore(eventsRes?.nextBefore ?? null)}
                    className={cn(
                    "h-9 rounded-xl border px-3 text-xs",
                    eventsRes?.nextBefore
                        ? "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                        : "border-white/10 bg-white/5 text-zinc-500 opacity-50 cursor-not-allowed"
                    )}
                >
                    Older →
                </button>
                </div>
            </div>

            {eventsLoading ? (
                <div className="mt-4 text-sm text-zinc-400">Loading events…</div>
            ) : eventsErr ? (
                <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                {eventsErr}
                </div>
            ) : (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
                <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="border-b border-white/10 text-[11px] text-zinc-500">
                    <tr>
                        <th className="px-4 py-3">Start</th>
                        <th className="px-4 py-3">End</th>
                        <th className="px-4 py-3">Machine</th>
                        <th className="px-4 py-3">Reason</th>
                        <th className="px-4 py-3">WO</th>
                        <th className="px-4 py-3 text-right">Duration</th>
                        <th className="px-4 py-3 text-right">Episode</th>
                    </tr>
                    </thead>

                    <tbody className="divide-y divide-white/5">
                    {filteredEvents.map((e) => {
                        const isActive = reasonCode === e.reasonCode;
                        const durMin = e.durationMinutes ?? (e.durationSeconds != null ? e.durationSeconds / 60 : null);

                        return (
                        <tr
                            key={e.id}
                            className={cn(
                            "cursor-pointer hover:bg-white/5",
                            isActive && "bg-emerald-500/10"
                            )}
                            onClick={() => {
                            // clicking an event focuses the rest of the page on its reason
                            setParams({ reasonCode: e.reasonCode });
                            }}
                            title="Click to focus this reason"
                        >
                            <td className="px-4 py-3 text-zinc-200">{fmtDT(e.startAt)}</td>
                            <td className="px-4 py-3 text-zinc-200">{fmtDT(e.endAt)}</td>
                            <td className="px-4 py-3">
                            <div className="truncate text-white">{e.machineName ?? "—"}</div>
                            <div className="mt-1 text-[11px] text-zinc-500">{e.machineId}</div>
                            </td>
                            <td className="px-4 py-3">
                            <div className="truncate text-white">{e.reasonLabel}</div>
                            <div className="mt-1 text-[11px] text-zinc-500">{e.reasonCode}</div>
                            </td>
                            <td className="px-4 py-3 text-zinc-200">{e.workOrderId ?? "—"}</td>
                            <td className="px-4 py-3 text-right text-white">
                            {durMin == null ? "—" : `${fmtNum(durMin, 1)} min`}
                            </td>
                            <td className="px-4 py-3 text-right text-[11px] text-zinc-500">
                            {e.episodeId ?? "—"}
                            </td>
                        </tr>
                        );
                    })}

                    {filteredEvents.length === 0 ? (
                        <tr>
                        <td className="px-4 py-6 text-sm text-zinc-400" colSpan={7}>
                            No events found for this filter/range.
                        </td>
                        </tr>
                    ) : null}
                    </tbody>
                </table>
                </div>
            )}

            <div className="mt-3 text-[11px] text-zinc-500">
                Tip: click any row to focus the whole page on that reason (Pareto + table + drawer).
            </div>
            </div>

        </>
      )}

      <ReasonDrawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false, row: null })}
        row={drawer.row}
        metric={metric}
      />
    </div>
  );
}
