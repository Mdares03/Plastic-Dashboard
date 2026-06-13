import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { MAX_OPEN_EPISODE_MS } from "@/lib/metrics";
import { COMPLETED_WO_STATUSES } from "@/lib/workOrders/status";

/**
 * Admin-only live consistency health check — the always-on congruence guarantee.
 *
 * Re-runs, for the caller's org, the same invariants the Phase-2 cleanup sanity
 * script and the R3 drift check assert, so "do the numbers hold together?" is
 * answerable on demand instead of by comparing two screens:
 *   - downtime_cap       (R5) no stored episode exceeds the 12 h cap
 *   - downtime_capacity  (R5) 30 d downtime < machines × window minutes
 *   - counter_drift      (R3) completed-WO counters == cycle-delta sums
 *   - stuck_mold         (R8) no active, unresolved mold incident older than 12 h
 *
 * status: "ok" (green) | "warn" (amber, attention but not broken) | "fail" (red).
 * Read-only.
 */

const MAX_OPEN_EPISODE_SECONDS = MAX_OPEN_EPISODE_MS / 1000;
const WINDOW_DAYS = 30;
const MOLD_ACTIVE_STALE_MS = MAX_OPEN_EPISODE_MS;

type CheckStatus = "ok" | "warn" | "fail";
type Check = { name: string; status: CheckStatus; detail: string };

const key = (machineId: string, workOrderId: string) => `${machineId}|${workOrderId}`;

export async function GET() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId } = auth.session;

  const checks: Check[] = [];

  // R5 — no over-cap episode (a runaway/never-resolved stop inflating downtime).
  const overCap = await prisma.reasonEntry.count({
    where: { orgId, kind: "downtime", durationSeconds: { gt: MAX_OPEN_EPISODE_SECONDS } },
  });
  checks.push({
    name: "downtime_cap",
    status: overCap === 0 ? "ok" : "fail",
    detail:
      overCap === 0
        ? "No downtime episode exceeds the 12h cap."
        : `${overCap} downtime episode(s) stored longer than 12h — would inflate downtime/cost.`,
  });

  // R5 — 30d downtime within the loose physical capacity bound.
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const machineCount = await prisma.machine.count({ where: { orgId } });
  const recent = await prisma.reasonEntry.findMany({
    where: { orgId, kind: "downtime", capturedAt: { gte: windowStart } },
    select: { durationSeconds: true },
  });
  const downtimeMin =
    recent.reduce((acc, r) => acc + Math.min(r.durationSeconds ?? 0, MAX_OPEN_EPISODE_SECONDS), 0) / 60;
  const capacityMin = machineCount * WINDOW_DAYS * 24 * 60;
  checks.push({
    name: "downtime_capacity",
    status: downtimeMin < capacityMin ? "ok" : "fail",
    detail: `30d downtime ${Math.round(downtimeMin)} min vs capacity ${capacityMin} min (${machineCount} machine(s)).`,
  });

  // R3 — completed-WO counters reconcile with cycle-delta sums. DB uniqueness on
  // MachineCycle makes the groupBy sums already deduped (= checkCounterDrift).
  const completedWos = await prisma.machineWorkOrder.findMany({
    where: { orgId, status: { in: [...COMPLETED_WO_STATUSES] } },
    select: { machineId: true, workOrderId: true, goodParts: true, scrapParts: true, cycleCount: true },
  });
  if (completedWos.length === 0) {
    checks.push({
      name: "counter_drift",
      status: "warn",
      detail:
        "No completed work orders to reconcile. The edge completes WOs locally but does not yet propagate terminal status to the dashboard — tracked for the edge-reliability phase (P6.6).",
    });
  } else {
    const cycleAgg = await prisma.machineCycle.groupBy({
      by: ["machineId", "workOrderId"],
      where: { orgId },
      _sum: { goodDelta: true, scrapDelta: true },
      _count: { _all: true },
    });
    const cycleMap = new Map<string, { good: number; scrap: number; rows: number }>();
    for (const row of cycleAgg) {
      if (!row.workOrderId) continue;
      cycleMap.set(key(row.machineId, row.workOrderId), {
        good: row._sum.goodDelta ?? 0,
        scrap: row._sum.scrapDelta ?? 0,
        rows: row._count._all,
      });
    }
    let withDrift = 0;
    for (const wo of completedWos) {
      const cyc = cycleMap.get(key(wo.machineId, wo.workOrderId)) ?? { good: 0, scrap: 0, rows: 0 };
      const hasDrift =
        Math.max(0, Math.trunc(wo.goodParts)) !== cyc.good ||
        Math.max(0, Math.trunc(wo.scrapParts)) !== cyc.scrap ||
        Math.max(0, Math.trunc(wo.cycleCount)) !== cyc.rows;
      if (hasDrift) withDrift += 1;
    }
    checks.push({
      name: "counter_drift",
      status: withDrift === 0 ? "ok" : "warn",
      detail:
        withDrift === 0
          ? `All ${completedWos.length} completed WO counter(s) reconcile with cycle sums.`
          : `${withDrift} of ${completedWos.length} completed WO(s) drift from cycle-delta sums.`,
    });
  }

  // R8 — no stuck (active, unresolved, >12h) mold incident.
  const moldEvents = await prisma.machineEvent.findMany({
    where: { orgId, eventType: "mold-change" },
    select: { machineId: true, ts: true, data: true },
  });
  const byIncident = new Map<string, { active: boolean; resolved: boolean; startMs: number }>();
  const now = Date.now();
  for (const e of moldEvents) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    const ik = (d.incidentKey as string) ?? `${e.machineId}:${e.ts.getTime()}`;
    const entry = byIncident.get(ik) ?? { active: false, resolved: false, startMs: e.ts.getTime() };
    if (d.status === "active") {
      entry.active = true;
      entry.startMs = Number(d.start_ms) || e.ts.getTime();
    }
    if (d.status === "resolved") entry.resolved = true;
    byIncident.set(ik, entry);
  }
  const stuck = [...byIncident.values()].filter(
    (v) => v.active && !v.resolved && now - v.startMs > MOLD_ACTIVE_STALE_MS,
  ).length;
  checks.push({
    name: "stuck_mold",
    status: stuck === 0 ? "ok" : "fail",
    detail:
      stuck === 0 ? "No stuck mold-change incidents." : `${stuck} mold incident(s) active and unresolved >12h.`,
  });

  // P6.4 + edge split — clock sync. A machine reporting an unsynced clock mis-times
  // its events; surface it. Two clocks must both be good (plan §E): the Pi's own NTP
  // sync (clockSynced) AND the ESP32 reader offset (readerClockSynced). null (not
  // reported) = that edge piece not deployed yet.
  const edgeMachines = await prisma.machine.findMany({ where: { orgId }, select: { id: true } });
  let clockUnsynced = 0;
  let clockReported = 0;
  let readerReported = 0;
  let readerDown = 0;
  for (const m of edgeMachines) {
    const hbClock = await prisma.machineHeartbeat.findFirst({
      where: { orgId, machineId: m.id, clockSynced: { not: null } },
      orderBy: { ts: "desc" },
      select: { clockSynced: true },
    });
    if (hbClock) {
      clockReported += 1;
      if (hbClock.clockSynced === false) clockUnsynced += 1;
    }
    // Latest heartbeat that reports the wireless reader link (edge split §D/§E).
    const hbReader = await prisma.machineHeartbeat.findFirst({
      where: { orgId, machineId: m.id, readerOnline: { not: null } },
      orderBy: { ts: "desc" },
      select: { readerOnline: true, readerClockSynced: true },
    });
    if (hbReader) {
      readerReported += 1;
      if (hbReader.readerOnline === false) readerDown += 1;
      if (hbReader.readerClockSynced === false) clockUnsynced += 1; // §E: reader clock counts too
    }
  }
  checks.push({
    name: "clock_sync",
    status: clockUnsynced > 0 ? "fail" : "ok",
    detail:
      clockReported === 0 && readerReported === 0
        ? "No machine reports clock-sync yet (edge clock-sync not deployed)."
        : clockUnsynced > 0
          ? `${clockUnsynced} clock(s) (Pi or ESP32 reader) are unsynced — event timestamps may be wrong.`
          : `All reporting Pi/reader clocks are synced.`,
  });

  // Edge split (§D) — reader link. readerOnline=false means the Pi is up but its
  // wireless ESP32 reader is dead: the machine is in DATA_LOSS, not trustworthy.
  checks.push({
    name: "reader_link",
    status: readerDown > 0 ? "fail" : "ok",
    detail:
      readerReported === 0
        ? "No machine reports a wireless reader link (edge split not deployed)."
        : readerDown > 0
          ? `${readerDown} machine(s) in DATA_LOSS — wireless ESP32 reader unreachable.`
          : `All ${readerReported} reader link(s) online.`,
  });

  const hasFail = checks.some((c) => c.status === "fail");
  return NextResponse.json({
    ok: !hasFail,
    generatedAt: new Date().toISOString(),
    orgId,
    checks,
  });
}
