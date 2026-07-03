import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { freshPairingCode } from "@/lib/pairingCode";

const machineIdSchema = z.string().uuid();

const PAIRING_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * (Re)issue a pairing code for an EXISTING machine so an edge reader can be paired
 * whenever it is physically installed — not only within 24h of machine creation.
 * OWNER/ADMIN only. Does not touch apiKey or pairingCodeUsedAt; the edge pair route
 * is unchanged. Machines that are already paired are not re-issued a code (the pair
 * route only accepts unused codes), so we return their status without regenerating.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ machineId: string }> }) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { machineId } = await params;
  if (!machineIdSchema.safeParse(machineId).success) {
    return NextResponse.json({ ok: false, error: "Invalid machine id" }, { status: 400 });
  }

  const machine = await prisma.machine.findFirst({
    where: { id: machineId, orgId: session.orgId },
    select: { id: true, pairingCode: true, pairingCodeExpiresAt: true, pairingCodeUsedAt: true },
  });
  if (!machine) {
    return NextResponse.json({ ok: false, error: "Machine not found" }, { status: 404 });
  }

  // Already paired: the edge pair route only accepts codes with pairingCodeUsedAt
  // null, so a fresh code here would be dead on arrival. Report status instead of
  // minting a useless code.
  if (machine.pairingCodeUsedAt) {
    return NextResponse.json(
      {
        ok: false,
        error: "Machine is already paired",
        paired: true,
      },
      { status: 409 }
    );
  }

  const pairingCode = await freshPairingCode(prisma);
  const pairingCodeExpiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

  await prisma.machine.update({
    where: { id: machine.id },
    data: { pairingCode, pairingCodeExpiresAt },
  });

  await prisma.settingsAudit.create({
    data: {
      orgId: session.orgId,
      machineId: machine.id,
      actorId: session.userId,
      source: "pairing-code:regenerate",
      payloadJson: { pairingCodeExpiresAt: pairingCodeExpiresAt.toISOString() } as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    ok: true,
    pairingCode,
    pairingCodeExpiresAt,
    paired: false,
  });
}
