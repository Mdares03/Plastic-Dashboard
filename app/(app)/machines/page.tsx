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
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdMachine, setCreatedMachine] = useState<{
    id: string;
    name: string;
    pairingCode: string;
    pairingExpiresAt: string;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

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

  async function createMachine() {
    if (!createName.trim()) {
      setCreateError("Machine name is required");
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const res = await fetch("/api/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName,
          code: createCode,
          location: createLocation,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to create machine");
      }

      const nextMachine = {
        ...data.machine,
        latestHeartbeat: null,
      };
      setMachines((prev) => [nextMachine, ...prev]);
      setCreatedMachine({
        id: data.machine.id,
        name: data.machine.name,
        pairingCode: data.machine.pairingCode,
        pairingExpiresAt: data.machine.pairingCodeExpiresAt,
      });
      setCreateName("");
      setCreateCode("");
      setCreateLocation("");
      setShowCreate(false);
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create machine");
    } finally {
      setCreating(false);
    }
  }

  async function copyText(text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopyStatus("Copied");
      } else {
        setCopyStatus("Copy not supported");
      }
    } catch {
      setCopyStatus("Copy failed");
    }
    setTimeout(() => setCopyStatus(null), 2000);
  }

  const showCreateCard = showCreate || (!loading && machines.length === 0);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Machines</h1>
          <p className="text-sm text-zinc-400">Select a machine to view live KPIs.</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreate((prev) => !prev)}
            className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/30"
          >
            {showCreate ? "Cancel" : "Add Machine"}
          </button>
          <Link
            href="/overview"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Back to Overview
          </Link>
        </div>
      </div>

      {showCreateCard && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-white">Add a machine</div>
              <div className="text-xs text-zinc-400">
                Generate the machine ID and API key for your Node-RED edge.
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              Machine Name
              <input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              Code (optional)
              <input
                value={createCode}
                onChange={(event) => setCreateCode(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              Location (optional)
              <input
                value={createLocation}
                onChange={(event) => setCreateLocation(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={createMachine}
              disabled={creating}
              className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-60"
            >
              {creating ? "Creating..." : "Create Machine"}
            </button>
            {createError && <div className="text-xs text-red-200">{createError}</div>}
          </div>
        </div>
      )}

      {createdMachine && (
      <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
          <div className="text-sm font-semibold text-white">Edge pairing code</div>
          <div className="mt-2 text-xs text-zinc-300">
            Machine: <span className="text-white">{createdMachine.name}</span>
          </div>
          <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-400">Pairing code</div>
            <div className="mt-2 text-3xl font-semibold text-white">{createdMachine.pairingCode}</div>
            <div className="mt-2 text-xs text-zinc-400">
              Expires{" "}
              {createdMachine.pairingExpiresAt
                ? new Date(createdMachine.pairingExpiresAt).toLocaleString()
                : "soon"}
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-300">
            Enter this code on the Node-RED Control Tower settings screen to link the edge device.
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => copyText(createdMachine.pairingCode)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              Copy Code
            </button>
            {copyStatus && <div className="text-xs text-zinc-300">{copyStatus}</div>}
          </div>
        </div>
      )}

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
