import { prisma } from "@/lib/prisma";
import { episodeWindowMinutes } from "@/lib/metrics";
import { loadShiftPlanningContext, resolveShiftName } from "@/lib/reports/queries/shiftPlanning";

export async function getDowntimeByShift(params: {
  orgId: string;
  from: Date;
  to: Date;
  machineIds: string[];
  timeZoneFallback?: string;
}) {
  const { orgId, from, to, machineIds, timeZoneFallback } = params;
  if (!machineIds.length) return [];

  const [rows, shiftCtx] = await Promise.all([
    prisma.reasonEntry.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        kind: "downtime",
        capturedAt: { gte: from, lte: to },
      },
      select: {
        capturedAt: true,
        episodeEndTs: true,
        durationSeconds: true,
      },
    }),
    loadShiftPlanningContext(orgId, timeZoneFallback),
  ]);

  const agg = new Map<string, { shiftName: string; minutes: number; events: number }>();
  for (const row of rows) {
    const shiftName = resolveShiftName(shiftCtx, row.capturedAt);
    if (!shiftName) continue;

    const prev = agg.get(shiftName) ?? { shiftName, minutes: 0, events: 0 };
    // R5: clamp to window + 12h cap, same authority as recap/reports/losses.
    prev.minutes += episodeWindowMinutes(row, from, to);
    prev.events += 1;
    agg.set(shiftName, prev);
  }

  for (const shift of shiftCtx.shifts) {
    if (!agg.has(shift.name)) {
      agg.set(shift.name, { shiftName: shift.name, minutes: 0, events: 0 });
    }
  }

  return [...agg.values()].sort((a, b) => b.minutes - a.minutes);
}
