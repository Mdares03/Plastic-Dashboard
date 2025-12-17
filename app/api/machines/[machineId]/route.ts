import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

export async function GET(
  _req: NextRequest,
  { params }: { params: { machineId: string } }
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { machineId } = params;


  const machine = await prisma.machine.findFirst({
    where: { id: machineId, orgId: session.orgId },
    select: {
      id: true,
      name: true,
      code: true,
      location: true,
      heartbeats: {
        orderBy: { ts: "desc" },
        take: 1,
        select: { ts: true, status: true, message: true, ip: true, fwVersion: true },
      },
      kpiSnapshots: {
        orderBy: { ts: "desc" },
        take: 1,
        select: {
          ts: true,
          oee: true,
          availability: true,
          performance: true,
          quality: true,
          workOrderId: true,
          sku: true,
          good: true,
          scrap: true,
          target: true,
          cycleTime: true,
        },
      },
    },
  });

  if (!machine) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const events = await prisma.machineEvent.findMany({
  where: {
    orgId: session.orgId,
    machineId,
    severity: { in: ["warning", "critical"] },
    eventType: { in: ["slow-cycle", "anomaly-detected", "performance-degradation", "scrap-spike", "down", "microstop"] },
  },
  orderBy: { ts: "desc" },
  take: 30,
  select: { /* same as now */ },
  });

  return NextResponse.json({
    ok: true,
    machine: {
      id: machine.id,
      name: machine.name,
      code: machine.code,
      location: machine.location,
      latestHeartbeat: machine.heartbeats[0] ?? null,
      latestKpi: machine.kpiSnapshots[0] ?? null,
    },
    events,
  });
}
