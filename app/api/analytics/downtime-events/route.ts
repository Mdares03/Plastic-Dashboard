import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { coerceDowntimeRange, rangeToStart } from "@/lib/analytics/downtimeRange";
import type { Prisma } from "@prisma/client";
import {
  applyDowntimeFilters,
  loadDowntimeShiftContext,
  normalizeMicrostopLtMin,
  normalizeShiftFilter,
  resolvePlannedFilter,
} from "@/lib/analytics/downtimeFilters";

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

function toISO(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

export async function GET(req: Request) {
  // ✅ Session auth (cookie)
  const session = await requireSession();
  if (!session) return bad(401, "Unauthorized");
  const orgId = session.orgId;

  const url = new URL(req.url);

  // ✅ Params
  const range = coerceDowntimeRange(url.searchParams.get("range"));
  const start = rangeToStart(range);

  const machineId = url.searchParams.get("machineId"); // optional
  const reasonCode = url.searchParams.get("reasonCode"); // optional
  const includeMoldChange = url.searchParams.get("includeMoldChange") === "true";
  const planned = resolvePlannedFilter(url.searchParams.get("planned"), includeMoldChange);
  const shift = normalizeShiftFilter(url.searchParams.get("shift"));
  const microstopLtMin = normalizeMicrostopLtMin(url.searchParams.get("microstopLtMin"));

  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitRaw || 200), 1), 500);

  // Optional pagination: return events before this timestamp (capturedAt)
  const before = url.searchParams.get("before"); // ISO string
  const beforeDate = before ? new Date(before) : null;
  if (before && isNaN(beforeDate!.getTime())) return bad(400, "Invalid before timestamp");

  // ✅ If machineId provided, verify it belongs to this org
  if (machineId) {
    const m = await prisma.machine.findFirst({
      where: { id: machineId, orgId },
      select: { id: true },
    });
    if (!m) return bad(404, "Machine not found");
  }

  // ✅ Query ReasonEntry as the "episode" table for downtime
  // We only return rows that have an episodeId (true downtime episodes)
  const where: Prisma.ReasonEntryWhereInput = {
    orgId,
    kind: "downtime",
    episodeId: { not: null },
    capturedAt: {
      gte: start,
      ...(beforeDate ? { lt: beforeDate } : {}),
    },
    ...(machineId ? { machineId } : {}),
    ...(reasonCode ? { reasonCode } : {}),
  };

  const scanTake = Math.min(Math.max(limit * 8, 1000), 5000);
  const rowsRaw = await prisma.reasonEntry.findMany({
    where,
    orderBy: { capturedAt: "desc" },
    take: scanTake,
    select: {
      id: true,
      episodeId: true,
      machineId: true,
      reasonCode: true,
      reasonLabel: true,
      reasonText: true,
      durationSeconds: true,
      capturedAt: true,
      episodeEndTs: true,
      workOrderId: true,
      meta: true,
      createdAt: true,
      machine: { select: { name: true } },
    },
  });

  const shiftContext = shift === "all" ? null : await loadDowntimeShiftContext(orgId);
  const rows = applyDowntimeFilters(rowsRaw, {
    planned,
    shift,
    microstopLtMin,
    shiftContext,
  }).slice(0, limit);

  const events = rows.map((r) => {
    const startAt = r.capturedAt;
    const endAt =
      r.episodeEndTs ??
      (r.durationSeconds != null
        ? new Date(startAt.getTime() + r.durationSeconds * 1000)
        : null);

    const durationSeconds = r.durationSeconds ?? null;
    const durationMinutes =
      durationSeconds != null ? Math.round((durationSeconds / 60) * 10) / 10 : null;

    return {
      id: r.id,
      episodeId: r.episodeId,
      machineId: r.machineId,
      machineName: r.machine?.name ?? null,

      reasonCode: r.reasonCode,
      reasonLabel: r.reasonLabel ?? r.reasonCode,
      reasonText: r.reasonText ?? null,

      durationSeconds,
      durationMinutes,

      startAt: toISO(startAt),
      endAt: toISO(endAt),
      capturedAt: toISO(r.capturedAt),

      workOrderId: r.workOrderId ?? null,
      meta: r.meta ?? null,
      createdAt: toISO(r.createdAt),
    };
  });

  const nextBefore =
    events.length > 0
      ? events[events.length - 1]?.capturedAt ?? null
      : rowsRaw.length > 0
      ? toISO(rowsRaw[rowsRaw.length - 1]?.capturedAt)
      : null;

  return NextResponse.json({
    ok: true,
    orgId,
    range,
    start,
    machineId: machineId ?? null,
    reasonCode: reasonCode ?? null,
    planned,
    shift,
    microstopLtMin,
    includeMoldChange,
    limit,
    before: before ?? null,
    nextBefore, // pass this back for pagination
    events,
  });
}
