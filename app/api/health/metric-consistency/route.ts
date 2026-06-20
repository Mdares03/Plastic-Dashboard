import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { computeDowntime, resolveWindow } from "@/lib/metrics";
import { isInPlannedShift } from "@/lib/metrics/shift";
import type { ReasonRow } from "@/lib/metrics/types";
import { computeRecap } from "@/lib/recap/getRecapData";
import { getLossesByReason } from "@/lib/reports/queries/losses";
import { loadShiftPlanningContext } from "@/lib/reports/queries/shiftPlanning";
import { getPlannedReasonCodes } from "@/lib/downtime/plannedCodes";
import type { MachineCostProfile } from "@/lib/reports/types";

/**
 * Admin-only cross-path metric congruence check — the live answer to the client's
 * "the numbers don't match across screens" complaint.
 *
 * Unlike /api/health/consistency (which checks DB-level integrity invariants — caps,
 * drift, stuck mold, clock sync), this re-runs the SAME 30 d window through the
 * distinct code paths that feed the distinct screens and asserts they agree:
 *
 *   - authority  computeDowntime over ReasonEntry (R5) — the single source of truth
 *   - recap      computeRecap (dashboard / machine detail / recap page), summed over machines
 *   - reports    getLossesByReason (weekly report / Pareto)
 *
 * The one *expected* difference is surfaced explicitly, not hidden: the reports family
 * filters downtime to PLANNED SHIFTS (isInPlannedShift), while recap/dashboard count the
 * whole window. When a plant runs work outside its configured shifts, that gap is the
 * usual cause of "the dashboard and the report disagree" — so we name it.
 *
 * status: "ok" (paths agree) | "warn" (a known, explainable gap) | "fail" (true drift).
 * Read-only.
 */

const ROUND_TOLERANCE_MIN = 0.5; // per-machine rounding slack accumulates across the sum

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

type CheckStatus = "ok" | "warn" | "fail";
type Check = {
  name: string;
  status: CheckStatus;
  detail: string;
  values?: Record<string, number>;
};

export async function GET() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId } = auth.session;

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { timezone: true },
  });
  const timezone = settings?.timezone || "UTC";
  const window = resolveWindow({ mode: "30d", timezone });

  const machines = await prisma.machine.findMany({
    where: { orgId },
    select: { id: true },
  });
  const machineIds = machines.map((m) => m.id);

  const checks: Check[] = [];

  if (machineIds.length === 0) {
    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      orgId,
      window: { start: window.start.toISOString(), end: window.end.toISOString(), label: window.label },
      checks: [{ name: "no_machines", status: "ok", detail: "Org has no machines to reconcile." }],
    });
  }

  // --- Authority (R5 + shift): computeDowntime over ReasonEntry, filtered to planned
  // shifts (the "shift-aware everywhere" rule). This is what every screen must equal. ---
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
  // Both are unfiltered, both clamp episodes the same way: they cannot legitimately differ.
  const recapDelta = round1(Math.abs(recapUnplannedMin - authority.unplannedMin));
  const recapTolerance = ROUND_TOLERANCE_MIN + machineIds.length * 0.02;
  checks.push({
    name: "recap_vs_authority",
    status: recapDelta <= recapTolerance ? "ok" : "fail",
    detail:
      recapDelta <= recapTolerance
        ? `Recap unplanned downtime matches the R5 authority (Δ ${recapDelta} min).`
        : `Recap unplanned downtime drifts from the R5 authority by ${recapDelta} min — a screen is computing downtime differently.`,
    values: {
      authorityUnplannedMin: authority.unplannedMin,
      recapUnplannedMin,
      deltaMin: recapDelta,
    },
  });

  // Check 2 — weekly-report losses must equal the authority. Both are shift-aware now,
  // so any gap is a true drift (a report counting different rows), not an explainable
  // shift difference.
  const reportsDelta = round1(Math.abs(reportsTotalMin - authority.totalMin));
  const reportsTolerance = ROUND_TOLERANCE_MIN + machineIds.length * 0.02;
  checks.push({
    name: "reports_vs_authority",
    status: reportsDelta <= reportsTolerance ? "ok" : "fail",
    detail:
      reportsDelta <= reportsTolerance
        ? `Weekly-report downtime matches the dashboard/authority (Δ ${reportsDelta} min).`
        : `Weekly-report downtime drifts from the authority by ${reportsDelta} min — the report is counting different rows than the dashboard.`,
    values: {
      authorityTotalMin: authority.totalMin,
      recapTotalMin,
      reportsTotalMin,
      deltaMin: reportsDelta,
    },
  });

  const hasFail = checks.some((c) => c.status === "fail");
  return NextResponse.json({
    ok: !hasFail,
    generatedAt: new Date().toISOString(),
    orgId,
    window: { start: window.start.toISOString(), end: window.end.toISOString(), label: window.label },
    checks,
  });
}
