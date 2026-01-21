"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import DowntimeParetoCard from "@/components/analytics/DowntimeParetoCard";
import { usePathname } from "next/navigation";


import { DOWNTIME_RANGES, coerceDowntimeRange, type DowntimeRange } from "@/lib/analytics/downtimeRange";

type MachineLite = {
  id: string;
  name: string;
  siteName?: string | null; // optional for later
};

export default function DowntimeParetoReportClient() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [range, setRange] = useState<DowntimeRange>(coerceDowntimeRange(sp.get("range")));
  const [machineId, setMachineId] = useState<string>(sp.get("machineId") || "");
  const [machines, setMachines] = useState<MachineLite[]>([]);
  const [loadingMachines, setLoadingMachines] = useState(true);

  // Keep URL in sync (so deep-links work)

    useEffect(() => {
    const qs = new URLSearchParams();
    if (range) qs.set("range", range);
    if (machineId) qs.set("machineId", machineId);

    const next = `${pathname}?${qs.toString()}`;
    const current = `${pathname}?${sp.toString()}`;

    // avoid needless replace loops
    if (next !== current) router.replace(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range, machineId, pathname]);


  useEffect(() => {
    let cancelled = false;

    async function loadMachines() {
      setLoadingMachines(true);
      try {
        // Use whatever endpoint you already have for listing machines:
        // If you don’t have one, easiest is GET /api/machines returning [{id,name}]
        const res = await fetch("/api/machines", { credentials: "include" });
        const json = await res.json();
        if (!cancelled && res.ok) setMachines(json.machines ?? json ?? []);
      } finally {
        if (!cancelled) setLoadingMachines(false);
      }
    }

    loadMachines();
    return () => {
      cancelled = true;
    };
  }, []);

  const machineOptions = useMemo(() => {
    return [{ id: "", name: "All machines" }, ...machines];
  }, [machines]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">Downtime Pareto</div>
          <div className="text-sm text-zinc-400">Org-wide report with drilldown</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            value={range}
            onChange={(e) => setRange(e.target.value as DowntimeRange)}
          >
            <option className="bg-black text-white" value="24h">Last 24h</option>
            <option className="bg-black text-white" value="7d">Last 7d</option>
            <option className="bg-black text-white" value="30d">Last 30d</option>
          </select>

          <select
            className="min-w-[240px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            disabled={loadingMachines}
          >
            {machineOptions.map((m) => (
              <option className="bg-black text-white" key={m.id || "all"} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <DowntimeParetoCard
        range={range}
        machineId={machineId || undefined}
        showOpenFullReport={false}
        />
    </div>
  );
}
