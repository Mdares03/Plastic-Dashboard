import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { AlertPolicySchema, DEFAULT_POLICY } from "@/lib/alerts/policy";
import { checkCircuitBreaker, shouldNotifyIncident } from "@/lib/alerts/throttle";

const HOUR_MS = 60 * 60 * 1000;

type Recipient = {
  userId?: string;
  contactId?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role: string;
};

function normalizeEventType(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return raw;
  const cleaned = raw.replace(/[_\s]+/g, "-").replace(/-+/g, "-");
  if (cleaned === "micro-stop") return "microstop";
  if (cleaned === "macro-stop") return "macrostop";
  if (cleaned === "slowcycle") return "slow-cycle";
  return cleaned;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function unwrapEventData(raw: unknown) {
  const payload = asRecord(raw);
  const inner = asRecord(payload?.data) ?? payload;
  return { payload, inner };
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function readBool(value: unknown) {
  return value === true;
}

function normalizeStatus(value?: string | null) {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "in_progress" || raw === "in-progress" || raw === "open" || raw === "activa" || raw === "activo") {
    return "active";
  }
  if (raw === "resuelta" || raw === "resuelto" || raw === "closed" || raw === "ended" || raw === "done") {
    return "resolved";
  }
  return raw;
}

function extractDurationSec(raw: unknown): number | null {
  const payload = asRecord(raw);
  if (!payload) return null;
  const data = asRecord(payload.data) ?? payload;
  const candidates = [
    data?.duration_seconds,
    data?.duration_sec,
    data?.stoppage_duration_seconds,
    data?.stop_duration_seconds,
  ];
  for (const val of candidates) {
    if (typeof val === "number" && Number.isFinite(val) && val >= 0) return val;
  }

  const msCandidates = [data?.duration_ms, data?.durationMs];
  for (const val of msCandidates) {
    if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
      return Math.round(val / 1000);
    }
  }

  const startMs = data?.start_ts ?? data?.startTs ?? null;
  const endMs = data?.end_ts ?? data?.endTs ?? null;
  if (typeof startMs === "number" && typeof endMs === "number" && endMs >= startMs) {
    return Math.round((endMs - startMs) / 1000);
  }

  return null;
}

async function ensurePolicy(orgId: string) {
  const existing = await prisma.alertPolicy.findUnique({
    where: { orgId },
    select: { id: true, policyJson: true },
  });
  if (existing) {
    const parsed = AlertPolicySchema.safeParse(existing.policyJson);
    return parsed.success ? parsed.data : DEFAULT_POLICY;
  }

  await prisma.alertPolicy.create({
    data: {
      orgId,
      policyJson: DEFAULT_POLICY,
    },
  });

  return DEFAULT_POLICY;
}

async function loadRecipients(orgId: string, role: string, eventType: string): Promise<Recipient[]> {
  const roleUpper = role.toUpperCase();
  const normalizedEventType = normalizeEventType(eventType);
  const [members, external] = await Promise.all([
    prisma.orgUser.findMany({
      where: { orgId, role: roleUpper },
      select: {
        userId: true,
        user: { select: { name: true, email: true, phone: true, isActive: true } },
      },
    }),
    prisma.alertContact.findMany({
      where: {
        orgId,
        isActive: true,
        OR: [{ roleScope: roleUpper }, { roleScope: "CUSTOM" }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        eventTypes: true,
      },
    }),
  ]);

  const memberRecipients = members
    .filter((m) => m.user?.isActive !== false)
    .map((m) => ({
      userId: m.userId,
      name: m.user?.name ?? null,
      email: m.user?.email ?? null,
      phone: m.user?.phone ?? null,
      role: roleUpper,
    }));

  const externalRecipients = external
    .filter((c) => {
      const types = Array.isArray(c.eventTypes) ? c.eventTypes : null;
      if (!types || !types.length) return true;
      return types.some((type) => normalizeEventType(type) === normalizedEventType);
    })
    .map((c) => ({
      contactId: c.id,
      name: c.name ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      role: roleUpper,
    }));

  return [...memberRecipients, ...externalRecipients];
}

function buildAlertMessage(params: {
  machineName: string;
  machineCode?: string | null;
  eventType: string;
  title: string;
  description?: string | null;
  durationMin?: number | null;
}) {
  const durationLabel =
    params.durationMin != null ? `${Math.round(params.durationMin)} min` : "n/a";
  const subject = `[MIS] ${params.eventType} - ${params.machineName}`;
  const text = [
    `Machine: ${params.machineName}${params.machineCode ? ` (${params.machineCode})` : ""}`,
    `Event: ${params.eventType}`,
    `Title: ${params.title}`,
    params.description ? `Description: ${params.description}` : null,
    `Duration: ${durationLabel}`,
  ]
    .filter(Boolean)
    .join("\n");
  const html = text.replace(/\n/g, "<br/>");
  return { subject, text, html };
}

/**
 * Last delivered notification for this exact (incidentKey, statusKey, role,
 * channel, recipient) tuple — the per-incident dedup state fed to throttle.
 */
async function lastSentAtFor(params: {
  orgId: string;
  incidentKey: string;
  statusKey: "active" | "resolved";
  role: string;
  channel: string;
  contactId?: string;
  userId?: string;
}): Promise<Date | null> {
  const existing = await prisma.alertNotification.findFirst({
    where: {
      orgId: params.orgId,
      incidentKey: params.incidentKey,
      status: "sent",
      // ruleId encodes the status phase ("<ruleId>:active" | ":resolved")
      ruleId: { endsWith: `:${params.statusKey}` },
      role: params.role,
      channel: params.channel,
      ...(params.contactId ? { contactId: params.contactId } : {}),
      ...(params.userId ? { userId: params.userId } : {}),
    },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  return existing?.sentAt ?? null;
}

/** Count delivered (status='sent') notifications in the last hour, org-wide. */
async function orgSentLastHour(orgId: string, since: Date): Promise<number> {
  return prisma.alertNotification.count({
    where: { orgId, status: "sent", sentAt: { gte: since } },
  });
}

/** Count delivered notifications in the last hour for one recipient. */
async function contactSentLastHour(
  params: { orgId: string; contactId?: string; userId?: string },
  since: Date,
): Promise<number> {
  if (!params.contactId && !params.userId) return 0;
  return prisma.alertNotification.count({
    where: {
      orgId: params.orgId,
      status: "sent",
      sentAt: { gte: since },
      ...(params.contactId ? { contactId: params.contactId } : {}),
      ...(params.userId ? { userId: params.userId } : {}),
    },
  });
}

async function recordNotification(params: {
  orgId: string;
  machineId: string;
  eventId: string;
  eventType: string;
  ruleId: string;
  incidentKey: string;
  role: string;
  channel: string;
  contactId?: string;
  userId?: string;
  status: string;
  error?: string | null;
}) {
  await prisma.alertNotification.create({
    data: {
      orgId: params.orgId,
      machineId: params.machineId,
      eventId: params.eventId,
      eventType: params.eventType,
      ruleId: params.ruleId,
      incidentKey: params.incidentKey,
      role: params.role,
      channel: params.channel,
      contactId: params.contactId ?? null,
      userId: params.userId ?? null,
      status: params.status,
      error: params.error ?? null,
    },
  });
}

async function emitFailureEvent(params: {
  orgId: string;
  machineId: string;
  eventType: string;
  role: string;
  channel: string;
  error: string;
}) {
  await prisma.machineEvent.create({
    data: {
      orgId: params.orgId,
      machineId: params.machineId,
      ts: new Date(),
      topic: "alert-delivery-failed",
      eventType: "alert-delivery-failed",
      severity: "critical",
      requiresAck: true,
      title: "Alert delivery failed",
      description: params.error,
      data: {
        sourceEventType: params.eventType,
        role: params.role,
        channel: params.channel,
        error: params.error,
      },
    },
  });
}

export async function evaluateAlertsForEvent(eventId: string) {
  const event = await prisma.machineEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      orgId: true,
      machineId: true,
      eventType: true,
      title: true,
      description: true,
      data: true,
    },
  });
  if (!event) return;

  const policy = await ensurePolicy(event.orgId);
  // Master kill switch: when alerts are disabled for the org, send nothing.
  if (!policy.enabled) return;
  const eventType = normalizeEventType(event.eventType);
  const rule = policy.rules.find((r) => normalizeEventType(r.eventType) === eventType);
  if (!rule) return;

  const { payload, inner } = unwrapEventData(event.data);
  const alertId = readString(payload?.alert_id ?? inner?.alert_id);
  const isUpdate = readBool(payload?.is_update ?? inner?.is_update);
  const isAutoAck = readBool(payload?.is_auto_ack ?? inner?.is_auto_ack);
  const status = normalizeStatus(readString(payload?.status ?? inner?.status));
  const lastCycleTs = readNumber(payload?.last_cycle_timestamp ?? inner?.last_cycle_timestamp);
  const theoreticalSec = readNumber(payload?.theoretical_cycle_time ?? inner?.theoretical_cycle_time);
  if (isAutoAck) return;
  if (isUpdate && status !== "resolved") return;
  if ((eventType === "microstop" || eventType === "macrostop") && theoreticalSec && lastCycleTs == null) {
    return;
  }

  const durationSec = extractDurationSec(event.data);
  const durationMin = durationSec != null ? durationSec / 60 : 0;
  const machine = await prisma.machine.findUnique({
    where: { id: event.machineId },
    select: { name: true, code: true },
  });

  // Incident identity: the edge's unified incidentKey (the whole point of this
  // overhaul). Fall back to alert_id, then a per-event key so a keyless event is
  // still circuit-broken even if it can't be incident-deduped.
  const incidentKey =
    readString(payload?.incidentKey ?? payload?.incident_key ?? inner?.incidentKey ?? inner?.incident_key) ||
    alertId ||
    `${eventType}:${event.id}`;
  const statusKey: "active" | "resolved" = status === "resolved" ? "resolved" : "active";
  const now = new Date();
  const since = new Date(now.getTime() - HOUR_MS);

  const incidentWhere = {
    orgId_machineId_incidentKey: {
      orgId: event.orgId,
      machineId: event.machineId,
      incidentKey,
    },
  };
  await prisma.alertIncident.upsert({
    where: incidentWhere,
    create: {
      orgId: event.orgId,
      machineId: event.machineId,
      incidentKey,
      eventType,
      status: statusKey,
      firstSeen: now,
      lastSeen: now,
      ...(statusKey === "resolved" ? { resolvedAt: now } : {}),
    },
    update: {
      lastSeen: now,
      eventType,
      ...(statusKey === "resolved" ? { status: "resolved", resolvedAt: now } : {}),
    },
  });

  // Circuit-breaker running counts: org baseline fetched once, per-recipient
  // baseline fetched per recipient; both incremented locally as we send within
  // this evaluation so caps hold even for a fan-out to many recipients.
  let orgSent = await orgSentLastHour(event.orgId, since);
  const localContactSent = new Map<string, number>();
  const delivered = new Set<string>();

  for (const [roleName, roleRule] of Object.entries(rule.roles)) {
    if (!roleRule?.enabled) continue;
    if (durationMin < Number(roleRule.afterMinutes ?? 0)) continue;

    const recipients = await loadRecipients(event.orgId, roleName, eventType);
    if (!recipients.length) continue;

    const message = buildAlertMessage({
      machineName: machine?.name ?? "Unknown Machine",
      machineCode: machine?.code ?? null,
      eventType,
      title: event.title ?? "Alert",
      description: event.description ?? null,
      durationMin,
    });

    const recipientId = (r: (typeof recipients)[number]) =>
      r.userId ?? r.contactId ?? r.email ?? r.phone ?? "";

    for (const recipient of recipients) {
      // Per-recipient hourly baseline (shared across this recipient's channels).
      const rKey = recipientId(recipient);
      if (!localContactSent.has(rKey)) {
        localContactSent.set(
          rKey,
          await contactSentLastHour(
            { orgId: event.orgId, contactId: recipient.contactId, userId: recipient.userId },
            since,
          ),
        );
      }

      for (const channel of roleRule.channels ?? []) {
        const canSend =
          channel === "email" ? !!recipient.email : channel === "sms" ? !!recipient.phone : false;
        if (!canSend) continue;
        const key = `${channel}:${rKey}`;
        if (delivered.has(key)) continue;

        const ruleKey = `${rule.id}:${statusKey}`;

        // Gate 1 — per-incident dedup: one active + one resolved per recipient/
        // channel (active repeats only after repeatMinutes).
        const lastSentAt = await lastSentAtFor({
          orgId: event.orgId,
          incidentKey,
          statusKey,
          role: roleName,
          channel,
          contactId: recipient.contactId,
          userId: recipient.userId,
        });
        if (
          !shouldNotifyIncident({
            state: { lastSentAt },
            statusKey,
            repeatMinutes: rule.repeatMinutes,
            now,
          })
        ) {
          continue;
        }

        // Gate 2 — circuit breaker: hard hourly ceilings per contact and per org.
        const breaker = checkCircuitBreaker({
          contactSentLastHour: localContactSent.get(rKey) ?? 0,
          orgSentLastHour: orgSent,
          maxPerContactPerHour: policy.maxPerContactPerHour,
          maxPerOrgPerHour: policy.maxPerOrgPerHour,
        });
        if (!breaker.allowed) {
          await recordNotification({
            orgId: event.orgId,
            machineId: event.machineId,
            eventId: event.id,
            eventType,
            ruleId: ruleKey,
            incidentKey,
            role: roleName,
            channel,
            contactId: recipient.contactId,
            userId: recipient.userId,
            status: "suppressed",
            error: breaker.reason,
          });
          await prisma.alertIncident.update({
            where: incidentWhere,
            data: { suppressedCount: { increment: 1 } },
          });
          continue;
        }

        try {
          if (channel === "email") {
            await sendEmail({
              to: recipient.email as string,
              subject: message.subject,
              text: message.text,
              html: message.html,
            });
          } else if (channel === "sms") {
            await sendSms({
              to: recipient.phone as string,
              body: message.text,
            });
          }

          await recordNotification({
            orgId: event.orgId,
            machineId: event.machineId,
            eventId: event.id,
            eventType,
            ruleId: ruleKey,
            incidentKey,
            role: roleName,
            channel,
            contactId: recipient.contactId,
            userId: recipient.userId,
            status: "sent",
          });
          delivered.add(key);
          orgSent += 1;
          localContactSent.set(rKey, (localContactSent.get(rKey) ?? 0) + 1);
          await prisma.alertIncident.update({
            where: incidentWhere,
            data: { notifyCount: { increment: 1 }, lastNotifiedAt: now },
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "notification_failed";
          await recordNotification({
            orgId: event.orgId,
            machineId: event.machineId,
            eventId: event.id,
            eventType,
            ruleId: ruleKey,
            incidentKey,
            role: roleName,
            channel,
            contactId: recipient.contactId,
            userId: recipient.userId,
            status: "failed",
            error: msg,
          });
          await emitFailureEvent({
            orgId: event.orgId,
            machineId: event.machineId,
            eventType,
            role: roleName,
            channel,
            error: msg,
          });
        }
      }
    }
  }
}
