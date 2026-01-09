import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const { machineId } = await params;

  const session = await requireSession();
  let orgId: string | null = null;

  if (session) {
    const machine = await prisma.machine.findFirst({
      where: { id: machineId, orgId: session.orgId },
      select: { id: true, orgId: true },
    });
    if (!machine) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    orgId = machine.orgId;
  } else {
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const machine = await prisma.machine.findFirst({
      where: { id: machineId, apiKey },
      select: { id: true, orgId: true },
    });
    if (!machine) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    orgId = machine.orgId;
  }

  const rows = await prisma.machineWorkOrder.findMany({
    where: { machineId, orgId: orgId as string, status: { not: "DONE" } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    ok: true,
    machineId,
    workOrders: rows.map((row) => ({
      workOrderId: row.workOrderId,
      sku: row.sku,
      targetQty: row.targetQty,
      cycleTime: row.cycleTime,
      status: row.status,
    })),
  });
}
