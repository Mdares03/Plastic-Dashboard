import type { WeeklyReport } from "@/lib/reports/types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function fmtMoney(value: number, locale: string) {
  return value.toLocaleString(locale, {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
}

export default function RecommendedActions({
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
      <div className="mb-2 text-sm font-semibold text-white">{t("reports.weekly.recommendedActions")}</div>
      <div className="space-y-2">
        {report.recommendedActions.length === 0 ? (
          <div className="text-xs text-zinc-500">{t("reports.weekly.empty")}</div>
        ) : (
          report.recommendedActions.map((row, index) => (
            <div key={`${row.title}-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-sm font-medium text-zinc-100">{row.title}</div>
              <div className="mt-1 text-xs text-zinc-400">
                {t("reports.weekly.owner")}: {row.owner} · {t("reports.weekly.eta")}: {row.eta}
              </div>
              {report.financialVisibility.hasAnyCost ? (
                <div className="mt-1 text-xs text-emerald-300">
                  {t("reports.weekly.recoverable")}: {fmtMoney(row.estimatedRecoveryMXN, locale)}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
