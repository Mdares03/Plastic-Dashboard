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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value: number, currency: string) {
  if (!Number.isFinite(value)) return "--";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatNumber(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "--";
  return value.toFixed(digits);
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
  const summaryBlocks = impact.currencySummaries
    .map(
      (summary) => `
        <div class="card">
          <div class="card-title">${escapeHtml(summary.currency)}</div>
          <div class="card-value">${escapeHtml(formatMoney(summary.totals.total, summary.currency))}</div>
          <div class="card-sub">Slow: ${escapeHtml(formatMoney(summary.totals.slowCycle, summary.currency))}</div>
          <div class="card-sub">Micro: ${escapeHtml(formatMoney(summary.totals.microstop, summary.currency))}</div>
          <div class="card-sub">Macro: ${escapeHtml(formatMoney(summary.totals.macrostop, summary.currency))}</div>
          <div class="card-sub">Scrap: ${escapeHtml(formatMoney(summary.totals.scrap, summary.currency))}</div>
        </div>
      `
    )
    .join("");

  const dailyTables = impact.currencySummaries
    .map((summary) => {
      const rows = summary.byDay
        .map(
          (row) => `
          <tr>
            <td>${escapeHtml(row.day)}</td>
            <td>${escapeHtml(formatMoney(row.total, summary.currency))}</td>
            <td>${escapeHtml(formatMoney(row.slowCycle, summary.currency))}</td>
            <td>${escapeHtml(formatMoney(row.microstop, summary.currency))}</td>
            <td>${escapeHtml(formatMoney(row.macrostop, summary.currency))}</td>
            <td>${escapeHtml(formatMoney(row.scrap, summary.currency))}</td>
          </tr>
        `
        )
        .join("");

      return `
        <section class="section">
          <h3>${escapeHtml(summary.currency)} Daily Breakdown</h3>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Total</th>
                <th>Slow</th>
                <th>Micro</th>
                <th>Macro</th>
                <th>Scrap</th>
              </tr>
            </thead>
            <tbody>
              ${rows || "<tr><td colspan=\"6\">No data</td></tr>"}
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");

  const eventRows = impact.events
    .map(
      (e) => `
        <tr>
          <td>${escapeHtml(e.ts.toISOString())}</td>
          <td>${escapeHtml(e.eventType)}</td>
          <td>${escapeHtml(e.category)}</td>
          <td>${escapeHtml(e.machineName ?? "-")}</td>
          <td>${escapeHtml(e.location ?? "-")}</td>
          <td>${escapeHtml(e.sku ?? "-")}</td>
          <td>${escapeHtml(e.workOrderId ?? "-")}</td>
          <td>${escapeHtml(formatNumber(e.durationSec))}</td>
          <td>${escapeHtml(formatMoney(e.costTotal, e.currency))}</td>
          <td>${escapeHtml(e.currency)}</td>
        </tr>
      `
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Financial Impact Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
    h1 { margin: 0 0 6px; }
    .muted { color: #64748b; font-size: 12px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 20px 0; }
    .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; }
    .card-title { font-size: 12px; text-transform: uppercase; color: #64748b; }
    .card-value { font-size: 20px; font-weight: 700; margin: 8px 0; }
    .card-sub { font-size: 12px; color: #475569; }
    .section { margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px; font-size: 12px; text-align: left; }
    th { background: #f8fafc; }
    footer { margin-top: 32px; text-align: right; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <header>
    <h1>Financial Impact Report</h1>
    <div class="muted">${escapeHtml(orgName)} | ${escapeHtml(start.toISOString())} - ${escapeHtml(end.toISOString())}</div>
  </header>

  <section class="cards">
    ${summaryBlocks || "<div class=\"muted\">No totals yet.</div>"}
  </section>

  ${dailyTables}

  <section class="section">
    <h3>Event Details</h3>
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Event</th>
          <th>Category</th>
          <th>Machine</th>
          <th>Location</th>
          <th>SKU</th>
          <th>Work Order</th>
          <th>Duration (sec)</th>
          <th>Cost</th>
          <th>Currency</th>
        </tr>
      </thead>
      <tbody>
        ${eventRows || "<tr><td colspan=\"10\">No events</td></tr>"}
      </tbody>
    </table>
  </section>

  <footer>Power by MaliounTech</footer>
</body>
</html>`;

  const fileName = `financial_report_${slugify(orgName)}.html`;
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
    },
  });
}
