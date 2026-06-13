/**
 * Idempotent edge-split flow patches (plan: composed-wandering-ember).
 *
 * Edits EXISTING function nodes in edge/flows.json for the wireless split. New
 * nodes (the MQTT input adapter, clock responder) are built in the editor — see
 * edge/nodered-snippets/. Re-runnable: each edit is skipped if already present.
 *
 *   node scripts/edge/apply-edge-split.mjs [in.json] [--out out.json]
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

// Apply exact string replacements within a node's func, idempotently.
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
    skipped.push(`${name} (already patched: ${label})`);
  }
}

// ── E3: rebase cycle time onto the ESP32 edge timestamp ─────────────────────
// `Machine cycles` is edge-triggered; its top-of-node `now` is THE edge-event
// time threaded through lastCycleCompletionTime / actualCycleTime delta / tsMs.
// Prefer the ESP32's absolute-UTC edge time (msg.tsDevice) so wireless latency &
// post-dropout backlog don't smear cycle durations; Date.now() stays as the
// fallback for any non-edge trigger. (Anomaly Detector is a live 1s tick and is
// intentionally left on Date.now() — it reads the now-device-UTC lastMachineCycleTime.)
patchReplacements("Machine cycles", "E3 device-time", [
  [
    "const now = Date.now();",
    'const now = (typeof msg.tsDevice === "number" && isFinite(msg.tsDevice)) ? msg.tsDevice : Date.now(); // E3: ESP32 edge time (abs UTC); Date.now() fallback for non-edge triggers',
  ],
]);

// ── E4: suppress false stoppages during DATA_LOSS ───────────────────────────
// When the wireless reader is dead (Pi liveness monitor sets global "readerOnline"
// = false), absence of cycles is UNEXPLAINED, not a machine stop. Gate the
// no-new-cycle stoppage block so the Pi doesn't emit phantom micro/macrostops
// (which would become false ReasonEntry downtime). The dashboard shows data-loss
// instead (lib/metrics/machineState.ts). KPI-history pushes are unaffected.
patchReplacements("Anomaly Detector", "E4 data-loss suppression", [
  [
    "const now = Date.now();",
    'const now = Date.now();\nconst readerLinkOk = global.get("readerOnline") !== false; // E4: false => wireless reader dead (DATA_LOSS)',
  ],
  [
    "if (!hasNewCycle && lastCycleTime > 0) {",
    "if (!hasNewCycle && lastCycleTime > 0 && readerLinkOk) {",
  ],
]);

// ── E4: enrich the Pi->cloud heartbeat with reader-link + clock health ──────
// The cloud derives DATA_LOSS and the clock-sync/reader-link health checks from
// these. Globals are set by the editor-built liveness nodes (see nodered-snippets);
// typeof guards send null ("not reported") if those aren't deployed yet, so this is
// safe to ship ahead of them and never emits a false signal.
patchReplacements("Online HeartBeat", "E4 heartbeat reader fields", [
  [
    "const signature = JSON.stringify({ status, ip, fwVersion });",
    `// Edge split (§D/§E): Pi NTP sync + wireless reader link health.
const clockSynced = (typeof global.get("clockSynced") === "boolean") ? global.get("clockSynced") : null;
const readerOnline = (typeof global.get("readerOnline") === "boolean") ? global.get("readerOnline") : null;
const readerClockSynced = (typeof global.get("readerClockSynced") === "boolean") ? global.get("readerClockSynced") : null;
const readerBufferDepth = (typeof global.get("readerBufferDepth") === "number") ? global.get("readerBufferDepth") : null;
// readerOnline in the signature → a DATA_LOSS transition forces an immediate heartbeat.
const signature = JSON.stringify({ status, ip, fwVersion, clockSynced, readerOnline });`,
  ],
  [
    "payload: { status, message, ip, fwVersion },",
    "payload: { status, message, ip, fwVersion, clockSynced, readerOnline, readerClockSynced, readerBufferDepth },",
  ],
]);

writeFileSync(outPath, JSON.stringify(flow, null, 4) + "\n");
console.log(`Read ${inPath} (${flow.length} nodes) → wrote ${outPath}`);
console.log("Applied:", applied.length ? "\n  " + applied.join("\n  ") : "(none)");
console.log("Skipped:", skipped.length ? "\n  " + skipped.join("\n  ") : "(none)");
