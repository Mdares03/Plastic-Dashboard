import type { KpiComparison } from "@/lib/reports/comparison";

export interface WeeklyReport {
  period: { from: string; to: string; generatedAt: string };
  org: { name: string; plant: string };
  machineIds: string[];

  /** Period-over-period headline-KPI deltas vs the prior equal-length window (item 1). */
  comparison?: KpiComparison;

  production: { good: number; target: number; pct: number };
  oeeAvg: number;
  availabilityAvg: number;
  performanceAvg: number;
  qualityAvg: number;
  estimatedLossMXN: number;
  classificationRate: number;
  classificationTarget: number;

  financialVisibility: {
    hasMachineCost: boolean;
    hasScrapCost: boolean;
    hasAnyCost: boolean;
  };

  machines: MachineSnapshot[];
  oeeTrend7d: { date: string; oee: number | null; target: number }[];
  topLosses: LossRow[];

  workOrderCycles: CyclePerfRow[];
  downtimeByReason: ParetoRow[];
  downtimeByShift: { shiftName: string; minutes: number; events: number }[];
  scrapTopSkus: ScrapRow[];
  workOrderStatus: WoStatusRow[];
  recommendedActions: ActionRow[];
}

export interface MachineSnapshot {
  machineId: string;
  name: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  unitsProduced: number;
  unitsTarget: number;
  topLossReasonLabel: string;
  topLossMinutes: number;
}

export interface LossRow {
  reasonCode: string;
  reasonLabel: string;
  minutes: number;
  events: number;
  estimatedCostMXN: number;
  contextNote?: string;
}

export interface CyclePerfRow {
  workOrderId: string;
  sku: string;
  machineName: string;
  targetCycleSec: number;
  actualAvgCycleSec: number;
  deltaPct: number;
  unitsProduced: number;
}

export interface ParetoRow {
  reasonCode: string;
  reasonLabel: string;
  minutes: number;
  events: number;
}

export interface ScrapRow {
  sku: string;
  scrapUnits: number;
  totalUnits: number;
  scrapPct: number;
  topReasonLabel: string;
  estimatedCostMXN: number;
}

export interface WoStatusRow {
  workOrderId: string;
  sku: string;
  machineName: string;
  target: number;
  completed: number;
  pctComplete: number;
  status: string;
}

export interface ActionRow {
  title: string;
  owner: string;
  estimatedRecoveryMXN: number;
  eta: string;
  relatedReasonCode?: string;
}

export type MachineCostProfile = {
  machineId: string;
  machineCostPerMin: number | null;
  scrapCostPerUnit: number | null;
};
