// Cleanup of `alert-delivery-failed` machine events.
//
// These rows are created (severity=critical, requiresAck=true) whenever an
// alert notification fails to send — e.g. while SMTP is turned off. They are
// in-app noise, not emails, and nothing has a foreign key to them, so deleting
// is safe.
//
// Usage (run from a host that can reach the target DB):
//   node scripts/cleanup-alert-delivery-failed.mjs            # dry run: counts only
//   node scripts/cleanup-alert-delivery-failed.mjs --apply    # actually delete
//
// Point at the right DB via DATABASE_URL, e.g.:
//   DATABASE_URL="postgresql://user:pass@host:5432/db" node scripts/cleanup-alert-delivery-failed.mjs --apply
//
// Optional: also clear the failed rows from the alert_notifications send-log
// (dedup history) by adding --notifications.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const alsoNotifications = process.argv.includes("--notifications");

const where = { eventType: "alert-delivery-failed" };

try {
  const total = await prisma.machineEvent.count({ where });
  const oldest = await prisma.machineEvent.findFirst({ where, orderBy: { ts: "asc" }, select: { ts: true } });
  const newest = await prisma.machineEvent.findFirst({ where, orderBy: { ts: "desc" }, select: { ts: true } });
  const failedNotifs = await prisma.alertNotification.count({ where: { status: "failed" } });

  console.log(`alert-delivery-failed machine_events: ${total}`);
  console.log(`  oldest: ${oldest?.ts ?? "-"}  newest: ${newest?.ts ?? "-"}`);
  console.log(`alert_notifications (status=failed) log rows: ${failedNotifs}`);

  if (!apply) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --apply to delete.");
  } else {
    const del = await prisma.machineEvent.deleteMany({ where });
    console.log(`\nDeleted ${del.count} alert-delivery-failed machine_events.`);
    if (alsoNotifications) {
      const delN = await prisma.alertNotification.deleteMany({ where: { status: "failed" } });
      console.log(`Deleted ${delN.count} failed alert_notifications log rows.`);
    }
  }
} finally {
  await prisma.$disconnect();
}
