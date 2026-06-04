import { prisma } from "@/lib/prisma";
import { isUnclassifiedReasonCode } from "@/lib/analytics/downtimeFilters";
import { isInPlannedShift, loadShiftPlanningContext } from "@/lib/reports/queries/shiftPlanning";

export async function getClassificationRate(params: {
  orgId: string;
  from: Date;
  to: Date;
  machineIds: string[];
}) {
  const { orgId, from, to, machineIds } = params;
  if (!machineIds.length) return { rate: 0, classifiedCount: 0, totalStopEvents: 0 };

  const [reasons, shiftCtx] = await Promise.all([
    prisma.reasonEntry.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        kind: "downtime",
        capturedAt: { gte: from, lte: to },
      },
      select: { id: true, episodeId: true, reasonCode: true, capturedAt: true },
    }),
    loadShiftPlanningContext(orgId),
  ]);

  // Count by stop episode (incident), not raw event rows, to avoid is_update/auto_ack noise.
  const episodeState = new Map<string, { classified: boolean }>();
  for (const row of reasons) {
    if (!isInPlannedShift(shiftCtx, row.capturedAt)) continue;
    const key = row.episodeId ? `ep:${row.episodeId}` : `id:${row.id}`;
    const prev = episodeState.get(key) ?? { classified: false };
    if (!isUnclassifiedReasonCode(row.reasonCode)) {
      prev.classified = true;
    }
    episodeState.set(key, prev);
  }

  const totalStopEvents = episodeState.size;
  const classifiedCount = [...episodeState.values()].reduce(
    (acc, value) => (value.classified ? acc + 1 : acc),
    0
  );

  return {
    rate: totalStopEvents > 0 ? classifiedCount / totalStopEvents : 0,
    classifiedCount,
    totalStopEvents,
  };
}
