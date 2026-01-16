import { prisma } from "@/lib/prisma";

const COST_EVENT_TYPES = ["slow-cycle", "microstop", "macrostop", "quality-spike"] as const;

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

export async function computeFinancialImpact(params: FinancialImpactParams): Promise<FinancialImpactResult> {
  const { orgId, start, end, machineId, location, sku, currency, includeEvents } = params;

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

  const missingSkuPairs = events
    .filter((e) => !e.sku && e.workOrderId)
    .map((e) => ({ machineId: e.machineId, workOrderId: e.workOrderId as string }));
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

  const [orgProfileRaw, locationOverrides, machineOverrides, productOverrides] = await Promise.all([
    prisma.orgFinancialProfile.findUnique({ where: { orgId } }),
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

  for (const ev of events) {
    const eventType = String(ev.eventType ?? "").toLowerCase();
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
      costMachine = durationMin * (profile.machineCostPerMin ?? 0);
      costOperator = durationMin * (profile.operatorCostPerMin ?? 0);
      costEnergy = durationMin * (computeEnergyCostPerMin(profile, "running") ?? 0);
      category = "slowCycle";
    } else if (eventType === "microstop" || eventType === "macrostop") {
      //future activestoppage handling
      if (status === "active") continue;
      const rawDurationSec =
        safeNumber(
          inner?.stoppage_duration_seconds ??
            blob?.stoppage_duration_seconds ??
            inner?.stop_duration_seconds ??
            blob?.stop_duration_seconds
        ) ?? 0;
      if (!rawDurationSec || rawDurationSec <= 0) continue;
      const theoreticalSec =
        safeNumber(
          inner?.theoretical_cycle_time ??
            blob?.theoretical_cycle_time ??
            inner?.theoreticalCycleTime ??
            blob?.theoreticalCycleTime
        ) ?? null;
      const lastCycleTimestamp = safeNumber(inner?.last_cycle_timestamp ?? blob?.last_cycle_timestamp);
      const isCycleGapStop = theoreticalSec != null && theoreticalSec > 0 && lastCycleTimestamp == null;
      durationSec = isCycleGapStop ? Math.max(0, rawDurationSec - theoreticalSec) : rawDurationSec;
      if (!durationSec || durationSec <= 0) continue;
      const durationMin = durationSec / 60;
      costMachine = durationMin * (profile.machineCostPerMin ?? 0);
      costOperator = durationMin * (profile.operatorCostPerMin ?? 0);
      costEnergy = durationMin * (computeEnergyCostPerMin(profile, "idle") ?? 0);
      category = eventType === "macrostop" ? "macrostop" : "microstop";
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
      costScrap = scrapParts * (profile.scrapCostPerUnit ?? 0);
      costRawMaterial = scrapParts * (profile.rawMaterialCostPerUnit ?? 0);
      category = "scrap";
    }

    if (!category) continue;

    const costTotal = costMachine + costOperator + costEnergy + costScrap + costRawMaterial;
    if (costTotal <= 0) continue;
    if (currency && profile.currency !== currency) continue;

    const key = profile.currency || "USD";
    const bucket = summaries.get(key) ?? {
      currency: key,
      totals: { total: 0, slowCycle: 0, microstop: 0, macrostop: 0, scrap: 0 },
      byDay: new Map<string, DayRow>(),
    };

    bucket.totals.total += costTotal;
    bucket.totals[category] += costTotal;

    const day = dateKey(ev.ts);
    const dayRow: DayRow = bucket.byDay.get(day) ?? {
      day,
      total: 0,
      slowCycle: 0,
      microstop: 0,
      macrostop: 0,
      scrap: 0,
    };
    dayRow.total += costTotal;
    dayRow[category] += costTotal;
    bucket.byDay.set(day, dayRow);

    summaries.set(key, bucket);
    eventsIncluded += 1;

    if (includeEvents) {
      detailed.push({
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
      });
    }
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
    eventsEvaluated: events.length,
    eventsIncluded,
    events: detailed,
    filters: { machineId, location, sku, currency },
  };
}
