Root cause found — CT has no authoritative WO counters
The actual bug
Your Node-RED writes goodParts/scrapParts/cycleCount to the Pi's MariaDB work_orders table. That's local. It never gets written to CT's Postgres machine_work_orders table — which the Prisma model doesn't even declare those columns. Confirmed:

model MachineWorkOrder {
  id, orgId, machineId, workOrderId, sku, targetQty, cycleTime, status, createdAt, updatedAt
  // NO good_parts, scrap_parts, cycle_count
}
lib/recap/getRecapData.ts line 259 probes information_schema.columns for those columns → always finds zero → workOrderCountersAvailable = false → loadWorkOrderCounterRows returns null → falls back to KPI delta math.

The KPI delta math (line 700 area):

const rangeGood = Math.max(0, (agg.maxGood ?? 0) - (agg.minGood ?? agg.maxGood ?? 0));
Node-RED sends the cumulative activeWorkOrder.goodParts in every KPI snapshot (not delta). If the WO has 353 parts now and has been stable (mold change, no new parts) across the 24h window, min=maxGood=353 → rangeGood = 0. If there was a brief scrap entry or counter drift, you get rangeGood = 1. That's where your "1 good part" comes from.

Recap is structurally unable to match Node-RED until CT persists the authoritative counter.

Fix — 3 changes, in order
1. Add counter columns to CT schema
File: prisma/schema.prisma

model MachineWorkOrder {
  id          String   @id @default(uuid())
  orgId       String
  machineId   String
  workOrderId String
  sku         String?
  targetQty   Int?
  cycleTime   Float?
  status      String   @default("PENDING")
  goodParts   Int      @default(0) @map("good_parts")    // NEW
  scrapParts  Int      @default(0) @map("scrap_parts")   // NEW
  cycleCount  Int      @default(0) @map("cycle_count")   // NEW
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  // rest unchanged
}
Generate migration: npx prisma migrate dev --name add_wo_counters. Run on prod DB.

2. Have KPI ingest upsert the counters
File: app/api/ingest/kpi/route.ts

Each KPI payload from Node-RED contains:

"activeWorkOrder": { "id": "OTBM-002", "sku": "RAMBOX", "goodParts": 353, "scrapParts": 1, "cycleCount": 353 }
Inside the handler, after creating the MachineKpiSnapshot, add:

const awo = payload?.activeWorkOrder;
if (awo?.id) {
  await prisma.machineWorkOrder.upsert({
    where: { machineId_workOrderId: { machineId: machine.id, workOrderId: String(awo.id) } },
    create: {
      orgId: machine.orgId,
      machineId: machine.id,
      workOrderId: String(awo.id),
      sku: awo.sku ?? null,
      targetQty: Number(awo.target) || null,
      cycleTime: Number(awo.cycleTime) || null,
      status: awo.status ?? "RUNNING",
      goodParts: Number(awo.goodParts) || 0,
      scrapParts: Number(awo.scrapParts) || 0,
      cycleCount: Number(awo.cycleCount) || 0,
    },
    update: {
      sku: awo.sku ?? undefined,
      targetQty: Number(awo.target) || undefined,
      cycleTime: Number(awo.cycleTime) || undefined,
      status: awo.status ?? undefined,
      goodParts: Number(awo.goodParts) || 0,
      scrapParts: Number(awo.scrapParts) || 0,
      cycleCount: Number(awo.cycleCount) || 0,
    },
  });
}
This makes CT's machine_work_orders rows track Pi's live state minute-by-minute.

3. Simplify recap aggregation
File: lib/recap/getRecapData.ts

Now that the columns exist, loadWorkOrderCounterRows will work. But also drop the updatedAt BETWEEN filter — it excludes WOs that haven't ticked recently (e.g. during mold change):

// REMOVE:
AND "updatedAt" >= ${params.start}
AND "updatedAt" <= ${params.end}

// KEEP only:
WHERE "orgId" = ${params.orgId}
  AND "machineId" IN (${machineIdList})
Return all WOs for the machine; filter client-side or by another criterion if needed. For the "last 24h production" metric, sum goodParts across all WOs (simple, matches Home UI).

Also remove the whole KPI-delta fallback block (lines ~600-760) — don't need it anymore. The authoritative counter is always present once changes 1+2 are deployed.

Other issues you flagged
OEE 75% vs 47%: Recap uses time-weighted average across the window (24h including hours of stopped machine → pulls avg down). Machine detail shows a shorter-window or last-snapshot value. Decision: Recap avg is technically correct for "24h avg"; Machine detail's 75% is the "current instantaneous" OEE. Label them clearly: "OEE promedio 24h: 47%" vs "OEE actual: 75%". Don't make them the same number — they measure different things. Show both if you want.

Machine detail timeline flickering: probably a client useEffect dependency loop or a polling interval too short. Check app/(app)/machines/[machineId]/MachineDetailClient.tsx for a setInterval or SWR revalidation. Likely you're re-fetching every 2-3s and the data comes back with slightly different timestamps, causing re-render. Fix: increase poll to 15-30s and compare by segment hash before updating state.

"1 good part" bug: will self-fix once #1 and #2 are deployed (recap reads authoritative column instead of computing bad delta).

Deployment order
Merge schema migration to main. Run prisma migrate deploy in prod.
Ship KPI ingest change — Node-RED starts populating counters immediately.
Ship recap simplification — hits the now-populated columns.
Watch for ~5 min for CT to catch up (KPI ticks every minute from Pi).
Verify: SELECT work_order_id, good_parts, scrap_parts FROM machine_work_orders WHERE machine_id = '<uuid>' ORDER BY updated_at DESC LIMIT 5; — should match Home UI (353).
No Node-RED changes needed. Pi is already sending the right data; CT just wasn't storing it.