import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import {
  FINANCIAL_IMPACT_SWR_SEC,
  FINANCIAL_IMPACT_TTL_SEC,
  getFinancialImpactCached,
} from "@/lib/financial/cache";

const RANGE_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function canManageFinancials(role?: string | null) {
  return role === "OWNER";
}

function parseDate(input?: string | null) {
  if (!input) return null;
  const n = Number(input);
  if (!Number.isNaN(n)) return new Date(n);
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickRange(req: NextRequest) {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "7d";
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

  const membership = await prisma.orgUser.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    select: { role: true },
  });
  if (!canManageFinancials(membership?.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const { start, end } = pickRange(req);
  const machineId = url.searchParams.get("machineId") ?? undefined;
  const location = url.searchParams.get("location") ?? undefined;
  const sku = url.searchParams.get("sku") ?? undefined;
  const currency = url.searchParams.get("currency") ?? undefined;

  const result = await getFinancialImpactCached(
    {
      orgId: session.orgId,
      start,
      end,
      machineId,
      location,
      sku,
      currency,
      includeEvents: false,
    },
    { refresh }
  );

  const responseHeaders = new Headers({
    "Cache-Control": `private, max-age=${FINANCIAL_IMPACT_TTL_SEC}, stale-while-revalidate=${FINANCIAL_IMPACT_SWR_SEC}`,
    Vary: "Cookie",
  });

  return NextResponse.json({ ok: true, ...result }, { headers: responseHeaders });
}
