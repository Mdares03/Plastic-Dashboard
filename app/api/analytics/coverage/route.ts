import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { episodeWindowMinutes } from "@/lib/metrics";
import { coerceDowntimeRange, rangeToStart } from "@/lib/analytics/downtimeRange";

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return bad(401, "Unauthorized");
  const orgId = session.orgId;

  const url = new URL(req.url);

  // ✅ Parse params INSIDE handler
  const range = coerceDowntimeRange(url.searchParams.get("range"));
  const start = rangeToStart(range);
  const windowEnd = new Date(); // rolling window ends now (R5 clamp upper bound)

  const machineId = url.searchParams.get("machineId"); // optional
  const kind = (url.searchParams.get("kind") || "downtime").toLowerCase();

  // coverage is only meaningful for downtime
  if (kind !== "downtime") return bad(400, "Invalid kind (downtime only)");

  let resolvedMachineId: string | null = null;

  // If machineId provided, validate ownership
  if (machineId) {
    const m = await prisma.machine.findFirst({
      where: { id: machineId, orgId },
      select: { id: true },
    });
    if (!m) return bad(404, "Machine not found");
    resolvedMachineId = m.id;
  }

  const rows = await prisma.reasonEntry.findMany({
    where: {
      orgId,
      ...(resolvedMachineId ? { machineId: resolvedMachineId } : {}),
      kind: "downtime",
      capturedAt: { gte: start },
    },
    select: { durationSeconds: true, capturedAt: true, episodeEndTs: true, episodeId: true },
  });

  const receivedEpisodes = new Set(rows.map((r) => r.episodeId).filter(Boolean)).size;

  // R5: window-clamp + 12h cap each episode, congruent with the pareto/recap totals.
  const receivedMinutes =
    Math.round(rows.reduce((acc, r) => acc + episodeWindowMinutes(r, start, windowEnd), 0) * 10) / 10;

  return NextResponse.json({
    ok: true,
    orgId,
    machineId: resolvedMachineId, // null => org-wide
    range,
    start,
    receivedEpisodes,
    receivedMinutes,
    note:
      "Control Tower received coverage (sync health). True coverage vs total downtime minutes can be added once CT has total downtime minutes per window.",
  });
}
