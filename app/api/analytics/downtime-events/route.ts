import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { coerceDowntimeRange, rangeToStart } from "@/lib/analytics/downtimeRange";
import type { Prisma } from "@prisma/client";
import {
  applyDowntimeFilters,
  isUnclassifiedReasonCode,
  loadDowntimeShiftContext,
  normalizeMicrostopLtMin,
  normalizeShiftFilter,
  parseBooleanParam,
  resolvePlannedFilter,
} from "@/lib/analytics/downtimeFilters";

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

function toISO(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

async function buildReasonLabelMap(orgId: string, reasonCodes: string[]) {
  const codes = [...new Set(reasonCodes.map((code) => String(code ?? "").trim().toUpperCase()).filter(Boolean))];
  if (!codes.length) return new Map<string, string>();

  const rows = await prisma.reasonCatalogItem.findMany({
    where: { orgId, reasonCode: { in: codes } },
    select: { reasonCode: true, name: true, category: { select: { name: true } } },
  });

  const out = new Map<string, string>();
  for (const row of rows) {
    const code = String(row.reasonCode ?? "").trim().toUpperCase();
    const category = String(row.category?.name ?? "").trim();
    const detail = String(row.name ?? "").trim();
    if (!code || !detail) continue;
    out.set(code, category ? `${category} > ${detail}` : detail);
  }
  return out;
}

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return bad(401, "Unauthorized");
  const orgId = session.orgId;

  const url = new URL(req.url);

  const range = coerceDowntimeRange(url.searchParams.get("range"));
  const start = rangeToStart(range);

  const machineId = url.searchParams.get("machineId");
  const reasonCode = url.searchParams.get("reasonCode");
  const includeMoldChange = url.searchParams.get("includeMoldChange") === "true";
  const planned = resolvePlannedFilter(url.searchParams.get("planned"), includeMoldChange);
  const shift = normalizeShiftFilter(url.searchParams.get("shift"));
  const microstopLtMin = normalizeMicrostopLtMin(url.searchParams.get("microstopLtMin"));
  const excludeUnclassified = parseBooleanParam(url.searchParams.get("excludeUnclassified"));

  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitRaw || 200), 1), 500);

  const before = url.searchParams.get("before");
  const beforeDate = before ? new Date(before) : null;
  if (before && isNaN(beforeDate!.getTime())) return bad(400, "Invalid before timestamp");

  if (machineId) {
    const m = await prisma.machine.findFirst({
      where: { id: machineId, orgId },
      select: { id: true },
    });
    if (!m) return bad(404, "Machine not found");
  }

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
  const filteredRowsAll = applyDowntimeFilters(rowsRaw, {
    planned,
    shift,
    microstopLtMin,
    shiftContext,
  });

  const filteredRowsClassified = filteredRowsAll.filter(
    (row) => !isUnclassifiedReasonCode(row.reasonCode)
  );

  const filteredRowsForOutput = (excludeUnclassified ? filteredRowsClassified : filteredRowsAll).slice(0, limit);

  const reasonLabelMap = await buildReasonLabelMap(
    orgId,
    filteredRowsForOutput.map((row) => row.reasonCode)
  );

  const events = filteredRowsForOutput.map((r) => {
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
      reasonLabel: reasonLabelMap.get(String(r.reasonCode ?? "").trim().toUpperCase()) ?? r.reasonLabel ?? r.reasonCode,
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

  const totalEventsAll = filteredRowsAll.length;
  const totalEventsClassified = filteredRowsClassified.length;
  const excludedUnclassifiedEvents = Math.max(0, totalEventsAll - totalEventsClassified);
  const excludedUnclassifiedPct = totalEventsAll > 0
    ? Math.round((excludedUnclassifiedEvents / totalEventsAll) * 10000) / 100
    : 0;

  const totalSecondsAll = filteredRowsAll.reduce(
    (acc, row) => acc + Math.max(0, row.durationSeconds ?? 0),
    0
  );
  const totalSecondsClassified = filteredRowsClassified.reduce(
    (acc, row) => acc + Math.max(0, row.durationSeconds ?? 0),
    0
  );
  const totalMinutesAll = Math.round((totalSecondsAll / 60) * 10) / 10;
  const totalMinutesClassified = Math.round((totalSecondsClassified / 60) * 10) / 10;
  const excludedUnclassifiedMinutes = Math.max(
    0,
    Math.round((totalMinutesAll - totalMinutesClassified) * 10) / 10
  );

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
    excludeUnclassified,
    limit,
    before: before ?? null,
    nextBefore,
    totalEventsAll,
    totalEventsClassified,
    excludedUnclassifiedEvents,
    excludedUnclassifiedPct,
    totalMinutesAll,
    totalMinutesClassified,
    excludedUnclassifiedMinutes,
    events,
  });
}
