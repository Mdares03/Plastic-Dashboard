"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";
import type { RecapMachineStatus, RecapSummaryResponse } from "@/lib/recap/types";
import RecapMachineCard from "@/components/recap/RecapMachineCard";

type Props = {
  initialData: RecapSummaryResponse;
};

function statusLabel(status: RecapMachineStatus, t: (key: string) => string) {
  if (status === "running") return t("recap.status.running");
  if (status === "mold-change") return t("recap.status.moldChange");
  if (status === "stopped") return t("recap.status.stopped");
  return t("recap.status.offline");
}

export default function RecapGridClient({ initialData }: Props) {
  const { t } = useI18n();

  const [data, setData] = useState<RecapSummaryResponse>(initialData);
  const [loading, setLoading] = useState(false);
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RecapMachineStatus>("all");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      setLoading(true);
      try {
        const res = await fetch(`/api/recap/summary?hours=${data.range.hours}`, { cache: "no-store" });
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
  }, [data.range.hours]);

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

          <div className="flex flex-wrap gap-2 text-sm">
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
              {(["running", "mold-change", "stopped", "offline"] as const).map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status, t)}
                </option>
              ))}
            </select>
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
      ) : (
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
      )}
    </div>
  );
}
