import { prisma } from "@/lib/prisma";
import type { WoStatusRow } from "@/lib/reports/types";
import { isTemporarilyBlockedWorkOrder } from "@/lib/workOrders/temporaryBlocklist";

const ACTIVE_STATUSES = new Set(["ACTIVE", "IN_PROGRESS", "RUNNING", "PENDING"]);

export async function getWorkOrderStatus(params: {
  orgId: string;
  from: Date;
  to: Date;
  machineIds: string[];
  machineNameById: Map<string, string>;
}) {
  const { orgId, from, to, machineIds, machineNameById } = params;
  if (!machineIds.length) return [] as WoStatusRow[];

  const rows = await prisma.machineWorkOrder.findMany({
    where: {
      orgId,
      machineId: { in: machineIds },
      OR: [
        { updatedAt: { gte: from, lte: to } },
        { status: { in: Array.from(ACTIVE_STATUSES) } },
      ],
    },
    orderBy: [
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ],
    select: {
      workOrderId: true,
      sku: true,
      machineId: true,
      targetQty: true,
      goodParts: true,
      status: true,
      updatedAt: true,
    },
  });

  const deduped = new Map<string, WoStatusRow>();
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

    const machineName = machineNameById.get(row.machineId) ?? row.machineId;
    const target = Math.max(0, Number(row.targetQty ?? 0));
    const completed = Math.max(0, Number(row.goodParts ?? 0));
    const pctComplete = target > 0 ? Math.min(100, (completed / target) * 100) : 0;

    const key = `${row.machineId}::${row.workOrderId}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        workOrderId: row.workOrderId,
        sku: row.sku ?? "--",
        machineName,
        target,
        completed,
        pctComplete,
        status: row.status,
      });
    }
  }

  return [...deduped.values()]
    .sort((a, b) => {
      const aActive = ACTIVE_STATUSES.has(String(a.status).toUpperCase()) ? 1 : 0;
      const bActive = ACTIVE_STATUSES.has(String(b.status).toUpperCase()) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return a.pctComplete - b.pctComplete;
    })
    .slice(0, 10);
}
