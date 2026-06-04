import { prisma } from "@/lib/prisma";
import { isTemporarilyBlockedWorkOrder } from "@/lib/workOrders/temporaryBlocklist";

export async function getProductionVsTarget(params: {
  orgId: string;
  from: Date;
  to: Date;
  machineIds: string[];
}) {
  const { orgId, from, to, machineIds } = params;
  if (!machineIds.length) return { good: 0, target: 0, pct: 0 };

  const rows = await prisma.machineWorkOrder.findMany({
    where: {
      orgId,
      machineId: { in: machineIds },
      updatedAt: { gte: from, lte: to },
    },
    select: { machineId: true, workOrderId: true, sku: true, goodParts: true, targetQty: true },
  });

  let good = 0;
  let target = 0;
  for (const row of rows) {
    if (
      isTemporarilyBlockedWorkOrder({
        machineId: row.machineId,
        workOrderId: row.workOrderId,
        sku: row.sku,
      })
    ) {
      continue;
    }

    good += Math.max(0, Number(row.goodParts ?? 0));
    target += Math.max(0, Number(row.targetQty ?? 0));
  }

  return {
    good,
    target,
    pct: target > 0 ? (good / target) * 100 : 0,
  };
}
