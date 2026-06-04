import { prisma } from "@/lib/prisma";
import type { ActionRow, LossRow } from "@/lib/reports/types";

const PRIORITY_WEIGHT: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function fmtEta(value: Date | null | undefined) {
  if (!value) return "7 días";
  return value.toISOString().slice(0, 10);
}

export async function getRecommendedActions(params: {
  orgId: string;
  topLosses: LossRow[];
  reasonCostMap: Map<string, number>;
}) {
  const { orgId, topLosses, reasonCostMap } = params;

  const rows = await prisma.downtimeAction.findMany({
    where: {
      orgId,
      status: { in: ["open", "in_progress", "blocked"] },
    },
    include: {
      ownerUser: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });

  if (!rows.length) {
    return topLosses.slice(0, 3).map((loss) => ({
      title: `Reducir ${loss.reasonLabel}`,
      owner: "Operaciones",
      estimatedRecoveryMXN: loss.estimatedCostMXN,
      eta: "7 días",
      relatedReasonCode: loss.reasonCode,
    })) satisfies ActionRow[];
  }

  return rows
    .sort((a, b) => {
      const p = (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0);
      if (p !== 0) return p;
      const aDue = a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDue = b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    })
    .slice(0, 5)
    .map((action) => ({
      title: action.title,
      owner: action.ownerUser?.name || action.ownerUser?.email || "Sin asignar",
      estimatedRecoveryMXN:
        action.reasonCode != null ? reasonCostMap.get(action.reasonCode) ?? 0 : 0,
      eta: fmtEta(action.dueDate),
      relatedReasonCode: action.reasonCode ?? undefined,
    })) satisfies ActionRow[];
}
