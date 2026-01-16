import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { getOverviewData } from "@/lib/overview/getOverviewData";

function toMs(value?: Date | null) {
  return value ? value.getTime() : 0;
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const eventsMode = url.searchParams.get("events") ?? "critical";
  const eventsWindowSecRaw = Number(url.searchParams.get("eventsWindowSec") ?? "21600");
  const eventsWindowSec = Number.isFinite(eventsWindowSecRaw) ? eventsWindowSecRaw : 21600;
  const eventMachinesRaw = Number(url.searchParams.get("eventMachines") ?? "6");
  const eventMachines = Number.isFinite(eventMachinesRaw) ? Math.max(1, eventMachinesRaw) : 6;
  const [machineAgg, heartbeatAgg, kpiAgg, eventAgg, orgSettings] = await Promise.all([
    prisma.machine.aggregate({
      where: { orgId: session.orgId },
      _max: { updatedAt: true },
    }),
    prisma.machineHeartbeat.aggregate({
      where: { orgId: session.orgId },
      _max: { tsServer: true },
    }),
    prisma.machineKpiSnapshot.aggregate({
      where: { orgId: session.orgId },
      _max: { tsServer: true },
    }),
    prisma.machineEvent.aggregate({
      where: { orgId: session.orgId },
      _max: { tsServer: true },
    }),
    prisma.orgSettings.findUnique({
      where: { orgId: session.orgId },
      select: { updatedAt: true, stoppageMultiplier: true, macroStoppageMultiplier: true },
    }),
  ]);

  const lastModifiedMs = Math.max(
    toMs(machineAgg._max.updatedAt),
    toMs(heartbeatAgg._max.tsServer),
    toMs(kpiAgg._max.tsServer),
    toMs(eventAgg._max.tsServer),
    toMs(orgSettings?.updatedAt)
  );

  const versionParts = [
    session.orgId,
    eventsMode,
    eventsWindowSec,
    eventMachines,
    toMs(machineAgg._max.updatedAt),
    toMs(heartbeatAgg._max.tsServer),
    toMs(kpiAgg._max.tsServer),
    toMs(eventAgg._max.tsServer),
    toMs(orgSettings?.updatedAt),
  ];

  const etag = `W/"${createHash("sha1").update(versionParts.join("|")).digest("hex")}"`;
  const lastModified = new Date(lastModifiedMs || 0).toUTCString();
  const responseHeaders = new Headers({
    "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
    ETag: etag,
    "Last-Modified": lastModified,
    Vary: "Cookie",
  });

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers: responseHeaders });
  }

  const ifModifiedSince = req.headers.get("if-modified-since");
  if (!ifNoneMatch && ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    if (!Number.isNaN(since) && lastModifiedMs <= since) {
      return new NextResponse(null, { status: 304, headers: responseHeaders });
    }
  }

  const { machines: machineRows, events } = await getOverviewData({
    orgId: session.orgId,
    eventsMode,
    eventsWindowSec,
    eventMachines,
    orgSettings,
  });

  return NextResponse.json(
    { ok: true, machines: machineRows, events },
    { headers: responseHeaders }
  );
}
