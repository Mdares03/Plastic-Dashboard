import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/requireSession";
import { buildWeeklyReport } from "@/lib/reports/weeklyReport";
import WeeklyReportClient from "./WeeklyReportClient";

type SearchParams = Record<string, string | string[] | undefined>;

function toSingle(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? undefined;
  return value;
}

function parseDate(raw: string | undefined) {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseMachineId(raw: string | undefined) {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value || value === 'all') return undefined;
  return value;
}

export default async function WeeklyReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = await requireSession();
  if (!session) redirect("/login?next=/reports/weekly");

  const resolved = searchParams ? await searchParams : {};
  const from = parseDate(toSingle(resolved.from));
  const to = parseDate(toSingle(resolved.to));
  const machineId = parseMachineId(toSingle(resolved.machineId));

  const report = await buildWeeklyReport({
    orgId: session.orgId,
    from,
    to,
    machineId,
  });

  return <WeeklyReportClient report={report} />;
}
