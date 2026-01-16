type NormalizeThresholds = {
  microMultiplier: number;
  macroMultiplier: number;
};

type RawEventRow = {
  id: string;
  ts?: Date | null;
  topic?: string | null;
  eventType?: string | null;
  severity?: string | null;
  title?: string | null;
  description?: string | null;
  requiresAck?: boolean | null;
  data?: unknown;
  workOrderId?: string | null;
};

function coerceString(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

export function normalizeEvent(row: RawEventRow, thresholds: NormalizeThresholds) {
  // -----------------------------
  // 1) Parse row.data safely
  // data may be:
  //   - object
  //   - array of objects
  //   - JSON string of either
  // -----------------------------
  const raw = row.data;

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw; // keep as string if not JSON
    }
  }

  // data can be object OR [object]
  const blob = Array.isArray(parsed) ? parsed[0] : parsed;

  // some payloads nest details under blob.data
  const inner = (blob as { data?: unknown })?.data ?? blob ?? {};

  const normalizeType = (t: unknown) =>
    String(t ?? "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");

  // -----------------------------
  // 2) Alias mapping (canonical types)
  // -----------------------------
  const ALIAS: Record<string, string> = {
    // Spanish / synonyms
    macroparo: "macrostop",
    "macro-stop": "macrostop",
    macro_stop: "macrostop",

    microparo: "microstop",
    "micro-paro": "microstop",
    micro_stop: "microstop",

    // Node-RED types
    "production-stopped": "stop", // we'll classify to micro/macro below

    // legacy / generic
    down: "stop",
  };

  // -----------------------------
  // 3) Determine event type from DB or blob
  // -----------------------------
  const fromDbType = row.eventType && row.eventType !== "unknown" ? row.eventType : null;

  const fromBlobType =
    (blob as { anomaly_type?: unknown; eventType?: unknown; topic?: unknown })?.anomaly_type ??
    (blob as { anomaly_type?: unknown; eventType?: unknown; topic?: unknown })?.eventType ??
    (blob as { anomaly_type?: unknown; eventType?: unknown; topic?: unknown })?.topic ??
    (inner as { anomaly_type?: unknown; eventType?: unknown })?.anomaly_type ??
    (inner as { anomaly_type?: unknown; eventType?: unknown })?.eventType ??
    null;

  // infer slow-cycle if signature exists
  const inferredType =
    fromDbType ??
    fromBlobType ??
    (((inner as { actual_cycle_time?: unknown; theoretical_cycle_time?: unknown })?.actual_cycle_time &&
      (inner as { actual_cycle_time?: unknown; theoretical_cycle_time?: unknown })?.theoretical_cycle_time) ||
    ((blob as { actual_cycle_time?: unknown; theoretical_cycle_time?: unknown })?.actual_cycle_time &&
      (blob as { actual_cycle_time?: unknown; theoretical_cycle_time?: unknown })?.theoretical_cycle_time)
      ? "slow-cycle"
      : "unknown");

  const eventTypeRaw = normalizeType(inferredType);
  let eventType = ALIAS[eventTypeRaw] ?? eventTypeRaw;

  // -----------------------------
  // 4) Optional: classify "stop" into micro/macro based on duration if present
  // (keeps old rows usable even if they stored production-stopped)
  // -----------------------------
  if (eventType === "stop") {
    const innerData = inner as {
      stoppage_duration_seconds?: unknown;
      stop_duration_seconds?: unknown;
      theoretical_cycle_time?: unknown;
    };
    const blobData = blob as {
      stoppage_duration_seconds?: unknown;
      stop_duration_seconds?: unknown;
      theoretical_cycle_time?: unknown;
    };

    const stopSec =
      (typeof innerData?.stoppage_duration_seconds === "number" && innerData.stoppage_duration_seconds) ||
      (typeof blobData?.stoppage_duration_seconds === "number" && blobData.stoppage_duration_seconds) ||
      (typeof innerData?.stop_duration_seconds === "number" && innerData.stop_duration_seconds) ||
      null;

    const microMultiplier = Number(thresholds?.microMultiplier ?? 1.5);
    const macroMultiplier = Math.max(microMultiplier, Number(thresholds?.macroMultiplier ?? 5));

    const theoreticalCycle =
      Number(innerData?.theoretical_cycle_time ?? blobData?.theoretical_cycle_time) || 0;

    if (stopSec != null) {
      if (theoreticalCycle > 0) {
        const macroThresholdSec = theoreticalCycle * macroMultiplier;
        eventType = stopSec >= macroThresholdSec ? "macrostop" : "microstop";
      } else {
        const fallbackMacroSec = 300;
        eventType = stopSec >= fallbackMacroSec ? "macrostop" : "microstop";
      }
    }
  }

  // -----------------------------
  // 5) Severity, title, description, timestamp
  // -----------------------------
  const severity =
    String(
      (row.severity && row.severity !== "info" ? row.severity : null) ??
        (blob as { severity?: unknown })?.severity ??
        (inner as { severity?: unknown })?.severity ??
        "info"
    )
      .trim()
      .toLowerCase();

  const title =
    String(
      (row.title && row.title !== "Event" ? row.title : null) ??
        (blob as { title?: unknown })?.title ??
        (inner as { title?: unknown })?.title ??
        (eventType === "slow-cycle" ? "Slow Cycle Detected" : "Event")
    ).trim();

  const description =
    row.description ??
    (blob as { description?: string | null })?.description ??
    (inner as { description?: string | null })?.description ??
    (eventType === "slow-cycle" &&
    ((inner as { actual_cycle_time?: unknown })?.actual_cycle_time ??
      (blob as { actual_cycle_time?: unknown })?.actual_cycle_time) &&
    ((inner as { theoretical_cycle_time?: unknown })?.theoretical_cycle_time ??
      (blob as { theoretical_cycle_time?: unknown })?.theoretical_cycle_time) &&
    ((inner as { delta_percent?: unknown })?.delta_percent ??
      (blob as { delta_percent?: unknown })?.delta_percent) != null
      ? `Cycle took ${Number(
          (inner as { actual_cycle_time?: unknown })?.actual_cycle_time ??
            (blob as { actual_cycle_time?: unknown })?.actual_cycle_time
        ).toFixed(1)}s (+${Number(
          (inner as { delta_percent?: unknown })?.delta_percent ??
            (blob as { delta_percent?: unknown })?.delta_percent
        )}% vs ${Number(
          (inner as { theoretical_cycle_time?: unknown })?.theoretical_cycle_time ??
            (blob as { theoretical_cycle_time?: unknown })?.theoretical_cycle_time
        ).toFixed(1)}s objetivo)`
      : null);

  const ts =
    row.ts ??
    (typeof (blob as { timestamp?: unknown })?.timestamp === "number"
      ? new Date((blob as { timestamp?: number }).timestamp as number)
      : null) ??
    (typeof (inner as { timestamp?: unknown })?.timestamp === "number"
      ? new Date((inner as { timestamp?: number }).timestamp as number)
      : null) ??
    null;

  const workOrderId =
    coerceString(row.workOrderId) ??
    coerceString((blob as { work_order_id?: unknown })?.work_order_id) ??
    coerceString((inner as { work_order_id?: unknown })?.work_order_id) ??
    null;

  return {
    id: row.id,
    ts,
    topic: String(row.topic ?? (blob as { topic?: unknown })?.topic ?? eventType),
    eventType,
    severity,
    title,
    description,
    requiresAck: !!row.requiresAck,
    workOrderId,
  };
}
