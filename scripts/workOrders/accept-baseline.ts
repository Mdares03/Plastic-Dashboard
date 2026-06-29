/**
 * One-time baseline accept, CLI equivalent of POST /api/health/fix/cycle-backfill
 * (app/api/health/fix/cycle-backfill/route.ts). Upserts a WorkOrderGapAcknowledgement
 * (reason "outbox-freeze-prefix") for every currently-UNEXPLAINED delivery gap — the
 * permanent edge losses (06-15→06-18 enqueue freeze, the target-crossing drop, and the
 * M4-2/OTBM-002 trial-run 8,227) that can never be recovered. After this the board reads
 * clean and only a NEW unexplained gap stands out as a real emergency.
 *
 * Idempotent: acknowledged gaps reclassify to "explained", so a second run accepts 0.
 *
 *   npx dotenv -e .env -- tsx scripts/workOrders/accept-baseline.ts          # dry run
 *   npx dotenv -e .env -- tsx scripts/workOrders/accept-baseline.ts --apply  # write acks
 */
import { prisma } from "@/lib/prisma";
import { getWorkOrderReconciliation } from "@/lib/workOrders/reconciliation";

const ORG = "6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5"; // bemis-2
const REASON = "outbox-freeze-prefix";
const ACK_BY = "baseline-accept:cli";

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await getWorkOrderReconciliation(ORG, { includeActive: true });
  const unexplained = rows.filter((r) => r.delivery === "unexplained" && r.missing > 0);

  console.log(`\nbemis-2 — ${unexplained.length} unexplained gap(s) to accept` + (apply ? "" : "  (dry run)"));
  for (const r of unexplained) {
    console.log(`  ${r.workOrderId.padEnd(14)} ${r.machineName.padEnd(6)} missing=${r.missing}`);
  }
  if (!apply) {
    console.log(`\nNothing written. Re-run with --apply to accept.\n`);
    return;
  }

  let accepted = 0;
  for (const r of unexplained) {
    await prisma.workOrderGapAcknowledgement.upsert({
      where: {
        orgId_machineId_workOrderId: { orgId: ORG, machineId: r.machineId, workOrderId: r.workOrderId },
      },
      create: {
        orgId: ORG,
        machineId: r.machineId,
        workOrderId: r.workOrderId,
        missingAtAck: r.missing,
        reason: REASON,
        acknowledgedBy: ACK_BY,
      },
      update: {}, // already accepted → keep the original acknowledgement
    });
    accepted += 1;
  }
  console.log(`\nAccepted ${accepted} gap(s) as "${REASON}".\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
