import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { generatePairingCode } from "@/lib/pairingCode";
import { z } from "zod";
import { logLine } from "@/lib/logger";
import { elapsedMs, formatServerTiming, nowMs, PERF_LOGS_ENABLED } from "@/lib/perf/serverTiming";
import { requireSession } from "@/lib/auth/requireSession";
import {
  fetchLatestHeartbeats,
  fetchLatestKpis,
  fetchMachineBase,
  mergeMachineOverviewRows,
} from "@/lib/machines/withLatest";

let machinesColdStart = true;

function getColdStartInfo() {
  const coldStart = machinesColdStart;
  machinesColdStart = false;
  return { coldStart, uptimeMs: Math.round(process.uptime() * 1000) };
}

const createMachineSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().max(40).optional(),
  location: z.string().trim().max(80).optional(),
});

export async function GET(req: Request) {
  const perfEnabled = PERF_LOGS_ENABLED;
  const totalStart = nowMs();
  const timings: Record<string, number> = {};
  const { coldStart, uptimeMs } = getColdStartInfo();
  const url = new URL(req.url);
  const includeKpi = url.searchParams.get("includeKpi") === "1";

  const authStart = nowMs();
  const session = await requireSession();
  if (perfEnabled) timings.auth = elapsedMs(authStart);
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const preQueryStart = nowMs();
  const machinesStart = nowMs();
  if (perfEnabled) timings.preQuery = elapsedMs(preQueryStart);
  const machines = await fetchMachineBase(session.orgId);
  if (perfEnabled) timings.machinesQuery = elapsedMs(machinesStart);

  const heartbeatStart = nowMs();
  const machineIds = machines.map((machine) => machine.id);
  const heartbeats = await fetchLatestHeartbeats(session.orgId, machineIds);
  if (perfEnabled) timings.heartbeatsQuery = elapsedMs(heartbeatStart);

  let kpis: Awaited<ReturnType<typeof fetchLatestKpis>> = [];
  if (includeKpi) {
    const kpiStart = nowMs();
    kpis = await fetchLatestKpis(session.orgId, machineIds);
    if (perfEnabled) timings.kpiQuery = elapsedMs(kpiStart);
  }

  const postQueryStart = nowMs();

  // flatten latest heartbeat for UI convenience
  const out = mergeMachineOverviewRows({
    machines,
    heartbeats,
    kpis,
    includeKpi,
  });

  const payload = { ok: true, machines: out };

  const responseHeaders = new Headers();
  if (perfEnabled) {
    timings.postQuery = elapsedMs(postQueryStart);
    timings.total = elapsedMs(totalStart);
    responseHeaders.set("Server-Timing", formatServerTiming(timings));
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
    logLine("perf.machines.api", {
      orgId: session.orgId,
      coldStart,
      uptimeMs,
      timings,
      counts: { machines: out.length },
      payloadBytes,
    });
  }

  return NextResponse.json(payload, { headers: responseHeaders });
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = createMachineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid machine payload" }, { status: 400 });
  }

  const name = parsed.data.name;
  const codeRaw = parsed.data.code ?? "";
  const locationRaw = parsed.data.location ?? "";

  const existing = await prisma.machine.findFirst({
    where: { orgId: session.orgId, name },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ ok: false, error: "Machine name already exists" }, { status: 409 });
  }

  const apiKey = randomBytes(24).toString("hex");
  const pairingExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let machine = null as null | {
    id: string;
    name: string;
    code?: string | null;
    location?: string | null;
    pairingCode?: string | null;
    pairingCodeExpiresAt?: Date | null;
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const pairingCode = generatePairingCode();
    try {
      machine = await prisma.machine.create({
        data: {
          orgId: session.orgId,
          name,
          code: codeRaw || null,
          location: locationRaw || null,
          apiKey,
          pairingCode,
          pairingCodeExpiresAt: pairingExpiresAt,
        },
        select: {
          id: true,
          name: true,
          code: true,
          location: true,
          pairingCode: true,
          pairingCodeExpiresAt: true,
        },
      });
      break;
    } catch (err: unknown) {
      const code = typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
      if (code !== "P2002") throw err;
    }
  }

  if (!machine?.pairingCode) {
    return NextResponse.json({ ok: false, error: "Failed to generate pairing code" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, machine });
}
