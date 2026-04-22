import { prisma } from "@/lib/prisma";
import type { OverviewMachineRow } from "@/lib/overview/types";

type MachineBaseRow = Pick<
  OverviewMachineRow,
  "id" | "name" | "code" | "location" | "createdAt" | "updatedAt"
>;

type LatestHeartbeatRow = {
  machineId: string;
  ts: Date;
  tsServer: Date | null;
  status: string;
  message?: string | null;
  ip?: string | null;
  fwVersion?: string | null;
};

type LatestKpiRow = {
  machineId: string;
  ts: Date;
  oee?: number | null;
  availability?: number | null;
  performance?: number | null;
  quality?: number | null;
  workOrderId?: string | null;
  sku?: string | null;
  good?: number | null;
  scrap?: number | null;
  target?: number | null;
  cycleTime?: number | null;
};

export async function fetchMachineBase(orgId: string): Promise<MachineBaseRow[]> {
  return prisma.machine.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      code: true,
      location: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function fetchLatestHeartbeats(
  orgId: string,
  machineIds: string[]
): Promise<LatestHeartbeatRow[]> {
  if (!machineIds.length) return [];
  return prisma.machineHeartbeat.findMany({
    where: { orgId, machineId: { in: machineIds } },
    orderBy: [{ machineId: "asc" }, { tsServer: "desc" }],
    distinct: ["machineId"],
    select: {
      machineId: true,
      ts: true,
      tsServer: true,
      status: true,
      message: true,
      ip: true,
      fwVersion: true,
    },
  });
}

export async function fetchLatestKpis(
  orgId: string,
  machineIds: string[]
): Promise<LatestKpiRow[]> {
  if (!machineIds.length) return [];
  return prisma.machineKpiSnapshot.findMany({
    where: { orgId, machineId: { in: machineIds } },
    orderBy: [{ machineId: "asc" }, { ts: "desc" }],
    distinct: ["machineId"],
    select: {
      machineId: true,
      ts: true,
      oee: true,
      availability: true,
      performance: true,
      quality: true,
      workOrderId: true,
      sku: true,
      good: true,
      scrap: true,
      target: true,
      cycleTime: true,
    },
  });
}

export function mergeMachineOverviewRows(params: {
  machines: MachineBaseRow[];
  heartbeats: LatestHeartbeatRow[];
  kpis?: LatestKpiRow[];
  includeKpi?: boolean;
}): OverviewMachineRow[] {
  const { machines, heartbeats, kpis = [], includeKpi = false } = params;
  const heartbeatMap = new Map(heartbeats.map((row) => [row.machineId, row]));
  const kpiMap = new Map(kpis.map((row) => [row.machineId, row]));

  return machines.map((machine) => ({
    ...machine,
    latestHeartbeat: (heartbeatMap.get(machine.id) ?? null) as OverviewMachineRow["latestHeartbeat"],
    latestKpi: includeKpi ? (kpiMap.get(machine.id) ?? null) : null,
    heartbeats: undefined,
    kpiSnapshots: undefined,
  }));
}
