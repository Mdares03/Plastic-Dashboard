import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/prisma";
import { getRecapTimelineForMachine, parseRecapTimelineRange } from "@/lib/recap/timelineApi";

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const session = await requireSession();
  if (!session) return bad(401, "Unauthorized");

  const { machineId } = await params;
  if (!machineId) return bad(400, "machineId is required");

  const machine = await prisma.machine.findFirst({
    where: { id: machineId, orgId: session.orgId },
    select: { id: true },
  });
  if (!machine) return bad(404, "Machine not found");

  const url = new URL(req.url);
  const { start, end, maxSegments } = parseRecapTimelineRange(url.searchParams);
  const response = await getRecapTimelineForMachine({
    orgId: session.orgId,
    machineId,
    start,
    end,
    maxSegments,
  });

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "private, max-age=60, stale-while-revalidate=60",
    },
  });
}
