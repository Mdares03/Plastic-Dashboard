import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { getBaseUrl } from "@/lib/appUrl";
import { generateReportPdf } from "@/lib/reports/pdf";

/**
 * On-screen "Download PDF" for the weekly/daily report (item 3). Session-gated;
 * mints a print token scoped to the caller's own org and streams the rendered PDF.
 * `type` is a query param (not a path segment) to avoid shadowing the static
 * /api/reports/{weekly,daily,roi} route folders.
 *
 *   GET /api/reports/pdf?type=weekly
 *   GET /api/reports/pdf?type=daily
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const type = new URL(req.url).searchParams.get("type");
  if (type !== "weekly" && type !== "daily") {
    return NextResponse.json({ ok: false, error: "Unknown report type" }, { status: 400 });
  }

  const window =
    type === "daily"
      ? (() => {
          const to = new Date();
          return { from: new Date(to.getTime() - DAY_MS).toISOString(), to: to.toISOString() };
        })()
      : {};

  try {
    const pdf = await generateReportPdf({
      payload: { type, orgId: session.orgId, ...window },
      baseUrl: getBaseUrl(req),
    });
    const fileName = `${type}_report.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "PDF generation failed" },
      { status: 500 }
    );
  }
}
