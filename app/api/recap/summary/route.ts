import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { getRecapSummaryCached, parseRecapSummaryHours } from "@/lib/recap/redesign";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const hours = parseRecapSummaryHours(url.searchParams.get("hours"));
  const summary = await getRecapSummaryCached({ orgId: session.orgId, hours });

  return NextResponse.json(summary, {
    headers: {
      "Cache-Control": "private, max-age=60, stale-while-revalidate=60",
    },
  });
}
