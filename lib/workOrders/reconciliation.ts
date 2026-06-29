import { prisma } from "@/lib/prisma";
import {
  COMPLETED_WO_STATUSES,
  isCompletedWorkOrder,
  isOpenWorkOrder,
} from "@/lib/workOrders/status";
import { isTemporarilyBlockedWorkOrder } from "@/lib/workOrders/temporaryBlocklist";

/**
 * Per-work-order completion / counter reconciliation. One source of truth shared by
 * the health checks (lib/health/checks.ts) and the Work Orders tab, so the numbers on
 * the reliability card and the rows on the tab can never disagree.
 *
 * The old single "cavity audit" flagged a job whenever activeCavities × cyclesCounted
 * ≠ good + scrap. That one red badge silently fused THREE unrelated conditions, which
 * is why it read as "the system is broken" with no way out. We now separate them:
 *
 *  1. Counter integrity (`countOk`) — the only genuine "the machine mis-counted"
 *     signal. Compares the WO's OWN authoritative cycle counter (cycle_count) against
 *     good parts: activeCavities × reportedCycleCount ≈ goodParts, tolerating scrap and
 *     rounding. Never uses delivered-row counts, so a delivery gap can't masquerade as
 *     a counter error. Skipped (treated as ok) when cavities are unknown or the WO's
 *     cycle_count is missing/stale (< delivered rows = not propagated, P6.6).
 *
 *  2. Delivery completeness (`delivery`) — a DATA fact, not a wrong number. The WO
 *     counted N cycles but only `cyclesCounted` MachineCycle rows reached the cloud
 *     (messages lost in transit — the 06-15→06-18 outbox freeze, a sensor outage, or
 *     in-flight backlog). `missing` = how many rows are absent, classified:
 *       - explained: covered by a WorkOrderGapAcknowledgement, or overlaps a recorded
 *         sensor-outage window (MachineHeartbeat.reader_online = false).
 *       - recoverable: WO still open and recently active — backlog may still drain.
 *       - unexplained: a gap with no known cause → ALWAYS alert-worthy. No size is
 *         tolerated. Even a 1-row residual points at the edge count↔enqueue seam (a
 *         counted cycle whose outbox row never became durable) and must be root-caused,
 *         not auto-ignored. Explicit, root-caused accepts (e.g. outbox-freeze-prefix)
 *         still explain a gap; a blanket "small gaps are fine" tolerance does not exist.
 *
 *  3. Scrap is TOLERATED — it never produces a flag on its own (scrapDelta is
 *     structurally 0; scrap lives in scrap_parts / ReasonEntry, not in cycle rows).
 */

/** Counter-integrity rounding slack (parts). */
const COUNTER_ROUND_SLACK = 1;
/** An open WO updated within this window is treated as still live (gap may drain). */
const RECOVERABLE_WINDOW_MS = 2 * 60 * 60 * 1000;

export type DeliveryClass = "none" | "explained" | "recoverable" | "unexplained";

export type WorkOrderAudit = {
  /** False only when the WO's own counter is internally inconsistent (a real error). */
  countOk: boolean;
  /** Whether the counter-integrity check could actually run (cavities + usable cycle_count). */
  countChecked: boolean;
  /** The WO records scrap that the old equality would have (wrongly) flagged. */
  scrapTolerated: boolean;
  /** Best estimate of cycles the machine actually ran (its own count, or good/cavities). */
  effectiveCycles: number;
  /** Cycle rows the machine ran but the cloud never received. */
  missing: number;
  delivery: DeliveryClass;
};

/**
 * Pure audit derivation — no DB. Tested directly in tests/workOrders.
 */
export function deriveWorkOrderAudit(input: {
  activeCavities: number | null;
  reportedCycleCount: number;
  cyclesCounted: number;
  goodParts: number;
  scrapParts: number;
  /** Has an acknowledgement been recorded for this gap? */
  acknowledged: boolean;
  /** Did a recorded sensor outage overlap the WO's active span? */
  readerOutage: boolean;
  /** Is the WO open and recently active (backlog could still arrive)? */
  liveRecent: boolean;
}): WorkOrderAudit {
  const {
    activeCavities,
    reportedCycleCount,
    cyclesCounted,
    goodParts,
    scrapParts,
    acknowledged,
    readerOutage,
    liveRecent,
  } = input;

  const cavityKnown = activeCavities != null && activeCavities > 0;
  // The WO's cycle_count is only authoritative when it's present AND it counts at
  // least as many cycles as were delivered. When it's 0 or below the delivered-row
  // count it was never propagated on close (P6.6) — unusable, not a counter error.
  const usableReported = reportedCycleCount > 0 && reportedCycleCount >= cyclesCounted;

  let countChecked = false;
  let countOk = true;
  if (cavityKnown && usableReported) {
    countChecked = true;
    const expectedGood = (activeCavities as number) * reportedCycleCount;
    countOk = Math.abs(expectedGood - goodParts) <= scrapParts + COUNTER_ROUND_SLACK;
  }

  // Best estimate of cycles actually run: the machine's own count when usable, else
  // infer from good parts / cavities, never below what we already received.
  let effectiveCycles: number;
  if (usableReported) {
    effectiveCycles = reportedCycleCount;
  } else if (cavityKnown && goodParts > 0) {
    effectiveCycles = Math.max(cyclesCounted, Math.round(goodParts / (activeCavities as number)));
  } else {
    effectiveCycles = cyclesCounted;
  }

  const missing = Math.max(0, effectiveCycles - cyclesCounted);

  let delivery: DeliveryClass = "none";
  if (missing > 0) {
    if (acknowledged) delivery = "explained";
    else if (readerOutage) delivery = "explained";
    else if (liveRecent) delivery = "recoverable";
    else delivery = "unexplained";
  }

  return {
    countOk,
    countChecked,
    scrapTolerated: scrapParts > 0,
    effectiveCycles,
    missing,
    delivery,
  };
}

export type WorkOrderReconciliationRow = {
  machineId: string;
  workOrderId: string;
  machineName: string;
  sku: string | null;
  mold: string | null;
  status: string;
  isFinished: boolean;
  updatedAt: string;
  targetQty: number | null;
  activeCavities: number | null;
  /** Number of cycle rows that reached the cloud for this WO. */
  cyclesCounted: number;
  /** cycle_count column the WO carries (its own authoritative count). */
  reportedCycleCount: number;
  goodParts: number;
  scrapParts: number;
  partsMade: number;
  goodFromCycles: number;
  scrapFromCycles: number;
  /** Counter integrity: the machine's own counter is internally consistent. */
  countOk: boolean;
  countChecked: boolean;
  scrapTolerated: boolean;
  /** Cycle rows the machine ran but the cloud never received. */
  missing: number;
  delivery: DeliveryClass;
  /** Human label for the gap's cause (sensor-outage date, ack reason), when known. */
  deliveryLabel: string | null;
  /** True when stored WO counters diverge from the summed cycle rows (legacy R3 detail). */
  counterDrift: boolean;
};

const key = (machineId: string, workOrderId: string) => `${machineId}|${workOrderId}`;

/** A gap is "flagged" (worth a manager's attention) when the counter is wrong or the
 * gap is unexplained. Explained / recoverable / scrap-only rows are NOT flagged. */
export function isFlaggedRow(r: WorkOrderReconciliationRow): boolean {
  return !r.countOk || r.delivery === "unexplained";
}

export async function getWorkOrderReconciliation(
  orgId: string,
  { includeActive }: { includeActive: boolean },
): Promise<WorkOrderReconciliationRow[]> {
  // Finished WOs always; open/active ones only when asked (the tab wants them, the
  // health check does not).
  const statusWhere = includeActive
    ? {} // every status; we partition finished vs open per-row below
    : { status: { in: [...COMPLETED_WO_STATUSES] } };

  const [workOrders, cycleAgg, machines, gapAcks, readerOutages] = await Promise.all([
    prisma.machineWorkOrder.findMany({
      where: { orgId, ...statusWhere },
      select: {
        machineId: true,
        workOrderId: true,
        sku: true,
        mold: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        targetQty: true,
        cavitiesActive: true,
        cavitiesTotal: true,
        goodParts: true,
        scrapParts: true,
        cycleCount: true,
      },
    }),
    prisma.machineCycle.groupBy({
      by: ["machineId", "workOrderId"],
      where: { orgId },
      _sum: { goodDelta: true, scrapDelta: true },
      _count: { _all: true },
    }),
    prisma.machine.findMany({ where: { orgId }, select: { id: true, name: true } }),
    prisma.workOrderGapAcknowledgement.findMany({
      where: { orgId },
      select: { machineId: true, workOrderId: true, reason: true, acknowledgedAt: true },
    }),
    // Recorded sensor-outage heartbeats (reader offline = DATA_LOSS). Used to
    // auto-explain gaps that overlap a known outage, per machine.
    prisma.machineHeartbeat.findMany({
      where: { orgId, readerOnline: false },
      select: { machineId: true, ts: true },
      orderBy: { ts: "asc" },
    }),
  ]);

  const cycleMap = new Map<string, { good: number; scrap: number; rows: number }>();
  for (const row of cycleAgg) {
    if (!row.workOrderId) continue;
    cycleMap.set(key(row.machineId, row.workOrderId), {
      good: row._sum.goodDelta ?? 0,
      scrap: row._sum.scrapDelta ?? 0,
      rows: row._count._all,
    });
  }

  const machineNameById = new Map<string, string>();
  for (const m of machines) machineNameById.set(m.id, m.name ?? m.id);

  const ackMap = new Map<string, { reason: string; acknowledgedAt: Date }>();
  for (const a of gapAcks) {
    ackMap.set(key(a.machineId, a.workOrderId), { reason: a.reason, acknowledgedAt: a.acknowledgedAt });
  }

  // machineId → ascending outage timestamps (ms) for overlap checks.
  const outageMsByMachine = new Map<string, number[]>();
  for (const hb of readerOutages) {
    const arr = outageMsByMachine.get(hb.machineId) ?? [];
    arr.push(hb.ts.getTime());
    outageMsByMachine.set(hb.machineId, arr);
  }
  const outageOverlaps = (machineId: string, startMs: number, endMs: number): number | null => {
    const arr = outageMsByMachine.get(machineId);
    if (!arr || arr.length === 0) return null;
    // arr is ascending; first ts within [start, end].
    for (const ts of arr) {
      if (ts < startMs) continue;
      if (ts > endMs) break;
      return ts;
    }
    return null;
  };

  const now = Date.now();
  const rows: WorkOrderReconciliationRow[] = [];
  for (const wo of workOrders) {
    const finished = isCompletedWorkOrder(wo.status);
    // includeActive pulls every status; keep only finished + still-open (drop CANCELLED).
    if (!finished && !isOpenWorkOrder(wo.status)) continue;
    if (
      isTemporarilyBlockedWorkOrder({
        machineId: wo.machineId,
        workOrderId: wo.workOrderId,
        sku: wo.sku,
      })
    ) {
      continue;
    }

    const cyc = cycleMap.get(key(wo.machineId, wo.workOrderId)) ?? { good: 0, scrap: 0, rows: 0 };
    const goodParts = Math.max(0, Math.trunc(wo.goodParts));
    const scrapParts = Math.max(0, Math.trunc(wo.scrapParts));
    const partsMade = goodParts + scrapParts;
    const cyclesCounted = cyc.rows;
    const reportedCycleCount = Math.max(0, Math.trunc(wo.cycleCount));
    const activeCavities = wo.cavitiesActive ?? wo.cavitiesTotal ?? null;

    const k = key(wo.machineId, wo.workOrderId);
    const ack = ackMap.get(k) ?? null;
    const startMs = wo.createdAt.getTime();
    const endMs = wo.updatedAt.getTime();
    const outageTs = outageOverlaps(wo.machineId, startMs, endMs);
    const liveRecent = !finished && now - endMs < RECOVERABLE_WINDOW_MS;

    const audit = deriveWorkOrderAudit({
      activeCavities,
      reportedCycleCount,
      cyclesCounted,
      goodParts,
      scrapParts,
      acknowledged: ack != null,
      readerOutage: outageTs != null,
      liveRecent,
    });

    let deliveryLabel: string | null = null;
    if (audit.delivery === "explained") {
      if (ack) deliveryLabel = `ack:${ack.reason}`;
      else if (outageTs != null) deliveryLabel = `outage:${new Date(outageTs).toISOString()}`;
    }

    const counterDrift =
      goodParts !== cyc.good || scrapParts !== cyc.scrap || reportedCycleCount !== cyclesCounted;

    rows.push({
      machineId: wo.machineId,
      workOrderId: wo.workOrderId,
      machineName: machineNameById.get(wo.machineId) ?? wo.machineId,
      sku: wo.sku ?? null,
      mold: wo.mold ?? null,
      status: wo.status,
      isFinished: finished,
      updatedAt: wo.updatedAt.toISOString(),
      targetQty: wo.targetQty ?? null,
      activeCavities,
      cyclesCounted,
      reportedCycleCount,
      goodParts,
      scrapParts,
      partsMade,
      goodFromCycles: cyc.good,
      scrapFromCycles: cyc.scrap,
      countOk: audit.countOk,
      countChecked: audit.countChecked,
      scrapTolerated: audit.scrapTolerated,
      missing: audit.missing,
      delivery: audit.delivery,
      deliveryLabel,
      counterDrift,
    });
  }

  // Problems first: counter errors and unexplained gaps, then recoverable, then
  // explained, then clean. Active before finished within a rank, newest first.
  const rank = (r: WorkOrderReconciliationRow) => {
    if (!r.countOk) return 0;
    if (r.delivery === "unexplained") return 1;
    if (r.delivery === "recoverable") return 2;
    if (r.delivery === "explained") return 3;
    return 4;
  };
  rows.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.isFinished !== b.isFinished) return a.isFinished ? 1 : -1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return rows;
}
