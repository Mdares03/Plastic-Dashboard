import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildDowntimeActionReminderEmail, sendEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/appUrl";

const DEFAULT_DUE_DAYS = 7;
const DEFAULT_LIMIT = 100;
const MS_PER_HOUR = 60 * 60 * 1000;

type ReminderStage = "week" | "day" | "hour" | "overdue";

function formatDueDate(value?: Date | null) {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function getReminderStage(dueDate: Date, now: Date): ReminderStage | null {
  const diffMs = dueDate.getTime() - now.getTime();
  if (diffMs <= 0) return "overdue";
  if (diffMs <= MS_PER_HOUR) return "hour";
  if (diffMs <= 24 * MS_PER_HOUR) return "day";
  if (diffMs <= 7 * 24 * MS_PER_HOUR) return "week";
  return null;
}

function buildActionUrl(baseUrl: string, action: { machineId: string | null; reasonCode: string | null; hmDay: number | null; hmHour: number | null }) {
  const params = new URLSearchParams();
  if (action.machineId) params.set("machineId", action.machineId);
  if (action.reasonCode) params.set("reasonCode", action.reasonCode);
  if (action.hmDay != null && action.hmHour != null) {
    params.set("hmDay", String(action.hmDay));
    params.set("hmHour", String(action.hmHour));
  }
  const qs = params.toString();
  return qs ? `${baseUrl}/downtime?${qs}` : `${baseUrl}/downtime`;
}

type AuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function authorizeRequest(req: Request): AuthResult {
  const secret = process.env.DOWNTIME_ACTION_REMINDER_SECRET;
  // Fail-closed: this endpoint fans out emails across every org, so it is a
  // cron-only, secret-gated job. Without the secret configured there is no safe
  // caller — refuse rather than fall back to any logged-in session (which let
  // any member trigger an org-wide reminder blast).
  if (!secret) {
    return { ok: false, status: 503, error: "Reminder endpoint not configured" };
  }
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const urlToken = new URL(req.url).searchParams.get("token");
  if (token === secret || urlToken === secret) return { ok: true };
  return { ok: false, status: 401, error: "Unauthorized" };
}

export async function POST(req: Request) {
  const auth = authorizeRequest(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const sp = new URL(req.url).searchParams;
  const dueInDays = Number(sp.get("dueInDays") || DEFAULT_DUE_DAYS);
  const limit = Number(sp.get("limit") || DEFAULT_LIMIT);

  const now = new Date();
  const dueBy = new Date(now.getTime() + dueInDays * 24 * 60 * 60 * 1000);

  const actions = await prisma.downtimeAction.findMany({
    where: {
      status: { not: "done" },
      ownerUserId: { not: null },
      dueDate: { not: null, lte: dueBy },
    },
    include: {
      ownerUser: { select: { name: true, email: true } },
      org: { select: { name: true } },
    },
    orderBy: { dueDate: "asc" },
    take: Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : DEFAULT_LIMIT,
  });

  const baseUrl = getBaseUrl(req);
  const sentIds: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];

  for (const action of actions) {
    const email = action.ownerUser?.email;
    if (!email) continue;
    if (!action.dueDate) continue;
    const stage = getReminderStage(action.dueDate, now);
    if (!stage) continue;
    if (action.reminderStage === stage) continue;
    try {
      const content = buildDowntimeActionReminderEmail({
        appName: "MIS Control Tower",
        orgName: action.org.name,
        actionTitle: action.title,
        assigneeName: action.ownerUser?.name ?? email,
        dueDate: formatDueDate(action.dueDate),
        actionUrl: buildActionUrl(baseUrl, action),
        priority: action.priority,
        status: action.status,
      });
      await sendEmail({
        to: email,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
      sentIds.push(action.id);
      await prisma.downtimeAction.update({
        where: { id: action.id },
        data: { reminderStage: stage, lastReminderAt: now },
      });
    } catch (err: unknown) {
      failures.push({
        id: action.id,
        error: err instanceof Error ? err.message : "Failed to send reminder email",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    sent: sentIds.length,
    failed: failures.length,
    failures,
  });
}
