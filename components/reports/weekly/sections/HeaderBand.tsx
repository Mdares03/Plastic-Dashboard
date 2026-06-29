import type { WeeklyReport } from "@/lib/reports/types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function fmtDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function fmtDateTime(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HeaderBand({
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">{t("reports.weekly.title")}</h1>
          <p className="text-sm text-zinc-400">{t("reports.weekly.subtitle")}</p>
        </div>
        <div className="text-right text-xs text-zinc-400">
          <div>
            {t("reports.weekly.generatedAt")}: {fmtDateTime(report.period.generatedAt, locale)}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-zinc-300 sm:grid-cols-4">
        <div>
          <div className="text-xs text-zinc-400">{t("reports.weekly.range")}</div>
          <div>{fmtDate(report.period.from, locale)} - {fmtDate(report.period.to, locale)}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-400">{t("reports.weekly.org")}</div>
          <div>{report.org.name}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-400">{t("reports.weekly.plant")}</div>
          <div>{report.org.plant}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-400">{t("reports.weekly.machinesIncluded")}</div>
          <div>{report.machineIds.length}</div>
        </div>
      </div>
    </div>
  );
}
