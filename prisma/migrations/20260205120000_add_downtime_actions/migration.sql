-- CreateTable
CREATE TABLE "downtime_actions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "machine_id" TEXT,
    "reason_code" TEXT,
    "hm_day" INTEGER,
    "hm_hour" INTEGER,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "due_date" TIMESTAMP(3),
    "reminder_at" TIMESTAMP(3),
    "last_reminder_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "owner_user_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "downtime_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "downtime_actions_org_id_idx" ON "downtime_actions"("org_id");

-- CreateIndex
CREATE INDEX "downtime_actions_org_id_machine_id_idx" ON "downtime_actions"("org_id", "machine_id");

-- CreateIndex
CREATE INDEX "downtime_actions_org_id_reason_code_idx" ON "downtime_actions"("org_id", "reason_code");

-- CreateIndex
CREATE INDEX "downtime_actions_org_id_hm_day_hm_hour_idx" ON "downtime_actions"("org_id", "hm_day", "hm_hour");

-- CreateIndex
CREATE INDEX "downtime_actions_org_id_status_due_date_idx" ON "downtime_actions"("org_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "downtime_actions_owner_user_id_idx" ON "downtime_actions"("owner_user_id");

-- AddForeignKey
ALTER TABLE "downtime_actions" ADD CONSTRAINT "downtime_actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_actions" ADD CONSTRAINT "downtime_actions_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_actions" ADD CONSTRAINT "downtime_actions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downtime_actions" ADD CONSTRAINT "downtime_actions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
