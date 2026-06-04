import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { buildWeeklyReport } from "@/lib/reports/weeklyReport";

function parseDate(raw: string | null | undefined) {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function parseMachineId(raw: string | null | undefined) {
  if (!raw) return undefined;
  const value = String(raw).trim();
  if (!value || value === 'all') return undefined;
  return value;
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));
  const machineId = parseMachineId(url.searchParams.get("machineId"));

  const report = await buildWeeklyReport({
    orgId: session.orgId,
    from,
    to,
    machineId,
  });

  return NextResponse.json(report, {
    headers: {
      "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
      Vary: "Cookie",
    },
  });
}
