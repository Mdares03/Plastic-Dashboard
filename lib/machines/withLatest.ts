import { prisma } from "@/lib/prisma";
import { getLatestRates } from "@/lib/metrics";
import type { OverviewLatestKpi, OverviewMachineRow } from "@/lib/overview/types";

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
  trackingEnabled?: boolean | null;
  productionStarted?: boolean | null;
  workOrderId?: string | null;
  sku?: string | null;
  good?: number | null;
  scrap?: number | null;
  target?: number | null;
  cycleTime?: number | null;
};

export type ActiveWorkOrderRow = {
  machineId: string;
  workOrderId: string;
  sku: string | null;
  mold: string | null;
  targetQty: number | null;
  goodParts: number;
  scrapParts: number;
  cycleTime: number | null;
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
      trackingEnabled: true,
      productionStarted: true,
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

export async function fetchActiveWorkOrders(
  orgId: string,
  machineIds: string[]
): Promise<ActiveWorkOrderRow[]> {
  if (!machineIds.length) return [];
  return prisma.machineWorkOrder.findMany({
    where: {
      orgId,
      machineId: { in: machineIds },
      status: { notIn: ["COMPLETED", "DONE", "CLOSED", "CANCELLED"] },
    },
    orderBy: [{ machineId: "asc" }, { updatedAt: "desc" }],
    distinct: ["machineId"],
    select: {
      machineId: true,
      workOrderId: true,
      sku: true,
      mold: true,
      targetQty: true,
      goodParts: true,
      scrapParts: true,
      cycleTime: true,
    },
  });
}

export async function fetchDowntimeCountsByWorkOrder(
  orgId: string,
  workOrderIds: string[]
): Promise<Map<string, number>> {
  const keys = [...new Set(workOrderIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!keys.length) return new Map<string, number>();

  const grouped = await prisma.reasonEntry.groupBy({
    by: ["workOrderId"],
    where: {
      orgId,
      kind: "downtime",
      episodeId: { not: null },
      workOrderId: { in: keys },
    },
    _count: { _all: true },
  });

  const out = new Map<string, number>();
  for (const row of grouped) {
    const key = String(row.workOrderId ?? "").trim();
    if (!key) continue;
    out.set(key, row._count._all ?? 0);
  }
  return out;
}

/**
 * R4 — gate the "current" rate tiles. OEE/A/P/Q render only when the latest
 * snapshot is a fresh (<10 min) production sample; otherwise they are null ("—",
 * R7) — never a stale snapshot presented as the live number (an offline machine
 * must not keep showing its last OEE). Factual fields (counts, cycleTime) pass
 * through unchanged. The single latest snapshot is the only sample we hold here,
 * so getLatestRates gates exactly that row.
 */
function gateLatestKpi(row: LatestKpiRow | null, now: Date): OverviewLatestKpi | null {
  if (!row) return null;
  const rates = getLatestRates(
    [
      {
        ts: row.ts,
        oee: row.oee ?? null,
        availability: row.availability ?? null,
        performance: row.performance ?? null,
        quality: row.quality ?? null,
        trackingEnabled: row.trackingEnabled ?? null,
        productionStarted: row.productionStarted ?? null,
      },
    ],
    now,
  );
  return {
    ts: row.ts,
    oee: rates.oee,
    availability: rates.availability,
    performance: rates.performance,
    quality: rates.quality,
    workOrderId: row.workOrderId,
    sku: row.sku,
    good: row.good,
    scrap: row.scrap,
    target: row.target,
    cycleTime: row.cycleTime,
  };
}

export function mergeMachineOverviewRows(params: {
  machines: MachineBaseRow[];
  heartbeats: LatestHeartbeatRow[];
  kpis?: LatestKpiRow[];
  macrostops?: LatestMacrostopRow[];
  activeWorkOrders?: ActiveWorkOrderRow[];
  downtimeCountByWorkOrder?: Map<string, number>;
  includeKpi?: boolean;
  now?: Date;
}): OverviewMachineRow[] {
  const {
    machines,
    heartbeats,
    kpis = [],
    macrostops = [],
    activeWorkOrders = [],
    downtimeCountByWorkOrder = new Map<string, number>(),
    includeKpi = false,
    now = new Date(),
  } = params;
  const heartbeatMap = new Map(heartbeats.map((row) => [row.machineId, row]));
  const kpiMap = new Map(kpis.map((row) => [row.machineId, row]));
  const macrostopMap = new Map(macrostops.map((row) => [row.machineId, row]));
  const activeWorkOrderMap = new Map(activeWorkOrders.map((row) => [row.machineId, row]));

  return machines.map((machine) => ({
    ...machine,
    latestHeartbeat: (heartbeatMap.get(machine.id) ?? null) as OverviewMachineRow["latestHeartbeat"],
    latestKpi: includeKpi ? gateLatestKpi(kpiMap.get(machine.id) ?? null, now) : null,
    latestMacrostop: macrostopMap.get(machine.id) ?? null,
    activeWorkOrder: (() => {
      const row = activeWorkOrderMap.get(machine.id);
      if (!row) return null;
      return {
        id: row.workOrderId,
        workOrderId: row.workOrderId,
        sku: row.sku,
        mold: row.mold,
        target: row.targetQty,
        goodParts: row.goodParts,
        scrapParts: row.scrapParts,
        cycleTime: row.cycleTime,
        stopsCount: downtimeCountByWorkOrder.get(row.workOrderId) ?? 0,
      };
    })(),
    heartbeats: undefined,
    kpiSnapshots: undefined,
  }));
}
