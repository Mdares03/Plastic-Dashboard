import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

const RANGE_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function parseDate(input?: string | null) {
  if (!input) return null;
  const n = Number(input);
  if (!Number.isNaN(n)) return new Date(n);
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickRange(req: NextRequest) {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "24h";
  const now = new Date();

  if (range === "custom") {
    const start = parseDate(url.searchParams.get("start")) ?? new Date(now.getTime() - RANGE_MS["24h"]);
    const end = parseDate(url.searchParams.get("end")) ?? now;
    return { start, end };
  }

  const ms = RANGE_MS[range] ?? RANGE_MS["24h"];
  return { start: new Date(now.getTime() - ms), end: now };
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const machineId = url.searchParams.get("machineId") ?? undefined;
  const { start, end } = pickRange(req);

  const baseWhere = {
    orgId: session.orgId,
    ...(machineId ? { machineId } : {}),
    ts: { gte: start, lte: end },
  };

  const workOrderRows = await prisma.machineCycle.findMany({
    where: { ...baseWhere, workOrderId: { not: null } },
    distinct: ["workOrderId"],
    select: { workOrderId: true },
  });

  const skuRows = await prisma.machineCycle.findMany({
    where: { ...baseWhere, sku: { not: null } },
    distinct: ["sku"],
    select: { sku: true },
  });

  const workOrders = workOrderRows.map((r) => r.workOrderId).filter(Boolean) as string[];
  const skus = skuRows.map((r) => r.sku).filter(Boolean) as string[];

  return NextResponse.json({ ok: true, workOrders, skus });
}
