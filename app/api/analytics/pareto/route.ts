import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { episodeWindowMinutes } from "@/lib/metrics";
import { coerceDowntimeRange, rangeToStart } from "@/lib/analytics/downtimeRange";
import {
  applyDowntimeFilters,
  isUnclassifiedReasonCode,
  loadDowntimeShiftContext,
  normalizeMicrostopLtMin,
  normalizeShiftFilter,
  parseBooleanParam,
  resolvePlannedFilter,
} from "@/lib/analytics/downtimeFilters";

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

async function buildReasonLabelMap(orgId: string, reasonCodes: string[]) {
  const codes = [...new Set(reasonCodes.map((code) => String(code ?? "").trim().toUpperCase()).filter(Boolean))];
  if (!codes.length) return new Map<string, string>();
  const rows = await prisma.reasonCatalogItem.findMany({
    where: { orgId, reasonCode: { in: codes } },
    select: { reasonCode: true, name: true, category: { select: { name: true } } },
  });

  const out = new Map<string, string>();
  for (const row of rows) {
    const code = String(row.reasonCode ?? "").trim().toUpperCase();
    const category = String(row.category?.name ?? "").trim();
    const detail = String(row.name ?? "").trim();
    if (!code || !detail) continue;
    out.set(code, category ? `${category} > ${detail}` : detail);
  }
  return out;
}

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return bad(401, "Unauthorized");
  const orgId = session.orgId;

  const url = new URL(req.url);

  const range = coerceDowntimeRange(url.searchParams.get("range"));
  const start = rangeToStart(range);
  const windowEnd = new Date(); // rolling window ends now (R5 clamp upper bound)

  const machineId = url.searchParams.get("machineId");
  const kind = (url.searchParams.get("kind") || "downtime").toLowerCase();
  const includeMoldChange = url.searchParams.get("includeMoldChange") === "true";
  const planned = resolvePlannedFilter(url.searchParams.get("planned"), includeMoldChange);
  const shift = normalizeShiftFilter(url.searchParams.get("shift"));
  const microstopLtMin = normalizeMicrostopLtMin(url.searchParams.get("microstopLtMin"));
  const excludeUnclassified = parseBooleanParam(url.searchParams.get("excludeUnclassified"));

  if (kind !== "downtime" && kind !== "scrap" && kind !== "planned-downtime") {
    return bad(400, "Invalid kind (downtime|scrap|planned-downtime)");
  }

  if (machineId) {
    const m = await prisma.machine.findFirst({
      where: { id: machineId, orgId },
      select: { id: true },
    });
    if (!m) return bad(404, "Machine not found");
  }

  let itemsRaw: { reasonCode: string; reasonLabel: string; value: number; count: number }[] = [];
  let totalMinutesAll: number | undefined;
  let totalMinutesClassified: number | undefined;
  let excludedUnclassifiedMinutes: number | undefined;
  let excludedUnclassifiedPct: number | undefined;

  if (kind === "downtime" || kind === "planned-downtime") {
    const baseRows = await prisma.reasonEntry.findMany({
      where: {
        orgId,
        ...(machineId ? { machineId } : {}),
        kind: "downtime",
        capturedAt: { gte: start },
      },
      select: {
        reasonCode: true,
        reasonLabel: true,
        durationSeconds: true,
        capturedAt: true,
        episodeEndTs: true,
        meta: true,
        episodeId: true,
      },
    });

    const effectivePlanned = kind === "planned-downtime" ? "planned" : planned;
    const shiftContext = shift === "all" ? null : await loadDowntimeShiftContext(orgId);
    const filteredRowsAll = applyDowntimeFilters(baseRows, {
      planned: effectivePlanned,
      shift,
      microstopLtMin,
      shiftContext,
    });

    const filteredRowsClassified = filteredRowsAll.filter(
      (row) => !isUnclassifiedReasonCode(row.reasonCode)
    );

    const filteredRowsForOutput = excludeUnclassified
      ? filteredRowsClassified
      : filteredRowsAll;

    // R5: each episode contributes its window-overlap minutes, capped at 12h —
    // same authority as recap/reports/losses, so the pareto total can't drift
    // above the dashboard's downtime number.
    const minutesAll = filteredRowsAll.reduce(
      (acc, row) => acc + episodeWindowMinutes(row, start, windowEnd),
      0
    );
    const minutesClassified = filteredRowsClassified.reduce(
      (acc, row) => acc + episodeWindowMinutes(row, start, windowEnd),
      0
    );

    totalMinutesAll = Math.round(minutesAll * 10) / 10;
    totalMinutesClassified = Math.round(minutesClassified * 10) / 10;
    excludedUnclassifiedMinutes = Math.max(
      0,
      Math.round((totalMinutesAll - totalMinutesClassified) * 10) / 10
    );
    excludedUnclassifiedPct =
      totalMinutesAll > 0
        ? Math.round((excludedUnclassifiedMinutes / totalMinutesAll) * 10000) / 100
        : 0;

    const reasonLabelMap = await buildReasonLabelMap(
      orgId,
      filteredRowsForOutput.map((row) => row.reasonCode)
    );

    const grouped = new Map<string, { reasonCode: string; reasonLabel: string; minutes: number; count: number }>();
    for (const row of filteredRowsForOutput) {
      const code = String(row.reasonCode ?? "").trim().toUpperCase();
      if (!code) continue;
      const resolvedLabel = reasonLabelMap.get(code) ?? row.reasonLabel ?? code;
      const slot =
        grouped.get(code) ??
        {
          reasonCode: code,
          reasonLabel: resolvedLabel,
          minutes: 0,
          count: 0,
        };
      slot.minutes += episodeWindowMinutes(row, start, windowEnd);
      slot.count += 1;
      grouped.set(code, slot);
    }

    itemsRaw = [...grouped.values()]
      .map((g) => ({
        reasonCode: g.reasonCode,
        reasonLabel: g.reasonLabel,
        value: Math.round(g.minutes * 10) / 10,
        count: g.count,
      }))
      .filter((x) => x.value > 0 || x.count > 0);
  } else {
    const grouped = await prisma.reasonEntry.groupBy({
      by: ["reasonCode", "reasonLabel"],
      where: {
        orgId,
        ...(machineId ? { machineId } : {}),
        kind,
        capturedAt: { gte: start },
      },
      _sum: { scrapQty: true },
      _count: { _all: true },
    });

    itemsRaw = grouped
      .map((g) => ({
        reasonCode: g.reasonCode,
        reasonLabel: g.reasonLabel ?? g.reasonCode,
        value: g._sum.scrapQty ?? 0,
        count: g._count._all,
      }))
      .filter((x) => x.value > 0);
  }

  itemsRaw.sort((a, b) => b.value - a.value);

  const total = itemsRaw.reduce((acc, x) => acc + x.value, 0);

  let cum = 0;
  let threshold80Index: number | null = null;

  const rows = itemsRaw.map((x, idx) => {
    const pctOfTotal = total > 0 ? (x.value / total) * 100 : 0;
    cum += x.value;
    const cumulativePct = total > 0 ? (cum / total) * 100 : 0;

    if (threshold80Index === null && cumulativePct >= 80) threshold80Index = idx;

    return {
      reasonCode: x.reasonCode,
      reasonLabel: x.reasonLabel,
      minutesLost: kind === "downtime" || kind === "planned-downtime" ? x.value : undefined,
      scrapQty: kind === "scrap" ? x.value : undefined,
      pctOfTotal,
      cumulativePct,
      count: x.count,
    };
  });

  const top3 = rows.slice(0, 3);
  const threshold80 =
    threshold80Index === null
      ? null
      : {
          index: threshold80Index,
          reasonCode: rows[threshold80Index].reasonCode,
          reasonLabel: rows[threshold80Index].reasonLabel,
        };

  return NextResponse.json({
    ok: true,
    orgId,
    machineId: machineId ?? null,
    kind,
    planned: kind === "downtime" ? planned : kind === "planned-downtime" ? "planned" : "all",
    shift,
    microstopLtMin,
    includeMoldChange,
    excludeUnclassified,
    range,
    start,
    totalMinutesLost: kind === "downtime" || kind === "planned-downtime" ? total : undefined,
    totalMinutesAll,
    totalMinutesClassified,
    excludedUnclassifiedMinutes,
    excludedUnclassifiedPct,
    totalScrap: kind === "scrap" ? total : undefined,
    rows,
    top3,
    threshold80,
    items: itemsRaw.map((x, i) => ({
      ...x,
      cumPct: rows[i]?.cumulativePct ?? 0,
    })),
    total,
  });
}
