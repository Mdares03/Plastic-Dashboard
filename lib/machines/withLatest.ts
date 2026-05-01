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

export type LatestMacrostopRow = {
  machineId: string;
  ts: Date;
  status: "active" | "resolved" | "unknown";
  startedAtMs: number;
};

const MACROSTOP_LOOKBACK_MS = 5 * 60 * 1000;

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

export async function fetchLatestMacrostops(
  orgId: string,
  machineIds: string[]
): Promise<LatestMacrostopRow[]> {
  if (!machineIds.length) return [];

  const rows = await prisma.machineEvent.findMany({
    where: {
      orgId,
      machineId: { in: machineIds },
      eventType: "macrostop",
      ts: { gte: new Date(Date.now() - MACROSTOP_LOOKBACK_MS) },
    },
    orderBy: [{ machineId: "asc" }, { ts: "desc" }],
    select: { machineId: true, ts: true, data: true },
  });

  const byMachine = new Map<string, LatestMacrostopRow>();
  for (const row of rows) {
    if (byMachine.has(row.machineId)) continue;

    let parsed: unknown = row.data;
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch { parsed = null; }
    }
    const data: Record<string, unknown> =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};

    const isAutoAck =
      data.is_auto_ack === true || data.isAutoAck === true ||
      data.is_auto_ack === "true" || data.isAutoAck === "true";
    if (isAutoAck) continue;

    const rawStatus = String(data.status ?? "").trim().toLowerCase();
    const status: LatestMacrostopRow["status"] =
      rawStatus === "active" ? "active" : rawStatus === "resolved" ? "resolved" : "unknown";

    const lastCycleTs = Number(data.last_cycle_timestamp);
    const startedAtMs = Number.isFinite(lastCycleTs) && lastCycleTs > 0
      ? lastCycleTs
      : row.ts.getTime();

    byMachine.set(row.machineId, { machineId: row.machineId, ts: row.ts, status, startedAtMs });
  }

  return Array.from(byMachine.values());
}


export function mergeMachineOverviewRows(params: {
  machines: MachineBaseRow[];
  heartbeats: LatestHeartbeatRow[];
  kpis?: LatestKpiRow[];
  macrostops?: LatestMacrostopRow[];
  includeKpi?: boolean;
}): OverviewMachineRow[] {
  const { machines, heartbeats, kpis = [], macrostops = [], includeKpi = false } = params;
  const heartbeatMap = new Map(heartbeats.map((row) => [row.machineId, row]));
  const kpiMap = new Map(kpis.map((row) => [row.machineId, row]));
  const macrostopMap = new Map(macrostops.map((row) => [row.machineId, row]));


  return machines.map((machine) => ({
    ...machine,
    latestHeartbeat: (heartbeatMap.get(machine.id) ?? null) as OverviewMachineRow["latestHeartbeat"],
    latestKpi: includeKpi ? (kpiMap.get(machine.id) ?? null) : null,
    latestMacrostop: macrostopMap.get(machine.id) ?? null,
    heartbeats: undefined,
    kpiSnapshots: undefined,
  }));
}
