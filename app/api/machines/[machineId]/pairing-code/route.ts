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
 * OWNER/ADMIN only. Sets a fresh code + 24h expiry and clears nothing else — it does
 * NOT touch apiKey or pairingCodeUsedAt, so a machine's "was paired before" history
 * stays intact. Returns `paired` (pairingCodeUsedAt != null) so the caller can label
 * the state.
 *
 * NOTE (re-pairing caveat): the edge pair route (app/api/machines/pair/route.ts)
 * only matches codes with pairingCodeUsedAt == null. So a code regenerated for an
 * already-paired machine is accepted here but WON'T pair until the pair route is
 * changed to accept re-pairing. This is the handoff-specified behavior — left for
 * review.
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
    select: { id: true, pairingCodeUsedAt: true },
  });
  if (!machine) {
    return NextResponse.json({ ok: false, error: "Machine not found" }, { status: 404 });
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
    paired: machine.pairingCodeUsedAt != null,
  });
}
