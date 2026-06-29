import type { WeeklyReport } from "@/lib/reports/types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

export default function DowntimeClassified({
  report,
  t,
}: {
  report: WeeklyReport;
  t: Translator;
}) {
  const paretoRows = report.downtimeByReason.slice(0, 8);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-2 text-sm font-semibold text-white">{t("reports.weekly.downtimePareto")}</div>
        <div className="space-y-2">
          {paretoRows.length === 0 ? (
            <div className="text-xs text-zinc-400">{t("reports.weekly.empty")}</div>
          ) : (
            paretoRows.map((row) => (
              <div key={row.reasonCode} className="rounded-lg border border-white/10 bg-black/20 p-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-zinc-200">{row.reasonLabel}</span>
                  <span className="text-zinc-400">{row.minutes.toFixed(0)} min</span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-400">{row.events} {t("reports.weekly.events")}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-2 text-sm font-semibold text-white">{t("reports.weekly.downtimeByShift")}</div>
        <div className="space-y-2">
          {report.downtimeByShift.length === 0 ? (
            <div className="text-xs text-zinc-400">{t("reports.weekly.empty")}</div>
          ) : (
            report.downtimeByShift.map((row) => (
              <div key={row.shiftName} className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200">{row.shiftName}</span>
                  <span className="text-zinc-400">{row.minutes.toFixed(0)} min</span>
                </div>
                <div className="mt-1 text-zinc-400">{row.events} {t("reports.weekly.events")}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
