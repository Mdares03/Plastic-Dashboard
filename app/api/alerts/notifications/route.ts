import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const machineId = url.searchParams.get("machineId") || undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);

  const notifications = await prisma.alertNotification.findMany({
    where: {
      orgId: session.orgId,
      ...(machineId ? { machineId } : {}),
    },
    orderBy: { sentAt: "desc" },
    take: Number.isFinite(limit) ? limit : 50,
  });

  return NextResponse.json({ ok: true, notifications });
}
