import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { resolveCostPerMin } from "@/lib/financial/costPerMin";

/**
 * Member-accessible read of the org's loaded cost per stopped minute, for the
 * Downtime page's "Est. cost" KPI. Unlike /api/financial/costs (OWNER-only,
 * full config), this exposes only the single resolved rate + currency + a
 * placeholder flag — safe for any signed-in member to read.
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { costPerMin, currency, placeholder } = await resolveCostPerMin(session.orgId);
  return NextResponse.json({ ok: true, costPerMin, currency, placeholder });
}
