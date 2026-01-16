import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { AlertPolicySchema, DEFAULT_POLICY } from "@/lib/alerts/policy";

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

async function shouldSendNotification(params: {
  eventIds: string[];
  ruleId: string;
  role: string;
  channel: string;
  contactId?: string;
  userId?: string;
  repeatMinutes?: number;
}) {
  const existing = await prisma.alertNotification.findFirst({
    where: {
      eventId: { in: params.eventIds },
      ruleId: params.ruleId,
      role: params.role,
      channel: params.channel,
      ...(params.contactId ? { contactId: params.contactId } : {}),
      ...(params.userId ? { userId: params.userId } : {}),
    },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });

  if (!existing) return true;
  const repeatMin = Number(params.repeatMinutes ?? 0);
  if (!repeatMin || repeatMin <= 0) return false;
  const elapsed = Date.now() - new Date(existing.sentAt).getTime();
  return elapsed >= repeatMin * 60 * 1000;
}

async function resolveAlertEventIds(orgId: string, alertId: string, fallbackId: string) {
  const events = await prisma.machineEvent.findMany({
    where: {
      orgId,
      data: {
        path: ["alert_id"],
        equals: alertId,
      },
    },
    select: { id: true },
  });
  const ids = events.map((row) => row.id);
  if (!ids.includes(fallbackId)) ids.push(fallbackId);
  return ids;
}

async function recordNotification(params: {
  orgId: string;
  machineId: string;
  eventId: string;
  eventType: string;
  ruleId: string;
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
  const eventType = normalizeEventType(event.eventType);
  const rule = policy.rules.find((r) => normalizeEventType(r.eventType) === eventType);
  if (!rule) return;

  const { payload, inner } = unwrapEventData(event.data);
  const alertId = readString(payload?.alert_id ?? inner?.alert_id);
  const isUpdate = readBool(payload?.is_update ?? inner?.is_update);
  const isAutoAck = readBool(payload?.is_auto_ack ?? inner?.is_auto_ack);
  const lastCycleTs = readNumber(payload?.last_cycle_timestamp ?? inner?.last_cycle_timestamp);
  const theoreticalSec = readNumber(payload?.theoretical_cycle_time ?? inner?.theoretical_cycle_time);
  if (isAutoAck) return;
  if (isUpdate && !(rule.repeatMinutes && rule.repeatMinutes > 0)) return;
  if ((eventType === "microstop" || eventType === "macrostop") && theoreticalSec && lastCycleTs == null) {
    return;
  }

  const durationSec = extractDurationSec(event.data);
  const durationMin = durationSec != null ? durationSec / 60 : 0;
  const machine = await prisma.machine.findUnique({
    where: { id: event.machineId },
    select: { name: true, code: true },
  });
  const delivered = new Set<string>();
  const notificationEventIds = alertId
    ? await resolveAlertEventIds(event.orgId, alertId, event.id)
    : [event.id];

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

    for (const recipient of recipients) {
      for (const channel of roleRule.channels ?? []) {
        const canSend =
          channel === "email" ? !!recipient.email : channel === "sms" ? !!recipient.phone : false;
        if (!canSend) continue;
        const key = `${channel}:${recipient.userId ?? recipient.contactId ?? recipient.email ?? recipient.phone ?? ""}`;
        if (delivered.has(key)) continue;

        const allowed = await shouldSendNotification({
          eventIds: notificationEventIds,
          ruleId: rule.id,
          role: roleName,
          channel,
          contactId: recipient.contactId,
          userId: recipient.userId,
          repeatMinutes: rule.repeatMinutes,
        });
        if (!allowed) continue;

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
            ruleId: rule.id,
            role: roleName,
            channel,
            contactId: recipient.contactId,
            userId: recipient.userId,
            status: "sent",
          });
          delivered.add(key);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "notification_failed";
          await recordNotification({
            orgId: event.orgId,
            machineId: event.machineId,
            eventId: event.id,
            eventType,
            ruleId: rule.id,
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
