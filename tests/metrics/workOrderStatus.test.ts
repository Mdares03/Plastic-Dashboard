import { describe, it, expect } from "vitest";
import {
  isCompletedWorkOrder,
  isTerminalWorkOrder,
  isOpenWorkOrder,
  COMPLETED_WO_STATUSES,
  TERMINAL_WO_STATUSES,
} from "@/lib/workOrders/status";

// METRICS_SPEC R1/R3 — one vocabulary for WO lifecycle status. The edge writes
// 'DONE' on completion; the dashboard must treat that congruently with COMPLETED.
describe("work-order status vocabulary", () => {
  it("treats the edge's 'DONE' as a completed (reconcilable) WO", () => {
    expect(isCompletedWorkOrder("DONE")).toBe(true);
    expect(isCompletedWorkOrder("COMPLETED")).toBe(true);
    expect(isCompletedWorkOrder("CLOSED")).toBe(true);
  });

  it("does NOT count CANCELLED as completed (counters not expected to reconcile)", () => {
    expect(isCompletedWorkOrder("CANCELLED")).toBe(false);
    expect(isTerminalWorkOrder("CANCELLED")).toBe(true); // but it IS terminal/closed
  });

  it("treats open statuses as not-terminal", () => {
    for (const s of ["PENDING", "RUNNING"]) {
      expect(isTerminalWorkOrder(s)).toBe(false);
      expect(isOpenWorkOrder(s)).toBe(true);
      expect(isCompletedWorkOrder(s)).toBe(false);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(isCompletedWorkOrder(" done ")).toBe(true);
    expect(isTerminalWorkOrder("cancelled")).toBe(true);
    expect(isOpenWorkOrder("Running")).toBe(true);
  });

  it("treats null/undefined/empty as open (unknown is not terminal)", () => {
    for (const s of [null, undefined, ""]) {
      expect(isTerminalWorkOrder(s)).toBe(false);
      expect(isOpenWorkOrder(s)).toBe(true);
      expect(isCompletedWorkOrder(s)).toBe(false);
    }
  });

  it("isOpenWorkOrder is exactly the negation of isTerminalWorkOrder", () => {
    for (const s of [...TERMINAL_WO_STATUSES, "PENDING", "RUNNING", "", null]) {
      expect(isOpenWorkOrder(s)).toBe(!isTerminalWorkOrder(s));
    }
  });

  it("COMPLETED set is a subset of TERMINAL set", () => {
    for (const s of COMPLETED_WO_STATUSES) {
      expect(TERMINAL_WO_STATUSES).toContain(s);
    }
  });
});
