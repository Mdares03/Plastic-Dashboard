"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";
import type { RecapMachine, RecapResponse } from "@/lib/recap/types";
import RecapKpiRow from "@/components/recap/RecapKpiRow";
import RecapProductionBySku from "@/components/recap/RecapProductionBySku";
import RecapDowntimeTop from "@/components/recap/RecapDowntimeTop";
import RecapWorkOrderStatus from "@/components/recap/RecapWorkOrderStatus";
import RecapMachineStatus from "@/components/recap/RecapMachineStatus";

type Props = {
  initialData: RecapResponse;
  initialFilters: {
    machineId: string;
    shift: string;
    start: string;
    end: string;
  };
};

type RangeMode = "24h" | "shift" | "custom";

function toInputDate(value: string) {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toMinutesLabel(minutes: number | null) {
  if (minutes == null || minutes <= 0) return "0";
  return String(Math.round(minutes));
}

export default function RecapClient({ initialData, initialFilters }: Props) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<RecapResponse>(initialData);
  const [machineId, setMachineId] = useState(initialFilters.machineId || "");
  const [shift, setShift] = useState(initialFilters.shift || "shift1");
  const [customStart, setCustomStart] = useState(toInputDate(initialFilters.start));
  const [customEnd, setCustomEnd] = useState(toInputDate(initialFilters.end));
  const [mode, setMode] = useState<RangeMode>(() => {
    if (initialFilters.shift) return "shift";
    if (initialFilters.start || initialFilters.end) return "custom";
    return "24h";
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      const qs = new URLSearchParams();
      if (machineId) qs.set("machineId", machineId);
      if (mode === "shift") qs.set("shift", shift || "shift1");
      if (mode === "custom") {
        if (customStart) qs.set("start", new Date(customStart).toISOString());
        if (customEnd) qs.set("end", new Date(customEnd).toISOString());
      }

      try {
        const res = await fetch(`/api/recap?${qs.toString()}`, { cache: "no-cache" });
        const json = await res.json().catch(() => null);
        if (!alive || !json) return;
        setData(json as RecapResponse);
      } finally {
        if (alive) setLoading(false);
      }
    }

    const timeout = setTimeout(load, 200);
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [machineId, mode, shift, customStart, customEnd]);

  useEffect(() => {
    async function refresh() {
      const qs = new URLSearchParams();
      if (machineId) qs.set("machineId", machineId);
      if (mode === "shift") qs.set("shift", shift || "shift1");
      if (mode === "custom") {
        if (customStart) qs.set("start", new Date(customStart).toISOString());
        if (customEnd) qs.set("end", new Date(customEnd).toISOString());
      }
      const res = await fetch(`/api/recap?${qs.toString()}`, { cache: "no-cache" });
      const json = await res.json().catch(() => null);
      if (json) setData(json as RecapResponse);
    }

    const onFocus = () => {
      void refresh();
    };

    const interval = window.setInterval(onFocus, 60000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [machineId, mode, shift, customStart, customEnd]);

  const selectedMachine = useMemo(() => {
    if (!data.machines.length) return null;
    return data.machines.find((m) => m.machineId === machineId) ?? data.machines[0];
  }, [data.machines, machineId]);

  const fleet = useMemo(() => {
    let good = 0;
    let scrap = 0;
    let stops = 0;
    let oeeSum = 0;
    let oeeCount = 0;
    for (const m of data.machines) {
      good += m.production.goodParts;
      scrap += m.production.scrapParts;
      stops += m.downtime.stopsCount;
      if (m.oee.avg != null) {
        oeeSum += m.oee.avg;
        oeeCount += 1;
      }
    }
    return {
      oeeAvg: oeeCount ? oeeSum / oeeCount : null,
      good,
      scrap,
      stops,
    };
  }, [data.machines]);

  const bannerMold = selectedMachine?.workOrders.moldChangeInProgress;
  const bannerStop = (selectedMachine?.downtime.ongoingStopMin ?? 0) > 0;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 rounded-2xl border border-white/10 bg-black/40 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">{t("recap.title")}</h1>
            <p className="text-sm text-zinc-400">
              {t("recap.subtitle")} · {new Date(data.range.start).toLocaleString(locale)} - {new Date(data.range.end).toLocaleString(locale)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <select
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-zinc-200"
            >
              <option value="">{t("recap.allMachines")}</option>
              {data.machines.map((m) => (
                <option key={m.machineId} value={m.machineId}>
                  {m.machineName}
                </option>
              ))}
            </select>

            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as RangeMode)}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-zinc-200"
            >
              <option value="24h">24h</option>
              <option value="shift">{t("recap.range.shift")}</option>
              <option value="custom">{t("recap.range.custom")}</option>
            </select>

            {mode === "shift" ? (
              <select
                value={shift}
                onChange={(event) => setShift(event.target.value)}
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-zinc-200"
              >
                <option value="shift1">{t("recap.shift.1")}</option>
                <option value="shift2">{t("recap.shift.2")}</option>
                <option value="shift3">{t("recap.shift.3")}</option>
              </select>
            ) : null}

            {mode === "custom" ? (
              <>
                <input
                  type="datetime-local"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-zinc-200"
                />
                <input
                  type="datetime-local"
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-zinc-200"
                />
              </>
            ) : null}
          </div>
        </div>
      </div>

      {bannerMold ? (
        <div className="mb-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
          {t("recap.banner.mold")} {selectedMachine?.workOrders.active?.startedAt ? new Date(selectedMachine.workOrders.active.startedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "--:--"}
        </div>
      ) : null}
      {bannerStop ? (
        <div className="mb-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {t("recap.banner.stopped", { minutes: toMinutesLabel(selectedMachine?.downtime.ongoingStopMin ?? null) })}
        </div>
      ) : null}

      {loading ? <div className="mb-3 text-sm text-zinc-400">{t("common.loading")}</div> : null}

      <RecapKpiRow oeeAvg={fleet.oeeAvg} goodParts={fleet.good} totalStops={fleet.stops} scrapParts={fleet.scrap} />

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <RecapProductionBySku rows={selectedMachine?.production.bySku ?? []} />
        <RecapDowntimeTop rows={selectedMachine?.downtime.topReasons ?? []} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <RecapWorkOrderStatus
          workOrders={
            selectedMachine?.workOrders ?? {
              completed: [],
              active: null,
              moldChangeInProgress: false,
            }
          }
        />
        <RecapMachineStatus machine={selectedMachine as RecapMachine | null} />
      </div>
    </div>
  );
}
