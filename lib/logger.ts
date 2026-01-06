import fs from "fs";
import path from "path";

const LOG_PATH = process.env.LOG_FILE || "/tmp/mis-control-tower.log";

export function logLine(event: string, data: Record<string, any> = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...data,
  });
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line + "\n", { encoding: "utf8" });
  } catch {
    // If file logging fails, we still want something:
    console.error("[logLine-failed]", line);
  }
}
