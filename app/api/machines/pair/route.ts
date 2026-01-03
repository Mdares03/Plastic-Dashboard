import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getBaseUrl } from "@/lib/appUrl";
import { normalizePairingCode } from "@/lib/pairingCode";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const rawCode = String(body.code || body.pairingCode || "").trim();
  const code = normalizePairingCode(rawCode);

  if (!code || code.length !== 5) {
    return NextResponse.json({ ok: false, error: "Invalid pairing code" }, { status: 400 });
  }

  const now = new Date();

  const machine = await prisma.machine.findFirst({
    where: {
      pairingCode: code,
      pairingCodeUsedAt: null,
      pairingCodeExpiresAt: { gt: now },
    },
    select: { id: true, orgId: true, apiKey: true },
  });

  if (!machine) {
    return NextResponse.json({ ok: false, error: "Pairing code not found or expired" }, { status: 404 });
  }

  let apiKey = machine.apiKey;
  if (!apiKey) {
    apiKey = randomBytes(24).toString("hex");
  }

  await prisma.machine.update({
    where: { id: machine.id },
    data: {
      apiKey,
      pairingCode: null,
      pairingCodeExpiresAt: null,
      pairingCodeUsedAt: now,
    },
  });

  return NextResponse.json({
    ok: true,
    config: {
      cloudBaseUrl: getBaseUrl(req),
      machineId: machine.id,
      apiKey,
    },
  });
}
