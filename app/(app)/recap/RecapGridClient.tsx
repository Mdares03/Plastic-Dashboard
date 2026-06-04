"use client";

import Link from "next/link";
import { LayoutGrid, List } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/useI18n";
import type { RecapMachineStatus, RecapSummaryMachine, RecapSummaryResponse } from "@/lib/recap/types";
import RecapMachineCard from "@/components/recap/RecapMachineCard";
import { formatElapsedFromMinutes } from "@/lib/time/elapsed";
import { avgCycle, pulseStateFromSegmentType, rowPulse, type MachinePulseState } from "@/lib/machines/rowPulse";

type MachineOption = {
  id: string;
  name: string;
};

type Props = {
  initialData: RecapSummaryResponse;
  machineOptions?: MachineOption[];
  initialMachineId?: string;
};

const STATUS_DOT: Record<RecapSummaryMachine["status"], string> = {
  running: "bg-emerald-400",
  "mold-change": "bg-amber-400",
  stopped: "bg-red-500",
  offline: "bg-zinc-500",
  idle: "bg-zinc-400",
};

function statusLabel(status: RecapMachineStatus, t: (key: string) => string) {
  if (status === "running") return t("recap.status.running");
  if (status === "mold-change") return t("recap.status.moldChange");
  if (status === "stopped") return t("recap.status.stopped");
  if (status === "idle") return t("recap.status.idle");
  return t("recap.status.offline");
}

function normalizeMachineId(value?: string) {
  const token = String(value ?? "").trim();
  if (!token) return "all";
  if (token.toLowerCase() === "all") return "all";
  return token;
}

type CyclePoint = { actual: number; ideal: number | null; t: number };
type TFunc = (key: string, params?: Record<string, string | number>) => string;

// Current state from the latest mini-timeline segment (falls back to machine.status).
function recapPulseState(machine: RecapSummaryMachine): MachinePulseState {
  if (machine.status === "offline") return "offline";
  const last = machine.miniTimeline.length ? machine.miniTimeline[machine.miniTimeline.length - 1] : null;
  if (last) return pulseStateFromSegmentType(last.type);
  if (machine.status === "mold-change") return "mold-change";
  if (machine.status === "stopped") return "stopped";
  if (machine.status === "idle") return "idle";
  return "running";
}

function recapSortPriority(m: RecapSummaryMachine): number {
  if (m.status === "stopped" && (m.ongoingStopMin ?? 0) >= 5) return 0;
  if (m.status === "stopped") return 1;
  if (m.status === "mold-change") return 2;
  if (m.status === "running") return 3;
  if (m.status === "idle") return 4;
  return 5;
}

function RecapListRow({ machine, t }: { machine: RecapSummaryMachine; t: TFunc }) {
  const [cycles, setCycles] = useState<CyclePoint[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`/api/machines/${machine.machineId}?windowSec=3600`, { cache: "no-store" });
        const data = await res.json();
        if (alive) setCycles(data.cycles ?? []);
      } catch {}
    }
    void load();
    const interval = setInterval(() => void load(), 60000);
    return () => { alive = false; clearInterval(interval); };
  }, [machine.machineId]);

  const ongoingStopMin = machine.ongoingStopMin ?? 0;
  const isUrgent = machine.status === "stopped" && ongoingStopMin >= 5;

  const effectiveState = isUrgent ? "stopped" : recapPulseState(machine);
  const rowClass = rowPulse(effectiveState, { urgent: isUrgent });

  const lastActivityLabel =
    machine.lastActivityMin == null
      ? t("common.never")
      : formatElapsedFromMinutes(machine.lastActivityMin, { maxUnits: 2 });

  return (
    <tr className={`transition ${rowClass}`}>
      <td className="px-4 py-3">
        <Link href={`/recap/${machine.machineId}`} className="block focus-visible:outline-none">
          <div className="font-medium text-white hover:text-emerald-300 transition">{machine.name}</div>
          <div className="mt-0.5 text-xs text-zinc-400">{machine.location || t("common.na")}</div>
        </Link>
      </td>
      <td className="px-4 py-3">
        <Link href={`/recap/${machine.machineId}`} className="block focus-visible:outline-none">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 text-xs text-zinc-200">
            <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[machine.status]}`} />
            {statusLabel(machine.status, t)}
          </span>
          {isUrgent ? (
            <div className="mt-1 text-xs text-red-200">
              {t("recap.card.stoppedFor", {
                duration: formatElapsedFromMinutes(ongoingStopMin, { maxUnits: 2 }),
              })}
            </div>
          ) : machine.moldChange?.active ? (
            <div className="mt-1 text-xs text-amber-200">
              {formatElapsedFromMinutes(machine.moldChange.elapsedMin, { maxUnits: 2 })}
            </div>
          ) : null}
        </Link>
      </td>
      <td className="px-4 py-3 text-right">
        <Link href={`/recap/${machine.machineId}`} className="block focus-visible:outline-none">
          <span className={`font-medium ${machine.oee == null ? "text-zinc-400" : "text-white"}`}>
            {machine.oee == null ? "—" : `${machine.oee.toFixed(1)}%`}
          </span>
        </Link>
      </td>
      <td className="px-4 py-3 text-right text-zinc-300">
        <Link href={`/recap/${machine.machineId}`} className="block focus-visible:outline-none">
          {machine.goodParts}
        </Link>
      </td>
      <td className="px-4 py-3 text-right text-zinc-300">
        <Link href={`/recap/${machine.machineId}`} className="block focus-visible:outline-none">
          {machine.scrap}
        </Link>
      </td>
      <td className="px-4 py-3 text-right text-zinc-300">
        <Link href={`/recap/${machine.machineId}`} className="block focus-visible:outline-none">
          {machine.stopsCount}
        </Link>
      </td>
      <td className="px-4 py-3 text-right text-zinc-300">
        <Link href={`/recap/${machine.machineId}`} className="block focus-visible:outline-none">
          {machine.cycleTime != null ? `${machine.cycleTime.toFixed(1)}s` : "—"}
        </Link>
      </td>
      <td className="px-4 py-3 text-right text-zinc-300">
        <Link href={`/recap/${machine.machineId}`} className="block focus-visible:outline-none">
          {(() => {
            const avg = avgCycle(cycles);
            return avg != null ? `${avg.toFixed(1)}s` : "—";
          })()}
        </Link>
      </td>
      <td className="px-4 py-3">
        <Link href={`/recap/${machine.machineId}`} className="block focus-visible:outline-none">
          <div className="text-xs text-zinc-200">{machine.activeWorkOrderId || t("common.na")}</div>
          <div className="mt-0.5 text-xs text-zinc-400">
            {machine.activeWorkOrderSku || t("common.na")} · {machine.activeWorkOrderMold || t("common.na")}
          </div>
        </Link>
      </td>
      <td className="px-4 py-3 text-right text-xs text-zinc-400">
        <Link href={`/recap/${machine.machineId}`} className="block focus-visible:outline-none">
          {lastActivityLabel}
        </Link>
      </td>
    </tr>
  );
}

export default function RecapGridClient({ initialData, machineOptions = [], initialMachineId = "all" }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [data, setData] = useState<RecapSummaryResponse>(initialData);
  const [loading, setLoading] = useState(false);
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RecapMachineStatus>("all");
  const [selectedMachineId, setSelectedMachineId] = useState(() => normalizeMachineId(initialMachineId));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ hours: String(data.range.hours), machineId: selectedMachineId });
        const res = await fetch(`/api/recap/summary?${params.toString()}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!alive || !json || !res.ok) return;
        setData(json as RecapSummaryResponse);
      } finally {
        if (alive) setLoading(false);
      }
    }

    const onFocus = () => {
      void refresh();
    };

    const interval = window.setInterval(onFocus, 60000);
    window.addEventListener("focus", onFocus);

    return () => {
      alive = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [data.range.hours, selectedMachineId]);

  const locationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const machine of data.machines) {
      if (machine.location) set.add(machine.location);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [data.machines]);

  const filteredMachines = useMemo(() => {
    return data.machines.filter((machine) => {
      if (locationFilter !== "all" && machine.location !== locationFilter) return false;
      if (statusFilter !== "all" && machine.status !== statusFilter) return false;
      return true;
    });
  }, [data.machines, locationFilter, statusFilter]);

  const generatedAtMs = new Date(data.generatedAt).getTime();
  const freshAgeSec = Number.isFinite(generatedAtMs) ? Math.max(0, Math.floor((nowMs - generatedAtMs) / 1000)) : null;

  const handleMachineChange = (nextMachineId: string) => {
    const normalized = normalizeMachineId(nextMachineId);
    setSelectedMachineId(normalized);

    const params = new URLSearchParams(searchParams.toString());
    params.set("machineId", normalized);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 rounded-2xl border border-white/10 bg-black/40 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">{t("recap.grid.title")}</h1>
            <p className="text-sm text-zinc-400">{t("recap.grid.subtitle")}</p>
            {freshAgeSec != null ? (
              <p className="mt-1 text-xs text-zinc-500">{t("recap.grid.updatedAgo", { sec: freshAgeSec })}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              value={selectedMachineId}
              onChange={(event) => handleMachineChange(event.target.value)}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-zinc-200"
            >
              <option value="all">Todas las máquinas</option>
              {machineOptions.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.name}
                </option>
              ))}
            </select>

            <select
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-zinc-200"
            >
              <option value="all">{t("recap.filter.allLocations")}</option>
              {locationOptions.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | RecapMachineStatus)}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-zinc-200"
            >
              <option value="all">{t("recap.filter.allStatuses")}</option>
              {(["running", "mold-change", "stopped", "idle", "offline"] as const).map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status, t)}
                </option>
              ))}
            </select>

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
      </div>

      {loading && data.machines.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-[220px] animate-pulse rounded-2xl border border-white/10 bg-white/5" />
          ))}
        </div>
      ) : null}

      {loading && data.machines.length > 0 ? (
        <div className="mb-3 text-xs text-zinc-500">{t("common.loading")}</div>
      ) : null}

      {filteredMachines.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-zinc-400">
          {t("recap.grid.empty")}
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredMachines.map((machine) => (
            <RecapMachineCard
              key={machine.machineId}
              machine={machine}
              rangeStart={data.range.start}
              rangeEnd={data.range.end}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3 text-left font-medium">{t("machines.col.machine")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("machines.status")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("recap.card.oee")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("recap.card.good")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("recap.card.scrap")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("recap.card.stops")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("recap.card.cycleTime")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("machines.col.avgCycle1h")}</th>
                <th className="px-4 py-3 text-left font-medium">{t("machines.card.wo")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("recap.col.lastActivity")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {[...filteredMachines]
                .sort((a, b) => recapSortPriority(a) - recapSortPriority(b))
                .map((machine) => (
                  <RecapListRow key={machine.machineId} machine={machine} t={t} />
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
