import { describe, expect, it, vi } from "vitest";
import { freshPairingCode, generatePairingCode, normalizePairingCode, PAIRING_CODE_LENGTH } from "@/lib/pairingCode";

describe("generatePairingCode", () => {
  it("produces a code of the default length over the safe alphabet (no ambiguous chars)", () => {
    const code = generatePairingCode();
    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
    // Alphabet excludes I, O, 0, 1 to avoid transcription errors.
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    expect(code).not.toMatch(/[IO01]/);
  });
});

describe("normalizePairingCode", () => {
  it("upper-cases, trims, and strips separators", () => {
    expect(normalizePairingCode("  ab-cd 23 ")).toBe("ABCD23");
  });
});

describe("freshPairingCode", () => {
  it("returns the first code with no clash", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const code = await freshPairingCode({ machine: { findUnique } } as never);
    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("retries past a collision, then returns a free code", async () => {
    // First lookup finds a clash, second is free → two attempts, second code wins.
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: "taken" })
      .mockResolvedValueOnce(null);
    const code = await freshPairingCode({ machine: { findUnique } } as never);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
  });

  it("falls back to a longer code after 8 straight collisions", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "taken" });
    const code = await freshPairingCode({ machine: { findUnique } } as never);
    // 8 uniqueness checks exhausted, then a 12-char fallback that is NOT re-checked.
    expect(findUnique).toHaveBeenCalledTimes(8);
    expect(code).toHaveLength(12);
  });
});
