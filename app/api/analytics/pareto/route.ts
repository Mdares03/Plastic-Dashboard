import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { coerceDowntimeRange, rangeToStart } from "@/lib/analytics/downtimeRange";
import {
  applyDowntimeFilters,
  loadDowntimeShiftContext,
  normalizeMicrostopLtMin,
  normalizeShiftFilter,
  resolvePlannedFilter,
} from "@/lib/analytics/downtimeFilters";

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function GET(req: Request) {
  // ✅ Session auth (cookie)
  const session = await requireSession();
  if (!session) return bad(401, "Unauthorized");
  const orgId = session.orgId;

  const url = new URL(req.url);

  // ✅ Parse params INSIDE handler
  const range = coerceDowntimeRange(url.searchParams.get("range"));
  const start = rangeToStart(range);

  const machineId = url.searchParams.get("machineId"); // optional
  const kind = (url.searchParams.get("kind") || "downtime").toLowerCase();
  const includeMoldChange = url.searchParams.get("includeMoldChange") === "true";
  const planned = resolvePlannedFilter(url.searchParams.get("planned"), includeMoldChange);
  const shift = normalizeShiftFilter(url.searchParams.get("shift"));
  const microstopLtMin = normalizeMicrostopLtMin(url.searchParams.get("microstopLtMin"));

  if (kind !== "downtime" && kind !== "scrap" && kind !== "planned-downtime") {
    return bad(400, "Invalid kind (downtime|scrap|planned-downtime)");
  }

  // ✅ If machineId provided, verify it belongs to this org
  if (machineId) {
    const m = await prisma.machine.findFirst({
      where: { id: machineId, orgId },
      select: { id: true },
    });
    if (!m) return bad(404, "Machine not found");
  }

  let itemsRaw: { reasonCode: string; reasonLabel: string; value: number; count: number }[] = [];

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
        meta: true,
        episodeId: true,
      },
    });

    const effectivePlanned = kind === "planned-downtime" ? "planned" : planned;
    const shiftContext = shift === "all" ? null : await loadDowntimeShiftContext(orgId);
    const filteredRows = applyDowntimeFilters(baseRows, {
      planned: effectivePlanned,
      shift,
      microstopLtMin,
      shiftContext,
    });

    const grouped = new Map<string, { reasonCode: string; reasonLabel: string; durationSeconds: number; count: number }>();
    for (const row of filteredRows) {
      const key = `${row.reasonCode}:::${row.reasonLabel ?? row.reasonCode}`;
      const slot =
        grouped.get(key) ??
        {
          reasonCode: row.reasonCode,
          reasonLabel: row.reasonLabel ?? row.reasonCode,
          durationSeconds: 0,
          count: 0,
        };
      slot.durationSeconds += Math.max(0, row.durationSeconds ?? 0);
      slot.count += 1;
      grouped.set(key, slot);
    }

    itemsRaw = [...grouped.values()]
      .map((g) => ({
        reasonCode: g.reasonCode,
        reasonLabel: g.reasonLabel,
        value: Math.round((g.durationSeconds / 60) * 10) / 10,
        count: g.count,
      }))
      .filter((x) => x.value > 0 || x.count > 0);
  } else {
    // Scrap path unchanged.
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
    range,       // ✅ now defined correctly
    start,       // ✅ now defined correctly
    totalMinutesLost: kind === "downtime" || kind === "planned-downtime" ? total : undefined,
    totalScrap: kind === "scrap" ? total : undefined,
    rows,
    top3,
    threshold80,
    // (optional) keep old shape if anything else uses it:
    items: itemsRaw.map((x, i) => ({
      ...x,
      cumPct: rows[i]?.cumulativePct ?? 0,
    })),
    total,
  });
}
