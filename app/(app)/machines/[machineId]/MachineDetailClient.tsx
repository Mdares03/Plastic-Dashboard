"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ComposedChart } from "recharts";
import { Cell } from "recharts";


import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  BarChart,
  Bar,
} from "recharts";


type Heartbeat = {
  ts: string;
  status: string;
  message?: string | null;
  ip?: string | null;
  fwVersion?: string | null;
};

type Kpi = {
  ts: string;
  oee?: number | null;
  availability?: number | null;
  performance?: number | null;
  quality?: number | null;
  workOrderId?: string | null;
  sku?: string | null;
  good?: number | null;
  scrap?: number | null;
  target?: number | null;
  cycleTime?: number | null;
};

type EventRow = {
  id: string;
  ts: string;
  topic: string;
  eventType: string;
  severity: string;
  title: string;
  description?: string | null;
  requiresAck: boolean;
};

type CycleRow = {
  ts: string;     // ISO
  t: number;      // epoch ms
  cycleCount: number | null;
  actual: number; // seconds
  ideal: number | null;
  workOrderId: string | null;
  sku: string | null;
};

type CycleDerivedRow = CycleRow & {
  extra: number | null;
  bucket: "normal" | "slow" | "microstop" | "macrostop" | "unknown";
};

type MachineDetail = {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
  latestHeartbeat: Heartbeat | null;
  latestKpi: Kpi | null;
};

export default function MachineDetailClient() {
  const params = useParams<{ machineId: string }>();
  const machineId = params?.machineId;

  const [loading, setLoading] = useState(true);
  const [machine, setMachine] = useState<MachineDetail | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [open, setOpen] = useState<null | "events" | "deviation" | "impact">(null);
  

  const BUCKET = {
  normal:   { label: "Ciclo Normal",  dot: "#12D18E", glow: "rgba(18,209,142,.35)", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" },
  slow:     { label: "Ciclo Lento",   dot: "#F7B500", glow: "rgba(247,181,0,.35)", chip: "bg-yellow-500/15 text-yellow-300 border-yellow-500/20" },
  microstop:{ label: "Microparo",     dot: "#FF7A00", glow: "rgba(255,122,0,.35)", chip: "bg-orange-500/15 text-orange-300 border-orange-500/20" },
  macrostop:{ label: "Macroparo",     dot: "#FF3B5C", glow: "rgba(255,59,92,.35)", chip: "bg-rose-500/15 text-rose-300 border-rose-500/20" },
  unknown:  { label: "Desconocido",   dot: "#A1A1AA", glow: "rgba(161,161,170,.25)", chip: "bg-white/10 text-zinc-200 border-white/10" },
  } as const;




  useEffect(() => {
    if (!machineId) return; // <-- IMPORTANT guard

    let alive = true;

    async function load() {
      try {
        const res = await fetch(`/api/machines/${machineId}?windowSec=10800`, {
          cache: "no-store",
          credentials: "include",
        });
        const json = await res.json();
        



        if (!alive) return;

        if (!res.ok || json?.ok === false) {
          setError(json?.error ?? "Failed to load machine");
          setLoading(false);
          return;
        }

        setMachine(json.machine ?? null);
        setEvents(json.events ?? []);
        setCycles(json.cycles ?? []);
        setError(null);
        setLoading(false);
      } catch {
        if (!alive) return;
        setError("Network error");
        setLoading(false);
      }
      
    }

    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [machineId]);

  

  function fmtPct(v?: number | null) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return `${v.toFixed(1)}%`;
  }

  function fmtNum(v?: number | null) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return `${v}`;
  }

  function timeAgo(ts?: string) {
    if (!ts) return "never";
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  function isOffline(ts?: string) {
    if (!ts) return true;
    return Date.now() - new Date(ts).getTime() > 15000;
  }

  function statusBadgeClass(status?: string, offline?: boolean) {
    if (offline) return "bg-white/10 text-zinc-300";
    const s = (status ?? "").toUpperCase();
    if (s === "RUN") return "bg-emerald-500/15 text-emerald-300";
    if (s === "IDLE") return "bg-yellow-500/15 text-yellow-300";
    if (s === "STOP" || s === "DOWN") return "bg-red-500/15 text-red-300";
    return "bg-white/10 text-white";
  }

  function severityBadgeClass(sev?: string) {
    const s = (sev ?? "").toLowerCase();
    if (s === "critical") return "bg-red-500/15 text-red-300";
    if (s === "warning") return "bg-yellow-500/15 text-yellow-300";
    return "bg-white/10 text-zinc-200";
  }

  const hb = machine?.latestHeartbeat ?? null;
  const kpi = machine?.latestKpi ?? null;
  const offline = useMemo(() => isOffline(hb?.ts), [hb?.ts]);
  const statusLabel = offline ? "OFFLINE" : (hb?.status ?? "UNKNOWN");
  const cycleTarget = (machine as any)?.effectiveCycleTime ?? kpi?.cycleTime ?? null;

  const ActiveRing = (props: any) => {
    const { cx, cy, fill } = props;
    if (cx == null || cy == null) return null;
    return (
      <g>
        <circle cx={cx} cy={cy} r={7} fill="transparent" stroke="white" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={4} fill={fill} />
      </g>
    );
  };

  function MiniCard({
  title,
  subtitle,
  value,
  onClick,
  }: {
    title: string;
    subtitle: string;
    value: string;
    onClick?: () => void;
  }) {
    const clickable = typeof onClick === "function";

    if (clickable) {
      return (
        <button
          type="button"
          onClick={onClick}
          className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left hover:bg-white/10 transition cursor-pointer"
        >
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-xs text-zinc-400">{subtitle}</div>
          <div className="mt-4 text-3xl font-semibold text-white">{value}</div>
        </button>
      );
    }

    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-1 text-xs text-zinc-400">{subtitle}</div>
        <div className="mt-4 text-3xl font-semibold text-white">{value}</div>
      </div>
    );
  }


  function MachineActivityTimeline({
    segments,
    windowSec,
  }: {
    segments: TimelineSeg[];
    windowSec: number;
  }) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white">Machine Activity Timeline</div>
            <div className="mt-1 text-xs text-zinc-400">Análisis en tiempo real de ciclos de producción</div>
          </div>
          <div className="text-xs text-zinc-400">{windowSec}s</div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-zinc-300">
          {(["normal","slow","microstop","macrostop"] as const).map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BUCKET[k].dot }} />
              <span>{BUCKET[k].label}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
          {/* time marks */}
          <div className="mb-2 flex justify-between text-[11px] text-zinc-500">
            <span>0s</span>
            <span>3h</span>
          </div>

          {/* strip */}
          <div className="flex h-14 w-full overflow-hidden rounded-2xl">
            {segments.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
                No timeline data yet.
              </div>
            ) : (
              segments.map((seg, idx) => {
                const wPct = Math.max(0.25, (seg.durationSec / windowSec) * 100); // min width for visibility
                const meta = BUCKET[seg.state];

                const glow =
                  seg.state === "microstop" || seg.state === "macrostop"
                    ? `0 0 22px ${meta.glow}`
                    : `0 0 12px ${meta.glow}`;

                return (
                  <div
                    key={`${seg.start}-${seg.end}-${idx}`}
                    title={`${meta.label}: ${seg.durationSec.toFixed(1)}s`}
                    className="h-full"
                    style={{
                      width: `${wPct}%`,
                      background: meta.dot,
                      boxShadow: glow,
                      opacity: 0.95,
                    }}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  function Modal({
  open,
  onClose,
  title,
  children,
  }: {
    open: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
  }) {
    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* overlay */}
        <div className="absolute inset-0 bg-black/70" onClick={onClose} />

        {/* panel */}
        <div className="relative w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/80 p-6 shadow-2xl backdrop-blur-xl">
          {/* gradient wash (Step 2) */}
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(900px 400px at 20% 10%, rgba(16,185,129,.18), transparent 60%)," +
                "radial-gradient(900px 400px at 85% 30%, rgba(59,130,246,.14), transparent 60%)," +
                "radial-gradient(900px 500px at 50% 100%, rgba(244,63,94,.10), transparent 60%)",
            }}
          />

          {/* content */}
          <div className="relative">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-semibold text-white">{title}</div>
              <button
                onClick={onClose}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-white hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            {children}
          </div>
        </div>
      </div>
    );
  }


  function CycleTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;

    const p = payload[0]?.payload;
    if (!p) return null;

    const ideal = p.ideal ?? null;
    const actual = p.actual ?? null;
    const deltaPct = p.deltaPct ?? null;

    return (
      <div className="rounded-xl border border-white/10 bg-zinc-950/95 px-4 py-3 shadow-lg">
        <div className="text-sm font-semibold text-white">Ciclo: {label}</div>
        <div className="mt-2 space-y-1 text-xs text-zinc-300">
          <div>Duración: <span className="text-white">{actual?.toFixed(2)}s</span></div>
          <div>Ideal: <span className="text-white">{ideal != null ? `${ideal.toFixed(2)}s` : "—"}</span></div>
          <div>Desviación: <span className="text-white">{deltaPct != null ? `${deltaPct.toFixed(1)}%` : "—"}</span></div>
        </div>
      </div>
    );
  }




  const TOL = 0.10;
  function hasIdealAndActual(r: CycleDerivedRow): r is CycleDerivedRow & { ideal: number; actual: number } {
  return r.ideal != null && r.actual != null && r.ideal > 0;
  }
  const cycleDerived = useMemo(() => {
    const rows = cycles ?? [];

    const mapped: CycleDerivedRow[] = rows.map((c) => {
    const ideal = c.ideal ?? null;
    const actual = c.actual ?? null;
    const extra = ideal != null && actual != null ? actual - ideal : null;

    let bucket: CycleDerivedRow["bucket"] = "unknown";
    if (ideal != null && actual != null) {
      if (actual <= ideal * (1 + TOL)) bucket = "normal";
      else if (extra != null && extra <= 1) bucket = "slow";
      else if (extra != null && extra <= 10) bucket = "microstop";
      else bucket = "macrostop";
    }

    return { ...c, ideal, actual, extra, bucket };
  });

    const counts = mapped.reduce(
      (acc, r) => {
        acc.total += 1;
        acc[r.bucket] += 1;
        if (r.extra != null && r.extra > 0) acc.extraTotal += r.extra;
        return acc;
      },
      { total: 0, normal: 0, slow: 0, microstop: 0, macrostop: 0, unknown: 0, extraTotal: 0 }
    );

    const deltas = mapped
    .filter(hasIdealAndActual)
    .map((r) => ((r.actual - r.ideal) / r.ideal) * 100);

    const avgDeltaPct = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;

    return { mapped, counts, avgDeltaPct };
  }, [cycles]);
  const deviationSeries = useMemo(() => {
  // use last N cycles to keep chart readable
    const last = cycleDerived.mapped.slice(-100);

    return last
      .map((r, idx) => {
        const ideal = r.ideal;
        const actual = r.actual;
        if (ideal == null || actual == null || ideal <= 0) return null;

        const deltaPct = ((actual - ideal) / ideal) * 100;

        return {
          i: idx + 1,           // x-axis index (cycle order)
          actual,
          ideal,
          deltaPct,
          bucket: r.bucket,
        };
      })
      .filter(Boolean) as Array<{
      i: number;
      actual: number;
      ideal: number;
      deltaPct: number;
      bucket: string;
    }>;
  }, [cycleDerived.mapped]);

  const impactAgg = useMemo(() => {
    // sum extra seconds by bucket
    const buckets = { slow: 0, microstop: 0, macrostop: 0 } as Record<string, number>;

    for (const r of cycleDerived.mapped) {
      if (!r.extra || r.extra <= 0) continue;
      if (r.bucket === "slow" || r.bucket === "microstop" || r.bucket === "macrostop") {
        buckets[r.bucket] += r.extra;
      }
    }

    const rows = [
      { name: "Slow", seconds: Math.round(buckets.slow * 10) / 10 },
      { name: "Microstop", seconds: Math.round(buckets.microstop * 10) / 10 },
      { name: "Macrostop", seconds: Math.round(buckets.macrostop * 10) / 10 },
    ];

    const total = rows.reduce((a, b) => a + b.seconds, 0);
    return { rows, total };
  }, [cycleDerived.mapped]);

  type TimelineState = "normal" | "slow" | "microstop" | "macrostop";
type TimelineSeg = {
  start: number;      // ms
  end: number;        // ms
  durationSec: number;
  state: TimelineState;
};

function classifyGap(dtSec: number, idealSec: number): TimelineState {
  const SLOW_X = 1.5;
  const STOP_X = 3.0;
  const MACRO_X = 10.0;

  if (dtSec <= idealSec * SLOW_X) return "normal";
  if (dtSec <= idealSec * STOP_X) return "slow";
  if (dtSec <= idealSec * MACRO_X) return "microstop";
  return "macrostop";
}

function mergeAdjacent(segs: TimelineSeg[]): TimelineSeg[] {
  if (!segs.length) return [];
  const out: TimelineSeg[] = [segs[0]];
  for (let i = 1; i < segs.length; i++) {
    const prev = out[out.length - 1];
    const cur = segs[i];
    // merge if same state and touching
    if (cur.state === prev.state && cur.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, cur.end);
      prev.durationSec = (prev.end - prev.start) / 1000;
    } else {
      out.push(cur);
    }
  }
  return out;
}

const timeline = useMemo(() => {
  const rows = cycles ?? [];
  if (rows.length < 2) {
    return { windowSec: 10800, segments: [] as TimelineSeg[], start: null as number | null, end: null as number | null };
  }

  // window: last 180s (like your screenshot)
  const windowSec = 10800;
  const end = rows[rows.length - 1].t;
  const start = end - windowSec * 1000;

  // keep cycles that overlap window (need one cycle before start to build first interval)
  const idxFirst = Math.max(
    0,
    rows.findIndex(r => r.t >= start) - 1
  );
  const sliced = rows.slice(idxFirst);

  const segs: TimelineSeg[] = [];

  for (let i = 1; i < sliced.length; i++) {
    const prev = sliced[i - 1];
    const cur = sliced[i];

    const s = Math.max(prev.t, start);
    const e = Math.min(cur.t, end);
    if (e <= s) continue;

    const dtSec = (cur.t - prev.t) / 1000;

    const ideal = (cur.ideal ?? prev.ideal ?? cycleTarget ?? 0) as number;
    if (!ideal || ideal <= 0) continue;

    const state = classifyGap(dtSec, ideal);

    segs.push({
      start: s,
      end: e,
      durationSec: (e - s) / 1000,
      state,
    });
  }

  const segments = mergeAdjacent(segs);

  return { windowSec, segments, start, end };
}, [cycles, cycleTarget]);



  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold text-white">
              {machine?.name ?? "Machine"}
            </h1>
            <span className={`rounded-full px-3 py-1 text-xs ${statusBadgeClass(hb?.status, offline)}`}>
              {statusLabel}
            </span>
          </div>
          <div className="mt-1 text-sm text-zinc-400">
            {machine?.code ? machine.code : "—"} • {machine?.location ? machine.location : "—"} • Last seen{" "}
            {hb?.ts ? timeAgo(hb.ts) : "never"}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/machines"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Back
          </Link>
        </div>
      </div>

      {loading && <div className="text-sm text-zinc-400">Loading…</div>}
      {error && !loading && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs text-zinc-400">OEE</div>
              <div className="mt-2 text-3xl font-bold text-emerald-300">{fmtPct(kpi?.oee)}</div>
              <div className="mt-1 text-xs text-zinc-400">Updated {kpi?.ts ? timeAgo(kpi.ts) : "never"}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs text-zinc-400">Availability</div>
              <div className="mt-2 text-2xl font-semibold text-white">{fmtPct(kpi?.availability)}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs text-zinc-400">Performance</div>
              <div className="mt-2 text-2xl font-semibold text-white">{fmtPct(kpi?.performance)}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs text-zinc-400">Quality</div>
              <div className="mt-2 text-2xl font-semibold text-white">{fmtPct(kpi?.quality)}</div>
            </div>
          </div>

          <div className="mt-6">
            <MachineActivityTimeline segments={timeline.segments} windowSec={timeline.windowSec} />
          </div>

          {/* Work order + recent events */}
          <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-1">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-white">Current Work Order</div>
                <div className="text-xs text-zinc-400">{kpi?.workOrderId ?? "—"}</div>
              </div>

              <div className="text-xs text-zinc-400">SKU</div>
              <div className="mt-1 text-base font-semibold text-white">{kpi?.sku ?? "—"}</div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[11px] text-zinc-400">Target</div>
                  <div className="mt-1 text-sm font-semibold text-white">{fmtNum(kpi?.target)}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[11px] text-zinc-400">Good</div>
                  <div className="mt-1 text-sm font-semibold text-white">{fmtNum(kpi?.good)}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[11px] text-zinc-400">Scrap</div>
                  <div className="mt-1 text-sm font-semibold text-white">{fmtNum(kpi?.scrap)}</div>
                </div>
              </div>

              <div className="mt-4 text-xs text-zinc-400">
                Cycle target: <span className="text-white">{cycleTarget ? `${cycleTarget}s` : "—"}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-2 flex flex-col">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-white">Recent Events</div>
                <div className="text-xs text-zinc-400">{events.length} shown</div>
              </div>

              {events.length === 0 ? (
                <div className="text-sm text-zinc-400">No events yet.</div>
                ) : (
                <div className="h-[300px] overflow-y-auto no-scrollbar space-y-3">
                  {events.map((e) => (
                    <div key={e.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs ${severityBadgeClass(e.severity)}`}>
                              {e.severity.toUpperCase()}
                            </span>
                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-zinc-200">
                              {e.eventType}
                            </span>
                            {e.requiresAck && (
                              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white">
                                ACK
                              </span>
                            )}
                          </div>

                          <div className="mt-2 truncate text-sm font-semibold text-white">{e.title}</div>
                          {e.description && (
                            <div className="mt-1 text-sm text-zinc-300">{e.description}</div>
                          )}
                        </div>

                        <div className="shrink-0 text-xs text-zinc-400">{timeAgo(e.ts)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Mini analysis cards */}
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <MiniCard
              title="Eventos Detectados"
              subtitle="Conteo por tipo (ciclos)"
              value={`${cycleDerived.counts.slow + cycleDerived.counts.microstop + cycleDerived.counts.macrostop}`}
              onClick={() => setOpen("events")}
            />
            <MiniCard
              title="Ciclo Real vs Estándar"
              subtitle="Desviación promedio"
              value={cycleDerived.avgDeltaPct == null ? "—" : `${cycleDerived.avgDeltaPct.toFixed(1)}%`}
              onClick={() => setOpen("deviation")}
            />
            <MiniCard
              title="Impacto en Producción"
              subtitle="Tiempo extra vs ideal"
              value={`${Math.round(cycleDerived.counts.extraTotal)}s`}
              onClick={() => setOpen("impact")}
            />
          </div>
          <Modal
            open={open === "events"}
            onClose={() => setOpen(null)}
            title="Eventos Detectados"
            >
            <div className="max-h-[60vh] overflow-y-auto space-y-2 no-scrollbar">
              {cycleDerived.mapped
                .filter((r) => r.bucket !== "normal" && r.bucket !== "unknown")
                .slice()
                .reverse()
                .map((r, idx) => {
                  const meta = BUCKET[r.bucket as keyof typeof BUCKET];

                  return (
                    <div
                      key={r.t ?? r.ts ?? idx}
                      className="rounded-xl border border-white/10 bg-white/5 p-3 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* left accent dot */}
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: meta.dot, boxShadow: `0 0 14px ${meta.glow}` }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {/* colored chip */}
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${meta.chip}`}>
                              {meta.label}
                            </span>

                            <span className="text-sm text-white truncate">
                              {r.actual?.toFixed(2)}s
                              {r.ideal != null ? ` (ideal ${r.ideal.toFixed(2)}s)` : ""}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-xs text-zinc-400 shrink-0">{timeAgo(r.ts)}</div>
                    </div>
                  );
                })}
            </div>
          </Modal>
          <Modal
            open={open === "deviation"}
            onClose={() => setOpen(null)}
            title="Ciclo Real vs Estándar"
          >
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">Ciclo estándar (ideal)</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {cycleTarget ? `${Number(cycleTarget).toFixed(1)}s` : "—"}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">Desviación promedio</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {cycleDerived.avgDeltaPct == null ? "—" : `${cycleDerived.avgDeltaPct.toFixed(1)}%`}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">Muestra</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {deviationSeries.length} ciclos
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="h-[380px] rounded-3xl border border-white/10 bg-black/30 p-4 shadow-[0_0_30px_rgba(0,0,0,0.6)] backdrop-blur">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={deviationSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />

                    <XAxis
                      dataKey="i"
                      type="number"
                      domain={[1, "dataMax"]}
                      allowDecimals={false}
                      tick={{ fill: "#a1a1aa" }}
                    />

                    <YAxis
                      tick={{ fill: "#a1a1aa" }}
                      domain={
                        kpi?.cycleTime
                          ? [
                              Math.max(0, kpi.cycleTime * (1 - TOL) - 2),
                              kpi.cycleTime * (1 + TOL) + 2,
                            ]
                          : ["auto", "auto"]
                      }
                    />

                    <Tooltip content={<CycleTooltip />} cursor={{ stroke: "rgba(255,255,255,0.15)" }} />

                    {/* Ideal center line */}
                    {kpi?.cycleTime ? (
                      <>
                        <ReferenceLine y={kpi.cycleTime} stroke="rgba(18,209,142,0.6)" strokeWidth={2} />

                        {/* ±10% tolerance band lines */}
                        <ReferenceLine
                          y={kpi.cycleTime * (1 - TOL)}
                          stroke="rgba(247,181,0,0.7)"
                          strokeDasharray="6 6"
                        />
                        <ReferenceLine
                          y={kpi.cycleTime * (1 + TOL)}
                          stroke="rgba(247,181,0,0.7)"
                          strokeDasharray="6 6"
                        />
                      </>
                    ) : null}

                    {/* Optional: ideal line from series */}
                    <Line
                      dataKey="ideal"
                      dot={false}
                      activeDot={false}
                      stroke="rgba(255,255,255,0.35)"
                    />


                    {/* ONE scatter so hover always matches */}
                    <Scatter
                      dataKey="actual"
                      isAnimationActive={false}
                      activeShape={<ActiveRing />}
                      shape={(props: any) => {
                        const { cx, cy, payload } = props;
                        const meta = BUCKET[payload.bucket as keyof typeof BUCKET] ?? BUCKET.unknown;

                        return (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={5}
                            fill={meta.dot}
                            style={{ filter: `drop-shadow(0 0 8px ${meta.glow})` }}
                          />
                        );
                      }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="text-xs text-zinc-400">
                Tip: la línea tenue es el ideal. Cada punto es un ciclo real.
              </div>
            </div>
          </Modal>
          <Modal
            open={open === "impact"}
            onClose={() => setOpen(null)}
            title="Impacto en Producción"
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">Tiempo extra total</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {Math.round(impactAgg.total)}s
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">Microstops</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {Math.round((impactAgg.rows.find(r => r.name === "Microstop")?.seconds ?? 0))}s
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">Macroparos</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {Math.round((impactAgg.rows.find(r => r.name === "Macrostop")?.seconds ?? 0))}s
                  </div>
                </div>
              </div>

              <div className="h-[380px] rounded-3xl border border-white/10 bg-black/30 p-4 shadow-[0_0_30px_rgba(0,0,0,0.6)] backdrop-blur">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={impactAgg.rows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fill: "#a1a1aa" }} />
                    <YAxis tick={{ fill: "#a1a1aa" }} />
                    <Tooltip
                      shared={false}
                      contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)" }}
                      labelStyle={{ color: "#fff" }}
                      formatter={(val: any) => [`${Number(val).toFixed(1)}s`, "Tiempo extra"]}
                    />
                    <Bar dataKey="seconds" radius={[10, 10, 0, 0]} isAnimationActive={false}>
                      {impactAgg.rows.map((row, idx) => {
                        const key =
                          row.name === "Slow" ? "slow" :
                          row.name === "Microstop" ? "microstop" :
                          "macrostop";

                        return <Cell key={idx} fill={BUCKET[key].dot} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="text-xs text-zinc-400">
                Esto es “tiempo perdido” vs ideal, distribuido por tipo de evento.
              </div>
            </div>
          </Modal>

        </>
        
      )}
    </div>
  );
}
