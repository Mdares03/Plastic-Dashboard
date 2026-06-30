import { beforeAll, describe, expect, it } from "vitest";

// Item 3: the print routes render a report for an org with no session, gated only by
// this signed token. It must round-trip, reject tampering, and expire.
beforeAll(() => {
  process.env.REPORT_PRINT_SECRET = "test-secret-abc";
});

describe("print token", () => {
  it("round-trips a valid payload", async () => {
    const { signPrintToken, verifyPrintToken } = await import("@/lib/reports/printToken");
    const token = signPrintToken({ type: "weekly", orgId: "org-1" });
    expect(verifyPrintToken(token)).toMatchObject({ type: "weekly", orgId: "org-1" });
  });

  it("rejects a tampered signature", async () => {
    const { signPrintToken, verifyPrintToken } = await import("@/lib/reports/printToken");
    const token = signPrintToken({ type: "daily", orgId: "org-1" });
    const tampered = `${token.slice(0, -2)}xx`;
    expect(verifyPrintToken(tampered)).toBeNull();
  });

  it("rejects a payload signed with a different secret", async () => {
    const { signPrintToken } = await import("@/lib/reports/printToken");
    const token = signPrintToken({ type: "weekly", orgId: "org-1" });
    process.env.REPORT_PRINT_SECRET = "different-secret";
    const { verifyPrintToken } = await import("@/lib/reports/printToken");
    expect(verifyPrintToken(token)).toBeNull();
    process.env.REPORT_PRINT_SECRET = "test-secret-abc";
  });

  it("rejects null/garbage", async () => {
    const { verifyPrintToken } = await import("@/lib/reports/printToken");
    expect(verifyPrintToken(null)).toBeNull();
    expect(verifyPrintToken("nodot")).toBeNull();
  });
});
