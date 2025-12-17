"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";


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

  useEffect(() => {
    if (!machineId) return; // <-- IMPORTANT guard

    let alive = true;

    async function load() {
      try {
        const res = await fetch(`/api/machines/${machineId}`, {
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
                Cycle target: <span className="text-white">{kpi?.cycleTime ? `${kpi.cycleTime}s` : "—"}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-white">Recent Events</div>
                <div className="text-xs text-zinc-400">{events.length} shown</div>
              </div>

              {events.length === 0 ? (
                <div className="text-sm text-zinc-400">No events yet.</div>
              ) : (
                <div className="space-y-3">
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
        </>
      )}
    </div>
  );
}
