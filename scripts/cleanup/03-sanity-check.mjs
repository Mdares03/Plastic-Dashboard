/**
 * Phase 2 sanity check (read-only).
 *
 * Cheap, always-true-if-healthy assertions over the downtime data. Run before
 * and after the cleanup scripts, and again whenever "the numbers look wrong":
 *
 *  A. No episode stored longer than the 12 h cap (R5)        -> after 01-* applies, 0
 *  B. 30 d total downtime < machines x window minutes        -> physically impossible to exceed
 *  C. No numeric-only reasonLabel (legacy backfill artifact) -> already 0 in this DB
 *  D. No stuck (active, unresolved, > 12 h) mold incidents   -> after 02-* applies, 0
 *
 * Exit code is non-zero if any assertion fails, so it can gate a runbook step.
 *
 * Usage: node scripts/cleanup/03-sanity-check.mjs [--orgId <id>]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MAX_OPEN_EPISODE_SECONDS = 12 * 60 * 60; // R5 cap (lib/metrics/spec.ts)
const MOLD_ACTIVE_STALE_MS = 12 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return !v || v.startsWith("--") ? null : v;
}
const orgId = argValue("--orgId");

async function main() {
  const baseWhere = { kind: "downtime", ...(orgId ? { orgId } : {}) };
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const checks = [];

  // A. no over-cap episodes
  const overCap = await prisma.reasonEntry.count({
    where: { ...baseWhere, durationSeconds: { gt: MAX_OPEN_EPISODE_SECONDS } },
  });
  checks.push({ id: "A_no_over_cap_episodes", pass: overCap === 0, value: overCap });

  // B. 30d downtime < machines x window minutes (loose physical upper bound)
  const machineCount = await prisma.machine.count({ where: orgId ? { orgId } : {} });
  const windowMinutes = WINDOW_DAYS * 24 * 60;
  const capacityMin = machineCount * windowMinutes;
  const recent = await prisma.reasonEntry.findMany({
    where: { ...baseWhere, capturedAt: { gte: windowStart } },
    select: { durationSeconds: true },
  });
  const downtimeMin =
    recent.reduce((acc, r) => acc + Math.min(r.durationSeconds ?? 0, MAX_OPEN_EPISODE_SECONDS), 0) / 60;
  checks.push({
    id: "B_downtime_within_capacity",
    pass: downtimeMin < capacityMin,
    value: { downtimeMin: Math.round(downtimeMin), capacityMin, machines: machineCount },
  });

  // C. no numeric-only reasonLabel
  // Prisma can't regex-match portably here, so pull distinct labels and test in JS.
  const labels = await prisma.reasonEntry.findMany({
    where: baseWhere,
    select: { reasonLabel: true },
    distinct: ["reasonLabel"],
  });
  const numeric = labels.filter((l) => l.reasonLabel && /^[0-9]+$/.test(l.reasonLabel.trim()));
  checks.push({
    id: "C_no_numeric_labels",
    pass: numeric.length === 0,
    value: numeric.map((l) => l.reasonLabel),
  });

  // D. no stuck mold incidents
  const moldEvents = await prisma.machineEvent.findMany({
    where: { eventType: "mold-change", ...(orgId ? { orgId } : {}) },
    select: { machineId: true, ts: true, data: true },
  });
  const byKey = new Map();
  const now = Date.now();
  for (const e of moldEvents) {
    const d = e.data ?? {};
    const ik = d.incidentKey ?? `${e.machineId}:${e.ts.getTime()}`;
    const entry = byKey.get(ik) ?? { active: false, resolved: false, startMs: null };
    if (d.status === "active") {
      entry.active = true;
      entry.startMs = Number(d.start_ms) || e.ts.getTime();
    }
    if (d.status === "resolved") entry.resolved = true;
    byKey.set(ik, entry);
  }
  const stuck = [...byKey.values()].filter(
    (v) => v.active && !v.resolved && now - v.startMs > MOLD_ACTIVE_STALE_MS,
  ).length;
  checks.push({ id: "D_no_stuck_mold_incidents", pass: stuck === 0, value: stuck });

  const allPass = checks.every((c) => c.pass);
  console.log(JSON.stringify({ org_scope: orgId ?? "all_orgs", allPass, checks }, null, 2));
  if (!allPass) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
