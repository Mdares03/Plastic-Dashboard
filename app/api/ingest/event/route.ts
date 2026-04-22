import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMachineAuth } from "@/lib/machineAuthCache";
import { z } from "zod";
import { evaluateAlertsForEvent } from "@/lib/alerts/engine";
import { toJsonValue } from "@/lib/prismaJson";
import {
  findCatalogReason,
  loadFallbackReasonCatalog,
  normalizeReasonCatalog,
  toReasonCode,
  type ReasonCatalog,
  type ReasonCatalogKind,
} from "@/lib/reasonCatalog";

const normalizeType = (t: unknown) =>
  String(t ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const CANON_TYPE: Record<string, string> = {
  // Node-RED
  "production-stopped": "stop",
  "oee-drop": "oee-drop",
  "quality-spike": "quality-spike",
  "predictive-oee-decline": "predictive-oee-decline",
  "performance-degradation": "performance-degradation",

  // legacy / synonyms
  "macroparo": "macrostop",
  "macro-stop": "macrostop",
  "microparo": "microstop",
  "micro-paro": "microstop",
  "down": "stop",
  "downtime-acknowledged": "downtime-acknowledged",
  "scrap-manual-entry": "scrap-manual-entry",
};

const ALLOWED_TYPES = new Set([
  "slow-cycle",
  "microstop",
  "macrostop",
  "offline",
  "error",
  "oee-drop",
  "quality-spike",
  "performance-degradation",
  "predictive-oee-decline",
  "downtime-acknowledged",
  "scrap-manual-entry",
]);

const machineIdSchema = z.string().uuid();
const MAX_EVENTS = 100;

//when no cycle time is configed
const DEFAULT_MACROSTOP_SEC = 300;


function clampText(value: unknown, maxLen: number) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function numberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function canonicalText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseReasonPath(rawPath: unknown) {
  let category: string | null = null;
  let detail: string | null = null;

  if (Array.isArray(rawPath)) {
    const first = rawPath[0];
    const second = rawPath[1];
    if (typeof first === "string") category = first;
    if (typeof second === "string") detail = second;
    if (asRecord(first)) category = clampText(first.id ?? first.label ?? first.value, 120);
    if (asRecord(second)) detail = clampText(second.id ?? second.label ?? second.value, 120);
  } else if (typeof rawPath === "string") {
    const pieces = rawPath
      .split(/>|\/|\\|\|/g)
      .map((p) => p.trim())
      .filter(Boolean);
    category = pieces[0] ?? null;
    detail = pieces[1] ?? null;
  }

  return {
    category: clampText(category, 120),
    detail: clampText(detail, 120),
  };
}

function parseReasonTextPath(reasonText: unknown) {
  const text = clampText(reasonText, 240);
  if (!text) return { category: null as string | null, detail: null as string | null };
  const pieces = text
    .split(/>|\/|\\|\|/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    category: clampText(pieces[0] ?? null, 120),
    detail: clampText(pieces[1] ?? null, 120),
  };
}

function findCatalogReasonFlexible(
  catalog: ReasonCatalog | null,
  kind: ReasonCatalogKind,
  categoryIdOrLabel: unknown,
  detailIdOrLabel: unknown
) {
  const direct = findCatalogReason(catalog, kind, categoryIdOrLabel, detailIdOrLabel);
  if (direct) return direct;
  if (!catalog) return null;

  const catNeedle = canonicalText(categoryIdOrLabel);
  const detNeedle = canonicalText(detailIdOrLabel);
  if (!catNeedle || !detNeedle) return null;

  for (const category of catalog[kind] ?? []) {
    const catMatch =
      canonicalText(category.id) === catNeedle || canonicalText(category.label) === catNeedle;
    if (!catMatch) continue;
    for (const detail of category.details) {
      const detMatch = canonicalText(detail.id) === detNeedle || canonicalText(detail.label) === detNeedle;
      if (!detMatch) continue;
      return {
        categoryId: category.id,
        categoryLabel: category.label,
        detailId: detail.id,
        detailLabel: detail.label,
        reasonCode: toReasonCode(category.id, detail.id),
        reasonLabel: `${category.label} > ${detail.label}`,
      };
    }
  }
  return null;
}

function getCatalogFromDefaults(defaultsJson: unknown) {
  const defaults = asRecord(defaultsJson);
  if (!defaults) return null;
  return normalizeReasonCatalog(defaults.reasonCatalog ?? defaults.reasonCatalogData);
}

function resolveReason(
  raw: Record<string, unknown>,
  kind: ReasonCatalogKind,
  catalog: ReasonCatalog | null,
  fallbackVersion: number
) {
  const reasonPath = parseReasonPath(raw.reasonPath);
  const reasonTextPath = parseReasonTextPath(raw.reasonText);
  const categoryIdRaw = clampText(raw.categoryId ?? reasonPath.category ?? reasonTextPath.category, 64);
  const detailIdRaw = clampText(raw.detailId ?? reasonPath.detail ?? reasonTextPath.detail, 64);
  const fromCatalog = findCatalogReasonFlexible(catalog, kind, categoryIdRaw, detailIdRaw);

  const categoryLabelRaw = clampText(raw.categoryLabel ?? reasonPath.category ?? reasonTextPath.category, 120);
  const detailLabelRaw = clampText(raw.detailLabel ?? reasonPath.detail ?? reasonTextPath.detail, 120);

  const reasonCode =
    clampText(raw.reasonCode, 64)?.toUpperCase() ??
    fromCatalog?.reasonCode ??
    toReasonCode(categoryIdRaw ?? categoryLabelRaw, detailIdRaw ?? detailLabelRaw) ??
    null;

  const categoryId = fromCatalog?.categoryId ?? categoryIdRaw;
  const detailId = fromCatalog?.detailId ?? detailIdRaw;
  const categoryLabel = fromCatalog?.categoryLabel ?? categoryLabelRaw;
  const detailLabel = fromCatalog?.detailLabel ?? detailLabelRaw;

  const pathLabel =
    clampText(raw.reasonText, 240) ??
    fromCatalog?.reasonLabel ??
    (categoryLabel && detailLabel ? `${categoryLabel} > ${detailLabel}` : null) ??
    detailLabel ??
    categoryLabel ??
    reasonCode;

  const catalogVersionRaw = numberFrom(raw.catalogVersion);
  const catalogVersion = catalogVersionRaw != null ? Math.trunc(catalogVersionRaw) : fallbackVersion;

  return {
    type: kind,
    categoryId,
    categoryLabel,
    detailId,
    detailLabel,
    reasonCode,
    reasonLabel: pathLabel,
    reasonText: pathLabel,
    catalogVersion,
  };
}

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing api key" }, { status: 401 });

  let body: unknown = await req.json().catch(() => null);

  // ✅ if Node-RED sent an array as the whole body, unwrap it
  if (Array.isArray(body)) body = body[0];
  const bodyRecord = asRecord(body) ?? {};
  const payloadRecord = asRecord(bodyRecord.payload) ?? {};

  // ✅ accept multiple common keys
  const machineId =
    bodyRecord.machineId ??
    bodyRecord.machine_id ??
    (asRecord(bodyRecord.machine)?.id ?? null);
  let rawEvent =
    bodyRecord.event ??
    bodyRecord.events ??
    bodyRecord.anomalies ??
    payloadRecord.event ??
    payloadRecord.events ??
    payloadRecord.anomalies ??
    payloadRecord ??
    bodyRecord.data; // sometimes "data"

  const rawEventRecord = asRecord(rawEvent);
  if (rawEventRecord?.event && typeof rawEventRecord.event === "object") rawEvent = rawEventRecord.event;
  if (Array.isArray(rawEventRecord?.events)) rawEvent = rawEventRecord.events;

  if (!machineId || !rawEvent) {
    return NextResponse.json(
      { ok: false, error: "Invalid payload", got: { hasMachineId: !!machineId, keys: Object.keys(bodyRecord) } },
      { status: 400 }
    );
  }

  if (!machineIdSchema.safeParse(String(machineId)).success) {
    return NextResponse.json({ ok: false, error: "Invalid machine id" }, { status: 400 });
  }

  const machine = await getMachineAuth(String(machineId), apiKey);
  if (!machine) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: machine.orgId },
    select: { stoppageMultiplier: true, macroStoppageMultiplier: true, defaultsJson: true },
  });
  const fallbackCatalog = await loadFallbackReasonCatalog();
  const settingsCatalog = getCatalogFromDefaults(orgSettings?.defaultsJson);
  const reasonCatalog = settingsCatalog ?? fallbackCatalog;

  const defaultMicroMultiplier = Number(orgSettings?.stoppageMultiplier ?? 1.5);
  const defaultMacroMultiplier = Math.max(
    defaultMicroMultiplier,
    Number(orgSettings?.macroStoppageMultiplier ?? 5)
  );


  // ✅ normalize to array no matter what
  const events = Array.isArray(rawEvent) ? rawEvent : [rawEvent];
  if (events.length > MAX_EVENTS) {
    return NextResponse.json({ ok: false, error: "Too many events" }, { status: 400 });
  }

  const created: { id: string; ts: Date; eventType: string }[] = [];
  const skipped: Array<Record<string, unknown>> = [];

  for (const ev of events) {
    const evRecord = asRecord(ev);
    if (!evRecord) {
      skipped.push({ reason: "invalid_event_object" });
      continue;
    }
    const evData = asRecord(evRecord.data) ?? {};
    const evReason = asRecord(evRecord.reason) ?? asRecord(evData.reason);
    const evDowntime = asRecord(evRecord.downtime) ?? asRecord(evData.downtime);

    const rawType = evRecord.eventType ?? evRecord.anomaly_type ?? evRecord.topic ?? bodyRecord.topic ?? "";
    const typ0 = normalizeType(rawType);
    const typ = CANON_TYPE[typ0] ?? typ0;

    // Determine timestamp
    const tsMs =
      (typeof evRecord.timestamp === "number" && evRecord.timestamp) ||
      (typeof evData.timestamp === "number" && evData.timestamp) ||
      (typeof evData.event_timestamp === "number" && evData.event_timestamp) ||
      null;

    const ts = tsMs ? new Date(tsMs) : new Date();

    // Severity defaulting (do not skip on severity — store for audit)
    let sev = String(evRecord.severity ?? "").trim().toLowerCase();
    if (!sev) sev = "warning";

    // Stop classification -> microstop/macrostop
    let finalType = typ;
    if (typ === "stop") {
      const stopSec =
        (typeof evData.stoppage_duration_seconds === "number" && evData.stoppage_duration_seconds) ||
        (typeof evData.stop_duration_seconds === "number" && evData.stop_duration_seconds) ||
        null;

      if (stopSec != null) {
        const theoretical = Number(evData.theoretical_cycle_time ?? evData.theoreticalCycleTime ?? 0) || 0;

        const microMultiplier = Number(
          evData.micro_threshold_multiplier ?? evData.threshold_multiplier ?? defaultMicroMultiplier
        );
        const macroMultiplier = Math.max(
          microMultiplier,
          Number(evData.macro_threshold_multiplier ?? defaultMacroMultiplier)
        );

        if (theoretical > 0) {
          const macroThresholdSec = theoretical * macroMultiplier;
          finalType = stopSec >= macroThresholdSec ? "macrostop" : "microstop";
        } else {
          finalType = stopSec >= DEFAULT_MACROSTOP_SEC ? "macrostop" : "microstop";
        }
      } else {
        // missing duration -> conservative
        finalType = "microstop";
      }
    }

    if (!ALLOWED_TYPES.has(finalType)) {
      skipped.push({ reason: "type_not_allowed", typ: finalType, sev });
      continue;
    }

    const title =
      clampText(evRecord.title, 160) ||
      (finalType === "slow-cycle" ? "Slow Cycle Detected" :
       finalType === "macrostop" ? "Macrostop Detected" :
       finalType === "microstop" ? "Microstop Detected" :
       "Event");

    const description = clampText(evRecord.description, 1000);

    // store full blob, ensure object
    const rawData = evRecord.data ?? evRecord;
    const parsedData = typeof rawData === "string"
      ? (() => {
          try {
            return JSON.parse(rawData);
          } catch {
            return { raw: rawData };
          }
        })()
      : rawData;
    const dataObj: Record<string, unknown> =
      parsedData && typeof parsedData === "object" && !Array.isArray(parsedData)
        ? { ...(parsedData as Record<string, unknown>) }
        : { raw: parsedData };
    if (evRecord.status != null && dataObj.status == null) dataObj.status = evRecord.status;
    if (evRecord.alert_id != null && dataObj.alert_id == null) dataObj.alert_id = evRecord.alert_id;
    if (evRecord.is_update != null && dataObj.is_update == null) dataObj.is_update = evRecord.is_update;
    if (evRecord.is_auto_ack != null && dataObj.is_auto_ack == null) dataObj.is_auto_ack = evRecord.is_auto_ack;
    if (evReason && dataObj.reason == null) dataObj.reason = evReason;
    if (evDowntime && dataObj.downtime == null) dataObj.downtime = evDowntime;

    const activeWorkOrder = asRecord(evRecord.activeWorkOrder);
    const dataActiveWorkOrder = asRecord(evData.activeWorkOrder);

    const row = await prisma.machineEvent.create({
      data: {
        orgId: machine.orgId,
        machineId: machine.id,
        ts,
        topic: clampText(evRecord.topic ?? finalType, 64) ?? finalType,
        eventType: finalType,
        severity: sev,
        requiresAck: !!evRecord.requires_ack,
        title,
        description,
        data: toJsonValue(dataObj),
        workOrderId:
          clampText(evRecord.work_order_id, 64) ??
          clampText(evData.work_order_id, 64) ??
          clampText(activeWorkOrder?.id, 64) ??
          clampText(dataActiveWorkOrder?.id, 64) ??
          null,
        sku:
          clampText(evRecord.sku, 64) ??
          clampText(evData.sku, 64) ??
          clampText(activeWorkOrder?.sku, 64) ??
          clampText(dataActiveWorkOrder?.sku, 64) ??
          null,
      },
    });

    created.push({ id: row.id, ts: row.ts, eventType: row.eventType });

    if (evReason) {
      const inferredKind: ReasonCatalogKind =
        String(evReason.type ?? "").toLowerCase() === "scrap" || finalType === "scrap-manual-entry"
          ? "scrap"
          : "downtime";
      const resolved = resolveReason(evReason, inferredKind, reasonCatalog, reasonCatalog.version);

      if (resolved.reasonCode) {
        const reasonId =
          clampText(evReason.reasonId, 128) ??
          (inferredKind === "downtime"
            ? `evt:${machine.id}:downtime:${clampText(evReason.incidentKey ?? evDowntime?.incidentKey, 128) ?? row.id}`
            : `evt:${machine.id}:scrap:${clampText(evReason.scrapEntryId, 128) ?? row.id}`);

        const workOrderId =
          clampText(evRecord.work_order_id, 64) ??
          clampText(evData.work_order_id, 64) ??
          clampText(evRecord.workOrderId, 64) ??
          null;

        const commonWrite = {
          reasonCode: resolved.reasonCode,
          reasonLabel: resolved.reasonLabel ?? resolved.reasonCode,
          reasonText: resolved.reasonText ?? null,
          capturedAt: row.ts,
          workOrderId,
          schemaVersion: Math.max(1, Math.trunc(resolved.catalogVersion)),
          meta: toJsonValue({
            source: "ingest:event",
            eventId: row.id,
            eventType: row.eventType,
            incidentKey: clampText(evReason.incidentKey ?? evDowntime?.incidentKey, 128),
            anomalyType:
              clampText(evRecord.anomalyType, 64) ??
              clampText(evDowntime?.anomalyType, 64) ??
              clampText(evRecord.anomaly_type, 64),
            reason: {
              type: resolved.type,
              categoryId: resolved.categoryId,
              categoryLabel: resolved.categoryLabel,
              detailId: resolved.detailId,
              detailLabel: resolved.detailLabel,
              reasonText: resolved.reasonText,
              catalogVersion: resolved.catalogVersion,
            },
          }),
        };

        if (inferredKind === "downtime") {
          const incidentKey = clampText(evReason.incidentKey ?? evDowntime?.incidentKey, 128) ?? row.id;
          const durationSeconds =
            numberFrom(evDowntime?.durationSeconds) ??
            numberFrom(evData.stoppage_duration_seconds) ??
            numberFrom(evData.stop_duration_seconds) ??
            null;
          const episodeEndTsMs =
            numberFrom(evDowntime?.episodeEndTsMs) ??
            numberFrom(evDowntime?.acknowledgedAtMs) ??
            null;

          await prisma.reasonEntry.upsert({
            where: { reasonId },
            create: {
              orgId: machine.orgId,
              machineId: machine.id,
              reasonId,
              kind: "downtime",
              episodeId: incidentKey,
              durationSeconds: durationSeconds != null ? Math.max(0, Math.trunc(durationSeconds)) : null,
              episodeEndTs: episodeEndTsMs != null ? new Date(episodeEndTsMs) : null,
              ...commonWrite,
            },
            update: {
              kind: "downtime",
              episodeId: incidentKey,
              durationSeconds: durationSeconds != null ? Math.max(0, Math.trunc(durationSeconds)) : null,
              episodeEndTs: episodeEndTsMs != null ? new Date(episodeEndTsMs) : null,
              ...commonWrite,
            },
          });
        } else {
          const scrapEntryId =
            clampText(evReason.scrapEntryId, 128) ??
            clampText(evRecord.id, 128) ??
            clampText(evRecord.eventId, 128) ??
            row.id;
          const scrapQtyRaw =
            numberFrom(evRecord.scrapDelta) ??
            numberFrom(evData.scrapDelta) ??
            numberFrom(evData.scrap_delta) ??
            0;
          const scrapQty = Math.max(0, Math.trunc(scrapQtyRaw));

          await prisma.reasonEntry.upsert({
            where: { reasonId },
            create: {
              orgId: machine.orgId,
              machineId: machine.id,
              reasonId,
              kind: "scrap",
              scrapEntryId,
              scrapQty,
              scrapUnit: clampText(evReason.scrapUnit, 16) ?? null,
              ...commonWrite,
            },
            update: {
              kind: "scrap",
              scrapEntryId,
              scrapQty,
              scrapUnit: clampText(evReason.scrapUnit, 16) ?? null,
              ...commonWrite,
            },
          });
        }
      }
    }

    try {
      if (row.eventType !== "downtime-acknowledged" && row.eventType !== "scrap-manual-entry") {
        await evaluateAlertsForEvent(row.id);
      }
    } catch (err) {
      console.error("[alerts] evaluation failed", err);
    }
  }

  return NextResponse.json({ ok: true, createdCount: created.length, created, skippedCount: skipped.length, skipped });
}
