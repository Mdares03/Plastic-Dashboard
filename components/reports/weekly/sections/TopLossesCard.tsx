import type { WeeklyReport } from "@/lib/reports/types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function fmtMoney(value: number, locale: string) {
  return value.toLocaleString(locale, {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
}

export default function TopLossesCard({
  report,
  locale,
  t,
}: {
  report: WeeklyReport;
  locale: string;
  t: Translator;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-white">{t("reports.weekly.topLosses")}</div>
      <div className="space-y-2">
        {report.topLosses.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-400">
            {t("reports.weekly.empty")}
          </div>
        ) : (
          report.topLosses.map((row) => (
            <div key={row.reasonCode} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-zinc-100">{row.reasonLabel}</div>
                <div className="text-xs text-zinc-400">{row.events} {t("reports.weekly.events")}</div>
              </div>
              <div className="mt-1 text-xs text-zinc-300">
                {row.minutes.toFixed(0)} min
                {report.financialVisibility.hasMachineCost ? ` · ${fmtMoney(row.estimatedCostMXN, locale)}` : ""}
              </div>
              {row.contextNote ? <div className="mt-1 text-xs text-zinc-500">{row.contextNote}</div> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
