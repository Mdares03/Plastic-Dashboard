import { NextResponse } from "next/server";
import { logLine } from "@/lib/logger";

export async function GET() {
  logLine("health.hit", { ok: true });
  return NextResponse.json({ ok: true });
}
