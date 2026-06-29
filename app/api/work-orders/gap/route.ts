import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { prisma } from "@/lib/prisma";
import { getWorkOrderReconciliation } from "@/lib/workOrders/reconciliation";

/**
 * POST — admin acknowledges a single work-order delivery gap ("I've accounted for
 * these missing cycle rows"). Records the gap size at ack time so a LATER, larger
 * gap on the same WO would surface again. Once acknowledged the WO stops reading as
 * an unexplained problem on the Work Orders board.
 */
const bodySchema = z.object({
  machineId: z.string().trim().min(1).max(128),
  workOrderId: z.string().trim().min(1).max(64),
  reason: z.enum(["manual", "sensor-outage", "outbox-freeze-prefix"]).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId, userId } = auth.session;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const { machineId, workOrderId, reason = "manual", note } = parsed.data;

  // Recompute server-side so the stored gap size is trustworthy (never client-supplied).
  const rows = await getWorkOrderReconciliation(orgId, { includeActive: true });
  const row = rows.find((r) => r.machineId === machineId && r.workOrderId === workOrderId);
  if (!row) {
    return NextResponse.json({ ok: false, error: "Work order not found" }, { status: 404 });
  }
  if (row.missing <= 0) {
    return NextResponse.json({ ok: false, error: "No delivery gap to acknowledge" }, { status: 409 });
  }

  await prisma.workOrderGapAcknowledgement.upsert({
    where: { orgId_machineId_workOrderId: { orgId, machineId, workOrderId } },
    create: { orgId, machineId, workOrderId, missingAtAck: row.missing, reason, note, acknowledgedBy: userId },
    update: { missingAtAck: row.missing, reason, note, acknowledgedBy: userId, acknowledgedAt: new Date() },
  });

  return NextResponse.json({ ok: true, missing: row.missing });
}
