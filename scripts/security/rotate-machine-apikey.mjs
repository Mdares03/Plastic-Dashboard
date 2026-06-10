import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// Rotates Machine.apiKey. The current keys appear in committed Node-RED flow
// exports (now under edge/), so they must be treated as leaked and rotated
// before the system goes live again. Dry-run by default; --apply executes.
//
// Usage:
//   node scripts/security/rotate-machine-apikey.mjs                      # dry run, all machines
//   node scripts/security/rotate-machine-apikey.mjs --machine-id <uuid>  # dry run, one machine
//   node scripts/security/rotate-machine-apikey.mjs --apply [--machine-id <uuid>]
//
// After --apply, update each Pi BEFORE resuming ingest:
//   1. SSH to the Pi and update the api_key in the Node-RED `current_config`
//      (Settings fetch / global context), or re-pair the machine.
//   2. Restart Node-RED and confirm a heartbeat lands (IngestLog) with the new key.
//   3. Old key stops working immediately on --apply — only run this while the
//      pilot is paused or with the Pi update ready to go.

const prisma = new PrismaClient();

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

const apply = process.argv.includes("--apply");
const machineId = argValue("--machine-id");

function newApiKey() {
  return randomBytes(32).toString("hex");
}

function preview(key) {
  if (!key) return null;
  return `${key.slice(0, 6)}…(${key.length} chars)`;
}

async function main() {
  const machines = await prisma.machine.findMany({
    where: machineId ? { id: machineId } : {},
    select: { id: true, orgId: true, name: true, apiKey: true, updatedAt: true },
    orderBy: { name: "asc" },
  });

  if (machines.length === 0) {
    console.log(JSON.stringify({ dry_run: !apply, machines_found: 0 }, null, 2));
    return;
  }

  const results = [];
  for (const m of machines) {
    const nextKey = newApiKey();
    if (apply) {
      await prisma.machine.update({
        where: { id: m.id },
        data: { apiKey: nextKey },
      });
    }
    results.push({
      machine_id: m.id,
      name: m.name,
      org_id: m.orgId,
      old_key_preview: preview(m.apiKey),
      // Full new key is only printed on --apply, since that's the one moment
      // it must be copied to the Pi. Dry runs never mint a usable key.
      new_key: apply ? nextKey : `(generated on --apply)`,
      action: apply ? "rotated" : "would_rotate",
    });
  }

  console.log(
    JSON.stringify(
      {
        dry_run: !apply,
        machines_found: machines.length,
        results,
        next_steps: apply
          ? "Update each Pi current_config with new_key, restart Node-RED, verify heartbeat."
          : "Re-run with --apply to rotate. Have Pi access ready: old keys die immediately.",
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
