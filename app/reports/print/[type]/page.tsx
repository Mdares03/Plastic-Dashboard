import { notFound } from "next/navigation";
import { verifyPrintToken } from "@/lib/reports/printToken";
import { buildWeeklyReport } from "@/lib/reports/weeklyReport";
import PrintReport from "./PrintReport";

/**
 * Token-gated print route for headless-PDF rendering (item 3). Validates the signed
 * print token (no session — Puppeteer has no cookie), builds the report for the
 * token's org, and renders the print-only view. Daily vs weekly differ only by the
 * window carried in the token.
 */

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReportPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { type } = await params;
  const sp = searchParams ? await searchParams : {};
  const payload = verifyPrintToken(toSingle(sp.token));
  if (!payload || payload.type !== type) notFound();

  const from = payload.from ? new Date(payload.from) : undefined;
  const to = payload.to ? new Date(payload.to) : undefined;

  const report = await buildWeeklyReport({
    orgId: payload.orgId,
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    comparePrevious: true,
  });

  return <PrintReport report={report} />;
}
