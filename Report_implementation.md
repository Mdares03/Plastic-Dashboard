# Weekly Executive Report — Implementation Handoff

## Goal

Add a weekly executive report to `/reports`. New "Descargar reporte semanal" button at top of the existing reports page opens a printable 2-page view (Spanish, rolling last 7 days). PDF via browser print.

Audience: BEMIS director/owner. Tone: honest, operations-first.

---

## Scope summary

| Field | Value |
|---|---|
| Route | `/reports/weekly` |
| Trigger | Button on `/reports` page |
| Default window | Rolling 7 days |
| Language | es-MX |
| Pages | 2 (A4) |
| PDF | Browser print + `@media print` stylesheet (Phase 1) |

---

## Report contents (final)

### Page 1 — Resumen ejecutivo

1. **Header** — date range, planta, machines included, generated timestamp
2. **KPI strip (4 cards)**
   - Producción vs plan (good parts / target qty)
   - OEE promedio
   - Pérdida estimada en MXN
   - % de paros clasificados (con meta)
3. **Snapshot por máquina** — one card per active machine (M4-2, M4-5):
   - OEE / A / P / Q
   - Unidades producidas
   - Razón principal de pérdida
4. **Tendencia OEE 7 días** — line chart vs target
5. **Top 3 pérdidas** — reason, minutes, events, $ impact, contextual note

### Page 2 — Detalle operativo

6. **Rendimiento de ciclos por OT** — table: WO, SKU, ciclo objetivo, ciclo real promedio, Δ%, unidades
7. **Paros clasificados**
   - Pareto (top reasons by minutes)
   - Comparación por turno (downtime minutes per shift)
8. **Scrap clasificado — top 3 SKUs** — sku, unidades scrap, % scrap, razón principal, $ estimado
9. **Estatus de órdenes de trabajo** — WO, SKU, máquina, target, completado, %, status
10. **Acciones recomendadas** — title, responsable, recuperable $, plazo
11. **Nota de calidad de datos** — % clasificación, meta, contexto

**Explicitly excluded**: energy cost.

---

## Files to create

```
app/
  api/reports/weekly/
    route.ts                       ← GET /api/reports/weekly?from=&to=
  (app)/reports/weekly/
    page.tsx                       ← Server component
    WeeklyReportClient.tsx         ← Client wrapper (handles ?print=1 → window.print)

lib/reports/
  weeklyReport.ts                  ← Composes report data (calls subqueries)
  queries/
    production.ts                  ← Production vs target
    oee.ts                         ← Per-machine + aggregate OEE/A/P/Q
    oeeTrend.ts                    ← 7-day daily rollup
    losses.ts                      ← Top losses by reason + $ impact
    cyclePerformance.ts            ← Cycle time per WO
    downtimeByShift.ts             ← Downtime bucketed by OrgShift
    scrapTopSkus.ts                ← Top 3 scrap SKUs
    workOrderStatus.ts             ← Current WO progress
    classificationRate.ts          ← Classified episodes / total stop episodes
    recommendedActions.ts          ← Open DowntimeAction + fallback
  types.ts                         ← WeeklyReport interface
  printStyles.ts                   ← Print CSS (or in globals.css)

components/reports/weekly/
  WeeklyReport.tsx                 ← Page layout (both pages)
  WeeklyReportButton.tsx           ← Download button
  sections/
    HeaderBand.tsx
    KpiStrip.tsx
    MachineSnapshot.tsx
    OeeTrendChart.tsx
    TopLossesCard.tsx
    CyclePerformanceTable.tsx
    DowntimeClassified.tsx         ← Pareto + shift comparison
    ScrapTopOffenders.tsx
    WorkOrderStatusTable.tsx
    RecommendedActions.tsx
    DataQualityNote.tsx
```

## Files to modify

- `app/(app)/reports/page.tsx` — add "Descargar reporte semanal" button (top right of header)
- `app/(app)/reports/ReportsPageClient.tsx` — wire button to `window.open('/reports/weekly?print=1', '_blank')`
- `app/globals.css` — add `@media print` block (page sizing, hide nav, page breaks)
- `lib/i18n/es-MX.json` — add weekly report copy strings

---

## Data shape

```ts
// lib/reports/types.ts

export interface WeeklyReport {
  period: { from: string; to: string; generatedAt: string };
  org: { name: string; plant: string };
  machineIds: string[];

  // KPI strip
  production: { good: number; target: number; pct: number };
  oeeAvg: number;
  availabilityAvg: number;
  performanceAvg: number;
  qualityAvg: number;
  estimatedLossMXN: number;
  classificationRate: number;      // 0–1
  classificationTarget: number;    // 0.8

  machines: MachineSnapshot[];
  oeeTrend7d: { date: string; oee: number; target: number }[];
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
  contextNote?: string;            // optional human-friendly hint
}

export interface CyclePerfRow {
  workOrderId: string;
  sku: string;
  machineName: string;
  targetCycleSec: number;
  actualAvgCycleSec: number;
  deltaPct: number;                // positive = slower than target
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
```

---

## Data sourcing — query notes

| Field | Source | Notes |
|---|---|---|
| `production` | `MachineWorkOrder` filtered by `updatedAt` in window; sum `goodParts`, `targetQty` | Filter `orgId` |
| `oeeAvg / A / P / Q` | `MachineKpiSnapshot.ts` in window, group by day then average | Skip rows where snapshot has all zeros (machine offline) |
| `estimatedLossMXN` | downtime minutes × `machineCostPerMin` + scrap units × `scrapCostPerUnit` | Use `MachineFinancialOverride` first, fall back to `OrgFinancialProfile` |
| `classificationRate` | `count(ReasonEntry where kind='downtime' and reasonCode != 'UNCLASSIFIED')` / `count(stop episodes from MachineEvent eventType in ('macrostop','microstop'))` | "Episodes" = events with `severity` indicating stop start |
| `machines[]` | per-machine roll-up of above | Active = has heartbeats in window |
| `oeeTrend7d` | `MachineKpiSnapshot` grouped by `date_trunc('day', ts)`, avg OEE | Target = constant from `OrgSettings.oeeAlertThresholdPct` or hardcode 65 |
| `topLosses` | `ReasonEntry where kind='downtime'` grouped by `reasonCode`, sum `durationSeconds`, count, multiply minutes × cost | Top 3 |
| `workOrderCycles` | `MachineCycle` joined to `MachineWorkOrder` on `workOrderId`; avg `actualCycleTime` per WO; `targetCycleSec = MachineWorkOrder.cycleTime` | Only WOs with cycles in window |
| `downtimeByReason` | same as topLosses but full list | Sort desc |
| `downtimeByShift` | `ReasonEntry where kind='downtime'`, bucket `capturedAt` by `OrgShift.startTime/endTime` | Use org timezone from `OrgSettings.timezone` |
| `scrapTopSkus` | `ReasonEntry where kind='scrap'` grouped by `meta->>'sku'` or via `workOrderId → MachineWorkOrder.sku` | Top 3 by `scrapQty`; compute % from total parts of that SKU in window |
| `workOrderStatus` | `MachineWorkOrder` snapshot at end of window (currently active or completed during window) | Show 10 most relevant |
| `recommendedActions` | `DowntimeAction where status='open'` ordered by priority + dueDate, top 3-5; if none, derive from `topLosses` with placeholder text | Link `reasonCode` |

`machineCostPerMin` resolution order: `MachineFinancialOverride` → `LocationFinancialOverride` → `OrgFinancialProfile.machineCostPerMin`. If all null, omit cost columns (don't show $0).

---

## API endpoint

```
GET /api/reports/weekly?from=ISO&to=ISO
```

- Auth: session cookie, same as other authed routes
- `from` / `to` optional; default `to=now`, `from=now-7d`
- Response: `WeeklyReport` JSON
- Implementation: `lib/reports/weeklyReport.ts` orchestrates all subqueries in parallel (`Promise.all`)

---

## UI / print layout

Page sizes itself for A4 (210 × 297 mm) with 12mm margins. Two `<section class="page">` blocks separated by `page-break-before: always`. Each page targets ~270mm content height.

Print CSS:

```css
@media print {
  @page { size: A4; margin: 12mm; }

  body { background: white; font-size: 10.5pt; line-height: 1.4; }
  .no-print { display: none !important; }
  .page-break { page-break-before: always; }
  section.page { break-inside: avoid; }

  /* hide app nav, sidebar, topbar */
  aside, nav, header[role="banner"] { display: none !important; }
}
```

Print trigger:

```ts
// WeeklyReportClient.tsx
useEffect(() => {
  if (searchParams.get('print') === '1') {
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }
}, []);
```

Web view (no `?print=1`) shows the same component without auto-print so the user can preview in-app before downloading.

---

## Button placement

`app/(app)/reports/page.tsx` — top right of the page header, next to existing filters:

```tsx
<button
  onClick={() => window.open('/reports/weekly?print=1', '_blank')}
  className="..."
>
  <DownloadIcon className="..." />
  Descargar reporte semanal
</button>
```

Also include a secondary link "Ver reporte (preview)" → opens `/reports/weekly` without `?print=1` for the user to inspect before sending.

---

## Acceptance criteria

- [ ] `/reports` shows "Descargar reporte semanal" button in header
- [ ] Click opens `/reports/weekly?print=1` in new tab, browser print dialog fires automatically after ~600ms
- [ ] `/reports/weekly` (no query) renders inline as preview, no print dialog
- [ ] All 11 sections populate from live data, no mocked numbers
- [ ] Default window is rolling 7 days; respects `from`/`to` query params if present
- [ ] Per-machine snapshot renders one card per active machine in the org (currently M4-2, M4-5)
- [ ] Cost columns hide entirely if `machineCostPerMin` and `scrapCostPerUnit` are both null
- [ ] Scrap top 3 section hides entirely if no scrap in window
- [ ] Recommended actions falls back to top-3 losses with placeholder copy if no open `DowntimeAction` exists
- [ ] Spanish copy uses `es-MX` keys from `lib/i18n/es-MX.json`
- [ ] Prints to exactly 2 A4 pages
- [ ] App nav/sidebar hidden in print output
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] `sudo systemctl restart mis-control-tower` and verify on prod URL

---

## Implementation order (suggested)

1. **Types + API skeleton** — `types.ts`, `weeklyReport.ts` stub, `route.ts` returning hardcoded shape. Verify endpoint reachable.
2. **Queries one at a time** — implement each subquery file, test in isolation against live DB. Most critical: `losses.ts`, `oee.ts`, `cyclePerformance.ts`.
3. **Layout shell** — `WeeklyReport.tsx` with all 11 section components stubbed, hooked to real data.
4. **Section components** — fill in one at a time, verify each against the mockup.
5. **Print CSS** — A4 sizing, page breaks, hide nav.
6. **Button + integration** — wire from `/reports` page.
7. **Polish** — copy review, number formatting (`toLocaleString('es-MX')`), null handling.

Verify after each step: `npx tsc --noEmit` → reload in browser.

---

## Open questions to confirm before coding

1. **Cost components** — does "Pérdida estimada" include only downtime × machineCostPerMin, or also performance loss (slow cycles × cost) and scrap × scrapCostPerUnit? Recommend: all three, labeled separately in tooltip on hover (web), aggregated in print.

In theory, all 3 are already in financial section, please confirm

2. **OEE target** — fixed 65%? Pull from `OrgSettings.oeeAlertThresholdPct`? Recommend: pull from settings, fallback 85.

recommendation is good

3. **Shift labels** — `OrgShift.name` is whatever exists in DB. Confirm BEMIS has 3 shifts populated; if not, group all downtime as "Sin turno".

Recommendation sounds good but double check with me with more info

4. **WO status table** — how many rows max? Recommend: top 10 active WOs by units remaining.

Top 10

5. **Date picker on web view** — should the preview have a week picker, or stay rolling-7-days only? Recommend: rolling only for v1, picker later.

Recommendation is good

---

## Phase 2 (not in scope, for the record)

- Server-side PDF rendering via puppeteer (better fidelity than browser print)
- Auto-email scheduled delivery (Sundays 6am)
- Week-over-week comparison ("vs semana anterior")
- Per-machine variants of the report
- Sharing/permalinks with frozen snapshot of a past week