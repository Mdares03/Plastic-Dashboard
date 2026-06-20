import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { computeRoi } from "@/lib/reports/roi";

/**
 * C2/C3 — ROI tracker data: baseline vs current unplanned downtime, % vs target, money saved,
 * and a 90-day weekly trend. Same downtime authority as the dashboard (verifiable on screen).
 *
 * Query: ?machineId= &from= &to=  (from/to bound the CURRENT window; baseline comes from
 * OrgSettings.defaultsJson.roi or defaults to the 30 days before `from`).
 */

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

function parseDate(v: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return bad(401, "Unauthorized");

  const url = new URL(req.url);
  const machineId = url.searchParams.get("machineId");
  const currentStart = parseDate(url.searchParams.get("from"));
  const currentEnd = parseDate(url.searchParams.get("to"));

  const roi = await computeRoi({
    orgId: session.orgId,
    machineId: machineId || null,
    currentStart,
    currentEnd,
  });

  return NextResponse.json({ ok: true, orgId: session.orgId, machineId: machineId || null, roi });
}
