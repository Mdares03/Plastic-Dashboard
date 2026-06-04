import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function parseCutoff(raw) {
  if (!raw) return null;
  // Treat YYYY-MM-DD as UTC midnight to avoid local timezone ambiguity.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00.000Z`);
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toIso(value) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

const cutoffArg = argValue("--cutoff") ?? "2026-05-06";
const cutoff = parseCutoff(cutoffArg);
const orgId = argValue("--orgId");

if (!cutoff) {
  console.error(
    "Invalid --cutoff value. Use YYYY-MM-DD or ISO date, e.g. --cutoff 2026-05-06"
  );
  process.exit(1);
}

const specs = [
  { model: "machineEvent", field: "ts", label: "MachineEvent.ts" },
  { model: "machineCycle", field: "ts", label: "MachineCycle.ts" },
  { model: "machineKpiSnapshot", field: "ts", label: "MachineKpiSnapshot.ts" },
  { model: "machineHeartbeat", field: "ts", label: "MachineHeartbeat.ts" },
  { model: "machineHeartbeat", field: "tsServer", label: "MachineHeartbeat.tsServer" },
  { model: "reasonEntry", field: "capturedAt", label: "ReasonEntry.capturedAt" },
  { model: "ingestLog", field: "tsServer", label: "IngestLog.tsServer" },
  { model: "alertNotification", field: "sentAt", label: "AlertNotification.sentAt" },
  { model: "downtimeAction", field: "createdAt", label: "DowntimeAction.createdAt" },
  { model: "downtimeAction", field: "updatedAt", label: "DowntimeAction.updatedAt" },
  { model: "machineWorkOrder", field: "createdAt", label: "MachineWorkOrder.createdAt" },
  { model: "machineWorkOrder", field: "updatedAt", label: "MachineWorkOrder.updatedAt" },
];

function withOrg(where, modelName) {
  if (!orgId) return where;
  if (modelName === "ingestLog") {
    return { ...where, orgId };
  }
  return { ...where, orgId };
}

async function collectMetrics() {
  const metrics = [];

  for (const spec of specs) {
    const model = prisma[spec.model];
    const whereOld = withOrg({ [spec.field]: { lt: cutoff } }, spec.model);
    const whereAll = withOrg({}, spec.model);

    const total = await model.count({ where: whereAll });
    const old = await model.count({ where: whereOld });

    const agg =
      old > 0
        ? await model.aggregate({
            where: whereOld,
            _min: { [spec.field]: true },
            _max: { [spec.field]: true },
          })
        : { _min: { [spec.field]: null }, _max: { [spec.field]: null } };

    metrics.push({
      metric: spec.label,
      total_rows: total,
      rows_before_cutoff: old,
      pct_before_cutoff: total ? Number(((old / total) * 100).toFixed(2)) : 0,
      oldest_before_cutoff: toIso(agg._min[spec.field]),
      newest_before_cutoff: toIso(agg._max[spec.field]),
    });
  }

  metrics.sort((a, b) => b.rows_before_cutoff - a.rows_before_cutoff);
  return metrics;
}

async function collectBoundarySamples() {
  const whereBefore = withOrg({ ts: { lt: cutoff } }, "machineEvent");
  const whereAfter = withOrg({ ts: { gte: cutoff } }, "machineEvent");

  const [latestBefore, earliestAfter] = await Promise.all([
    prisma.machineEvent.findMany({
      where: whereBefore,
      orderBy: { ts: "desc" },
      take: 5,
      select: { id: true, orgId: true, machineId: true, ts: true, eventType: true },
    }),
    prisma.machineEvent.findMany({
      where: whereAfter,
      orderBy: { ts: "asc" },
      take: 5,
      select: { id: true, orgId: true, machineId: true, ts: true, eventType: true },
    }),
  ]);

  return {
    latest_before_cutoff: latestBefore.map((r) => ({ ...r, ts: toIso(r.ts) })),
    earliest_on_or_after_cutoff: earliestAfter.map((r) => ({ ...r, ts: toIso(r.ts) })),
  };
}

async function main() {
  const [metrics, boundarySamples] = await Promise.all([
    collectMetrics(),
    collectBoundarySamples(),
  ]);

  console.log(
    JSON.stringify(
      {
        dry_run: true,
        cutoff_utc: cutoff.toISOString(),
        org_scope: orgId ?? "all_orgs",
        metrics,
        boundarySamples,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
