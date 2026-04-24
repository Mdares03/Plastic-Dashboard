import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { getRecapMachineDetailCached, parseRecapDetailRangeInput } from "@/lib/recap/redesign";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { machineId } = await params;
  if (!machineId) {
    return NextResponse.json({ ok: false, error: "machineId is required" }, { status: 400 });
  }

  const url = new URL(req.url);
  const input = parseRecapDetailRangeInput(url.searchParams);
  const detail = await getRecapMachineDetailCached({
    orgId: session.orgId,
    machineId,
    input,
  });

  if (!detail) {
    return NextResponse.json({ ok: false, error: "Machine not found" }, { status: 404 });
  }

  return NextResponse.json(detail, {
    headers: {
      "Cache-Control": "private, max-age=60, stale-while-revalidate=60",
    },
  });
}
