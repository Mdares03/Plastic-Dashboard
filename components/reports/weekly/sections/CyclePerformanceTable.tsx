import type { WeeklyReport } from "@/lib/reports/types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function fmtDelta(value: number) {
  const rounded = value.toFixed(1);
  return `${value > 0 ? "+" : ""}${rounded}%`;
}

export default function CyclePerformanceTable({
  report,
  locale,
  t,
}: {
  report: WeeklyReport;
  locale: string;
  t: Translator;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 text-sm font-semibold text-white">{t("reports.weekly.cyclePerformance")}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs text-zinc-300">
          <thead>
            <tr className="border-b border-white/10 text-zinc-400">
              <th className="py-2 pr-3">OT</th>
              <th className="py-2 pr-3">SKU</th>
              <th className="py-2 pr-3">{t("reports.weekly.machine")}</th>
              <th className="py-2 pr-3">{t("reports.weekly.targetCycle")}</th>
              <th className="py-2 pr-3">{t("reports.weekly.actualCycle")}</th>
              <th className="py-2 pr-3">Δ%</th>
              <th className="py-2">{t("reports.weekly.units")}</th>
            </tr>
          </thead>
          <tbody>
            {report.workOrderCycles.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-3 text-zinc-500">{t("reports.weekly.empty")}</td>
              </tr>
            ) : (
              report.workOrderCycles.slice(0, 12).map((row) => (
                <tr key={`${row.machineName}-${row.workOrderId}`} className="border-b border-white/5">
                  <td className="py-2 pr-3">{row.workOrderId}</td>
                  <td className="py-2 pr-3">{row.sku}</td>
                  <td className="py-2 pr-3">{row.machineName}</td>
                  <td className="py-2 pr-3">{row.targetCycleSec.toFixed(2)}s</td>
                  <td className="py-2 pr-3">{row.actualAvgCycleSec.toFixed(2)}s</td>
                  <td className={`py-2 pr-3 ${row.deltaPct > 0 ? "text-yellow-300" : "text-emerald-300"}`}>
                    {fmtDelta(row.deltaPct)}
                  </td>
                  <td className="py-2">{row.unitsProduced.toLocaleString(locale)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
