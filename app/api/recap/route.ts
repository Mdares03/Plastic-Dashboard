import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { getRecapDataCached, parseRecapQuery } from "@/lib/recap/getRecapData";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = parseRecapQuery({
    machineId: url.searchParams.get("machineId"),
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
    shift: url.searchParams.get("shift"),
  });

  const recap = await getRecapDataCached({
    orgId: session.orgId,
    machineId: query.machineId,
    start: query.start ?? undefined,
    end: query.end ?? undefined,
    shift: query.shift ?? undefined,
  });

  return NextResponse.json(recap);
}
