import { describe, expect, it } from "vitest";
import { computeSavingsByReason, type SavingsInputRow } from "@/lib/analytics/savingsByReason";

const rows: SavingsInputRow[] = [
  { reasonCode: "DTMAQ-01", reasonLabel: "Machine fault", minutesLost: 120, count: 4, pctOfTotal: 60 },
  { reasonCode: "DTPLN-02", reasonLabel: "Changeover", minutesLost: 80, count: 2, pctOfTotal: 40 },
  { reasonCode: "DTNONE", reasonLabel: "No minutes", minutesLost: 0, count: 1, pctOfTotal: 0 },
];

describe("computeSavingsByReason", () => {
  it("computes per-reason money = minutes × costPerMin and total = Σ (congruent)", () => {
    const { rows: out, total } = computeSavingsByReason(rows, 2);
    expect(out.map((r) => r.cost)).toEqual([240, 160]);
    expect(total).toBe(400);
    // Total must equal the sum of the rows by construction (R5/#13).
    expect(total).toBe(out.reduce((acc, r) => acc + r.cost, 0));
  });

  it("filters out zero-cost (zero-minute) rows", () => {
    const { rows: out } = computeSavingsByReason(rows, 2);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.reasonCode === "DTNONE")).toBeUndefined();
  });

  it("still yields rows under a placeholder (1/min) rate — money is illustrative, not hidden", () => {
    const { rows: out, total } = computeSavingsByReason(rows, 1);
    expect(out).toHaveLength(2);
    expect(total).toBe(200); // 120 + 80
  });

  it("returns nothing when the rate is not positive", () => {
    expect(computeSavingsByReason(rows, 0)).toEqual({ rows: [], total: 0 });
    expect(computeSavingsByReason(rows, -5)).toEqual({ rows: [], total: 0 });
  });

  it("treats missing minutesLost as zero", () => {
    const { rows: out } = computeSavingsByReason(
      [{ reasonCode: "X", reasonLabel: "X", count: 1, pctOfTotal: 100 }],
      3
    );
    expect(out).toHaveLength(0);
  });
});
