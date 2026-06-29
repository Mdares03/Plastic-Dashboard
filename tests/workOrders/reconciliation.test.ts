import { describe, expect, it } from "vitest";
import { deriveWorkOrderAudit } from "@/lib/workOrders/reconciliation";

/**
 * Golden cases for the work-order audit. Numbers are taken from the live Bemis cloud
 * DB (the rows that produced the wall of red "Mismatch" badges), so these lock in the
 * intended re-classification: scrap tolerated, counter integrity separated from data
 * delivery, and gaps classified by cause.
 */

const base = {
  acknowledged: false,
  readerOutage: false,
  liveRecent: false,
};

describe("deriveWorkOrderAudit — scrap is tolerated", () => {
  it("230875: scrap-only difference, no propagated cycle_count → clean", () => {
    // cav1, cycle_count not propagated (0), 907 rows delivered, 902 good + 6 scrap.
    const a = deriveWorkOrderAudit({
      ...base,
      activeCavities: 1,
      reportedCycleCount: 0,
      cyclesCounted: 907,
      goodParts: 902,
      scrapParts: 6,
    });
    expect(a.countOk).toBe(true);
    expect(a.countChecked).toBe(false); // cycle_count unusable → can't disprove
    expect(a.missing).toBe(0);
    expect(a.delivery).toBe("none");
    expect(a.scrapTolerated).toBe(true);
  });

  it("230969: partial cycle_count below delivered rows → unusable, clean", () => {
    const a = deriveWorkOrderAudit({
      ...base,
      activeCavities: 1,
      reportedCycleCount: 12, // < 188 delivered → stale/unpropagated, not a counter error
      cyclesCounted: 188,
      goodParts: 179,
      scrapParts: 11,
    });
    expect(a.countOk).toBe(true);
    expect(a.countChecked).toBe(false);
    expect(a.missing).toBe(0);
    expect(a.delivery).toBe("none");
  });
});

describe("deriveWorkOrderAudit — delivery gaps (counter internally perfect)", () => {
  it("230982: 1 cycle row never delivered → unexplained gap, counter ok", () => {
    const a = deriveWorkOrderAudit({
      ...base,
      activeCavities: 1,
      reportedCycleCount: 762,
      cyclesCounted: 761,
      goodParts: 762,
      scrapParts: 0,
    });
    expect(a.countOk).toBe(true);
    expect(a.countChecked).toBe(true);
    expect(a.missing).toBe(1);
    expect(a.delivery).toBe("unexplained");
  });

  it("OT-TEST-CAV: 186 cycles × 2 cav = 372 made, only 155 rows delivered → 31 missing", () => {
    const a = deriveWorkOrderAudit({
      ...base,
      activeCavities: 2,
      reportedCycleCount: 186,
      cyclesCounted: 155,
      goodParts: 372,
      scrapParts: 0,
    });
    expect(a.countOk).toBe(true); // the machine's own counter reconciles
    expect(a.effectiveCycles).toBe(186);
    expect(a.missing).toBe(31);
    expect(a.delivery).toBe("unexplained");
  });

  it("OT-TEST-CAV with an acknowledgement → explained", () => {
    const a = deriveWorkOrderAudit({
      ...base,
      acknowledged: true,
      activeCavities: 2,
      reportedCycleCount: 186,
      cyclesCounted: 155,
      goodParts: 372,
      scrapParts: 0,
    });
    expect(a.missing).toBe(31);
    expect(a.delivery).toBe("explained");
  });

  it("OT-TEST-CAV overlapping a recorded sensor outage → explained", () => {
    const a = deriveWorkOrderAudit({
      ...base,
      readerOutage: true,
      activeCavities: 2,
      reportedCycleCount: 186,
      cyclesCounted: 155,
      goodParts: 372,
      scrapParts: 0,
    });
    expect(a.delivery).toBe("explained");
  });

  it("open WO recently active with a gap → recoverable (backlog may drain)", () => {
    const a = deriveWorkOrderAudit({
      ...base,
      liveRecent: true,
      activeCavities: 1,
      reportedCycleCount: 500,
      cyclesCounted: 480,
      goodParts: 500,
      scrapParts: 0,
    });
    expect(a.missing).toBe(20);
    expect(a.delivery).toBe("recoverable");
  });
});

describe("deriveWorkOrderAudit — a genuine counter error", () => {
  it("good parts the machine's own cycle counter can't explain → countOk false", () => {
    const a = deriveWorkOrderAudit({
      ...base,
      activeCavities: 2,
      reportedCycleCount: 100, // 100 rows delivered, counter usable
      cyclesCounted: 100,
      goodParts: 150, // expected 2×100=200; off by 50, scrap can't cover it
      scrapParts: 0,
    });
    expect(a.countChecked).toBe(true);
    expect(a.countOk).toBe(false);
  });

  it("a small overage within scrap + rounding slack stays ok", () => {
    // 230825: cav1, rep3694, good3692, scrap2 → |3694-3692|=2 ≤ 2+1
    const a = deriveWorkOrderAudit({
      ...base,
      activeCavities: 1,
      reportedCycleCount: 3694,
      cyclesCounted: 3691,
      goodParts: 3692,
      scrapParts: 2,
    });
    expect(a.countOk).toBe(true);
    expect(a.missing).toBe(3);
    expect(a.delivery).toBe("unexplained");
  });
});

describe("deriveWorkOrderAudit — unknown cavities", () => {
  it("no cavity count → counter check skipped, not flagged", () => {
    const a = deriveWorkOrderAudit({
      ...base,
      activeCavities: null,
      reportedCycleCount: 100,
      cyclesCounted: 100,
      goodParts: 100,
      scrapParts: 0,
    });
    expect(a.countChecked).toBe(false);
    expect(a.countOk).toBe(true);
    expect(a.missing).toBe(0);
  });
});

// NOTE: the former "isBoundedResidualRow" / EDGE_RESIDUAL_TOLERANCE auto-ack was removed
// (2026-06-26). Policy: no delivery residual is silently tolerated by size — any unexplained
// gap, even 1 row, stays red until root-caused. Only explicit, root-caused accepts explain a gap.
