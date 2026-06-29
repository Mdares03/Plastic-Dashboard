import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/prisma";
import { RECAP_HEARTBEAT_STALE_MS } from "@/lib/metrics/spec";

/**
 * Member-accessible fleet-freshness rollup — backs the always-on "data flowing"
 * pill in the header. Reports the most-recent contact across the fleet plus how
 * many machines are reporting / stale / in data-loss (Pi up but wireless reader
 * dead). Non-sensitive, so any signed-in member can read it (operators benefit
 * from the ambient "the system is watching" signal). Read-only.
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const machines = await prisma.machine.findMany({
    where: { orgId: session.orgId },
    select: { id: true },
  });
  const ids = machines.map((m) => m.id);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, machines: 0, online: 0, stale: 0, dataLoss: 0, lastSyncTs: null });
  }

  // Latest heartbeat per machine. tsServer (server receipt) is preferred for the
  // "synced ago" age so an edge clock skew can't make the pipe look fresh/stale.
  const hbs = await prisma.machineHeartbeat.findMany({
    where: { orgId: session.orgId, machineId: { in: ids } },
    orderBy: [{ machineId: "asc" }, { tsServer: "desc" }],
    distinct: ["machineId"],
    select: { machineId: true, ts: true, tsServer: true, readerOnline: true },
  });

  const now = Date.now();
  let online = 0;
  let stale = 0;
  let dataLoss = 0;
  let lastSyncMs = 0;
  for (const hb of hbs) {
    const ms = (hb.tsServer ?? hb.ts).getTime();
    if (ms > lastSyncMs) lastSyncMs = ms;
    if (now - ms <= RECAP_HEARTBEAT_STALE_MS) online += 1;
    else stale += 1;
    if (hb.readerOnline === false) dataLoss += 1;
  }
  // Machines that have never sent a heartbeat count as stale.
  stale += ids.length - hbs.length;

  return NextResponse.json({
    ok: true,
    machines: ids.length,
    online,
    stale,
    dataLoss,
    lastSyncTs: lastSyncMs ? new Date(lastSyncMs).toISOString() : null,
  });
}
