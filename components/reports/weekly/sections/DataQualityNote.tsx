import type { WeeklyReport } from "@/lib/reports/types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

export default function DataQualityNote({
  report,
  t,
}: {
  report: WeeklyReport;
  t: Translator;
}) {
  const pct = report.classificationRate * 100;
  const target = report.classificationTarget * 100;
  const belowTarget = report.classificationRate < report.classificationTarget;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-1 text-sm font-semibold text-white">{t("reports.weekly.dataQuality")}</div>
      <div className="text-xs text-zinc-300">
        {t("reports.weekly.classifiedStops")}: <span className={belowTarget ? "text-yellow-300" : "text-emerald-300"}>{pct.toFixed(1)}%</span>
        {" · "}
        {t("reports.weekly.target")}: {target.toFixed(0)}%
      </div>
      <div className="mt-2 text-xs text-zinc-400">{t("reports.weekly.dataQualityNote")}</div>
    </div>
  );
}
