import { randomBytes } from "crypto";

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
