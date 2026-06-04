import type { WeeklyReport } from "@/lib/reports/types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function fmtMoney(value: number, locale: string) {
  return value.toLocaleString(locale, {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
}

export default function ScrapTopOffenders({
  report,
  locale,
  t,
}: {
  report: WeeklyReport;
  locale: string;
  t: Translator;
}) {
  if (!report.scrapTopSkus.length) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 text-sm font-semibold text-white">{t("reports.weekly.scrapTopSkus")}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs text-zinc-300">
          <thead>
            <tr className="border-b border-white/10 text-zinc-400">
              <th className="py-2 pr-3">SKU</th>
              <th className="py-2 pr-3">{t("reports.weekly.scrapUnits")}</th>
              <th className="py-2 pr-3">{t("reports.weekly.scrapPct")}</th>
              <th className="py-2 pr-3">{t("reports.weekly.mainReason")}</th>
              {report.financialVisibility.hasScrapCost ? <th className="py-2">MXN</th> : null}
            </tr>
          </thead>
          <tbody>
            {report.scrapTopSkus.map((row) => (
              <tr key={row.sku} className="border-b border-white/5">
                <td className="py-2 pr-3">{row.sku}</td>
                <td className="py-2 pr-3">{row.scrapUnits.toLocaleString(locale)}</td>
                <td className="py-2 pr-3">{row.scrapPct.toFixed(1)}%</td>
                <td className="py-2 pr-3">{row.topReasonLabel}</td>
                {report.financialVisibility.hasScrapCost ? (
                  <td className="py-2">{fmtMoney(row.estimatedCostMXN, locale)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
