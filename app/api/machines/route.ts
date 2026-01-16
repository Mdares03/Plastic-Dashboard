import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { generatePairingCode } from "@/lib/pairingCode";
import { z } from "zod";

const COOKIE_NAME = "mis_session";

const createMachineSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().max(40).optional(),
  location: z.string().trim().max(80).optional(),
});

async function requireSession() {
  const sessionId = (await cookies()).get(COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const session = await prisma.session.findFirst({
    where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { org: true, user: true },
  });

  if (!session || !session.user?.isActive || !session.user?.emailVerifiedAt) {
    return null;
  }

  return session;
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const machines = await prisma.machine.findMany({
    where: { orgId: session.orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      code: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      heartbeats: {
        orderBy: { tsServer: "desc" },
        take: 1,
        select: { ts: true, tsServer: true, status: true, message: true, ip: true, fwVersion: true },
      },
      kpiSnapshots: {
        orderBy: { ts: "desc" },
        take: 1,
        select: {
          ts: true,
          oee: true,
          availability: true,
          performance: true,
          quality: true,
          workOrderId: true,
          sku: true,
          good: true,
          scrap: true,
          target: true,
          cycleTime: true,
        },
      },
    },
  });


  // flatten latest heartbeat for UI convenience
  const out = machines.map((m) => ({
    ...m,
    latestHeartbeat: m.heartbeats[0] ?? null,
    latestKpi: m.kpiSnapshots[0] ?? null,
    heartbeats: undefined,
    kpiSnapshots: undefined,
  }));

  return NextResponse.json({ ok: true, machines: out });
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = createMachineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid machine payload" }, { status: 400 });
  }

  const name = parsed.data.name;
  const codeRaw = parsed.data.code ?? "";
  const locationRaw = parsed.data.location ?? "";

  const existing = await prisma.machine.findFirst({
    where: { orgId: session.orgId, name },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ ok: false, error: "Machine name already exists" }, { status: 409 });
  }

  const apiKey = randomBytes(24).toString("hex");
  const pairingExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let machine = null as null | {
    id: string;
    name: string;
    code?: string | null;
    location?: string | null;
    pairingCode?: string | null;
    pairingCodeExpiresAt?: Date | null;
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const pairingCode = generatePairingCode();
    try {
      machine = await prisma.machine.create({
        data: {
          orgId: session.orgId,
          name,
          code: codeRaw || null,
          location: locationRaw || null,
          apiKey,
          pairingCode,
          pairingCodeExpiresAt: pairingExpiresAt,
        },
        select: {
          id: true,
          name: true,
          code: true,
          location: true,
          pairingCode: true,
          pairingCodeExpiresAt: true,
        },
      });
      break;
    } catch (err: unknown) {
      const code = typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
      if (code !== "P2002") throw err;
    }
  }

  if (!machine?.pairingCode) {
    return NextResponse.json({ ok: false, error: "Failed to generate pairing code" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, machine });
}
