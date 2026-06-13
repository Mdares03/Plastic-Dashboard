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

writeFileSync(outPath, JSON.stringify(flow, null, 4) + "\n");
console.log(`Read ${inPath} (${flow.length} nodes) → wrote ${outPath}`);
console.log("Applied:", applied.length ? "\n  " + applied.join("\n  ") : "(none)");
console.log("Skipped:", skipped.length ? "\n  " + skipped.join("\n  ") : "(none)");
