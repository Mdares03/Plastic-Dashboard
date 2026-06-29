import { NextResponse } from "next/server";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { rollupStatus, runConsistencyChecks } from "@/lib/health/checks";

/**
 * Admin-only live consistency health check — the always-on congruence guarantee.
 * The check logic lives in lib/health/checks.ts so the same invariants back this
 * endpoint, the cached /api/health/summary badge rollup, and the /trust page.
 * Read-only.
 */
export async function GET() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId } = auth.session;

  const checks = await runConsistencyChecks(orgId);
  return NextResponse.json({
    ok: rollupStatus(checks) !== "fail",
    generatedAt: new Date().toISOString(),
    orgId,
    checks,
  });
}
