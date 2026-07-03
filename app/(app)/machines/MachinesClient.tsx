"use client";
import Link from "next/link";
import { LayoutGrid, List } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/lib/i18n/useI18n";
import { RECAP_HEARTBEAT_STALE_MS } from "@/lib/recap/recapUiConstants";
import { formatElapsedFromMinutes, formatElapsedSince } from "@/lib/time/elapsed";
import { avgCycle, rowPulse, type MachinePulseState } from "@/lib/machines/rowPulse";

type MachineRow = {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
  // Pairing status (Task A). pairingCode is only present for OWNER/ADMIN.
  pairingCode?: string | null;
  pairingCodeExpiresAt?: string | null;
  pairingCodeUsedAt?: string | null;
  latestHeartbeat: null | {
    ts: string;
    tsServer?: string | null;
    status: string;
    message?: string | null;
    ip?: string | null;
    fwVersion?: string | null;
  };
  latestKpi?: null | {
    ts: string;
    oee?: number | null;
    cycleTime?: number | null;
  };
  latestMacrostop?: null | {
    machineId: string;
    ts: string;
    status: "active" | "resolved" | "unknown";
    startedAtMs: number;
  };
  activeWorkOrder?: null | {
    id?: string | null;
    workOrderId: string;
    sku: string | null;
    mold: string | null;
    target: number | null;
    goodParts: number;
    scrapParts: number;
    cycleTime: number | null;
    stopsCount: number;
  };
};

const LIVE_REFRESH_MS = 5000;
const OFFLINE_MS = RECAP_HEARTBEAT_STALE_MS;

function isOffline(ts?: string) {
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > OFFLINE_MS;
}

function normalizeStatus(status?: string) {
  const s = (status ?? "").toUpperCase();
  if (s === "ONLINE") return "RUN";
  return s;
}

function badgeClass(status?: string, offline?: boolean) {
  if (offline) return "bg-white/10 text-zinc-300";
  const s = (status ?? "").toUpperCase();
  if (s === "RUN") return "bg-emerald-500/15 text-emerald-300";
  if (s === "IDLE") return "bg-yellow-500/15 text-yellow-300";
  if (s === "STOP" || s === "DOWN") return "bg-red-500/15 text-red-300";
  return "bg-white/10 text-white";
}

const MACROSTOP_FRESH_MS = 2 * 60 * 1000;

function isMacrostopActive(macrostop: MachineRow["latestMacrostop"]) {
  if (!macrostop) return false;
  if (macrostop.status !== "active") return false;
  // Fresh if last refresh was within 2 min — Node-RED refreshes every 10s,
  // so anything older means the stoppage already ended without resolution event.
  return Date.now() - new Date(macrostop.ts).getTime() <= MACROSTOP_FRESH_MS;
}

function ongoingMacrostopMin(macrostop: MachineRow["latestMacrostop"]) {
  if (!macrostop) return 0;
  return Math.max(0, Math.floor((Date.now() - macrostop.startedAtMs) / 60000));
}

function formatInt(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function formatOneDecimal(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${Number(value).toFixed(1)}%`;
}

type CyclePoint = { actual: number; ideal: number | null; t: number };
type TFunc = (key: string, params?: Record<string, string | number>) => string;

type PairingState = "paired" | "active" | "unpaired";

// Paired = the edge stamped pairingCodeUsedAt. Otherwise an unexpired code is
// "active" (still usable); anything else is unpaired (no code, or expired).
function pairingState(m: MachineRow): PairingState {
  if (m.pairingCodeUsedAt) return "paired";
  if (m.pairingCodeExpiresAt && new Date(m.pairingCodeExpiresAt).getTime() > Date.now()) return "active";
  return "unpaired";
}

function pairingCodeMinutesLeft(m: MachineRow): number {
  if (!m.pairingCodeExpiresAt) return 0;
  return Math.max(0, Math.floor((new Date(m.pairingCodeExpiresAt).getTime() - Date.now()) / 60000));
}

function PairingPill({ m, t }: { m: MachineRow; t: TFunc }) {
  const state = pairingState(m);
  if (state === "paired") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
        {t("machines.pairing.status.paired")}
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-1 text-xs text-sky-300">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
        {t("machines.pairing.status.active")} ·{" "}
        {formatElapsedFromMinutes(pairingCodeMinutesLeft(m), { maxUnits: 2 })}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs text-zinc-300">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" />
      {t("machines.pairing.status.unpaired")}
    </span>
  );
}

function machineSortPriority(m: MachineRow): number {
  const hbTs = m.latestHeartbeat?.tsServer ?? m.latestHeartbeat?.ts;
  const offline = isOffline(hbTs);
  const status = normalizeStatus(m.latestHeartbeat?.status);
  if (isMacrostopActive(m.latestMacrostop)) return 0;
  if ((status === "STOP" || status === "DOWN") && !offline) return 1;
  if (status === "IDLE" && !offline) return 2;
  if (status === "RUN" && !offline) return 3;
  return 4;
}

function MachineListRow({
  m,
  t,
  onNavigate,
  canManage,
  onGenerate,
  generating,
}: {
  m: MachineRow;
  t: TFunc;
  onNavigate: (id: string) => void;
  canManage: boolean;
  onGenerate: (m: MachineRow) => void;
  generating: boolean;
}) {
  const [cycles, setCycles] = useState<CyclePoint[]>([]);
  const [currentState, setCurrentState] = useState<MachinePulseState | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`/api/machines/${m.id}?windowSec=3600`, { cache: "no-store" });
        const data = await res.json();
        if (alive) {
          setCycles(data.cycles ?? []);
          setCurrentState((data.currentState as MachinePulseState | undefined) ?? null);
        }
      } catch {}
    }
    void load();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void load();
    }, 60000);
    return () => { alive = false; clearInterval(interval); };
  }, [m.id]);

  const hb = m.latestHeartbeat;
  const hbTs = hb?.tsServer ?? hb?.ts;
  const offline = isOffline(hbTs);
  const normalizedStatus = normalizeStatus(hb?.status);
  const lastSeen = formatElapsedSince(hbTs, t("common.never"), { maxUnits: 2, minUnit: "second" });
  const macrostopActive = isMacrostopActive(m.latestMacrostop);
  const stoppedMin = macrostopActive ? ongoingMacrostopMin(m.latestMacrostop) : 0;

  const productionBadgeLabel = offline
    ? t("machines.status.offline")
    : macrostopActive
    ? t("machines.status.stopped")
    : (normalizedStatus || t("machines.status.unknown"));

  const productionBadgeClass = offline
    ? "bg-white/10 text-zinc-300"
    : macrostopActive
    ? "bg-red-500/20 text-red-200 ring-2 ring-red-500/50 animate-pulse"
    : badgeClass(normalizedStatus, offline);

  const wo = m.activeWorkOrder ?? null;
  const cycleTime = wo?.cycleTime ?? m.latestKpi?.cycleTime ?? null;
  const heartbeatFresh = Boolean(hbTs) && !offline;
  const heartbeatDotClass = heartbeatFresh ? "bg-emerald-400 animate-pulse" : "bg-red-500 animate-pulse";
  const heartbeatLabel = heartbeatFresh ? t("machines.status.ok") : t("machines.status.noHeartbeat");

  // Fallback state from local signals while the per-row state fetch is in flight.
  const fallbackState: MachinePulseState = offline
    ? "offline"
    : normalizedStatus === "STOP" || normalizedStatus === "DOWN"
    ? "stopped"
    : normalizedStatus === "IDLE"
    ? "idle"
    : "running";
  // A fresh active macrostop is an immediate, strong signal — force urgent red.
  const effectiveState: MachinePulseState = macrostopActive ? "stopped" : currentState ?? fallbackState;
  const rowClass = rowPulse(effectiveState, { urgent: macrostopActive });

  return (
    <tr onClick={() => onNavigate(m.id)} className={`transition ${rowClass}`}>
      <td className="px-4 py-3">
        <div className="font-medium text-white">{m.name}</div>
        <div className="mt-0.5 text-xs text-zinc-400">
          {m.code || t("common.na")} · {t("machines.lastSeen", { time: lastSeen })}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <PairingPill m={m} t={t} />
          {canManage && pairingState(m) !== "paired" ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onGenerate(m);
              }}
              disabled={generating}
              className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
            >
              {generating ? t("machines.pairing.generating") : t("machines.pairing.generate")}
            </button>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-1 text-xs ${productionBadgeClass}`}>
          {productionBadgeLabel}
        </span>
        {macrostopActive ? (
          <div className="mt-1 text-xs text-red-200">
            {t("machines.stoppedFor", {
              duration: formatElapsedFromMinutes(stoppedMin, { maxUnits: 2 }),
            })}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right">
        <span className={`font-medium ${m.latestKpi?.oee == null ? "text-zinc-400" : "text-white"}`}>
          {formatOneDecimal(m.latestKpi?.oee)}
        </span>
      </td>
      <td className="px-4 py-3 text-right text-zinc-300">{formatInt(wo?.goodParts)}</td>
      <td className="px-4 py-3 text-right text-zinc-300">{formatInt(wo?.scrapParts)}</td>
      <td className="px-4 py-3 text-right text-zinc-300">{formatInt(wo?.stopsCount)}</td>
      <td className="px-4 py-3 text-right text-zinc-300">
        {cycleTime != null ? `${cycleTime.toFixed(1)}s` : "—"}
      </td>
      <td className="px-4 py-3 text-right text-zinc-300">
        {(() => {
          const avg = avgCycle(cycles);
          return avg != null ? `${avg.toFixed(1)}s` : "—";
        })()}
      </td>
      <td className="px-4 py-3">
        <div className="text-xs text-zinc-200">{wo?.workOrderId || t("common.na")}</div>
        <div className="mt-0.5 text-xs text-zinc-400">
          {wo?.sku || t("common.na")} · {wo?.mold || t("common.na")}
        </div>
      </td>
      <td className="px-4 py-3 text-center">
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-200">
          <span className={`inline-block h-2 w-2 rounded-full ${heartbeatDotClass}`} />
          {heartbeatLabel}
        </span>
      </td>
    </tr>
  );
}

export default function MachinesClient({
  initialMachines = [],
  canManage = false,
}: {
  initialMachines?: MachineRow[];
  canManage?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [machines, setMachines] = useState<MachineRow[]>(() => initialMachines);
  const [loading, setLoading] = useState(() => initialMachines.length === 0);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // The pairing reveal panel — shown after creating a machine OR regenerating a
  // code for an existing one. Reused for both flows so there is one code display.
  const [pairingReveal, setPairingReveal] = useState<{
    id: string;
    name: string;
    pairingCode: string;
    pairingExpiresAt: string;
  } | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const sortedMachines = useMemo(
    () => [...machines].sort((a, b) => machineSortPriority(a) - machineSortPriority(b)),
    [machines],
  );

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load(initial: boolean) {
      try {
        if (!initial && typeof document !== "undefined" && document.hidden) {
          return;
        }

        const res = await fetch("/api/machines?includeKpi=1", { cache: "no-store" });
        const json = await res.json();
        if (alive) {
          setMachines(json.machines ?? []);
          if (initial) setLoading(false);
        }
      } catch {
        if (alive && initial) setLoading(false);
      } finally {
        if (!alive) return;
        timer = setTimeout(() => {
          void load(false);
        }, LIVE_REFRESH_MS);
      }
    }

    void load(initialMachines.length === 0);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [initialMachines.length]);

  async function createMachine() {
    if (!createName.trim()) {
      setCreateError(t("machines.create.error.nameRequired"));
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
        throw new Error(data.error || t("machines.create.error.failed"));
      }

      const nextMachine: MachineRow = {
        ...data.machine,
        latestHeartbeat: null,
        latestKpi: null,
        latestMacrostop: null,
        activeWorkOrder: null,
      };
      setMachines((prev) => [nextMachine, ...prev]);
      setPairingReveal({
        id: data.machine.id,
        name: data.machine.name,
        pairingCode: data.machine.pairingCode,
        pairingExpiresAt: data.machine.pairingCodeExpiresAt,
      });
      setCreateName("");
      setCreateCode("");
      setCreateLocation("");
      setShowCreate(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setCreateError(message || t("machines.create.error.failed"));
    } finally {
      setCreating(false);
    }
  }

  // (Re)issue a pairing code for an existing, not-yet-paired machine so its edge
  // reader can be paired whenever it is physically installed.
  async function generatePairingCode(machine: MachineRow) {
    setGeneratingId(machine.id);
    setCopyStatus(null);
    try {
      const res = await fetch(`/api/machines/${machine.id}/pairing-code`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t("machines.pairing.generateFailed"));
      }
      setMachines((prev) =>
        prev.map((row) =>
          row.id === machine.id
            ? {
                ...row,
                pairingCode: data.pairingCode,
                pairingCodeExpiresAt: data.pairingCodeExpiresAt,
                pairingCodeUsedAt: null,
              }
            : row,
        ),
      );
      setPairingReveal({
        id: machine.id,
        name: machine.name,
        pairingCode: data.pairingCode,
        pairingExpiresAt: data.pairingCodeExpiresAt,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("machines.pairing.generateFailed");
      setCopyStatus(message);
      setTimeout(() => setCopyStatus(null), 3000);
    } finally {
      setGeneratingId(null);
    }
  }

  async function copyText(text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopyStatus(t("machines.pairing.copied"));
      } else {
        setCopyStatus(t("machines.pairing.copyUnsupported"));
      }
    } catch {
      setCopyStatus(t("machines.pairing.copyFailed"));
    }
    setTimeout(() => setCopyStatus(null), 2000);
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>, machineId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(`/machines/${machineId}`);
    }
  }

  const showCreateCard = showCreate || (!loading && machines.length === 0);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("machines.title")}</h1>
          <p className="text-sm text-zinc-400">{t("machines.subtitle")}</p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => setShowCreate((prev) => !prev)}
            className="w-full rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/30 sm:w-auto"
          >
            {showCreate ? t("machines.cancel") : t("machines.addMachine")}
          </button>
          <Link
            href="/recap"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center text-sm text-white hover:bg-white/10 sm:w-auto"
          >
            {t("machines.backOverview")}
          </Link>
          <div className="flex items-center overflow-hidden rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              aria-label={t("machines.view.grid")}
              className={`p-2 transition ${viewMode === "grid" ? "bg-emerald-500/20 text-emerald-100" : "bg-black/40 text-zinc-400 hover:text-zinc-200"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              aria-label={t("machines.view.list")}
              className={`border-l border-white/10 p-2 transition ${viewMode === "list" ? "bg-emerald-500/20 text-emerald-100" : "bg-black/40 text-zinc-400 hover:text-zinc-200"}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {showCreateCard && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-white">{t("machines.addCardTitle")}</div>
              <div className="text-xs text-zinc-400">{t("machines.addCardSubtitle")}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              {t("machines.field.name")}
              <input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              {t("machines.field.code")}
              <input
                value={createCode}
                onChange={(event) => setCreateCode(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              {t("machines.field.location")}
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
              {creating ? t("machines.create.loading") : t("machines.create.default")}
            </button>
            {createError && <div className="text-xs text-red-200">{createError}</div>}
          </div>
        </div>
      )}

      {pairingReveal && (
        <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-semibold text-white">{t("machines.pairing.title")}</div>
            <button
              type="button"
              onClick={() => setPairingReveal(null)}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300 hover:bg-white/10"
            >
              {t("machines.pairing.dismiss")}
            </button>
          </div>
          <div className="mt-2 text-xs text-zinc-300">
            {t("machines.pairing.machine")} <span className="text-white">{pairingReveal.name}</span>
          </div>
          <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-400">{t("machines.pairing.codeLabel")}</div>
            <div className="mt-2 text-3xl font-semibold text-white">{pairingReveal.pairingCode}</div>
            <div className="mt-2 text-xs text-zinc-400">
              {t("machines.pairing.expires")}{" "}
              {pairingReveal.pairingExpiresAt
                ? new Date(pairingReveal.pairingExpiresAt).toLocaleString(locale)
                : t("machines.pairing.soon")}
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-300">
            {t("machines.pairing.instructions")}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => copyText(pairingReveal.pairingCode)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              {t("machines.pairing.copy")}
            </button>
            {copyStatus && <div className="text-xs text-zinc-300">{copyStatus}</div>}
          </div>
        </div>
      )}

      {loading && <div className="mb-4 text-sm text-zinc-400">{t("machines.loading")}</div>}

      {!loading && machines.length === 0 && (
        <div className="mb-4 text-sm text-zinc-400">{t("machines.empty")}</div>
      )}

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(!loading ? sortedMachines : []).map((m) => {
            const hb = m.latestHeartbeat;
            const hbTs = hb?.tsServer ?? hb?.ts;
            const offline = isOffline(hbTs);
            const normalizedStatus = normalizeStatus(hb?.status);
            const lastSeen = formatElapsedSince(hbTs, t("common.never"), {
              maxUnits: 2,
              minUnit: "second",
            });

            const macrostopActive = isMacrostopActive(m.latestMacrostop);
            const stoppedMin = macrostopActive ? ongoingMacrostopMin(m.latestMacrostop) : 0;

            // Production-state badge: STOPPED if active macrostop, else heartbeat-based.
            const productionBadgeLabel = offline
              ? t("machines.status.offline")
              : macrostopActive
              ? t("machines.status.stopped")
              : (normalizedStatus || t("machines.status.unknown"));

            const productionBadgeClass = offline
              ? "bg-white/10 text-zinc-300"
              : macrostopActive
              ? "bg-red-500/20 text-red-200 ring-2 ring-red-500/50 animate-pulse"
              : badgeClass(normalizedStatus, offline);

            const cardClass = macrostopActive
              ? "cursor-pointer rounded-2xl border border-red-500/60 bg-red-500/10 p-5 ring-2 ring-red-500/40 animate-pulse hover:bg-red-500/15"
              : "cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-5 hover:bg-white/10";

            const wo = m.activeWorkOrder ?? null;
            const cycleTime = wo?.cycleTime ?? m.latestKpi?.cycleTime ?? null;
            const heartbeatFresh = Boolean(hbTs) && !offline;
            const heartbeatDotClass = heartbeatFresh
              ? "bg-emerald-400 animate-pulse"
              : "bg-red-500 animate-pulse";
            const heartbeatLabel = heartbeatFresh
              ? t("machines.status.ok")
              : t("machines.status.noHeartbeat");

            return (
              <div
                key={m.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/machines/${m.id}`)}
                onKeyDown={(event) => handleCardKeyDown(event, m.id)}
                className={cardClass}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-lg font-semibold text-white">{m.name}</div>
                    <div className="mt-1 text-xs text-zinc-400">
                      {m.code ? m.code : t("common.na")} - {t("machines.lastSeen", { time: lastSeen })}
                    </div>
                    {macrostopActive ? (
                      <div className="mt-1 text-xs font-semibold text-red-200">
                        {t("machines.stoppedFor", {
                          duration: formatElapsedFromMinutes(stoppedMin, { maxUnits: 2 }),
                        })}
                      </div>
                    ) : null}
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs ${productionBadgeClass}`}
                  >
                    {productionBadgeLabel}
                  </span>
                </div>

                <div className="mt-4 flex items-baseline gap-2">
                  <div className={`text-3xl font-semibold ${m.latestKpi?.oee == null ? "text-zinc-400" : "text-white"}`}>
                    {formatOneDecimal(m.latestKpi?.oee)}
                  </div>
                  <div className="text-xs uppercase tracking-wide text-zinc-400">{t("machines.card.oee")}</div>
                </div>

                <div className="mt-2 text-[11px] text-zinc-400">{t("machines.card.scopeWoTotals")}</div>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
                  <span>{t("recap.card.good")}: {formatInt(wo?.goodParts)}</span>
                  <span>{t("recap.card.scrap")}: {formatInt(wo?.scrapParts)}</span>
                  <span>{t("recap.card.stops")}: {formatInt(wo?.stopsCount)}</span>
                  <span>{t("recap.card.cycleTime")}: {cycleTime != null ? cycleTime.toFixed(1) + "s" : "—"}</span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                  <span>{t("machines.card.wo")}: {wo?.id || wo?.workOrderId || t("common.na")}</span>
                  <span>{t("machines.card.sku")}: {wo?.sku || t("common.na")}</span>
                  <span>{t("machines.card.mold")}: {wo?.mold || t("common.na")}</span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <PairingPill m={m} t={t} />
                  {canManage && pairingState(m) !== "paired" ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void generatePairingCode(m);
                      }}
                      disabled={generatingId === m.id}
                      className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
                    >
                      {generatingId === m.id ? t("machines.pairing.generating") : t("machines.pairing.generate")}
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-xs">
                  <span className="text-zinc-400">{t("recap.machine.lastHeartbeat")}</span>
                  <span className="inline-flex items-center gap-2 text-zinc-200">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${heartbeatDotClass}`} />
                    {heartbeatLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-400">
                <th className="px-4 py-3 text-left font-medium">{t("machines.col.machine")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("machines.status")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("machines.card.oee")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("recap.card.good")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("recap.card.scrap")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("recap.card.stops")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("recap.card.cycleTime")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("machines.col.avgCycle1h")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("machines.card.wo")}</th>
                <th className="px-4 py-3 text-center font-medium">{t("recap.machine.lastHeartbeat")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(!loading ? sortedMachines : []).map((m) => (
                <MachineListRow
                  key={m.id}
                  m={m}
                  t={t}
                  onNavigate={(id) => router.push(`/machines/${id}`)}
                  canManage={canManage}
                  onGenerate={(machine) => void generatePairingCode(machine)}
                  generating={generatingId === m.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
