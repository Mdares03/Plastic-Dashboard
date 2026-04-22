import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import fs from "fs";
import { getLogPath } from "@/lib/logger";

const MAX_LINES = 100;

/**
 * GET /api/debug/logs?key=YOUR_DEBUG_LOGS_KEY
 *
 * Returns the last MAX_LINES from the app log file. Set DEBUG_LOGS_KEY in .env
 * and call with ?key=... to view. If DEBUG_LOGS_KEY is unset, returns 401.
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const secret = process.env.DEBUG_LOGS_KEY;

  if (!secret || key !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logPath = getLogPath();
  try {
    const raw = fs.readFileSync(logPath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const recent = lines.slice(-MAX_LINES);
    return NextResponse.json({
      logPath,
      lines: recent.length,
      entries: recent.map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return { raw: line };
        }
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to read log file", detail: message, logPath },
      { status: 500 }
    );
  }
}
