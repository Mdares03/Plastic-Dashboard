/**
 * Phase 2 cleanup — stuck mold-change incidents (R5 / R8).
 *
 * A mold change is recorded as a pair of MachineEvent rows sharing an
 * `incidentKey`: one `{status:"active", start_ms}` and, when the operator
 * finishes, one `{status:"resolved", end_ms}`. A "stuck" incident is an active
 * event whose incidentKey never received a resolved sibling. Historically these
 * pinned the machine into a perpetual "mold-change" live state.
 *
 * lib/metrics/machineState.ts (R8) already ignores active episodes older than
 * MOLD_ACTIVE_STALE_MS (12 h), so the LIVE display has self-healed. This script
 * repairs the stored data so the historical record is consistent: for every
 * stuck incident older than the stale window it synthesizes the missing
 * `resolved` event, end_ms = min(start_ms + 12 h, first production cycle after
 * start). Synthetic rows are tagged `{synthetic:true, resolvedBy:"phase2-cleanup"}`.
 *
 * Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   node scripts/cleanup/02-stuck-mold-events.mjs            # dry-run
 *   node scripts/cleanup/02-stuck-mold-events.mjs --apply
 *   node scripts/cleanup/02-stuck-mold-events.mjs --orgId <id>
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MOLD_ACTIVE_STALE_MS = 12 * 60 * 60 * 1000; // = MOLD_ACTIVE_STALE_MS, lib/metrics/spec.ts

const APPLY = process.argv.includes("--apply");
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return !v || v.startsWith("--") ? null : v;
}
const orgId = argValue("--orgId");

async function main() {
  const now = Date.now();
  const events = await prisma.machineEvent.findMany({
    where: { eventType: "mold-change", ...(orgId ? { orgId } : {}) },
    select: {
      id: true,
      orgId: true,
      machineId: true,
      ts: true,
      topic: true,
      severity: true,
      requiresAck: true,
      title: true,
      description: true,
      workOrderId: true,
      sku: true,
      schemaVersion: true,
      data: true,
    },
    orderBy: { ts: "asc" },
  });

  // Group by incidentKey; keep the active row (the one we mirror) and a flag for resolved.
  const byKey = new Map();
  for (const e of events) {
    const data = e.data ?? {};
    const ik = data.incidentKey ?? `${e.machineId}:${e.ts.getTime()}`;
    const entry = byKey.get(ik) ?? { active: null, hasResolved: false, startMs: null };
    if (data.status === "resolved") entry.hasResolved = true;
    if (data.status === "active") {
      entry.active = e;
      entry.startMs = Number(data.start_ms) || e.ts.getTime();
    }
    byKey.set(ik, entry);
  }

  const stuck = [...byKey.entries()].filter(
    ([, v]) => v.active && !v.hasResolved && now - v.startMs > MOLD_ACTIVE_STALE_MS,
  );

  const repairs = [];
  for (const [ik, v] of stuck) {
    const startMs = v.startMs;
    // First production cycle strictly after start, else fall back to the 12 h cap.
    const nextCycle = await prisma.machineCycle.findFirst({
      where: { machineId: v.active.machineId, ts: { gt: new Date(startMs) } },
      select: { ts: true },
      orderBy: { ts: "asc" },
    });
    const cappedEnd = startMs + MOLD_ACTIVE_STALE_MS;
    const cycleMs = nextCycle ? nextCycle.ts.getTime() : null;
    const useCycle = cycleMs != null && cycleMs <= cappedEnd;
    const endMs = useCycle ? cycleMs : cappedEnd;
    repairs.push({
      incidentKey: ik,
      machineId: v.active.machineId,
      startedAt: new Date(startMs).toISOString(),
      resolvedAt: new Date(endMs).toISOString(),
      endSource: useCycle ? "first-cycle-after-start" : "12h-cap",
      _src: v.active,
      _endMs: endMs,
      _startMs: startMs,
    });
  }

  const report = {
    dry_run: !APPLY,
    org_scope: orgId ?? "all_orgs",
    rule: "R5/R8: every mold-change active event must have a resolved sibling; cap at 12 h",
    stuckIncidents: repairs.length,
    detail: repairs.map(({ _src, _endMs, _startMs, ...r }) => r),
  };

  if (APPLY && repairs.length > 0) {
    const rows = repairs.map((r) => ({
      id: randomUUID(),
      orgId: r._src.orgId,
      machineId: r._src.machineId,
      ts: new Date(r._endMs),
      topic: r._src.topic,
      eventType: "mold-change",
      severity: r._src.severity,
      requiresAck: false,
      title: r._src.title,
      description: r._src.description,
      workOrderId: r._src.workOrderId,
      sku: r._src.sku,
      schemaVersion: r._src.schemaVersion,
      seq: null, // synthetic: not part of the edge seq sequence
      data: {
        status: "resolved",
        start_ms: r._startMs,
        end_ms: r._endMs,
        incidentKey: r.incidentKey,
        synthetic: true,
        resolvedBy: "phase2-cleanup",
      },
    }));
    const result = await prisma.machineEvent.createMany({ data: rows });
    report.applied = result.count;
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
