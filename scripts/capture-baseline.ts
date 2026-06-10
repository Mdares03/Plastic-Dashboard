/**
 * Read-only baseline capture (Phase 0 of docs/OVERHAUL_PLAN.md).
 *
 * Runs the CURRENT lib computation paths against the database DATABASE_URL
 * points at and snapshots what every major view would show, per org, for
 * yesterday / rolling 7d / rolling 30d. This is the "before" exhibit that
 * Phase 3 call-site migrations diff against.
 *
 * Usage (read-only; point at prod via the env file):
 *   npm run baseline:capture
 *   # = dotenv -e .env.backup_prod_pointing -- tsx scripts/capture-baseline.ts
 *
 * Output: docs/verification/baseline-<YYYY-MM-DD>.json
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { computeRecap } from "@/lib/recap/getRecapData";
import { getOverviewSummary } from "@/lib/overview/getOverviewSummary";
import { buildWeeklyReport } from "@/lib/reports/weeklyReport";
import { computeFinancialImpact } from "@/lib/financial/impact";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Midnight boundaries in the org's timezone, mirroring how "yesterday" is
// meant to read on a calendar (R6 lands the real resolver in lib/metrics).
function startOfDayInTz(now: Date, timeZone: string, daysBack: number) {
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const local = dayFmt.format(new Date(now.getTime() - daysBack * DAY_MS));
  const guess = new Date(`${local}T00:00:00.000Z`);
  // Probe candidate UTC instants until one reads as local midnight in tz.
  for (let offsetMin = -840; offsetMin <= 840; offsetMin += 15) {
    const candidate = new Date(guess.getTime() + offsetMin * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(candidate);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const hour = get("hour");
    if (
      `${get("year")}-${get("month")}-${get("day")}` === local &&
      (hour === "00" || hour === "24") &&
      get("minute") === "00"
    ) {
      return candidate;
    }
  }
  return guess; // fallback: UTC midnight
}

async function capture<T>(label: string, fn: () => Promise<T>) {
  try {
    return { label, ok: true as const, data: await fn() };
  } catch (err) {
    return { label, ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const now = new Date();
  const orgs = await prisma.org.findMany({
    select: { id: true, name: true, settings: { select: { timezone: true } } },
  });

  const result: Record<string, unknown>[] = [];

  for (const org of orgs) {
    const tz = org.settings?.timezone || "UTC";
    const machines = await prisma.machine.findMany({
      where: { orgId: org.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const yesterdayStart = startOfDayInTz(now, tz, 1);
    const todayStart = startOfDayInTz(now, tz, 0);
    const windows = [
      { key: "yesterday", from: yesterdayStart, to: new Date(todayStart.getTime() - 1) },
      { key: "rolling7d", from: new Date(now.getTime() - 7 * DAY_MS), to: now },
      { key: "rolling30d", from: new Date(now.getTime() - 30 * DAY_MS), to: now },
    ];

    const windowCaptures = [];
    for (const w of windows) {
      windowCaptures.push({
        window: w.key,
        from: w.from.toISOString(),
        to: w.to.toISOString(),
        captures: [
          await capture("recap", () =>
            computeRecap({ orgId: org.id, start: w.from, end: w.to })
          ),
          // buildWeeklyReport bundles every reports query (oee, trend,
          // production, losses, cycle perf, classification, downtime by
          // shift, scrap, WO status) with real cost profiles.
          await capture("reports", () =>
            buildWeeklyReport({ orgId: org.id, from: w.from, to: w.to })
          ),
          await capture("financial.impact", () =>
            computeFinancialImpact({ orgId: org.id, start: w.from, end: w.to, includeEvents: false })
          ),
        ],
      });
    }

    result.push({
      orgId: org.id,
      orgName: org.name,
      timezone: tz,
      machines,
      live: [await capture("overview.summary", () => getOverviewSummary({ orgId: org.id }))],
      windows: windowCaptures,
    });
  }

  let gitCommit = "unknown";
  try {
    gitCommit = execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    /* not in a git checkout */
  }

  const dbHost = (process.env.DATABASE_URL ?? "").replace(/\/\/[^@]*@/, "//***@");
  const out = {
    capturedAt: now.toISOString(),
    gitCommit,
    database: dbHost,
    note: "Baseline of CURRENT (pre-overhaul) computation paths. Read-only capture.",
    orgs: result,
  };

  mkdirSync("docs/verification", { recursive: true });
  const file = `docs/verification/baseline-${isoDate(now)}.json`;
  writeFileSync(file, JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v), 2));
  console.log(`Baseline written to ${file}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
