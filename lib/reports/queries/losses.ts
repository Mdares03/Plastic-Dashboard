import { prisma } from "@/lib/prisma";
import { episodeWindowMinutes } from "@/lib/metrics";
import { isInPlannedShift, loadShiftPlanningContext } from "@/lib/reports/queries/shiftPlanning";
import type { LossRow, MachineCostProfile, ParetoRow } from "@/lib/reports/types";

type LossesResult = {
  topLosses: LossRow[];
  downtimeByReason: ParetoRow[];
  totalDowntimeCostMXN: number;
  reasonCostMap: Map<string, number>;
};

export async function getLossesByReason(params: {
  orgId: string;
  from: Date;
  to: Date;
  machineIds: string[];
  machineCostProfileById: Map<string, MachineCostProfile>;
}): Promise<LossesResult> {
  const { orgId, from, to, machineIds, machineCostProfileById } = params;

  if (!machineIds.length) {
    return {
      topLosses: [],
      downtimeByReason: [],
      totalDowntimeCostMXN: 0,
      reasonCostMap: new Map<string, number>(),
    };
  }

  const [rows, shiftCtx] = await Promise.all([
    prisma.reasonEntry.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        kind: "downtime",
        capturedAt: { gte: from, lte: to },
      },
      select: {
        machineId: true,
        reasonCode: true,
        reasonLabel: true,
        reasonText: true,
        capturedAt: true,
        episodeEndTs: true,
        durationSeconds: true,
      },
    }),
    loadShiftPlanningContext(orgId),
  ]);

  const grouped = new Map<
    string,
    {
      reasonCode: string;
      reasonLabel: string;
      minutes: number;
      events: number;
      estimatedCostMXN: number;
      contextNote?: string;
    }
  >();

  for (const row of rows) {
    if (!isInPlannedShift(shiftCtx, row.capturedAt)) continue;

    const reasonCode = String(row.reasonCode || "UNCLASSIFIED");
    const reasonLabel = String(row.reasonLabel || row.reasonCode || "Sin clasificar");
    // R5: clamp each episode to the report window and cap runaway/open episodes
    // at 12 h — same authority recap/reports use, so loss minutes are congruent.
    const minutes = episodeWindowMinutes(row, from, to);
    if (minutes <= 0) continue;
    const machineCostPerMin = machineCostProfileById.get(row.machineId)?.machineCostPerMin ?? null;
    const estimatedCost = machineCostPerMin == null ? 0 : minutes * machineCostPerMin;

    const prev = grouped.get(reasonCode) ?? {
      reasonCode,
      reasonLabel,
      minutes: 0,
      events: 0,
      estimatedCostMXN: 0,
      contextNote: undefined,
    };
    prev.minutes += minutes;
    prev.events += 1;
    prev.estimatedCostMXN += estimatedCost;
    if (!prev.contextNote && row.reasonText && row.reasonText !== reasonLabel) {
      prev.contextNote = row.reasonText;
    }
    grouped.set(reasonCode, prev);
  }

  const sorted = [...grouped.values()].sort((a, b) => b.minutes - a.minutes);

  const downtimeByReason: ParetoRow[] = sorted.map((row) => ({
    reasonCode: row.reasonCode,
    reasonLabel: row.reasonLabel,
    minutes: row.minutes,
    events: row.events,
  }));

  const topLosses: LossRow[] = sorted.slice(0, 3).map((row) => ({
    reasonCode: row.reasonCode,
    reasonLabel: row.reasonLabel,
    minutes: row.minutes,
    events: row.events,
    estimatedCostMXN: row.estimatedCostMXN,
    contextNote: row.contextNote,
  }));

  const totalDowntimeCostMXN = sorted.reduce((acc, row) => acc + row.estimatedCostMXN, 0);
  const reasonCostMap = new Map<string, number>(
    sorted.map((row) => [row.reasonCode, row.estimatedCostMXN])
  );

  return {
    topLosses,
    downtimeByReason,
    totalDowntimeCostMXN,
    reasonCostMap,
  };
}
