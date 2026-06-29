/**
 * Read-only verification exhibit for the work-order audit rework. Runs the real
 * getWorkOrderReconciliation against the local prod DB (bemis-2) and reports how the
 * old single "mismatch" rows reclassify under the new counter / delivery split.
 *
 *   npx dotenv -e .env -- tsx scripts/workOrders/recon-verify.ts
 */
import { getWorkOrderReconciliation } from "@/lib/workOrders/reconciliation";

const ORG = "6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5"; // bemis-2
const SAMPLE = ["OT-TEST-CAV", "230982", "230876", "230875", "230969", "230897", "230910", "230825"];

async function main() {
  const rows = await getWorkOrderReconciliation(ORG, { includeActive: true });

  const counts = {
    counterError: rows.filter((r) => !r.countOk).length,
    unexplained: rows.filter((r) => r.countOk && r.delivery === "unexplained").length,
    recoverable: rows.filter((r) => r.countOk && r.delivery === "recoverable").length,
    explained: rows.filter((r) => r.countOk && r.delivery === "explained").length,
    clean: rows.filter((r) => r.countOk && r.delivery === "none").length,
  };
  const totalMissing = rows.reduce((a, r) => a + (r.delivery === "unexplained" ? r.missing : 0), 0);

  console.log(`\nbemis-2 — ${rows.length} work orders\n`);
  console.log("Classification:");
  console.log(`  counter error (RED)      : ${counts.counterError}`);
  console.log(`  unexplained gap (RED)    : ${counts.unexplained}  (${totalMissing} cycle rows)`);
  console.log(`  catching up (amber)      : ${counts.recoverable}`);
  console.log(`  explained gap (amber)    : ${counts.explained}`);
  console.log(`  reconciled (green)       : ${counts.clean}`);

  console.log("\nSample rows (the wall of red from the screenshot):");
  console.log(
    "  job           cav  rep_cyc  delivered  good  scrap  countOk  missing  delivery",
  );
  for (const id of SAMPLE) {
    const r = rows.find((x) => x.workOrderId === id);
    if (!r) {
      console.log(`  ${id.padEnd(13)} (not found)`);
      continue;
    }
    console.log(
      `  ${r.workOrderId.padEnd(13)} ${String(r.activeCavities ?? "-").padStart(3)}  ${String(
        r.reportedCycleCount,
      ).padStart(7)}  ${String(r.cyclesCounted).padStart(9)}  ${String(r.goodParts).padStart(4)}  ${String(
        r.scrapParts,
      ).padStart(5)}  ${String(r.countOk).padStart(7)}  ${String(r.missing).padStart(7)}  ${r.delivery}`,
    );
  }
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
