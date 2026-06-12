import { prisma } from "@/lib/prisma";
import { MAX_OPEN_EPISODE_MS, episodeWindowMinutes, DEFAULT_PLANNED_CODES } from "@/lib/metrics";
import { getCompiledFinancialFormulas } from "@/lib/financial/cache";
import {
  createSchemaDriftDiagnostic,
  getMissingColumnName,
  isPrismaMissingColumnError,
  logFinancialSchemaDrift,
  type FinancialDiagnostic,
} from "@/lib/financial/diagnostics";
import {
  evaluateCompiledFinancialExpression,
  type FinancialFormulaKey,
  type FinancialFormulaVariable,
  type CompiledFinancialExpression,
} from "@/lib/financial/formulas";

// MachineEvent is the source for performance loss (slow-cycle) and quality loss
// (quality-spike → scrap) only. Downtime cost (micro/macrostop) is sourced from
// ReasonEntry — the R5 downtime authority — so the financial downtime number
// equals the dashboard's getDowntime by construction (#13). See computeFinancialImpact.
const COST_EVENT_TYPES = ["slow-cycle", "quality-spike"] as const;

// ReasonEntry carries no micro/macro flag (only domain reason codes), so the
// financial micro-vs-macro split is by episode duration. This is a cosmetic
// breakdown only — the TOTAL downtime cost (what the ROI model uses) is
// authority-congruent regardless of where this cutoff falls.
export const MICROSTOP_MAX_SECONDS = 120;

/**
 * Micro vs macro downtime category from a ReasonEntry episode duration (seconds).
 * Capped at the same 12 h R5 ceiling as the cost itself. Pure — unit-tested.
 */
export function classifyDowntimeCategory(durationSeconds: number | null | undefined): "microstop" | "macrostop" {
  const episodeSec = Math.min(Math.max(0, durationSeconds ?? 0), MAX_OPEN_EPISODE_MS / 1000);
  return episodeSec < MICROSTOP_MAX_SECONDS ? "microstop" : "macrostop";
}

type CostProfile = {
  currency: string;
  machineCostPerMin: number | null;
  operatorCostPerMin: number | null;
  ratedRunningKw: number | null;
  idleKw: number | null;
  kwhRate: number | null;
  energyMultiplier: number | null;
  energyCostPerMin: number | null;
  scrapCostPerUnit: number | null;
  rawMaterialCostPerUnit: number | null;
};



type CostProfileOverride = Omit<Partial<CostProfile>, "currency">;
type Category = "slowCycle" | "microstop" | "macrostop" | "scrap";
type Totals = { total: number } & Record<Category, number>;
type DayRow = { day: string } & Totals;

export type FinancialEventDetail = {
  id: string;
  ts: Date;
  eventType: string;
  status: string;
  severity: string;
  category: Category;
  // Only present for downtime (ReasonEntry-sourced) detail rows.
  reasonCode?: string | null;
  reasonLabel?: string | null;
  machineId: string;
  machineName: string | null;
  location: string | null;
  workOrderId: string | null;
  sku: string | null;
  durationSec: number | null;
  costMachine: number;
  costOperator: number;
  costEnergy: number;
  costScrap: number;
  costRawMaterial: number;
  costTotal: number;
  currency: string;
};

export type FinancialImpactSummary = {
  currency: string;
  totals: Totals;
  byDay: DayRow[];
};

export type FinancialImpactResult = {
  range: { start: Date; end: Date };
  currencySummaries: FinancialImpactSummary[];
  eventsEvaluated: number;
  eventsIncluded: number;
  events: FinancialEventDetail[];
  diagnostic?: FinancialDiagnostic;
  filters: {
    machineId?: string;
    location?: string;
    sku?: string;
    currency?: string;
  };
};

export type FinancialImpactParams = {
  orgId: string;
  start: Date;
  end: Date;
  machineId?: string;
  location?: string;
  sku?: string;
  currency?: string;
  includeEvents?: boolean;
};

function safeNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseBlob(raw: unknown) {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }
  const blob = Array.isArray(parsed) ? parsed[0] : parsed;
  const blobRecord = typeof blob === "object" && blob !== null ? (blob as Record<string, unknown>) : null;
  const innerCandidate = blobRecord?.data ?? blobRecord ?? {};
  const inner =
    typeof innerCandidate === "object" && innerCandidate !== null
      ? (innerCandidate as Record<string, unknown>)
      : {};
  return { blob: blobRecord, inner } as const;
}

function dateKey(ts: Date) {
  return ts.toISOString().slice(0, 10);
}

function applyOverride(
  base: CostProfile,
  override?: CostProfileOverride | null,
  currency?: string | null
) {
  const out: CostProfile = { ...base };
  if (currency) out.currency = currency;
  if (!override) return out;

  if (override.machineCostPerMin != null) out.machineCostPerMin = override.machineCostPerMin;
  if (override.operatorCostPerMin != null) out.operatorCostPerMin = override.operatorCostPerMin;
  if (override.ratedRunningKw != null) out.ratedRunningKw = override.ratedRunningKw;
  if (override.idleKw != null) out.idleKw = override.idleKw;
  if (override.kwhRate != null) out.kwhRate = override.kwhRate;
  if (override.energyMultiplier != null) out.energyMultiplier = override.energyMultiplier;
  if (override.energyCostPerMin != null) out.energyCostPerMin = override.energyCostPerMin;
  if (override.scrapCostPerUnit != null) out.scrapCostPerUnit = override.scrapCostPerUnit;
  if (override.rawMaterialCostPerUnit != null) out.rawMaterialCostPerUnit = override.rawMaterialCostPerUnit;
  return out;
}

function computeEnergyCostPerMin(profile: CostProfile, mode: "running" | "idle") {
  if (profile.energyCostPerMin != null) return profile.energyCostPerMin;
  const kw = mode === "running" ? profile.ratedRunningKw : profile.idleKw;
  const rate = profile.kwhRate;
  if (kw == null || rate == null) return null;
  const multiplier = profile.energyMultiplier ?? 1;
  return (kw / 60) * rate * multiplier;
}

function buildFormulaScope(
  profile: CostProfile,
  params: { mode: "running" | "idle"; durationMin?: number; scrapUnits?: number }
) {
  const fallbackEnergyCostPerMin = computeEnergyCostPerMin(profile, params.mode) ?? 0;
  const scope: Record<FinancialFormulaVariable, number> = {
    machineCostPerMin: profile.machineCostPerMin ?? 0,
    operatorCostPerMin: profile.operatorCostPerMin ?? 0,
    ratedRunningKw: profile.ratedRunningKw ?? 0,
    idleKw: profile.idleKw ?? 0,
    kwhRate: profile.kwhRate ?? 0,
    energyMultiplier: profile.energyMultiplier ?? 1,
    energyCostPerMin: fallbackEnergyCostPerMin,
    scrapCostPerUnit: profile.scrapCostPerUnit ?? 0,
    rawMaterialCostPerUnit: profile.rawMaterialCostPerUnit ?? 0,
    durationMin: Math.max(0, params.durationMin ?? 0),
    scrapUnits: Math.max(0, params.scrapUnits ?? 0),
  };
  return scope;
}

function evaluateFormulaValue(
  formulas: Partial<Record<FinancialFormulaKey, CompiledFinancialExpression>>,
  key: FinancialFormulaKey,
  scope: Record<FinancialFormulaVariable, number>
) {
  const compiled = formulas[key];
  if (!compiled) return 0;
  const value = evaluateCompiledFinancialExpression(compiled, scope);
  return Number.isFinite(value) ? value : 0;
}

function distributeCost(
  total: number,
  parts: { costMachine: number; costOperator: number; costEnergy: number; costScrap: number; costRawMaterial: number }
) {
  const baseTotal = parts.costMachine + parts.costOperator + parts.costEnergy + parts.costScrap + parts.costRawMaterial;
  if (baseTotal <= 0) {
    return { ...parts, costMachine: total };
  }

  const ratio = total / baseTotal;
  return {
    costMachine: parts.costMachine * ratio,
    costOperator: parts.costOperator * ratio,
    costEnergy: parts.costEnergy * ratio,
    costScrap: parts.costScrap * ratio,
    costRawMaterial: parts.costRawMaterial * ratio,
  };
}

export async function computeFinancialImpact(params: FinancialImpactParams): Promise<FinancialImpactResult> {
  const { orgId, start, end, machineId, location, sku, currency, includeEvents } = params;
  let diagnostic: FinancialDiagnostic | undefined;

  const machines = await prisma.machine.findMany({
    where: { orgId },
    select: { id: true, name: true, location: true },
  });

  const machineMap = new Map(machines.map((m) => [m.id, m]));

  let machineIds = machines.map((m) => m.id);
  if (location) {
    machineIds = machines.filter((m) => m.location === location).map((m) => m.id);
  }
  if (machineId) {
    machineIds = machineIds.includes(machineId) ? [machineId] : [];
  }

  if (!machineIds.length) {
    return {
      range: { start, end },
      currencySummaries: [],
      eventsEvaluated: 0,
      eventsIncluded: 0,
      events: [],
      filters: { machineId, location, sku, currency },
    };
  }

  const events = await prisma.machineEvent.findMany({
    where: {
      orgId,
      ts: { gte: start, lte: end },
      machineId: { in: machineIds },
      eventType: { in: COST_EVENT_TYPES as unknown as string[] },
    },
    orderBy: { ts: "asc" },
    select: {
      id: true,
      ts: true,
      eventType: true,
      data: true,
      machineId: true,
      workOrderId: true,
      sku: true,
      severity: true,
    },
  });

  // R5 downtime authority: micro/macrostop cost is sourced from ReasonEntry, not
  // MachineEvent — the SAME rows + episodeWindowMinutes clamp the dashboard uses,
  // so financial downtime minutes equal getDowntime by construction (#13).
  const reasonRows = await prisma.reasonEntry.findMany({
    where: {
      orgId,
      machineId: { in: machineIds },
      kind: "downtime",
      capturedAt: { gte: start, lte: end },
    },
    orderBy: { capturedAt: "asc" },
    select: {
      id: true,
      machineId: true,
      reasonCode: true,
      reasonLabel: true,
      capturedAt: true,
      episodeEndTs: true,
      durationSeconds: true,
      workOrderId: true,
    },
  });

  const missingSkuPairs = [
    ...events
      .filter((e) => !e.sku && e.workOrderId)
      .map((e) => ({ machineId: e.machineId, workOrderId: e.workOrderId as string })),
    // ReasonEntry has no sku column, so any episode with a WO needs the lookup.
    ...reasonRows
      .filter((r) => r.workOrderId)
      .map((r) => ({ machineId: r.machineId, workOrderId: r.workOrderId as string })),
  ];
  const workOrderIds = Array.from(new Set(missingSkuPairs.map((p) => p.workOrderId)));
  const workOrderMachines = Array.from(new Set(missingSkuPairs.map((p) => p.machineId)));

  const workOrders = workOrderIds.length
    ? await prisma.machineWorkOrder.findMany({
        where: {
          orgId,
          workOrderId: { in: workOrderIds },
          machineId: { in: workOrderMachines },
        },
        select: { machineId: true, workOrderId: true, sku: true },
      })
    : [];

  const workOrderSku = new Map<string, string>();
  for (const row of workOrders) {
    if (row.sku) {
      workOrderSku.set(`${row.machineId}:${row.workOrderId}`, row.sku);
    }
  }

  let orgProfileRaw:
    | {
        defaultCurrency: string | null;
        machineCostPerMin: number | null;
        operatorCostPerMin: number | null;
        ratedRunningKw: number | null;
        idleKw: number | null;
        kwhRate: number | null;
        energyMultiplier: number | null;
        energyCostPerMin: number | null;
        scrapCostPerUnit: number | null;
        rawMaterialCostPerUnit: number | null;
        formulasJson?: unknown;
      }
    | null = null;

  try {
    orgProfileRaw = await prisma.orgFinancialProfile.findUnique({
      where: { orgId },
      select: {
        defaultCurrency: true,
        machineCostPerMin: true,
        operatorCostPerMin: true,
        ratedRunningKw: true,
        idleKw: true,
        kwhRate: true,
        energyMultiplier: true,
        energyCostPerMin: true,
        scrapCostPerUnit: true,
        rawMaterialCostPerUnit: true,
        formulasJson: true,
      },
    });
  } catch (error) {
    if (!isPrismaMissingColumnError(error)) throw error;

    orgProfileRaw = await prisma.orgFinancialProfile.findUnique({
      where: { orgId },
      select: {
        defaultCurrency: true,
        machineCostPerMin: true,
        operatorCostPerMin: true,
        ratedRunningKw: true,
        idleKw: true,
        kwhRate: true,
        energyMultiplier: true,
        energyCostPerMin: true,
        scrapCostPerUnit: true,
        rawMaterialCostPerUnit: true,
      },
    });

    diagnostic = createSchemaDriftDiagnostic(getMissingColumnName(error));
    logFinancialSchemaDrift({
      route: "lib/financial/impact",
      orgId,
      error,
    });
  }

  const [locationOverrides, machineOverrides, productOverrides] = await Promise.all([
    prisma.locationFinancialOverride.findMany({ where: { orgId } }),
    prisma.machineFinancialOverride.findMany({ where: { orgId } }),
    prisma.productCostOverride.findMany({ where: { orgId } }),
  ]);

  const orgProfile: CostProfile = {
    currency: orgProfileRaw?.defaultCurrency ?? "USD",
    machineCostPerMin: orgProfileRaw?.machineCostPerMin ?? null,
    operatorCostPerMin: orgProfileRaw?.operatorCostPerMin ?? null,
    ratedRunningKw: orgProfileRaw?.ratedRunningKw ?? null,
    idleKw: orgProfileRaw?.idleKw ?? null,
    kwhRate: orgProfileRaw?.kwhRate ?? null,
    energyMultiplier: orgProfileRaw?.energyMultiplier ?? 1,
    energyCostPerMin: orgProfileRaw?.energyCostPerMin ?? null,
    scrapCostPerUnit: orgProfileRaw?.scrapCostPerUnit ?? null,
    rawMaterialCostPerUnit: orgProfileRaw?.rawMaterialCostPerUnit ?? null,
  };

  const formulaSet = getCompiledFinancialFormulas(orgId, orgProfileRaw?.formulasJson);

  const locationMap = new Map(locationOverrides.map((o) => [o.location, o]));
  const machineOverrideMap = new Map(machineOverrides.map((o) => [o.machineId, o]));
  const productMap = new Map(productOverrides.map((o) => [o.sku, o]));

  const summaries = new Map<
    string,
    {
      currency: string;
      totals: Totals;
      byDay: Map<string, DayRow>;
    }
  >();

  const detailed: FinancialEventDetail[] = [];
  let eventsIncluded = 0;

  // Shared accumulation for both passes (MachineEvent + ReasonEntry) so a single
  // total/byDay/detail path keeps the two sources from drifting.
  function accumulate(args: {
    currency: string;
    category: Category;
    costTotal: number;
    ts: Date;
    detail?: FinancialEventDetail;
  }) {
    const key = args.currency || "USD";
    const bucket = summaries.get(key) ?? {
      currency: key,
      totals: { total: 0, slowCycle: 0, microstop: 0, macrostop: 0, scrap: 0 },
      byDay: new Map<string, DayRow>(),
    };
    bucket.totals.total += args.costTotal;
    bucket.totals[args.category] += args.costTotal;

    const day = dateKey(args.ts);
    const dayRow: DayRow = bucket.byDay.get(day) ?? {
      day,
      total: 0,
      slowCycle: 0,
      microstop: 0,
      macrostop: 0,
      scrap: 0,
    };
    dayRow.total += args.costTotal;
    dayRow[args.category] += args.costTotal;
    bucket.byDay.set(day, dayRow);

    summaries.set(key, bucket);
    eventsIncluded += 1;
    if (includeEvents && args.detail) detailed.push(args.detail);
  }

  for (const ev of events) {
    const eventType = String(ev.eventType ?? "").toLowerCase();
    if (eventType === "mold-change") continue;
    const { blob, inner } = parseBlob(ev.data);
    const status = String(blob?.status ?? inner?.status ?? "").toLowerCase();
    const severity = String(ev.severity ?? "").toLowerCase();
    const isAutoAck = Boolean(blob?.is_auto_ack ?? inner?.is_auto_ack);
    const isUpdate = Boolean(blob?.is_update ?? inner?.is_update);

    const machine = machineMap.get(ev.machineId);
    const locationName = machine?.location ?? null;
    const skuResolved =
      ev.sku ??
      (ev.workOrderId ? workOrderSku.get(`${ev.machineId}:${ev.workOrderId}`) : null) ??
      null;

    if (sku && skuResolved !== sku) continue;
    if (isAutoAck || isUpdate) continue;

    const locationOverride = locationName ? locationMap.get(locationName) : null;
    const machineOverride = machineOverrideMap.get(ev.machineId) ?? null;

    let profile = applyOverride(orgProfile, locationOverride, locationOverride?.currency ?? null);
    profile = applyOverride(profile, machineOverride, machineOverride?.currency ?? null);

    const productOverride = skuResolved ? productMap.get(skuResolved) : null;
    if (productOverride?.rawMaterialCostPerUnit != null) {
      profile.rawMaterialCostPerUnit = productOverride.rawMaterialCostPerUnit;
    }
    if (productOverride?.currency) {
      profile.currency = productOverride.currency;
    }

    let category: Category | null = null;
    let durationSec: number | null = null;
    let costMachine = 0;
    let costOperator = 0;
    let costEnergy = 0;
    let costScrap = 0;
    let costRawMaterial = 0;

    let costTotal = 0;

    if (eventType === "slow-cycle") {
      const actual =
        safeNumber(inner?.actual_cycle_time ?? blob?.actual_cycle_time ?? inner?.actualCycleTime ?? blob?.actualCycleTime) ??
        null;
      const theoretical =
        safeNumber(
          inner?.theoretical_cycle_time ??
            blob?.theoretical_cycle_time ??
            inner?.theoreticalCycleTime ??
            blob?.theoreticalCycleTime
        ) ?? null;
      if (actual == null || theoretical == null) continue;
      durationSec = Math.max(0, actual - theoretical);
      if (!durationSec) continue;
      const durationMin = durationSec / 60;
      const scope = buildFormulaScope(profile, { mode: "running", durationMin });
      costTotal = Math.max(0, evaluateFormulaValue(formulaSet, "slowCycleTotalCost", scope));
      const distributed = distributeCost(costTotal, {
        costMachine: durationMin * (profile.machineCostPerMin ?? 0),
        costOperator: durationMin * (profile.operatorCostPerMin ?? 0),
        costEnergy: durationMin * (computeEnergyCostPerMin(profile, "running") ?? 0),
        costScrap: 0,
        costRawMaterial: 0,
      });
      costMachine = distributed.costMachine;
      costOperator = distributed.costOperator;
      costEnergy = distributed.costEnergy;
      category = "slowCycle";
      // micro/macrostop downtime cost is NOT sourced here anymore — see the
      // ReasonEntry pass below (R5 authority, #13). COST_EVENT_TYPES excludes them.
    } else if (eventType === "quality-spike") {
      if (severity === "info" || status === "resolved") continue;
      const scrapParts =
        safeNumber(
          inner?.scrap_parts ??
            blob?.scrap_parts ??
            inner?.scrapParts ??
            blob?.scrapParts
        ) ?? 0;
      if (scrapParts <= 0) continue;
      const scope = buildFormulaScope(profile, { mode: "idle", scrapUnits: scrapParts });
      costTotal = Math.max(0, evaluateFormulaValue(formulaSet, "scrapTotalCost", scope));
      const distributed = distributeCost(costTotal, {
        costMachine: 0,
        costOperator: 0,
        costEnergy: 0,
        costScrap: scrapParts * (profile.scrapCostPerUnit ?? 0),
        costRawMaterial: scrapParts * (profile.rawMaterialCostPerUnit ?? 0),
      });
      costScrap = distributed.costScrap;
      costRawMaterial = distributed.costRawMaterial;
      category = "scrap";
    }

    if (!category) continue;
    if (costTotal <= 0) continue;
    if (currency && profile.currency !== currency) continue;

    const key = profile.currency || "USD";
    accumulate({
      currency: key,
      category,
      costTotal,
      ts: ev.ts,
      detail: includeEvents
        ? {
            id: ev.id,
            ts: ev.ts,
            eventType,
            status,
            severity,
            category,
            machineId: ev.machineId,
            machineName: machine?.name ?? null,
            location: locationName,
            workOrderId: ev.workOrderId ?? null,
            sku: skuResolved,
            durationSec,
            costMachine,
            costOperator,
            costEnergy,
            costScrap,
            costRawMaterial,
            costTotal,
            currency: key,
          }
        : undefined,
    });
  }

  // R5 downtime cost pass: micro/macrostop cost from ReasonEntry episodes, using
  // the SAME episodeWindowMinutes clamp (+12h cap) the dashboard's getDowntime
  // uses — so summed downtime cost minutes reconcile with computeDowntime (#13).
  for (const row of reasonRows) {
    const code = String(row.reasonCode ?? "").trim().toUpperCase();
    // Planned downtime (mold change) is necessary, not a reducible loss — excluded
    // from cost, matching the old event path which skipped mold-change.
    if (DEFAULT_PLANNED_CODES.has(code)) continue;

    const minutes = episodeWindowMinutes(row, start, end);
    if (minutes <= 0) continue;

    const skuResolved = row.workOrderId
      ? workOrderSku.get(`${row.machineId}:${row.workOrderId}`) ?? null
      : null;
    if (sku && skuResolved !== sku) continue;

    const machine = machineMap.get(row.machineId);
    const locationName = machine?.location ?? null;
    const locationOverride = locationName ? locationMap.get(locationName) : null;
    const machineOverride = machineOverrideMap.get(row.machineId) ?? null;
    let profile = applyOverride(orgProfile, locationOverride, locationOverride?.currency ?? null);
    profile = applyOverride(profile, machineOverride, machineOverride?.currency ?? null);

    const durationMin = minutes;
    const scope = buildFormulaScope(profile, { mode: "idle", durationMin });
    const costTotal = Math.max(0, evaluateFormulaValue(formulaSet, "downtimeTotalCost", scope));
    if (costTotal <= 0) continue;
    if (currency && profile.currency !== currency) continue;

    // Micro vs macro by episode duration (capped at the same 12h R5 ceiling).
    const category: Category = classifyDowntimeCategory(row.durationSeconds);

    const distributed = distributeCost(costTotal, {
      costMachine: durationMin * (profile.machineCostPerMin ?? 0),
      costOperator: durationMin * (profile.operatorCostPerMin ?? 0),
      costEnergy: durationMin * (computeEnergyCostPerMin(profile, "idle") ?? 0),
      costScrap: 0,
      costRawMaterial: 0,
    });

    const key = profile.currency || "USD";
    accumulate({
      currency: key,
      category,
      costTotal,
      ts: row.capturedAt,
      detail: includeEvents
        ? {
            id: row.id,
            ts: row.capturedAt,
            eventType: "downtime",
            status: "",
            severity: "",
            category,
            reasonCode: code || null,
            reasonLabel: row.reasonLabel ?? null,
            machineId: row.machineId,
            machineName: machine?.name ?? null,
            location: locationName,
            workOrderId: row.workOrderId ?? null,
            sku: skuResolved,
            durationSec: Math.round(minutes * 60),
            costMachine: distributed.costMachine,
            costOperator: distributed.costOperator,
            costEnergy: distributed.costEnergy,
            costScrap: 0,
            costRawMaterial: 0,
            costTotal,
            currency: key,
          }
        : undefined,
    });
  }

  const currencySummaries = Array.from(summaries.values()).map((summary) => {
    const byDay = Array.from(summary.byDay.values()).sort((a, b) => {
      return String(a.day).localeCompare(String(b.day));
    });
    return { currency: summary.currency, totals: summary.totals, byDay };
  });

  return {
    range: { start, end },
    currencySummaries,
    eventsEvaluated: events.length + reasonRows.length,
    eventsIncluded,
    events: detailed,
    diagnostic,
    filters: { machineId, location, sku, currency },
  };
}
