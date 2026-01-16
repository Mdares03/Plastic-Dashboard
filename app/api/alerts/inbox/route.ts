import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { getAlertsInboxData } from "@/lib/alerts/getAlertsInboxData";

function parseDate(input?: string | null) {
  if (!input) return null;
  const n = Number(input);
  if (!Number.isNaN(n)) return new Date(n);
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "24h";
  const machineId = url.searchParams.get("machineId") ?? undefined;
  const location = url.searchParams.get("location") ?? undefined;
  const eventType = url.searchParams.get("eventType") ?? undefined;
  const severity = url.searchParams.get("severity") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const shift = url.searchParams.get("shift") ?? undefined;
  const includeUpdates = url.searchParams.get("includeUpdates") === "1";
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
  const start = parseDate(url.searchParams.get("start"));
  const end = parseDate(url.searchParams.get("end"));

  const result = await getAlertsInboxData({
    orgId: session.orgId,
    range,
    start,
    end,
    machineId,
    location,
    eventType,
    severity,
    status,
    shift,
    includeUpdates,
    limit,
  });

  return NextResponse.json({ ok: true, range: result.range, events: result.events });
}
