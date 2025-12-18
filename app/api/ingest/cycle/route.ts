import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing api key" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.machineId || !body?.cycle) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const machine = await prisma.machine.findFirst({
    where: { id: String(body.machineId), apiKey },
    select: { id: true, orgId: true },
  });
  if (!machine) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const c = body.cycle;

  const tsMs =
    (typeof c.timestamp === "number" && c.timestamp) ||
    (typeof c.ts === "number" && c.ts) ||
    (typeof c.event_timestamp === "number" && c.event_timestamp) ||
    undefined;

  const ts = tsMs ? new Date(tsMs) : new Date();

  const row = await prisma.machineCycle.create({
    data: {
      orgId: machine.orgId,
      machineId: machine.id,
      ts,
      cycleCount: typeof c.cycle_count === "number" ? c.cycle_count : null,
      actualCycleTime: Number(c.actual_cycle_time),
      theoreticalCycleTime: c.theoretical_cycle_time != null ? Number(c.theoretical_cycle_time) : null,
      workOrderId: c.work_order_id ? String(c.work_order_id) : null,
      sku: c.sku ? String(c.sku) : null,
      cavities: typeof c.cavities === "number" ? c.cavities : null,
      goodDelta: typeof c.good_delta === "number" ? c.good_delta : null,
      scrapDelta: typeof c.scrap_delta === "number" ? c.scrap_delta : null,
    },
  });

  return NextResponse.json({ ok: true, id: row.id, ts: row.ts });
}
