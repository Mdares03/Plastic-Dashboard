import { prisma } from "@/lib/prisma";
import {
  isScheduleDue,
  normalizeSchedule,
  resolveRecipients,
  type ReportType,
} from "@/lib/reports/schedule";

/**
 * Schedule-aware fan-out for the report email endpoints (item 1).
 *
 * The cron endpoints used to send to every org unconditionally. They now call this
 * helper, which — per org — loads the OrgReportSchedule row (or a sensible default),
 * checks due-ness against `now` (so an hourly cron never double-sends), resolves
 * recipients (explicit list, else the org's active alert contacts), invokes the
 * caller's `send`, and records `lastSentAt`. Per-org failures are isolated.
 */

export type DispatchResult = {
  sent: string[];
  skipped: number;
  failures: Array<{ orgId: string; error: string }>;
};

export async function runScheduledReport(opts: {
  reportType: ReportType;
  onlyOrgId?: string | null;
  /** Skip the due-ness check (manual "send now"). Recipients + lastSentAt still apply. */
  force?: boolean;
  now?: Date;
  send: (ctx: { org: { id: string; name: string }; recipients: string[] }) => Promise<void>;
}): Promise<DispatchResult> {
  const now = opts.now ?? new Date();

  const orgs = await prisma.org.findMany({
    where: opts.onlyOrgId ? { id: opts.onlyOrgId } : {},
    select: { id: true, name: true },
  });
  const orgIds = orgs.map((o) => o.id);
  if (orgIds.length === 0) return { sent: [], skipped: 0, failures: [] };

  const [schedules, contacts] = await Promise.all([
    prisma.orgReportSchedule.findMany({
      where: { orgId: { in: orgIds }, reportType: opts.reportType },
    }),
    prisma.alertContact.findMany({
      where: { orgId: { in: orgIds }, isActive: true, email: { not: null } },
      select: { orgId: true, email: true },
    }),
  ]);

  const scheduleByOrg = new Map(schedules.map((s) => [s.orgId, s]));
  const contactsByOrg = new Map<string, string[]>();
  for (const c of contacts) {
    if (!c.email) continue;
    const list = contactsByOrg.get(c.orgId) ?? [];
    list.push(c.email);
    contactsByOrg.set(c.orgId, list);
  }

  const result: DispatchResult = { sent: [], skipped: 0, failures: [] };

  for (const org of orgs) {
    try {
      const schedule = normalizeSchedule(opts.reportType, scheduleByOrg.get(org.id));
      if (!opts.force && !isScheduleDue(schedule, now)) {
        result.skipped += 1;
        continue;
      }
      // A forced send still requires the report to be enabled (avoid surprise sends
      // for a report an org explicitly turned off).
      if (opts.force && !schedule.enabled) {
        result.skipped += 1;
        continue;
      }

      const recipients = resolveRecipients(schedule.recipients, contactsByOrg.get(org.id) ?? []);
      if (recipients.length === 0) {
        result.skipped += 1;
        continue;
      }

      await opts.send({ org, recipients });

      await prisma.orgReportSchedule.upsert({
        where: { orgId_reportType: { orgId: org.id, reportType: opts.reportType } },
        create: {
          orgId: org.id,
          reportType: opts.reportType,
          enabled: schedule.enabled,
          frequency: schedule.frequency,
          recipients: schedule.recipients,
          hourUtc: schedule.hourUtc,
          dayOfWeek: schedule.dayOfWeek,
          dayOfMonth: schedule.dayOfMonth,
          lastSentAt: now,
        },
        update: { lastSentAt: now },
      });

      result.sent.push(org.id);
    } catch (err) {
      result.failures.push({ orgId: org.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
