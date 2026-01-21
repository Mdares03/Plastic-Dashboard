import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { buildDowntimeActionAssignedEmail, sendEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/appUrl";

const STATUS = ["open", "in_progress", "blocked", "done"] as const;
const PRIORITY = ["low", "medium", "high"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const updateSchema = z.object({
  machineId: z.string().trim().min(1).optional().nullable(),
  reasonCode: z.string().trim().min(1).max(64).optional().nullable(),
  hmDay: z.number().int().min(0).max(6).optional().nullable(),
  hmHour: z.number().int().min(0).max(23).optional().nullable(),
  title: z.string().trim().min(1).max(160).optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
  ownerUserId: z.string().trim().min(1).optional().nullable(),
  dueDate: z.string().trim().regex(DATE_RE).optional().nullable(),
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
});

function parseDueDate(value?: string | null) {
  if (value === undefined) return undefined;
  if (!value) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDueDate(value?: Date | null) {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
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

function serializeAction(action: {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  machineId: string | null;
  reasonCode: string | null;
  hmDay: number | null;
  hmHour: number | null;
  title: string;
  notes: string | null;
  ownerUserId: string | null;
  dueDate: Date | null;
  status: string;
  priority: string;
  ownerUser?: { name: string | null; email: string } | null;
}) {
  return {
    id: action.id,
    createdAt: action.createdAt.toISOString(),
    updatedAt: action.updatedAt.toISOString(),
    machineId: action.machineId,
    reasonCode: action.reasonCode,
    hmDay: action.hmDay,
    hmHour: action.hmHour,
    title: action.title,
    notes: action.notes ?? "",
    ownerUserId: action.ownerUserId,
    ownerName: action.ownerUser?.name ?? null,
    ownerEmail: action.ownerUser?.email ?? null,
    dueDate: formatDueDate(action.dueDate),
    status: action.status,
    priority: action.priority,
  };
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid action payload" }, { status: 400 });
  }

  const data = parsed.data;
  if (("hmDay" in data || "hmHour" in data) && (data.hmDay == null) !== (data.hmHour == null)) {
    return NextResponse.json({ ok: false, error: "Heatmap requires hmDay and hmHour" }, { status: 400 });
  }

  const existing = await prisma.downtimeAction.findFirst({
    where: { id, orgId: session.orgId },
    include: { ownerUser: { select: { name: true, email: true } } },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Action not found" }, { status: 404 });
  }

  if (data.machineId) {
    const machine = await prisma.machine.findFirst({
      where: { id: data.machineId, orgId: session.orgId },
      select: { id: true },
    });
    if (!machine) {
      return NextResponse.json({ ok: false, error: "Invalid machineId" }, { status: 400 });
    }
  }

  let ownerMembership: { user: { name: string | null; email: string } } | null = null;
  if (data.ownerUserId) {
    ownerMembership = await prisma.orgUser.findUnique({
      where: { orgId_userId: { orgId: session.orgId, userId: data.ownerUserId } },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!ownerMembership) {
      return NextResponse.json({ ok: false, error: "Invalid ownerUserId" }, { status: 400 });
    }
  }

  let completedAt: Date | null | undefined = undefined;
  if ("status" in data) {
    completedAt = data.status === "done" ? existing.completedAt ?? new Date() : null;
  }

  const updateData: Prisma.DowntimeActionUncheckedUpdateInput = {};
  let shouldResetReminder = false;
  if ("machineId" in data) updateData.machineId = data.machineId;
  if ("reasonCode" in data) updateData.reasonCode = data.reasonCode;
  if ("hmDay" in data) updateData.hmDay = data.hmDay;
  if ("hmHour" in data) updateData.hmHour = data.hmHour;
  if ("title" in data) updateData.title = data.title?.trim();
  if ("notes" in data) updateData.notes = data.notes == null ? null : data.notes.trim() || null;
  if ("ownerUserId" in data) updateData.ownerUserId = data.ownerUserId;
  if ("dueDate" in data) {
    const nextDue = parseDueDate(data.dueDate);
    const prev = formatDueDate(existing.dueDate);
    const next = formatDueDate(nextDue ?? null);
    updateData.dueDate = nextDue;
    if (prev !== next) {
      shouldResetReminder = true;
    }
  }
  if ("status" in data) updateData.status = data.status;
  if ("priority" in data) updateData.priority = data.priority;
  if (completedAt !== undefined) updateData.completedAt = completedAt;
  if (shouldResetReminder) {
    updateData.reminderStage = null;
    updateData.lastReminderAt = null;
  }

  const updated = await prisma.downtimeAction.update({
    where: { id: existing.id },
    data: updateData,
    include: { ownerUser: { select: { name: true, email: true } } },
  });

  const ownerChanged = "ownerUserId" in data && data.ownerUserId !== existing.ownerUserId;
  const dueChanged =
    "dueDate" in data && formatDueDate(existing.dueDate) !== formatDueDate(updated.dueDate);

  let emailSent = false;
  let emailError: string | null = null;
  if ((ownerChanged || dueChanged) && updated.ownerUser?.email) {
    try {
      const org = await prisma.org.findUnique({
        where: { id: session.orgId },
        select: { name: true },
      });
      const baseUrl = getBaseUrl(req);
      const actionUrl = buildActionUrl(baseUrl, updated);
      const content = buildDowntimeActionAssignedEmail({
        appName: "MIS Control Tower",
        orgName: org?.name || "your organization",
        actionTitle: updated.title,
        assigneeName: updated.ownerUser.name ?? updated.ownerUser.email,
        dueDate: formatDueDate(updated.dueDate),
        actionUrl,
        priority: updated.priority,
        status: updated.status,
      });
      await sendEmail({
        to: updated.ownerUser.email,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
      emailSent = true;
    } catch (err: unknown) {
      emailError = err instanceof Error ? err.message : "Failed to send assignment email";
    }
  }

  return NextResponse.json({
    ok: true,
    action: serializeAction(updated),
    emailSent,
    emailError,
  });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const existing = await prisma.downtimeAction.findFirst({
    where: { id, orgId: session.orgId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Action not found" }, { status: 404 });
  }

  await prisma.downtimeAction.delete({ where: { id: existing.id } });

  return NextResponse.json({ ok: true });
}
