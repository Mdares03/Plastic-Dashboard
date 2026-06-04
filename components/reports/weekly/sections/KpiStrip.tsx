import type { WeeklyReport } from "@/lib/reports/types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function fmtPct(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function fmtInt(value: number, locale: string) {
  return value.toLocaleString(locale);
}

function fmtMoney(value: number, locale: string) {
  return value.toLocaleString(locale, {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
}

export default function KpiStrip({
  report,
  locale,
  t,
}: {
  report: WeeklyReport;
  locale: string;
  t: Translator;
}) {
  const kpis = [
    {
      label: t("reports.weekly.kpi.productionVsPlan"),
      value: `${fmtInt(report.production.good, locale)} / ${fmtInt(report.production.target, locale)}`,
      hint: fmtPct(report.production.pct),
      tone: "text-emerald-300",
    },
    {
      label: t("reports.weekly.kpi.oeeAvg"),
      value: fmtPct(report.oeeAvg),
      hint: `A ${fmtPct(report.availabilityAvg)} · P ${fmtPct(report.performanceAvg)} · Q ${fmtPct(report.qualityAvg)}`,
      tone: "text-white",
    },
    {
      label: t("reports.weekly.kpi.estimatedLoss"),
      value: report.financialVisibility.hasAnyCost ? fmtMoney(report.estimatedLossMXN, locale) : "--",
      hint: report.financialVisibility.hasAnyCost
        ? t("reports.weekly.kpi.lossHint")
        : t("reports.weekly.costHidden"),
      tone: "text-red-300",
    },
    {
      label: t("reports.weekly.kpi.classificationRate"),
      value: fmtPct(report.classificationRate * 100),
      hint: `${t("reports.weekly.target")} ${fmtPct(report.classificationTarget * 100, 0)}`,
      tone: report.classificationRate >= report.classificationTarget ? "text-emerald-300" : "text-yellow-300",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-zinc-500">{kpi.label}</div>
          <div className={`mt-2 text-2xl font-semibold ${kpi.tone}`}>{kpi.value}</div>
          <div className="mt-1 text-xs text-zinc-400">{kpi.hint}</div>
        </div>
      ))}
    </div>
  );
}
