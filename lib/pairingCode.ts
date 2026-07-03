import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// 8 chars over a 32-symbol alphabet = 32^8 ≈ 1.1e12 codes — brute-force
// infeasible within the short pairing-code TTL, especially behind rate limits.
export const PAIRING_CODE_LENGTH = 8;

export function generatePairingCode(length = PAIRING_CODE_LENGTH) {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  }
  return code;
}

export function normalizePairingCode(input: string) {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Minimal shape needed to check pairing-code uniqueness. Both the full
 * PrismaClient and a Prisma.TransactionClient satisfy it, so provisioning (inside
 * a $transaction) and the regenerate route (outside one) share this one loop.
 */
type PairingCodeUniquenessDb = {
  machine: { findUnique: Prisma.MachineDelegate["findUnique"] };
};

/**
 * Generate a pairing code that isn't already taken. The uniqueness check runs on
 * the passed client so a collision never aborts a surrounding transaction; on the
 * astronomically-unlikely event of 8 straight collisions, fall back to a longer
 * (harder-to-collide) code.
 */
export async function freshPairingCode(db: PairingCodeUniquenessDb): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generatePairingCode();
    const clash = await db.machine.findUnique({ where: { pairingCode: code }, select: { id: true } });
    if (!clash) return code;
  }
  return generatePairingCode(12);
}
