import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getBaseUrl } from "@/lib/appUrl";
import { normalizePairingCode, PAIRING_CODE_LENGTH } from "@/lib/pairingCode";
import { checkRateLimit, getClientIp, tooManyRequestsResponse } from "@/lib/rateLimit";
import { logLine } from "@/lib/logger";
import { z } from "zod";

const pairSchema = z.object({
  code: z.string().trim().max(16).optional(),
  pairingCode: z.string().trim().max(16).optional(),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limit = checkRateLimit("pair", ip);
  if (!limit.ok) {
    logLine("pair.rate_limited", { ip, retryAfterSec: limit.retryAfterSec });
    return tooManyRequestsResponse(limit);
  }

  const body = await req.json().catch(() => ({}));
  const parsed = pairSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid pairing payload" }, { status: 400 });
  }
  const rawCode = String(parsed.data.code || parsed.data.pairingCode || "").trim();
  const code = normalizePairingCode(rawCode);

  // Accept the canonical 8-char code; tolerate legacy 5-char codes still in the
  // DB until every machine is re-paired. The DB lookup (with expiry) is the
  // real gate; this just rejects obviously malformed input cheaply.
  if (!code || code.length < 5 || code.length > PAIRING_CODE_LENGTH) {
    logLine("pair.invalid_code", { ip, codeLength: code.length });
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
    logLine("pair.failed", { ip, codeLength: code.length });
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
