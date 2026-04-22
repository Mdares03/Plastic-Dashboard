import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { coerceDowntimeRange, rangeToStart } from "@/lib/analytics/downtimeRange";

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

  if (kind !== "downtime" && kind !== "scrap") {
    return bad(400, "Invalid kind (downtime|scrap)");
  }

  // ✅ If machineId provided, verify it belongs to this org
  if (machineId) {
    const m = await prisma.machine.findFirst({
      where: { id: machineId, orgId },
      select: { id: true },
    });
    if (!m) return bad(404, "Machine not found");
  }

  // ✅ Scope by orgId (+ machineId if provided)
  const grouped = await prisma.reasonEntry.groupBy({
    by: ["reasonCode", "reasonLabel"],
    where: {
      orgId,
      ...(machineId ? { machineId } : {}),
      kind,
      capturedAt: { gte: start },
    },
    _sum: {
      durationSeconds: true,
      scrapQty: true,
    },
    _count: { _all: true },
  });

  const itemsRaw = grouped
    .map((g) => {
      const value =
        kind === "downtime"
          ? Math.round(((g._sum.durationSeconds ?? 0) / 60) * 10) / 10 // minutes, 1 decimal
          : g._sum.scrapQty ?? 0;

      return {
        reasonCode: g.reasonCode,
        reasonLabel: g.reasonLabel ?? g.reasonCode,
        value,
        count: g._count._all,
      };
    })
    .filter((x) => (kind === "downtime" ? x.value > 0 || x.count > 0 : x.value > 0));

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
      minutesLost: kind === "downtime" ? x.value : undefined,
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
    range,       // ✅ now defined correctly
    start,       // ✅ now defined correctly
    totalMinutesLost: kind === "downtime" ? total : undefined,
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
