/**
 * Idempotent Phase 6 edge-flow patches for the Node-RED flow.
 *
 * The edge is code: rather than hand-editing escaped JS inside a 400KB JSON, this
 * script loads the flow, rewrites specific function nodes' `.func` by name, and
 * writes valid JSON back. Re-runnable — if you re-export the flow from Node-RED,
 * run this again to re-apply. Each edit detects its own marker and skips if present.
 *
 *   node scripts/edge/apply-phase6-edits.mjs [in.json] [--out out.json]
 * Defaults: in = edge/flows.json, out = in (in place).
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const inPath = args.find((a) => !a.startsWith("--")) ?? "edge/flows.json";
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : inPath;

const flow = JSON.parse(readFileSync(inPath, "utf8"));
const byName = (name) => flow.find((n) => n.type === "function" && (n.name || "") === name);
const applied = [];
const skipped = [];

function patchFunc(name, marker, newFunc) {
  const node = byName(name);
  if (!node) {
    skipped.push(`${name} (NODE NOT FOUND)`);
    return;
  }
  if ((node.func || "").includes(marker)) {
    skipped.push(`${name} (already patched: ${marker})`);
    return;
  }
  node.func = newFunc;
  applied.push(`${name} → ${marker}`);
}

// Apply exact string replacements within a node's func, idempotently: each pair
// is applied only if `from` is present and `to` is not already there.
function patchReplacements(name, label, pairs) {
  const node = byName(name);
  if (!node) {
    skipped.push(`${name} (NODE NOT FOUND)`);
    return;
  }
  let func = node.func || "";
  let changed = 0;
  for (const [from, to] of pairs) {
    if (func.includes(to)) continue; // already patched
    if (!func.includes(from)) {
      skipped.push(`${name}: '${from.slice(0, 40)}…' not found`);
      continue;
    }
    func = func.split(from).join(to);
    changed += 1;
  }
  if (changed) {
    node.func = func;
    applied.push(`${name} → ${label} (${changed} repl)`);
  } else {
    skipped.push(`${name} (${label}: nothing to change)`);
  }
}

// ── P6.2: restore a stable, type-independent incidentKey ────────────────────
// The flow emits alert_id = "<type>:<workOrderId>:<lastCycleTime>"; a micro→macro
// escalation changes only <type>, which (without a unified key) splits one physical
// stoppage into two incidents → two alert emails. The backend alert engine reads
// payload.incidentKey/inner.incidentKey first, then falls back to alert_id. Emitting
// a collapsed "downtime:<wo>:<lastCycleTime>" key restores one-incident-per-episode
// (the pre-regression flows-68 behaviour).
patchFunc(
  "Build Event Outbox Payload",
  "Phase 6 (P6.2)",
  `// Build event outbox payload (direct HTTP disabled)

const event = msg.payload || {};
msg.tsMs = typeof event.tsMs === "number" ? event.tsMs : Date.now();

// Phase 6 (P6.2): restore a stable, type-INDEPENDENT incidentKey so the backend
// alert engine dedups per physical stoppage EPISODE, not per (type) event. alert_id
// is "<type>:<workOrderId>:<lastCycleTime>"; a micro->macro escalation changes only
// the <type> segment, which without this splits one stoppage into two incidents
// (two emails). Collapsing micro/macrostop to "downtime:<wo>:<lastCycleTime>" matches
// the pre-regression (flows 68) behaviour.
function deriveIncidentKey(ev) {
    if (ev.incidentKey) return ev.incidentKey;
    const type = ev.anomaly_type || ev.type || "";
    const id = ev.alert_id || ev.alertId || null;
    if (type === "mold-change") {
        const d = ev.data || {};
        const start = d.start_ms || d.startMs || ev.startMs || ev.tsMs || msg.tsMs;
        return "mold-change:" + start;
    }
    if ((type === "microstop" || type === "macrostop") && typeof id === "string") {
        const parts = id.split(":");
        if (parts.length >= 3) return "downtime:" + parts.slice(1).join(":");
    }
    return (typeof id === "string" && id) ? id : null;
}

const incidentKey = deriveIncidentKey(event);
if (incidentKey) {
    event.incidentKey = incidentKey;
    event.data = event.data || {};
    if (!event.data.incidentKey) event.data.incidentKey = incidentKey;
}

msg.outbox = {
    type: "event",
    payload: { event },
};
return msg;`
);

// ── P6.3: persist state-bearing context to the "file" store ─────────────────
// anomalyState (active stoppage + cycle tracking), anomaly (acks/reasons) and
// zeroStreak are held in in-memory context, so a reboot mid-stoppage loses the
// active episode → wrong downtime. Route just these keys to a persistent "file"
// store (default store stays memory). REQUIRES the contextStorage block in the
// Pi's settings.js (edge/settings.contextStorage.snippet.js) — deploy that +
// restart Node-RED BEFORE importing this flow, or the "file" store is undefined.
patchReplacements("Anomaly Detector", "P6.3 persist anomalyState/anomaly", [
  ['global.get("anomaly")', 'global.get("anomaly", "file")'],
  ['global.get("anomalyState")', 'global.get("anomalyState", "file")'],
  ['global.set("anomalyState", anomalyState)', 'global.set("anomalyState", anomalyState, "file")'],
]);
patchReplacements("Handle Anomaly Acknowledgment", "P6.3 persist anomaly", [
  ['global.get("anomaly")', 'global.get("anomaly", "file")'],
  ['global.set("anomaly", anomaly)', 'global.set("anomaly", anomaly, "file")'],
]);
patchReplacements("Machine cycles", "P6.3 persist zeroStreak", [
  ['flow.get("zeroStreak")', 'flow.get("zeroStreak", "file")'],
  ['flow.set("zeroStreak", zeroStreak)', 'flow.set("zeroStreak", zeroStreak, "file")'],
]);

writeFileSync(outPath, JSON.stringify(flow, null, 4) + "\n");
console.log(`Read ${inPath} (${flow.length} nodes) → wrote ${outPath}`);
console.log("Applied:", applied.length ? "\n  " + applied.join("\n  ") : "(none)");
if (skipped.length) console.log("Skipped:\n  " + skipped.join("\n  "));
