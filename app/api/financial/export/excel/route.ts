import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/prisma";
import { computeFinancialImpact } from "@/lib/financial/impact";

const RANGE_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function canManageFinancials(role?: string | null) {
  return role === "OWNER";
}

function parseDate(input?: string | null) {
  if (!input) return null;
  const n = Number(input);
  if (!Number.isNaN(n)) return new Date(n);
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickRange(req: NextRequest) {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "7d";
  const now = new Date();

  if (range === "custom") {
    const start = parseDate(url.searchParams.get("start")) ?? new Date(now.getTime() - RANGE_MS["24h"]);
    const end = parseDate(url.searchParams.get("end")) ?? now;
    return { start, end };
  }

  const ms = RANGE_MS[range] ?? RANGE_MS["24h"];
  return { start: new Date(now.getTime() - ms), end: now };
}

function csvValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function formatNumber(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toFixed(4);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "report";
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const membership = await prisma.orgUser.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    select: { role: true },
  });
  if (!canManageFinancials(membership?.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const { start, end } = pickRange(req);
  const machineId = url.searchParams.get("machineId") ?? undefined;
  const location = url.searchParams.get("location") ?? undefined;
  const sku = url.searchParams.get("sku") ?? undefined;
  const currency = url.searchParams.get("currency") ?? undefined;

  const [org, impact] = await Promise.all([
    prisma.org.findUnique({ where: { id: session.orgId }, select: { name: true } }),
    computeFinancialImpact({
      orgId: session.orgId,
      start,
      end,
      machineId,
      location,
      sku,
      currency,
      includeEvents: true,
    }),
  ]);

  const orgName = org?.name ?? "Organization";
  const header = [
    "org_name",
    "range_start",
    "range_end",
    "event_id",
    "event_ts",
    "event_type",
    "status",
    "severity",
    "category",
    "machine_id",
    "machine_name",
    "location",
    "work_order_id",
    "sku",
    "duration_sec",
    "cost_machine",
    "cost_operator",
    "cost_energy",
    "cost_scrap",
    "cost_raw_material",
    "cost_total",
    "currency",
  ];

  const rows = impact.events.map((event) => [
    orgName,
    start.toISOString(),
    end.toISOString(),
    event.id,
    event.ts.toISOString(),
    event.eventType,
    event.status,
    event.severity,
    event.category,
    event.machineId,
    event.machineName ?? "",
    event.location ?? "",
    event.workOrderId ?? "",
    event.sku ?? "",
    formatNumber(event.durationSec),
    formatNumber(event.costMachine),
    formatNumber(event.costOperator),
    formatNumber(event.costEnergy),
    formatNumber(event.costScrap),
    formatNumber(event.costRawMaterial),
    formatNumber(event.costTotal),
    event.currency,
  ]);

  const lines = [header, ...rows].map((row) => row.map(csvValue).join(","));
  const csv = lines.join("\n");

  const fileName = `financial_events_${slugify(orgName)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
    },
  });
}
