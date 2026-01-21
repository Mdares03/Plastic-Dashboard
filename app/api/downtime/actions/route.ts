import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { buildDowntimeActionAssignedEmail, sendEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/appUrl";

const STATUS = ["open", "in_progress", "blocked", "done"] as const;
const PRIORITY = ["low", "medium", "high"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  machineId: z.string().trim().min(1).optional().nullable(),
  reasonCode: z.string().trim().min(1).max(64).optional().nullable(),
  hmDay: z.number().int().min(0).max(6).optional().nullable(),
  hmHour: z.number().int().min(0).max(23).optional().nullable(),
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(4000).optional().nullable(),
  ownerUserId: z.string().trim().min(1).optional().nullable(),
  dueDate: z.string().trim().regex(DATE_RE).optional().nullable(),
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
});

function parseDueDate(value?: string | null) {
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

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const machineId = sp.get("machineId");
  const reasonCode = sp.get("reasonCode");
  const hmDayStr = sp.get("hmDay");
  const hmHourStr = sp.get("hmHour");

  const hmDay = hmDayStr != null ? Number(hmDayStr) : null;
  const hmHour = hmHourStr != null ? Number(hmHourStr) : null;
  if ((hmDayStr != null || hmHourStr != null) && (!Number.isFinite(hmDay) || !Number.isFinite(hmHour))) {
    return NextResponse.json({ ok: false, error: "Invalid heatmap selection" }, { status: 400 });
  }
  if ((hmDayStr != null || hmHourStr != null) && (hmDay == null || hmHour == null)) {
    return NextResponse.json({ ok: false, error: "Heatmap requires hmDay and hmHour" }, { status: 400 });
  }

  const where: {
    orgId: string;
    AND?: Array<Record<string, unknown>>;
  } = { orgId: session.orgId };

  if (machineId) {
    where.AND = [...(where.AND ?? []), { OR: [{ machineId }, { machineId: null }] }];
  }

  if (reasonCode) {
    where.AND = [...(where.AND ?? []), { OR: [{ reasonCode }, { reasonCode: null }] }];
  }

  if (hmDay != null && hmHour != null) {
    where.AND = [
      ...(where.AND ?? []),
      { OR: [{ hmDay, hmHour }, { hmDay: null, hmHour: null }] },
    ];
  }

  const actions = await prisma.downtimeAction.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { ownerUser: { select: { name: true, email: true } } },
  });

  return NextResponse.json({
    ok: true,
    actions: actions.map(serializeAction),
  });
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid action payload" }, { status: 400 });
  }

  const data = parsed.data;
  if ((data.hmDay == null) !== (data.hmHour == null)) {
    return NextResponse.json({ ok: false, error: "Heatmap requires hmDay and hmHour" }, { status: 400 });
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

  const created = await prisma.downtimeAction.create({
    data: {
      orgId: session.orgId,
      machineId: data.machineId ?? null,
      reasonCode: data.reasonCode ?? null,
      hmDay: data.hmDay ?? null,
      hmHour: data.hmHour ?? null,
      title: data.title.trim(),
      notes: data.notes?.trim() || null,
      ownerUserId: data.ownerUserId ?? null,
      dueDate: parseDueDate(data.dueDate),
      status: data.status ?? "open",
      priority: data.priority ?? "medium",
      completedAt: data.status === "done" ? new Date() : null,
      createdBy: session.userId,
    },
    include: { ownerUser: { select: { name: true, email: true } } },
  });

  let emailSent = false;
  let emailError: string | null = null;
  if (ownerMembership?.user?.email) {
    try {
      const org = await prisma.org.findUnique({
        where: { id: session.orgId },
        select: { name: true },
      });
      const baseUrl = getBaseUrl(req);
      const actionUrl = buildActionUrl(baseUrl, created);
      const content = buildDowntimeActionAssignedEmail({
        appName: "MIS Control Tower",
        orgName: org?.name || "your organization",
        actionTitle: created.title,
        assigneeName: ownerMembership.user.name ?? ownerMembership.user.email,
        dueDate: formatDueDate(created.dueDate),
        actionUrl,
        priority: created.priority,
        status: created.status,
      });
      await sendEmail({
        to: ownerMembership.user.email,
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
    action: serializeAction(created),
    emailSent,
    emailError,
  });
}
