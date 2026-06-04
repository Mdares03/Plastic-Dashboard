import type { WeeklyReport } from "@/lib/reports/types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

export default function WorkOrderStatusTable({
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
      <div className="mb-2 text-sm font-semibold text-white">{t("reports.weekly.workOrderStatus")}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs text-zinc-300">
          <thead>
            <tr className="border-b border-white/10 text-zinc-400">
              <th className="py-2 pr-3">OT</th>
              <th className="py-2 pr-3">SKU</th>
              <th className="py-2 pr-3">{t("reports.weekly.machine")}</th>
              <th className="py-2 pr-3">Target</th>
              <th className="py-2 pr-3">{t("reports.weekly.completed")}</th>
              <th className="py-2 pr-3">%</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.workOrderStatus.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-3 text-zinc-500">{t("reports.weekly.empty")}</td>
              </tr>
            ) : (
              report.workOrderStatus.map((row) => (
                <tr key={`${row.machineName}-${row.workOrderId}`} className="border-b border-white/5">
                  <td className="py-2 pr-3">{row.workOrderId}</td>
                  <td className="py-2 pr-3">{row.sku}</td>
                  <td className="py-2 pr-3">{row.machineName}</td>
                  <td className="py-2 pr-3">{row.target.toLocaleString(locale)}</td>
                  <td className="py-2 pr-3">{row.completed.toLocaleString(locale)}</td>
                  <td className="py-2 pr-3">{row.pctComplete.toFixed(1)}%</td>
                  <td className="py-2">{row.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
