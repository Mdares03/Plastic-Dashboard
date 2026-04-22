import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logLine } from "@/lib/logger";

export const dynamic = "force-dynamic";

type PerfPayload = {
  event?: string;
  data?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PerfPayload;
    const type = typeof body?.event === "string" ? body.event : "nav";
    const data = body?.data && typeof body.data === "object" ? body.data : {};
    const userAgent = req.headers.get("user-agent") ?? "";

    logLine("perf.client", {
      type,
      userAgent,
      ...data,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logLine("perf.client.error", { message });
    return NextResponse.json({ ok: false, error: "Bad payload" }, { status: 400 });
  }
}
