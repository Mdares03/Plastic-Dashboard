"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import ChartSkeleton from "@/components/charts/ChartSkeleton";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/useI18n";

// Recharts is heavy; load the chart card only when this page renders it.
const DowntimeParetoCard = dynamic(() => import("@/components/analytics/DowntimeParetoCard"), {
  ssr: false,
  loading: () => <ChartSkeleton heightClass="h-80" />,
});


import { DOWNTIME_RANGES, coerceDowntimeRange, type DowntimeRange } from "@/lib/analytics/downtimeRange";

type MachineLite = {
  id: string;
  name: string;
  siteName?: string | null; // optional for later
};

export default function DowntimeParetoReportClient() {
  const { t } = useI18n();
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
    return [{ id: "", name: t("pareto.allMachines") }, ...machines];
  }, [machines, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">{t("pareto.title")}</div>
          <div className="text-sm text-zinc-300">{t("pareto.subtitle")}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            value={range}
            onChange={(e) => setRange(e.target.value as DowntimeRange)}
          >
            <option className="bg-black text-white" value="24h">{t("pareto.range.24h")}</option>
            <option className="bg-black text-white" value="7d">{t("pareto.range.7d")}</option>
            <option className="bg-black text-white" value="30d">{t("pareto.range.30d")}</option>
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
