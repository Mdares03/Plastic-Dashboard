import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import {
  defaultSchedule,
  normalizeSchedule,
  REPORT_TYPES,
  type ReportType,
} from "@/lib/reports/schedule";

/**
 * Per-org report schedule UI backend (item 1). Admin/owner only.
 *
 *   GET  -> { schedules: { [reportType]: schedule } } for all report kinds (defaults
 *           synthesized for kinds with no row yet).
 *   PUT  { reportType, enabled, frequency, recipients[], hourUtc, dayOfWeek, dayOfMonth }
 *        -> upserts that org's row for one report kind.
 */

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

function serialize(reportType: ReportType, row: Parameters<typeof normalizeSchedule>[1]) {
  const s = normalizeSchedule(reportType, row);
  return {
    reportType: s.reportType,
    enabled: s.enabled,
    frequency: s.frequency,
    recipients: s.recipients,
    hourUtc: s.hourUtc,
    dayOfWeek: s.dayOfWeek,
    dayOfMonth: s.dayOfMonth,
    lastSentAt: s.lastSentAt ? s.lastSentAt.toISOString() : null,
  };
}

export async function GET() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId } = auth.session;

  const rows = await prisma.orgReportSchedule.findMany({ where: { orgId } });
  const byType = new Map(rows.map((r) => [r.reportType, r]));

  const schedules = Object.fromEntries(
    REPORT_TYPES.map((type) => [type, serialize(type, byType.get(type) ?? null)])
  );

  return NextResponse.json({ ok: true, schedules });
}

function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && (REPORT_TYPES as string[]).includes(value);
}

function parseRecipients(value: unknown): { ok: true; emails: string[] } | { ok: false } {
  if (value == null) return { ok: true, emails: [] };
  if (!Array.isArray(value)) return { ok: false };
  const emails: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return { ok: false };
    const trimmed = item.trim();
    if (!trimmed) continue;
    // Light validation — the dispatcher dedupes/validates again before sending.
    if (!trimmed.includes("@") || /\s/.test(trimmed)) return { ok: false };
    emails.push(trimmed);
  }
  return { ok: true, emails };
}

export async function PUT(req: Request) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId, userId } = auth.session;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return bad(400, "Invalid payload");

  const reportType = (body as { reportType?: unknown }).reportType;
  if (!isReportType(reportType)) return bad(400, "Invalid reportType");

  const fallback = defaultSchedule(reportType);

  const frequency = (body as { frequency?: unknown }).frequency;
  if (frequency !== undefined && frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly") {
    return bad(400, "Invalid frequency");
  }

  const recipientsParsed = parseRecipients((body as { recipients?: unknown }).recipients);
  if (!recipientsParsed.ok) return bad(400, "Invalid recipients");

  const enabled = (body as { enabled?: unknown }).enabled;
  if (enabled !== undefined && typeof enabled !== "boolean") return bad(400, "Invalid enabled");

  const numOrNull = (v: unknown, min: number, max: number): number | null | undefined => {
    if (v === null) return null;
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) return undefined;
    return Math.trunc(n);
  };

  const hourUtcRaw = (body as { hourUtc?: unknown }).hourUtc;
  const hourUtc = hourUtcRaw === undefined ? undefined : numOrNull(hourUtcRaw, 0, 23);
  if (hourUtcRaw !== undefined && hourUtc == null) return bad(400, "Invalid hourUtc");

  const dayOfWeek = numOrNull((body as { dayOfWeek?: unknown }).dayOfWeek, 0, 6);
  const dayOfMonth = numOrNull((body as { dayOfMonth?: unknown }).dayOfMonth, 1, 28);

  const data = {
    enabled: typeof enabled === "boolean" ? enabled : fallback.enabled,
    frequency: (frequency as string | undefined) ?? fallback.frequency,
    recipients: recipientsParsed.emails,
    hourUtc: hourUtc ?? fallback.hourUtc,
    dayOfWeek: dayOfWeek === undefined ? fallback.dayOfWeek : dayOfWeek,
    dayOfMonth: dayOfMonth === undefined ? fallback.dayOfMonth : dayOfMonth,
    updatedBy: userId,
  };

  const saved = await prisma.orgReportSchedule.upsert({
    where: { orgId_reportType: { orgId, reportType } },
    create: { orgId, reportType, ...data },
    update: data,
  });

  return NextResponse.json({ ok: true, schedule: serialize(reportType, saved) });
}
