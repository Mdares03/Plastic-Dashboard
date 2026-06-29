import { prisma } from "@/lib/prisma";
import { MAX_OPEN_EPISODE_MS, computeDowntime, resolveWindow } from "@/lib/metrics";
import { isInPlannedShift } from "@/lib/metrics/shift";
import type { ReasonRow } from "@/lib/metrics/types";
import { computeRecap } from "@/lib/recap/getRecapData";
import { computeFinancialImpact } from "@/lib/financial/impact";
import { getLossesByReason } from "@/lib/reports/queries/losses";
import { loadShiftPlanningContext } from "@/lib/reports/queries/shiftPlanning";
import { getPlannedReasonCodes } from "@/lib/downtime/plannedCodes";
import { getWorkOrderReconciliation } from "@/lib/workOrders/reconciliation";
import type { MachineCostProfile } from "@/lib/reports/types";

/**
 * Shared health-check computation, extracted from the /api/health/{consistency,
 * metric-consistency} routes so the same checks back (a) those admin endpoints,
 * (b) the cached /api/health/summary rollup that feeds the header "Verified"
 * badge, and (c) the client-facing /trust page — one source, no divergence.
 *
 * `detail` is the English fallback; `detailKey`/`detailVars` let the UI render a
 * localized sentence (EN/ES) without the server knowing the caller's locale.
 */
export type CheckStatus = "ok" | "warn" | "fail";

export type HealthCheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
  detailKey?: string;
  detailVars?: Record<string, string | number>;
  values?: Record<string, number>;
  /** Set when this failure has a safe, idempotent one-click fix the cloud can apply. */
  fix?: "stuck_mold" | "downtime_cap" | "cycle_backfill";
};

const MAX_OPEN_EPISODE_SECONDS = MAX_OPEN_EPISODE_MS / 1000;
const WINDOW_DAYS = 30;
/** A machine whose latest heartbeat (direct HTTP path) is within this is "online". */
const ONLINE_HEARTBEAT_MS = 15 * 60 * 1000;
/** A running, online machine whose KPI snapshots (outbox path) are older than this has
 *  a STALLED delivery pipeline — an enqueue freeze or drain wedge in progress. */
const DELIVERY_LAG_MS = 30 * 60 * 1000;
const MOLD_ACTIVE_STALE_MS = MAX_OPEN_EPISODE_MS;
const ROUND_TOLERANCE_MIN = 0.5; // per-machine rounding slack accumulates across the sum

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * DB-level integrity invariants (R3/R5/R8 + edge clock/reader). Read-only.
 */
export async function runConsistencyChecks(orgId: string): Promise<HealthCheckResult[]> {
  const checks: HealthCheckResult[] = [];

  // R5 — no over-cap episode (a runaway/never-resolved stop inflating downtime).
  const overCap = await prisma.reasonEntry.count({
    where: { orgId, kind: "downtime", durationSeconds: { gt: MAX_OPEN_EPISODE_SECONDS } },
  });
  checks.push({
    name: "downtime_cap",
    status: overCap === 0 ? "ok" : "fail",
    detail:
      overCap === 0
        ? "No stop has been left running long enough to inflate the totals."
        : `${overCap} stop(s) were left running so long they're inflating the totals.`,
    detailKey: overCap === 0 ? "health.detail.downtime_cap.ok" : "health.detail.downtime_cap.fail",
    detailVars: { count: overCap },
    ...(overCap === 0 ? {} : { fix: "downtime_cap" as const }),
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
    detailKey: "health.detail.downtime_capacity",
    detailVars: { downtime: Math.round(downtimeMin), capacity: capacityMin, machines: machineCount },
  });

  // Work-order reconciliation, split into two honest signals (shared with the Work
  // Orders tab via getWorkOrderReconciliation so the card counts and the tab rows agree):
  //   - counter_drift: the machine's OWN counter is internally wrong (cavities × its
  //     cycle_count ≠ good parts). A real mis-count — almost never happens.
  //   - cycle_delivery: cycle rows the machine ran never reached the cloud (lost in
  //     transit). The numbers shown aren't wrong, just incomplete. Only UNEXPLAINED
  //     gaps (no sensor outage, no acknowledgement) are flagged; the one-click
  //     cycle_backfill fix accepts the known pre-fix losses.
  const reconRows = await getWorkOrderReconciliation(orgId, { includeActive: true });
  const finishedRows = reconRows.filter((r) => r.isFinished);
  if (finishedRows.length === 0) {
    checks.push({
      name: "counter_drift",
      status: "warn",
      detail: "No finished jobs to check yet.",
      detailKey: "health.detail.counter_drift.none",
    });
  } else {
    const withError = finishedRows.filter((r) => !r.countOk).length;
    checks.push({
      name: "counter_drift",
      status: withError === 0 ? "ok" : "warn",
      detail:
        withError === 0
          ? `All ${finishedRows.length} finished job(s) counted parts consistently.`
          : `${withError} of ${finishedRows.length} finished job(s) recorded a part count its own cycle counter can't explain.`,
      detailKey: withError === 0 ? "health.detail.counter_drift.ok" : "health.detail.counter_drift.drift",
      detailVars: { withDrift: withError, total: finishedRows.length },
    });
  }

  const unexplainedGaps = reconRows.filter((r) => r.delivery === "unexplained").length;
  const totalMissing = reconRows.reduce((acc, r) => acc + (r.delivery === "unexplained" ? r.missing : 0), 0);
  checks.push({
    name: "cycle_delivery",
    status: unexplainedGaps === 0 ? "ok" : "fail",
    detail:
      unexplainedGaps === 0
        ? "Every recorded cycle reached the cloud (or the gaps are accounted for)."
        : `${unexplainedGaps} job(s) are missing ${totalMissing} cycle row(s) with no known cause.`,
    detailKey: unexplainedGaps === 0 ? "health.detail.cycle_delivery.ok" : "health.detail.cycle_delivery.fail",
    detailVars: { jobs: unexplainedGaps, missing: totalMissing },
    ...(unexplainedGaps === 0 ? {} : { fix: "cycle_backfill" as const }),
  });

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
      stuck === 0
        ? "No mold changes left open."
        : `${stuck} mold change(s) left open for over 12 h.`,
    detailKey: stuck === 0 ? "health.detail.stuck_mold.ok" : "health.detail.stuck_mold.fail",
    detailVars: { count: stuck },
    ...(stuck === 0 ? {} : { fix: "stuck_mold" as const }),
  });

  // P6.4 + edge split — clock sync. A machine reporting an unsynced clock mis-times
  // its events; surface it. Two clocks must both be good (plan §E): the Pi's own NTP
  // sync (clockSynced) AND the ESP32 reader offset (readerClockSynced). null (not
  // reported) = that edge piece not deployed yet.
  const edgeMachines = await prisma.machine.findMany({ where: { orgId }, select: { id: true } });
  const nowMs = Date.now();

  // One parallel pass over machines (was two sequential N+1 loops). Each machine's
  // independent reads run together; lastKpi is only fetched when the machine is
  // online+running (same short-circuit as before). Ordering by tsServer (cloud
  // receive time) is the intended honest signal — backed by an index on
  // (orgId, machineId, tsServer) so these are seeks, not per-machine scans.
  const perMachine = await Promise.all(
    edgeMachines.map(async (m) => {
      const [hbClock, hbReader, lastHb] = await Promise.all([
        prisma.machineHeartbeat.findFirst({
          where: { orgId, machineId: m.id, clockSynced: { not: null } },
          orderBy: { ts: "desc" },
          select: { clockSynced: true },
        }),
        // Latest heartbeat that reports the wireless reader link (edge split §D/§E).
        prisma.machineHeartbeat.findFirst({
          where: { orgId, machineId: m.id, readerOnline: { not: null } },
          orderBy: { ts: "desc" },
          select: { readerOnline: true, readerClockSynced: true },
        }),
        prisma.machineHeartbeat.findFirst({
          where: { orgId, machineId: m.id },
          orderBy: { tsServer: "desc" },
          select: { tsServer: true, status: true },
        }),
      ]);
      const online = lastHb ? nowMs - lastHb.tsServer.getTime() <= ONLINE_HEARTBEAT_MS : false;
      const running = lastHb ? String(lastHb.status ?? "").toUpperCase().startsWith("RUN") : false;
      let lastKpi: { tsServer: Date } | null = null;
      if (lastHb && online && running) {
        lastKpi = await prisma.machineKpiSnapshot.findFirst({
          where: { orgId, machineId: m.id },
          orderBy: { tsServer: "desc" },
          select: { tsServer: true },
        });
      }
      return { hbClock, hbReader, online, running, hasHb: !!lastHb, lastKpi };
    }),
  );

  let clockUnsynced = 0;
  let clockReported = 0;
  let readerReported = 0;
  let readerDown = 0;
  for (const r of perMachine) {
    if (r.hbClock) {
      clockReported += 1;
      if (r.hbClock.clockSynced === false) clockUnsynced += 1;
    }
    if (r.hbReader) {
      readerReported += 1;
      if (r.hbReader.readerOnline === false) readerDown += 1;
      if (r.hbReader.readerClockSynced === false) clockUnsynced += 1; // §E: reader clock counts too
    }
  }
  checks.push({
    name: "clock_sync",
    status: clockUnsynced > 0 ? "fail" : "ok",
    detail:
      clockReported === 0 && readerReported === 0
        ? "No machine is reporting its clock yet."
        : clockUnsynced > 0
          ? `${clockUnsynced} machine clock(s) are off — event times may be wrong.`
          : `All machine clocks are on time.`,
    detailKey:
      clockReported === 0 && readerReported === 0
        ? "health.detail.clock_sync.none"
        : clockUnsynced > 0
          ? "health.detail.clock_sync.unsynced"
          : "health.detail.clock_sync.ok",
    detailVars: { count: clockUnsynced },
  });

  // Edge split (§D) — reader link. readerOnline=false means the Pi is up but its
  // wireless ESP32 reader is dead: the machine is in DATA_LOSS, not trustworthy.
  checks.push({
    name: "reader_link",
    status: readerDown > 0 ? "fail" : "ok",
    detail:
      readerReported === 0
        ? "No machine is reporting a sensor yet."
        : readerDown > 0
          ? `${readerDown} machine(s) not recording data — sensor offline.`
          : `All ${readerReported} machine sensor(s) online.`,
    detailKey:
      readerReported === 0
        ? "health.detail.reader_link.none"
        : readerDown > 0
          ? "health.detail.reader_link.down"
          : "health.detail.reader_link.ok",
    detailVars: { down: readerDown, online: readerReported },
  });

  // Delivery pipeline (live freeze/wedge alarm). The heartbeat rides a direct HTTP
  // path; cycle/kpi/event rows ride the outbox. When the outbox enqueue freezes (the
  // 06-15→06-18 collation bug) or the publisher drain wedges, the cloud keeps getting
  // heartbeats but stops getting production data. So: a machine whose latest heartbeat
  // says it's RUNNING (edge alive + producing) but whose KPI snapshots stopped arriving
  // is a pipeline stall in progress — surface it in minutes, not days. Idle/offline
  // machines are excluded (no data is expected), so this can't false-alarm on downtime.
  let pipelineStalled = 0;
  let pipelineRunning = 0;
  for (const r of perMachine) {
    if (!r.hasHb || !r.online || !r.running) continue;
    pipelineRunning += 1;
    const kpiAgeMs = r.lastKpi ? nowMs - r.lastKpi.tsServer.getTime() : Number.POSITIVE_INFINITY;
    if (kpiAgeMs > DELIVERY_LAG_MS) pipelineStalled += 1;
  }
  checks.push({
    name: "delivery_pipeline",
    status: pipelineStalled > 0 ? "fail" : "ok",
    detail:
      pipelineRunning === 0
        ? "No machine is actively producing right now."
        : pipelineStalled > 0
          ? `${pipelineStalled} running machine(s) stopped sending production data — the edge is online but its data pipeline is stalled.`
          : `All ${pipelineRunning} running machine(s) are delivering production data.`,
    detailKey:
      pipelineRunning === 0
        ? "health.detail.delivery_pipeline.none"
        : pipelineStalled > 0
          ? "health.detail.delivery_pipeline.stalled"
          : "health.detail.delivery_pipeline.ok",
    detailVars: { stalled: pipelineStalled, running: pipelineRunning },
  });

  return checks;
}

export type MetricConsistencyResult = {
  checks: HealthCheckResult[];
  window: { start: string; end: string; label: string };
};

/**
 * Cross-path metric congruence: re-runs the SAME 30d window through the distinct
 * code paths feeding the distinct screens (authority/recap/reports/financial) and
 * asserts they agree. Read-only.
 */
export async function runMetricConsistencyChecks(orgId: string): Promise<MetricConsistencyResult> {
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { timezone: true },
  });
  const timezone = settings?.timezone || "UTC";
  const window = resolveWindow({ mode: "30d", timezone });
  const windowMeta = {
    start: window.start.toISOString(),
    end: window.end.toISOString(),
    label: window.label,
  };

  const machines = await prisma.machine.findMany({ where: { orgId }, select: { id: true } });
  const machineIds = machines.map((m) => m.id);

  if (machineIds.length === 0) {
    return {
      window: windowMeta,
      checks: [
        {
          name: "no_machines",
          status: "ok",
          detail: "No machines to check yet.",
          detailKey: "health.detail.no_machines",
        },
      ],
    };
  }

  const checks: HealthCheckResult[] = [];

  // --- Authority (R5 + shift): computeDowntime over ReasonEntry, planned-shift filtered. ---
  const [reasonRows, shiftCtx, plannedCodes] = await Promise.all([
    prisma.reasonEntry.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        kind: "downtime",
        capturedAt: { gte: window.start, lte: window.end },
      },
      select: {
        kind: true,
        reasonCode: true,
        reasonLabel: true,
        durationSeconds: true,
        capturedAt: true,
        episodeEndTs: true,
        scrapQty: true,
        workOrderId: true,
      },
    }),
    loadShiftPlanningContext(orgId),
    getPlannedReasonCodes(orgId),
  ]);
  const inShiftRows = (reasonRows as ReasonRow[]).filter((r) => isInPlannedShift(shiftCtx, r.capturedAt));
  const authority = computeDowntime(inShiftRows, window, plannedCodes);

  // --- Recap path: the dashboard / machine-detail / recap aggregation. ---
  const recap = await computeRecap({ orgId, start: window.start, end: window.end });
  const recapTotalMin = round1(recap.machines.reduce((acc, m) => acc + m.downtime.totalMin, 0));
  const recapUnplannedMin = round1(recap.machines.reduce((acc, m) => acc + m.downtime.unplannedMin, 0));

  // --- Reports path: weekly report / Pareto losses (shift-filtered). ---
  const losses = await getLossesByReason({
    orgId,
    from: window.start,
    to: window.end,
    machineIds,
    machineCostProfileById: new Map<string, MachineCostProfile>(),
  });
  const reportsTotalMin = round1(losses.downtimeByReason.reduce((acc, r) => acc + r.minutes, 0));

  // Check 1 — recap (every dashboard/detail screen) must equal the R5 authority.
  const recapDelta = round1(Math.abs(recapUnplannedMin - authority.unplannedMin));
  const recapTolerance = ROUND_TOLERANCE_MIN + machineIds.length * 0.02;
  checks.push({
    name: "recap_vs_authority",
    status: recapDelta <= recapTolerance ? "ok" : "fail",
    detail:
      recapDelta <= recapTolerance
        ? `Dashboard unplanned downtime matches the source (Δ ${recapDelta} min).`
        : `Dashboard unplanned downtime drifts from the source by ${recapDelta} min — a screen is computing downtime differently.`,
    detailKey: recapDelta <= recapTolerance ? "health.detail.recap.ok" : "health.detail.recap.fail",
    detailVars: { delta: recapDelta },
    values: { authorityUnplannedMin: authority.unplannedMin, recapUnplannedMin, deltaMin: recapDelta },
  });

  // Check 2 — weekly-report losses must equal the authority (both shift-aware).
  const reportsDelta = round1(Math.abs(reportsTotalMin - authority.totalMin));
  const reportsTolerance = ROUND_TOLERANCE_MIN + machineIds.length * 0.02;
  checks.push({
    name: "reports_vs_authority",
    status: reportsDelta <= reportsTolerance ? "ok" : "fail",
    detail:
      reportsDelta <= reportsTolerance
        ? `Weekly-report downtime matches the dashboard / source (Δ ${reportsDelta} min).`
        : `Weekly-report downtime drifts from the source by ${reportsDelta} min — the report is counting different rows than the dashboard.`,
    detailKey: reportsDelta <= reportsTolerance ? "health.detail.reports.ok" : "health.detail.reports.fail",
    detailVars: { delta: reportsDelta },
    values: { authorityTotalMin: authority.totalMin, recapTotalMin, reportsTotalMin, deltaMin: reportsDelta },
  });

  // Check 3 — the financial / ROI downtime number must equal the authority's UNPLANNED minutes.
  const financial = await computeFinancialImpact({
    orgId,
    start: window.start,
    end: window.end,
    includeEvents: true,
  });
  const downtimeDetails = financial.events.filter((e) => e.eventType === "downtime");
  const financialDowntimeMin = round1(
    downtimeDetails.reduce((acc, e) => acc + (e.durationSec ?? 0) / 60, 0)
  );
  const financialTolerance = ROUND_TOLERANCE_MIN + downtimeDetails.length * (0.5 / 60);
  const financialDelta = round1(Math.abs(financialDowntimeMin - authority.unplannedMin));
  const ratesUnset = financialDowntimeMin === 0 && authority.unplannedMin > financialTolerance;
  checks.push({
    name: "financial_vs_authority",
    status: ratesUnset ? "warn" : financialDelta <= financialTolerance ? "ok" : "fail",
    detail: ratesUnset
      ? "Cost rates aren't set (Settings → Financial), so the peso impact can't be shown yet. The dashboard downtime minutes are unaffected."
      : financialDelta <= financialTolerance
        ? `Financial / ROI downtime matches the dashboard source (Δ ${financialDelta} min).`
        : `Financial / ROI downtime drifts from the source by ${financialDelta} min — the money figure is using a different stoppage number than the dashboard.`,
    detailKey: ratesUnset
      ? "health.detail.financial.warn"
      : financialDelta <= financialTolerance
        ? "health.detail.financial.ok"
        : "health.detail.financial.fail",
    detailVars: { delta: financialDelta },
    values: { authorityUnplannedMin: authority.unplannedMin, financialDowntimeMin, deltaMin: financialDelta },
  });

  return { window: windowMeta, checks };
}

/** Worst status across a set of checks (fail > warn > ok). */
export function rollupStatus(checks: HealthCheckResult[]): CheckStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}
