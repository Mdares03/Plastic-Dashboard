import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

const asTrimmedString = (v: any) => {
  if (v == null) return "";
  return String(v).trim();
};

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return bad(401, "Missing api key");

  const body = await req.json().catch(() => null);
  if (!body?.machineId || !body?.reason) return bad(400, "Invalid payload");

  const machine = await prisma.machine.findFirst({
    where: { id: String(body.machineId), apiKey },
    select: { id: true, orgId: true },
  });
  if (!machine) return bad(401, "Unauthorized");

  const r = body.reason;

  const reasonId = asTrimmedString(r.reasonId);
  if (!reasonId) return bad(400, "Missing reason.reasonId");

  const kind = asTrimmedString(r.kind).toLowerCase();
  if (kind !== "downtime" && kind !== "scrap")
    return bad(400, "Invalid reason.kind");

  const capturedAtMs = r.capturedAtMs;
  if (typeof capturedAtMs !== "number" || !Number.isFinite(capturedAtMs)) {
    return bad(400, "Invalid reason.capturedAtMs");
  }
  const capturedAt = new Date(capturedAtMs);

  const reasonCodeRaw = asTrimmedString(r.reasonCode);
  if (!reasonCodeRaw) return bad(400, "Missing reason.reasonCode");
  const reasonCode = reasonCodeRaw.toUpperCase(); // normalize for grouping/pareto

  const reasonLabel = r.reasonLabel != null ? String(r.reasonLabel) : null;

  let reasonText = r.reasonText != null ? String(r.reasonText).trim() : null;
  if (reasonCode === "OTHER") {
    if (!reasonText || reasonText.length < 2)
      return bad(400, "reason.reasonText required when reasonCode=OTHER");
  } else {
    // Non-OTHER must not store free text
    reasonText = null;
  }

  // Optional shared fields
  const workOrderId =
    r.workOrderId != null && String(r.workOrderId).trim()
      ? String(r.workOrderId).trim()
      : null;

  const schemaVersion =
    typeof r.schemaVersion === "number" && Number.isFinite(r.schemaVersion)
      ? Math.trunc(r.schemaVersion)
      : 1;

  const meta = r.meta != null ? r.meta : null;

  // Kind-specific fields
  let episodeId: string | null = null;
  let durationSeconds: number | null = null;
  let episodeEndTs: Date | null = null;

  let scrapEntryId: string | null = null;
  let scrapQty: number | null = null;
  let scrapUnit: string | null = null;

  if (kind === "downtime") {
    episodeId = asTrimmedString(r.episodeId) || null;
    if (!episodeId) return bad(400, "Missing reason.episodeId for downtime");

    if (typeof r.durationSeconds !== "number" || !Number.isFinite(r.durationSeconds)) {
      return bad(400, "Invalid reason.durationSeconds for downtime");
    }
    durationSeconds = Math.max(0, Math.trunc(r.durationSeconds));

    const episodeEndTsMs = r.episodeEndTsMs;
    if (episodeEndTsMs != null) {
      if (typeof episodeEndTsMs !== "number" || !Number.isFinite(episodeEndTsMs)) {
        return bad(400, "Invalid reason.episodeEndTsMs");
      }
      episodeEndTs = new Date(episodeEndTsMs);
    }
  } else {
    scrapEntryId = asTrimmedString(r.scrapEntryId) || null;
    if (!scrapEntryId) return bad(400, "Missing reason.scrapEntryId for scrap");

    if (typeof r.scrapQty !== "number" || !Number.isFinite(r.scrapQty)) {
      return bad(400, "Invalid reason.scrapQty for scrap");
    }
    scrapQty = Math.max(0, Math.trunc(r.scrapQty));

    scrapUnit =
      r.scrapUnit != null && String(r.scrapUnit).trim()
        ? String(r.scrapUnit).trim()
        : null;
  }

  // Idempotent upsert keyed by reasonId
  const row = await prisma.reasonEntry.upsert({
    where: { reasonId },
    create: {
      orgId: machine.orgId,
      machineId: machine.id,
      reasonId,
      kind,
      episodeId,
      durationSeconds,
      episodeEndTs,
      scrapEntryId,
      scrapQty,
      scrapUnit,
      reasonCode,
      reasonLabel,
      reasonText,
      capturedAt,
      workOrderId,
      meta,
      schemaVersion,
    },
    update: {
      kind,
      episodeId,
      durationSeconds,
      episodeEndTs,
      scrapEntryId,
      scrapQty,
      scrapUnit,
      reasonCode,
      reasonLabel,
      reasonText,
      capturedAt,
      workOrderId,
      meta,
      schemaVersion,
    },
    select: { id: true, reasonId: true },
  });

  return NextResponse.json({ ok: true, id: row.id, reasonId: row.reasonId });
}
