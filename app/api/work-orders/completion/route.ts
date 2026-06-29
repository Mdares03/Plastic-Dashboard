import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { getWorkOrderReconciliation } from "@/lib/workOrders/reconciliation";

/**
 * GET — per-work-order completion / counter audit for the Work Orders tab. Includes
 * active jobs (live running totals) alongside finished ones. Read-only; any signed-in
 * member of the org can view (parity with the downtime/reports pages).
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const rows = await getWorkOrderReconciliation(session.orgId, { includeActive: true });
  return NextResponse.json({ ok: true, rows });
}
