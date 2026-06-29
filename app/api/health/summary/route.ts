import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import {
  rollupStatus,
  runConsistencyChecks,
  runMetricConsistencyChecks,
  type CheckStatus,
} from "@/lib/health/checks";

/**
 * Cheap, cached rollup of all health checks — backs the persistent "Verified ✓"
 * badge in the app header. The full consistency + metric-consistency passes are
 * heavy (30d computeDowntime across paths, per-machine heartbeat scans), far too
 * expensive to run on every page load, so this caches the rollup per org for 5
 * minutes. The /trust page and Settings → Integrity still call the detailed
 * endpoints on demand. Owner/Admin only. Read-only.
 */
async function computeSummary(orgId: string): Promise<{
  status: CheckStatus;
  counts: { ok: number; warn: number; fail: number };
  total: number;
  generatedAt: string;
}> {
  const [consistency, metric] = await Promise.all([
    runConsistencyChecks(orgId),
    runMetricConsistencyChecks(orgId),
  ]);
  const checks = [...consistency, ...metric.checks];
  const counts = {
    ok: checks.filter((c) => c.status === "ok").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
  };
  return {
    status: rollupStatus(checks),
    counts,
    total: checks.length,
    generatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId } = auth.session;

  const cached = unstable_cache(() => computeSummary(orgId), ["health-summary", orgId], {
    revalidate: 300,
  });
  const summary = await cached();
  return NextResponse.json({ ok: true, orgId, ...summary });
}
