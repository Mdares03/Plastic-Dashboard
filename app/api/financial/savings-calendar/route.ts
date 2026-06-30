import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { computeSavingsCalendar, MAX_SAVINGS_MONTHS } from "@/lib/financial/savingsCalendar";
import {
  createSchemaDriftDiagnostic,
  getMissingColumnName,
  isPrismaMissingColumnError,
  logFinancialSchemaDrift,
} from "@/lib/financial/diagnostics";

function canManageFinancials(role?: string | null) {
  return role === "OWNER";
}

/**
 * Item 2 — savings calendar feed (OWNER-only, like the financial impact route).
 * Monthly + daily cost-of-losses for up to 24 months, sourced from the financial
 * authority so the numbers reconcile with the financial page by construction.
 */
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
  const monthsRaw = Number(url.searchParams.get("months"));
  const months = Number.isFinite(monthsRaw) && monthsRaw > 0 ? monthsRaw : MAX_SAVINGS_MONTHS;
  const machineId = url.searchParams.get("machineId") ?? undefined;
  const location = url.searchParams.get("location") ?? undefined;
  const currency = url.searchParams.get("currency") ?? undefined;

  const responseHeaders = new Headers({
    "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
    Vary: "Cookie",
  });

  try {
    const result = await computeSavingsCalendar({
      orgId: session.orgId,
      months,
      machineId,
      location,
      currency,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: responseHeaders });
  } catch (error) {
    if (!isPrismaMissingColumnError(error)) throw error;

    logFinancialSchemaDrift({
      route: "app/api/financial/savings-calendar",
      orgId: session.orgId,
      userId: session.userId,
      error,
    });

    const diagnostic = createSchemaDriftDiagnostic(getMissingColumnName(error));
    return NextResponse.json(
      { ok: true, range: null, currencies: [], diagnostic },
      { headers: responseHeaders }
    );
  }
}
