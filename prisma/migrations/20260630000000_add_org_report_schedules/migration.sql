-- Per-org report email schedule (item 1): one row per (org, report kind).
CREATE TABLE "org_report_schedules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "report_type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hour_utc" INTEGER NOT NULL DEFAULT 13,
    "day_of_week" INTEGER,
    "day_of_month" INTEGER,
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "org_report_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_report_schedules_org_id_report_type_key" ON "org_report_schedules"("org_id", "report_type");
CREATE INDEX "org_report_schedules_org_id_idx" ON "org_report_schedules"("org_id");

ALTER TABLE "org_report_schedules" ADD CONSTRAINT "org_report_schedules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
