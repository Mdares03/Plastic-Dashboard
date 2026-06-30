/**
 * Read-only P4 probe: identify M4-2 / OTBM-002, its work-order mold/cavities
 * state, and its last cloud signals (heartbeat / kpi / cycle), so the
 * "set cavitiesActive on the Asiento 170 mold" fix and the "why did the edge go
 * quiet ~06-10" question can be teed up. Does NOT write anything.
 *
 *   npx dotenv -e .env -- tsx scripts/workOrders/m42-cavities-probe.ts
 */
import { prisma } from "@/lib/prisma";

const ORG = "6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5"; // bemis-2

async function main() {
  const m = await prisma.machine.findFirst({
    where: { orgId: ORG, OR: [{ name: { contains: "M4-2" } }, { code: { contains: "M42" } }] },
    select: { id: true, name: true, code: true },
  });
  if (!m) { console.log("M4-2 not found"); return; }
  console.log("MACHINE:", JSON.stringify(m));

  const wos = await prisma.machineWorkOrder.findMany({
    where: { machineId: m.id },
    select: { workOrderId: true, status: true, mold: true, cavitiesActive: true, cavitiesTotal: true, cycleCount: true, goodParts: true, scrapParts: true },
  });
  console.log("\nWORK ORDERS:");
  for (const w of wos) console.log(" ", JSON.stringify(w));

  const [hb, kpi, cyc, evt] = await Promise.all([
    prisma.machineHeartbeat.findFirst({ where: { machineId: m.id }, orderBy: { ts: "desc" }, select: { ts: true, status: true, readerOnline: true, clockSynced: true } }),
    prisma.machineKpiSnapshot.findFirst({ where: { machineId: m.id }, orderBy: { ts: "desc" }, select: { ts: true, cycleCount: true } }),
    prisma.machineCycle.findFirst({ where: { machineId: m.id }, orderBy: { ts: "desc" }, select: { ts: true, cycleCount: true } }),
    prisma.machineEvent.findFirst({ where: { machineId: m.id }, orderBy: { ts: "desc" }, select: { ts: true, eventType: true } }),
  ]);
  const now = Date.now();
  const ago = (d?: Date | null) => d ? `${((now - d.getTime()) / 86400000).toFixed(1)}d ago` : "—";
  console.log("\nLAST CLOUD SIGNALS:");
  console.log("  heartbeat:", hb ? `${hb.ts.toISOString()} (${ago(hb.ts)}) status=${hb.status} readerOnline=${hb.readerOnline} clockSynced=${hb.clockSynced}` : "none");
  console.log("  kpi snap :", kpi ? `${kpi.ts.toISOString()} (${ago(kpi.ts)}) cycleCount=${kpi.cycleCount}` : "none");
  console.log("  cycle row:", cyc ? `${cyc.ts.toISOString()} (${ago(cyc.ts)}) cycleCount=${cyc.cycleCount}` : "none");
  console.log("  event    :", evt ? `${evt.ts.toISOString()} (${ago(evt.ts)}) type=${evt.eventType}` : "none");
}

main().finally(() => prisma.$disconnect());
