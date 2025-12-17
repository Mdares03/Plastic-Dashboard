import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing api key" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.machineId || !body?.status) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const machine = await prisma.machine.findFirst({
    where: { id: String(body.machineId), apiKey },
    select: { id: true, orgId: true },
  });

  if (!machine) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const hb = await prisma.machineHeartbeat.create({
    data: {
      orgId: machine.orgId,
      machineId: machine.id,
      status: String(body.status),
      message: body.message ? String(body.message) : null,
      ip: body.ip ? String(body.ip) : null,
      fwVersion: body.fwVersion ? String(body.fwVersion) : null,
    },
  });

  return NextResponse.json({ ok: true, id: hb.id, ts: hb.ts });
}
