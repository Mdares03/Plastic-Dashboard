import { NextResponse } from "next/server";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { prisma } from "@/lib/prisma";
import { getWorkOrderReconciliation } from "@/lib/workOrders/reconciliation";

/**
 * Admin-only one-click fix for the `cycle_delivery` health check. One-time baseline:
 * accepts every currently-UNEXPLAINED delivery gap as `outbox-freeze-prefix` — the
 * losses from the 06-15→06-18 outbox freeze and other pre-fix dropouts that can never
 * be recovered. After this the board starts clean and only a NEW unexplained gap (which
 * the contiguous-ack outbox now makes ~impossible) stands out as a real emergency.
 *
 * Idempotent: acknowledged gaps reclassify to "explained", so a second call finds 0
 * unexplained rows and accepts 0.
 */
export async function POST() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId, userId } = auth.session;

  const rows = await getWorkOrderReconciliation(orgId, { includeActive: true });
  const unexplained = rows.filter((r) => r.delivery === "unexplained" && r.missing > 0);

  let accepted = 0;
  for (const r of unexplained) {
    await prisma.workOrderGapAcknowledgement.upsert({
      where: {
        orgId_machineId_workOrderId: { orgId, machineId: r.machineId, workOrderId: r.workOrderId },
      },
      create: {
        orgId,
        machineId: r.machineId,
        workOrderId: r.workOrderId,
        missingAtAck: r.missing,
        reason: "outbox-freeze-prefix",
        acknowledgedBy: userId,
      },
      update: {}, // present already → leave as-is (keeps original acknowledgement)
    });
    accepted += 1;
  }

  return NextResponse.json({ ok: true, accepted });
}
