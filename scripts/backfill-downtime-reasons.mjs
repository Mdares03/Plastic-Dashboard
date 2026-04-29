#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const NON_AUTHORITATIVE_REASON_CODES = new Set(["PENDIENTE", "UNCLASSIFIED"]);

function parseArgs(argv) {
  const out = {
    dryRun: false,
    since: "30d",
    orgId: null,
    machineId: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (token === "--since") {
      out.since = argv[i + 1] || out.since;
      i += 1;
      continue;
    }
    if (token === "--org-id") {
      out.orgId = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (token === "--machine-id") {
      out.machineId = argv[i + 1] || null;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return out;
}

function parseSince(value) {
  const now = Date.now();
  const text = String(value || "30d").trim().toLowerCase();
  const relative = text.match(/^(\d+)\s*([dhm])$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const factor = unit === "d" ? 24 * 60 * 60 * 1000 : unit === "h" ? 60 * 60 * 1000 : 60 * 1000;
    return new Date(now - amount * factor);
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Invalid --since value: ${value}. Use ISO date, or relative like 30d / 12h / 90m.`);
  }
  return dt;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function clampText(value, maxLen) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function canonicalId(input) {
  const text = String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || null;
}

function toReasonCode(categoryId, detailId) {
  const cat = canonicalId(categoryId);
  const det = canonicalId(detailId);
  if (!cat || !det) return null;
  return `${cat}__${det}`.toUpperCase();
}

function isNonAuthoritativeReasonCode(code) {
  const normalized = clampText(code, 64)?.toUpperCase();
  return !!normalized && NON_AUTHORITATIVE_REASON_CODES.has(normalized);
}

function extractReasonPayload(data) {
  const rec = asRecord(data);
  if (!rec) return null;
  const direct = asRecord(rec.reason);
  if (direct) return direct;
  const downtime = asRecord(rec.downtime);
  const nested = asRecord(downtime?.reason);
  return nested || null;
}

function extractIncidentKey(data, reason) {
  const rec = asRecord(data);
  const downtime = asRecord(rec?.downtime);
  return (
    clampText(rec?.incidentKey, 128) ??
    clampText(downtime?.incidentKey, 128) ??
    clampText(reason?.incidentKey, 128) ??
    null
  );
}

function normalizeAckReason(reasonRaw) {
  const categoryId = clampText(reasonRaw?.categoryId, 64);
  const detailId = clampText(reasonRaw?.detailId, 64);
  const categoryLabel = clampText(reasonRaw?.categoryLabel, 120);
  const detailLabel = clampText(reasonRaw?.detailLabel, 120);

  const reasonCode =
    clampText(reasonRaw?.reasonCode, 64)?.toUpperCase() ??
    toReasonCode(categoryId ?? categoryLabel, detailId ?? detailLabel) ??
    null;
  if (!reasonCode) return null;

  const reasonLabel =
    clampText(reasonRaw?.reasonText, 240) ??
    (categoryLabel && detailLabel ? `${categoryLabel} > ${detailLabel}` : null) ??
    detailLabel ??
    categoryLabel ??
    reasonCode;

  return {
    type: "downtime",
    categoryId,
    categoryLabel,
    detailId,
    detailLabel,
    reasonCode,
    reasonLabel,
    reasonText: reasonLabel,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = parseSince(args.since);

  const where = {
    eventType: "downtime-acknowledged",
    ts: { gte: since },
    ...(args.orgId ? { orgId: args.orgId } : {}),
    ...(args.machineId ? { machineId: args.machineId } : {}),
  };

  const ackEvents = await prisma.machineEvent.findMany({
    where,
    orderBy: { ts: "desc" },
    select: {
      id: true,
      orgId: true,
      machineId: true,
      ts: true,
      data: true,
    },
  });

  const latestByIncident = new Map();
  for (const event of ackEvents) {
    const reasonRaw = extractReasonPayload(event.data);
    if (!reasonRaw) continue;
    const normalized = normalizeAckReason(reasonRaw);
    if (!normalized) continue;
    if (isNonAuthoritativeReasonCode(normalized.reasonCode)) continue;

    const incidentKey = extractIncidentKey(event.data, reasonRaw);
    if (!incidentKey) continue;

    const mapKey = `${event.orgId}::${incidentKey}`;
    if (latestByIncident.has(mapKey)) continue;
    latestByIncident.set(mapKey, {
      orgId: event.orgId,
      machineId: event.machineId,
      incidentKey,
      eventId: event.id,
      eventTs: event.ts,
      reason: normalized,
    });
  }

  let scanned = 0;
  let candidates = 0;
  let updated = 0;
  let missingReasonEntry = 0;
  let alreadyManual = 0;
  let skippedNonPendingIncoming = 0;
  const samples = [];

  for (const item of latestByIncident.values()) {
    scanned += 1;
    const existing = await prisma.reasonEntry.findFirst({
      where: {
        orgId: item.orgId,
        kind: "downtime",
        episodeId: item.incidentKey,
      },
      select: {
        id: true,
        reasonCode: true,
        reasonLabel: true,
        reasonText: true,
        capturedAt: true,
        schemaVersion: true,
      },
    });

    if (!existing) {
      missingReasonEntry += 1;
      continue;
    }
    if (!isNonAuthoritativeReasonCode(existing.reasonCode)) {
      alreadyManual += 1;
      continue;
    }
    if (isNonAuthoritativeReasonCode(item.reason.reasonCode)) {
      skippedNonPendingIncoming += 1;
      continue;
    }

    candidates += 1;
    const next = {
      reasonCode: item.reason.reasonCode,
      reasonLabel: item.reason.reasonLabel ?? item.reason.reasonCode,
      reasonText: item.reason.reasonText ?? item.reason.reasonLabel ?? item.reason.reasonCode,
      schemaVersion: Math.max(1, Number(existing.schemaVersion || 1)),
      meta: {
        source: "backfill:downtime-acknowledged",
        eventId: item.eventId,
        eventTs: item.eventTs.toISOString(),
        incidentKey: item.incidentKey,
        reason: {
          type: "downtime",
          categoryId: item.reason.categoryId,
          categoryLabel: item.reason.categoryLabel,
          detailId: item.reason.detailId,
          detailLabel: item.reason.detailLabel,
          reasonText: item.reason.reasonText,
        },
      },
    };

    samples.push({
      reasonEntryId: existing.id,
      orgId: item.orgId,
      machineId: item.machineId,
      incidentKey: item.incidentKey,
      from: {
        reasonCode: existing.reasonCode,
        reasonLabel: existing.reasonLabel,
        reasonText: existing.reasonText,
      },
      to: {
        reasonCode: next.reasonCode,
        reasonLabel: next.reasonLabel,
        reasonText: next.reasonText,
      },
    });

    if (!args.dryRun) {
      await prisma.reasonEntry.update({
        where: { id: existing.id },
        data: next,
      });
      updated += 1;
    }
  }

  const summary = {
    ok: true,
    mode: args.dryRun ? "dry-run" : "apply",
    since: since.toISOString(),
    filters: {
      orgId: args.orgId,
      machineId: args.machineId,
    },
    eventsRead: ackEvents.length,
    incidentsDeduped: latestByIncident.size,
    scanned,
    candidates,
    updated,
    missingReasonEntry,
    alreadyManual,
    skippedNonPendingIncoming,
    sampleUpdates: samples.slice(0, 25),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error("[backfill-downtime-reasons] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

