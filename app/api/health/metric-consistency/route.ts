import { NextResponse } from "next/server";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { rollupStatus, runMetricConsistencyChecks } from "@/lib/health/checks";

/**
 * Admin-only cross-path metric congruence check — the live answer to the client's
 * "the numbers don't match across screens" complaint. Re-runs the same 30d window
 * through the distinct code paths (authority/recap/reports/financial) and asserts
 * they agree. The check logic lives in lib/health/checks.ts (shared with the
 * /api/health/summary badge rollup and the /trust page). Read-only.
 */
export async function GET() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId } = auth.session;

  const { checks, window } = await runMetricConsistencyChecks(orgId);
  return NextResponse.json({
    ok: rollupStatus(checks) !== "fail",
    generatedAt: new Date().toISOString(),
    orgId,
    window,
    checks,
  });
}
