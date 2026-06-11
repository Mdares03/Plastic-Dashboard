/**
 * Phase 2 cleanup — stale / runaway downtime episodes (R5).
 *
 * Two jobs, both dry-run by default (pass --apply to write):
 *
 *  1. CLAMP runaway episodes. lib/metrics/downtime.ts already caps any episode
 *     at MAX_OPEN_EPISODE_MS (12 h) at read time, so these never inflate a KPI.
 *     But the stored ReasonEntry.durationSeconds is still wrong, which is
 *     confusing in the DB and in any future export. We clamp the stored value
 *     to 12 h so the source agrees with the spec.
 *
 *  2. REPORT overlapping duplicates. The plan anticipated pre-incidentKey
 *     duplicate episodes (same machine, same reason, overlapping interval). In
 *     practice the @@unique([orgId, kind, episodeId]) constraint already blocks
 *     true duplicates, and a scan for *genuine* overlaps (both episodeEndTs
 *     known) finds zero. We therefore only REPORT overlap candidates and never
 *     delete — episodes whose start is derived backwards from capturedAt (1330
 *     rows have a null episodeEndTs) overlap artificially and must not be touched.
 *
 * Usage:
 *   node scripts/cleanup/01-stale-downtime-episodes.mjs            # dry-run
 *   node scripts/cleanup/01-stale-downtime-episodes.mjs --apply    # execute clamp
 *   node scripts/cleanup/01-stale-downtime-episodes.mjs --orgId <id>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// = MAX_OPEN_EPISODE_MS in lib/metrics/spec.ts (R5). Kept in sync by hand: a
// script may not import the TS module, but the comment is the contract.
const MAX_OPEN_EPISODE_SECONDS = 12 * 60 * 60; // 43200

const APPLY = process.argv.includes("--apply");
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return !v || v.startsWith("--") ? null : v;
}
const orgId = argValue("--orgId");

const iso = (d) => (d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : null);

async function main() {
  const baseWhere = { kind: "downtime", ...(orgId ? { orgId } : {}) };

  // --- Job 1: runaway episodes (> 12 h) ---
  const runaway = await prisma.reasonEntry.findMany({
    where: { ...baseWhere, durationSeconds: { gt: MAX_OPEN_EPISODE_SECONDS } },
    select: {
      id: true,
      machineId: true,
      reasonCode: true,
      durationSeconds: true,
      episodeEndTs: true,
      capturedAt: true,
    },
    orderBy: { durationSeconds: "desc" },
  });

  const clampCandidates = runaway.map((r) => ({
    id: r.id,
    machineId: r.machineId,
    reasonCode: r.reasonCode,
    currentHours: Math.round((r.durationSeconds / 3600) * 10) / 10,
    clampedHours: MAX_OPEN_EPISODE_SECONDS / 3600,
    episodeEndTs: iso(r.episodeEndTs),
    capturedAt: iso(r.capturedAt),
  }));

  // --- Job 2: genuine overlap candidates (both ends known) — report only ---
  const closed = await prisma.reasonEntry.findMany({
    where: { ...baseWhere, episodeEndTs: { not: null }, durationSeconds: { not: null } },
    select: { id: true, machineId: true, reasonCode: true, durationSeconds: true, episodeEndTs: true },
  });
  const intervals = closed.map((r) => {
    const end = r.episodeEndTs.getTime();
    const dur = Math.min(r.durationSeconds, MAX_OPEN_EPISODE_SECONDS) * 1000;
    return { id: r.id, machineId: r.machineId, reasonCode: r.reasonCode, start: end - dur, end };
  });
  const overlaps = [];
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i];
      const b = intervals[j];
      if (a.machineId !== b.machineId || a.reasonCode !== b.reasonCode) continue;
      if (a.start < b.end && b.start < a.end) {
        overlaps.push({ keep: a.id, candidate: b.id, machineId: a.machineId, reasonCode: a.reasonCode });
      }
    }
  }

  const report = {
    dry_run: !APPLY,
    org_scope: orgId ?? "all_orgs",
    clamp: {
      rule: "R5: store at most MAX_OPEN_EPISODE_MS (12 h) for any episode",
      candidates: clampCandidates.length,
      detail: clampCandidates,
    },
    overlapDuplicates: {
      rule: "report-only; genuine overlap requires both episodeEndTs known",
      candidates: overlaps.length,
      detail: overlaps,
      note:
        "0 expected: @@unique([orgId, kind, episodeId]) blocks true dupes and " +
        "null-episodeEndTs rows are excluded to avoid artificial overlaps.",
    },
  };

  if (APPLY && clampCandidates.length > 0) {
    const result = await prisma.reasonEntry.updateMany({
      where: { ...baseWhere, durationSeconds: { gt: MAX_OPEN_EPISODE_SECONDS } },
      data: { durationSeconds: MAX_OPEN_EPISODE_SECONDS },
    });
    report.clamp.applied = result.count;
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
