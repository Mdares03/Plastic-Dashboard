"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type MachineRow = {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
  latestHeartbeat: null | {
    ts: string;
    status: string;
    message?: string | null;
    ip?: string | null;
    fwVersion?: string | null;
  };
};

function secondsAgo(ts?: string) {
  if (!ts) return "never";
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

function isOffline(ts?: string) {
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > 15000; // 15s threshold
}

function badgeClass(status?: string, offline?: boolean) {
  if (offline) return "bg-white/10 text-zinc-300";
  const s = (status ?? "").toUpperCase();
  if (s === "RUN") return "bg-emerald-500/15 text-emerald-300";
  if (s === "IDLE") return "bg-yellow-500/15 text-yellow-300";
  if (s === "STOP" || s === "DOWN") return "bg-red-500/15 text-red-300";
  return "bg-white/10 text-white";
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const res = await fetch("/api/machines", { cache: "no-store" });
        const json = await res.json();
        if (alive) {
          setMachines(json.machines ?? []);
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    }

    load();
    const t = setInterval(load, 5000);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Machines</h1>
          <p className="text-sm text-zinc-400">Select a machine to view live KPIs.</p>
        </div>

        <Link
          href="/overview"
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
        >
          Back to Overview
        </Link>
      </div>

      {loading && <div className="mb-4 text-sm text-zinc-400">Loading machines…</div>}

      {!loading && machines.length === 0 && (
        <div className="mb-4 text-sm text-zinc-400">No machines found for this org.</div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(!loading ? machines : []).map((m) => {
          const hb = m.latestHeartbeat;
          const offline = isOffline(hb?.ts);
          const statusLabel = offline ? "OFFLINE" : hb?.status ?? "UNKNOWN";
          const lastSeen = secondsAgo(hb?.ts);

          return (
            <Link
              key={m.id}
              href={`/machines/${m.id}`}
              className="rounded-2xl border border-white/10 bg-white/5 p-5 hover:bg-white/10"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-white">{m.name}</div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {m.code ? m.code : "—"} • Last seen {lastSeen}
                  </div>
                </div>

                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs ${badgeClass(
                    hb?.status,
                    offline
                  )}`}
                >
                  {statusLabel}
                </span>
              </div>

              <div className="mt-4 text-sm text-zinc-400">Status</div>
              <div className="text-xl font-semibold text-white">
                {offline ? "No heartbeat" : hb?.message ?? "OK"}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
