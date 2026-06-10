Recap Redesign — Handoff Prompt
Goal
Replace the current aggregated /recap view with a two-level drill-down: machine grid → machine-specific 24h detail. One machine = one clear story. No mixed averages.

Architecture
/recap                    → grid of machine cards (overview)
/recap/[machineId]        → full recap detail for one machine
Level 1: /recap (grid)
Layout
Reuse the pattern from app/(app)/machines/MachinesClient.tsx. Same card grid, same responsive breakpoints, same filters (location, status).

Card contents (per machine)
Header: machine name + location + status dot (green=running, amber=mold-change, red=stopped, gray=offline)
Big number: today's OEE % (or good parts — pick one primary metric and stick with it)
Secondary row: good parts · scrap · stops count
Mini timeline bar: compressed 24h bar (height 20px), same color coding as detail page. No labels, tooltip only. Clicking anywhere navigates to detail.
Footer: "Última actividad hace X min" or current WO id if active
Banners (inline, colored):
If mold-change active → amber: "Cambio de molde en curso · Xm"
If machine offline >10 min → red: "Sin señal hace Xm"
Data source
New endpoint app/api/recap/summary/route.ts — returns array of per-machine summaries in one query. Cache 60s.

GET /api/recap/summary?hours=24
→ {
    machines: [{
      machineId, name, location, status,
      oee, goodParts, scrap, stopsCount,
      lastSeenMs, activeWorkOrderId,
      moldChange: { active, startMs } | null,
      miniTimeline: Segment[]  // compressed, max ~30 segments
    }]
  }
Empty / loading states
Skeleton cards while loading (pulse animation, same size as real card).
Zero-activity machine: card renders but with "Sin producción" muted text, gray mini bar, metric "—".
Level 2: /recap/[machineId]
Layout (top to bottom)
Back arrow + machine name breadcrumb — ← Todas las máquinas / M4-5
Range picker — 24h / Turno actual / Ayer / Personalizado (top-right)
Banners — mold-change / offline / ongoing-stop (full-width, colored)
KPI row (4 cards) — OEE, Buenas, Paros totales (min), Scrap
Timeline 24h — full-width smooth bar (see fix from previous message: min 1.5% width, no dots, merged consecutive stops)
Two-column row:
Left: Producción por SKU (table) — SKU | Buenas | Scrap | Meta | Avance%
Right: Top downtime (pareto) — top 3 reasons with minutes + percent
Work orders — two side-by-side lists:
Completadas: id, SKU, parts, duration
Activa: id, SKU, progress bar, started-at
Estado máquina — last heartbeat, uptime %, connection status
Data source
Endpoint app/api/recap/[machineId]/route.ts — the detailed payload (shape I already documented in the earlier handoff). Cache 60s keyed by {machineId, range}.

Navigation
Sidebar "Resumen" stays → routes to /recap grid.
MachineCard onClick → router.push('/recap/' + machineId).
Breadcrumb on detail page navigates back to grid.
Deep link safe: /recap/<uuid> works standalone.
Shared components
Build these in components/recap/:

RecapMachineCard.tsx — the grid card. Props: machine summary object.
RecapMiniTimeline.tsx — 20px-high compressed bar, no labels, tooltip only.
RecapFullTimeline.tsx — 48-56px bar, labels on wide segments (>5% width), minimum segment width 1.5%, rounded only on first/last child.
RecapKpiRow.tsx — reused from prior design.
RecapProductionBySku.tsx, RecapDowntimeTop.tsx, RecapWorkOrders.tsx, RecapMachineStatus.tsx — detail-page sections.
RecapBanners.tsx — mold-change / offline / ongoing-stop alert bars.
Timeline specifics (fix the ugly-dots issue)
Both mini and full versions share segment-builder logic. Server-side:

Walk 24h chronologically, produce raw segments from MachineCycle, MachineEvent, MachineWorkOrder.
Gap-fill — any time between segments with no data → idle segment.
Merge pass — consecutive same-type segments separated by <30s → merge.
Absorb micro-runs — runs of microstops closer than 60s → single microstop-cluster segment with aggregated duration and count.
Minimum display width — server returns raw segments; client enforces Math.max(1.5, pct) so nothing renders as a dot.
Client:

display: flex; overflow: hidden; border-radius: 0.75rem on container.
Each child: width % only, no margin, no gap, no border-right.
Only labels if segment width >5% (else title tooltip).
Color map exactly:
production: bg-emerald-500 text-black
mold-change: bg-sky-400 text-black
macrostop: bg-red-500 text-white
microstop: bg-orange-500 text-black
idle: bg-zinc-700 text-zinc-300
i18n
Every user-visible string routes through useI18n(). Add to Spanish locale (primary):

recap.grid.title = "Resumen de máquinas"
recap.grid.subtitle = "Últimas 24h · click para ver detalle"
recap.detail.back = "Todas las máquinas"
recap.card.oee = "OEE"
recap.card.good = "Piezas buenas"
recap.card.stops = "Paros"
recap.banner.moldChange = "Cambio de molde en curso desde {time}"
recap.banner.offline = "Sin señal hace {min} min"
recap.banner.ongoingStop = "Máquina detenida hace {min} min"
recap.production.bySku = "Producción por SKU"
recap.downtime.top = "Top paros"
...
English keys mirror.

Accessibility / responsive
Cards collapse to single column <640px.
Timeline stays readable — horizontal scroll if really tight.
Keyboard navigable: cards are <button> or <Link>, not divs.
Status dots have aria-label.
Permissions
Same as /machines — any authenticated org member. No OWNER gate.

Files to create
app/(app)/recap/page.tsx (server, fetches summary)
app/(app)/recap/RecapGridClient.tsx (client, renders cards + filters)
app/(app)/recap/[machineId]/page.tsx (server, fetches detail)
app/(app)/recap/[machineId]/RecapDetailClient.tsx (client, renders detail)
app/api/recap/summary/route.ts
app/api/recap/[machineId]/route.ts
components/recap/* (per list above)
Files to delete / repurpose
The current aggregated recap (if it exists at /recap with mixed-machine view) — replace with the grid.
Any "global OEE average across all machines" widget — remove. Too misleading.
Testing checklist
not done
Grid renders for org with 5+ machines without lag (1 query, not N+1)
not done
Clicking a card navigates to correct detail page
not done
Detail page works for offline machine (no panic)
not done
Mold-change banner appears on both grid card AND detail page
not done
Timeline shows no dots — segments have visible width or get merged
not done
Mini timeline and full timeline use identical color palette
not done
Back navigation works, range picker persists in URL query
not done
Mobile layout: cards stack, detail sections stack
Non-goals
No real-time websockets — polling on focus is fine
No PDF/email export in this iteration
No shift-boundary magic (use wall-clock 24h unless user picks "Turno actual")
No schema changes