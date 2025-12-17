import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing api key" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.machineId || !body?.kpis) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const machine = await prisma.machine.findFirst({
    where: { id: String(body.machineId), apiKey },
    select: { id: true, orgId: true },
  });
  if (!machine) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const wo = body.activeWorkOrder ?? {};
  const k = body.kpis ?? {};

  const row = await prisma.machineKpiSnapshot.create({
    data: {
      orgId: machine.orgId,
      machineId: machine.id,

      workOrderId: wo.id ? String(wo.id) : null,
      sku: wo.sku ? String(wo.sku) : null,

      target: typeof wo.target === "number" ? wo.target : null,
      good: typeof wo.good === "number" ? wo.good : null,
      scrap: typeof wo.scrap === "number" ? wo.scrap : null,

      cycleCount: typeof body.cycle_count === "number" ? body.cycle_count : null,
      goodParts: typeof body.good_parts === "number" ? body.good_parts : null,

      cycleTime: typeof body.cycleTime === "number" ? body.cycleTime : null,

      availability: typeof k.availability === "number" ? k.availability : null,
      performance: typeof k.performance === "number" ? k.performance : null,
      quality: typeof k.quality === "number" ? k.quality : null,
      oee: typeof k.oee === "number" ? k.oee : null,

      trackingEnabled: typeof body.trackingEnabled === "boolean" ? body.trackingEnabled : null,
      productionStarted: typeof body.productionStarted === "boolean" ? body.productionStarted : null,
    },
  });

  return NextResponse.json({ ok: true, id: row.id, ts: row.ts });
}
