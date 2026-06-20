import { prisma } from "@/lib/prisma";
import { normalizeShiftOverrides } from "@/lib/settings";
import {
  hasPlannedShifts,
  isInPlannedShift,
  resolveShiftName,
  type ShiftLike,
  type ShiftPlanningContext,
} from "@/lib/metrics/shift";

// The shift authority now lives in lib/metrics/shift so the dashboard/recap and the
// reports family share one definition (the "shift-aware everywhere" rule). This module
// keeps only the DB loader; the pure helpers are re-exported for existing callers.
export { hasPlannedShifts, isInPlannedShift, resolveShiftName };
export type { ShiftLike, ShiftPlanningContext };

export async function loadShiftPlanningContext(
  orgId: string,
  timeZoneFallback?: string
): Promise<ShiftPlanningContext> {
  const [shifts, settings] = await Promise.all([
    prisma.orgShift.findMany({
      where: { orgId, enabled: true },
      orderBy: { sortOrder: "asc" },
      select: { name: true, startTime: true, endTime: true, enabled: true },
    }),
    prisma.orgSettings.findUnique({
      where: { orgId },
      select: { timezone: true, shiftScheduleOverridesJson: true },
    }),
  ]);

  return {
    timeZone: settings?.timezone || timeZoneFallback || "UTC",
    shifts,
    overrides: normalizeShiftOverrides(settings?.shiftScheduleOverridesJson),
  };
}
