import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

const COOKIE_NAME = "mis_session";

async function requireSession() {
  const sessionId = (await cookies()).get(COOKIE_NAME)?.value;
  if (!sessionId) return null;

  return prisma.session.findFirst({
    where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { org: true, user: true },
  });
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const machines = await prisma.machine.findMany({
    where: { orgId: session.orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      code: true,
      location: true,
      createdAt: true,
      updatedAt: true,
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


  // flatten latest heartbeat for UI convenience
  const out = machines.map((m) => ({
    ...m,
    latestHeartbeat: m.heartbeats[0] ?? null,
    latestKpi: m.kpiSnapshots[0] ?? null,
    heartbeats: undefined,
    kpiSnapshots: undefined,
  }));

  return NextResponse.json({ ok: true, machines: out });
}
