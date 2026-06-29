/**
 * Read-only exhibit: runs the real runConsistencyChecks against the local prod DB
 * (bemis-2) and prints each check's status/detail. Used to sanity-check new checks
 * (e.g. delivery_pipeline) without a browser session.
 *
 *   npx dotenv -e .env -- tsx scripts/health/verify-checks.ts
 */
import { runConsistencyChecks } from "@/lib/health/checks";

const ORG = "6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5"; // bemis-2

async function main() {
  const checks = await runConsistencyChecks(ORG);
  for (const c of checks) {
    const vars = c.detailVars ? `  ${JSON.stringify(c.detailVars)}` : "";
    console.log(`  [${c.status.toUpperCase().padEnd(4)}] ${c.name.padEnd(22)} ${c.detail}${vars}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
