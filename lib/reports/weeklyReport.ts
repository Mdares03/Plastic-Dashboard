import { prisma } from "@/lib/prisma";
import { getClassificationRate } from "@/lib/reports/queries/classificationRate";
import { getCyclePerformanceByWorkOrder } from "@/lib/reports/queries/cyclePerformance";
import { getDowntimeByShift } from "@/lib/reports/queries/downtimeByShift";
import { getLossesByReason } from "@/lib/reports/queries/losses";
import { getOeeSnapshot } from "@/lib/reports/queries/oee";
import { getOeeTrend7d } from "@/lib/reports/queries/oeeTrend";
import { getProductionVsTarget } from "@/lib/reports/queries/production";
import { getRecommendedActions } from "@/lib/reports/queries/recommendedActions";
import { getScrapTopSkus } from "@/lib/reports/queries/scrapTopSkus";
import { getWorkOrderStatus } from "@/lib/reports/queries/workOrderStatus";
import type { MachineCostProfile, WeeklyReport } from "@/lib/reports/types";

function clampPct(value: number) {
  return Math.max(0, Math.min(100, value));
}

function toIso(date: Date) {
  return date.toISOString();
}

function getDateRange(input?: { from?: Date; to?: Date }) {
  const to = input?.to ? new Date(input.to) : new Date();
  const from = input?.from ? new Date(input.from) : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    const now = new Date();
    return {
      from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      to: now,
    };
  }

  return { from, to };
}

function resolveMachineCostProfiles(params: {
  machines: Array<{ id: string; location: string | null }>;
  orgMachineCostPerMin: number | null;
  orgScrapCostPerUnit: number | null;
  locationOverrides: Array<{ location: string; machineCostPerMin: number | null; scrapCostPerUnit: number | null }>;
  machineOverrides: Array<{ machineId: string; machineCostPerMin: number | null; scrapCostPerUnit: number | null }>;
}) {
  const { machines, orgMachineCostPerMin, orgScrapCostPerUnit, locationOverrides, machineOverrides } = params;

  const locationMap = new Map(
    locationOverrides.map((row) => [
      row.location,
      {
        machineCostPerMin: row.machineCostPerMin,
        scrapCostPerUnit: row.scrapCostPerUnit,
      },
    ])
  );

  const machineMap = new Map(
    machineOverrides.map((row) => [
      row.machineId,
      {
        machineCostPerMin: row.machineCostPerMin,
        scrapCostPerUnit: row.scrapCostPerUnit,
      },
    ])
  );

  const result = new Map<string, MachineCostProfile>();

  for (const machine of machines) {
    const machineOverride = machineMap.get(machine.id);
    const locationOverride = machine.location ? locationMap.get(machine.location) : undefined;
    const machineCostPerMin =
      machineOverride?.machineCostPerMin ??
      locationOverride?.machineCostPerMin ??
      orgMachineCostPerMin ??
      null;
    const scrapCostPerUnit =
      machineOverride?.scrapCostPerUnit ??
      locationOverride?.scrapCostPerUnit ??
      orgScrapCostPerUnit ??
      null;

    result.set(machine.id, {
      machineId: machine.id,
      machineCostPerMin,
      scrapCostPerUnit,
    });
  }

  return result;
}

function resolvePlantName(orgName: string, machines: Array<{ location: string | null }>) {
  const labels = machines
    .map((machine) => machine.location)
    .filter((value): value is string => !!value && value.trim().length > 0);
  if (!labels.length) return orgName;

  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? orgName;
}

export async function buildWeeklyReport(params: {
  orgId: string;
  from?: Date;
  to?: Date;
  machineId?: string;
}): Promise<WeeklyReport> {
  const { orgId, machineId } = params;
  const { from, to } = getDateRange(params);

  const [org, settings, machines, heartbeats, orgProfile, locationOverrides, machineOverrides] =
    await Promise.all([
      prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
      prisma.orgSettings.findUnique({
        where: { orgId },
        select: { timezone: true, oeeAlertThresholdPct: true },
      }),
      prisma.machine.findMany({
        where: {
          orgId,
          ...(machineId ? { id: machineId } : {}),
        },
        select: { id: true, name: true, location: true },
      }),
      prisma.machineHeartbeat.findMany({
        where: {
          orgId,
          ...(machineId ? { machineId } : {}),
          ts: { gte: from, lte: to },
        },
        select: { machineId: true },
        distinct: ["machineId"],
      }),
      prisma.orgFinancialProfile.findUnique({
        where: { orgId },
        select: {
          machineCostPerMin: true,
          scrapCostPerUnit: true,
        },
      }),
      prisma.locationFinancialOverride.findMany({
        where: { orgId },
        select: {
          location: true,
          machineCostPerMin: true,
          scrapCostPerUnit: true,
        },
      }),
      prisma.machineFinancialOverride.findMany({
        where: { orgId },
        select: {
          machineId: true,
          machineCostPerMin: true,
          scrapCostPerUnit: true,
        },
      }),
    ]);

  const activeMachineIds = heartbeats.map((row) => row.machineId);
  const machineScopeIds = activeMachineIds.length ? activeMachineIds : machines.map((m) => m.id);
  const scopedMachines = machines.filter((m) => machineScopeIds.includes(m.id));

  const machineNameById = new Map(scopedMachines.map((machine) => [machine.id, machine.name]));
  const machineCostProfileById = resolveMachineCostProfiles({
    machines: scopedMachines,
    orgMachineCostPerMin: orgProfile?.machineCostPerMin ?? null,
    orgScrapCostPerUnit: orgProfile?.scrapCostPerUnit ?? null,
    locationOverrides,
    machineOverrides,
  });

  const timeZone = settings?.timezone || "UTC";
  const oeeTarget = Number.isFinite(settings?.oeeAlertThresholdPct)
    ? Number(settings?.oeeAlertThresholdPct)
    : 85;

  const [production, oeeSnapshot, oeeTrend7d, lossesResult, cyclePerfResult, classification, downtimeByShift, scrapTopSkus, workOrderStatus] =
    await Promise.all([
      getProductionVsTarget({ orgId, from, to, machineIds: machineScopeIds }),
      getOeeSnapshot({
        orgId,
        from,
        to,
        machineIds: machineScopeIds,
        machineNameById,
      }),
      getOeeTrend7d({
        orgId,
        from,
        to,
        machineIds: machineScopeIds,
        targetPct: clampPct(oeeTarget),
        timeZone,
      }),
      getLossesByReason({
        orgId,
        from,
        to,
        machineIds: machineScopeIds,
        machineCostProfileById,
      }),
      getCyclePerformanceByWorkOrder({
        orgId,
        from,
        to,
        machineIds: machineScopeIds,
        machineNameById,
        machineCostProfileById,
      }),
      getClassificationRate({ orgId, from, to, machineIds: machineScopeIds }),
      getDowntimeByShift({
        orgId,
        from,
        to,
        machineIds: machineScopeIds,
        timeZoneFallback: timeZone,
      }),
      getScrapTopSkus({
        orgId,
        from,
        to,
        machineIds: machineScopeIds,
        machineCostProfileById,
      }),
      getWorkOrderStatus({
        orgId,
        from,
        to,
        machineIds: machineScopeIds,
        machineNameById,
      }),
    ]);

  const recommendedActions = await getRecommendedActions({
    orgId,
    topLosses: lossesResult.topLosses,
    reasonCostMap: lossesResult.reasonCostMap,
  });

  const scrapLossMXN = scrapTopSkus.reduce((acc, row) => acc + row.estimatedCostMXN, 0);
  const estimatedLossMXN =
    lossesResult.totalDowntimeCostMXN + cyclePerfResult.totalPerformanceLossMXN + scrapLossMXN;

  const hasMachineCost = [...machineCostProfileById.values()].some(
    (profile) => profile.machineCostPerMin != null
  );
  const hasScrapCost = [...machineCostProfileById.values()].some(
    (profile) => profile.scrapCostPerUnit != null
  );

  return {
    period: {
      from: toIso(from),
      to: toIso(to),
      generatedAt: toIso(new Date()),
    },
    org: {
      name: org?.name ?? "Organización",
      plant: resolvePlantName(org?.name ?? "Organización", scopedMachines),
    },
    machineIds: machineScopeIds,
    production,
    oeeAvg: oeeSnapshot.oeeAvg,
    availabilityAvg: oeeSnapshot.availabilityAvg,
    performanceAvg: oeeSnapshot.performanceAvg,
    qualityAvg: oeeSnapshot.qualityAvg,
    estimatedLossMXN,
    classificationRate: classification.rate,
    classificationTarget: 0.8,
    financialVisibility: {
      hasMachineCost,
      hasScrapCost,
      hasAnyCost: hasMachineCost || hasScrapCost,
    },
    machines: oeeSnapshot.machines,
    oeeTrend7d,
    topLosses: lossesResult.topLosses,
    workOrderCycles: cyclePerfResult.rows,
    downtimeByReason: lossesResult.downtimeByReason,
    downtimeByShift,
    scrapTopSkus,
    workOrderStatus,
    recommendedActions,
  };
}
