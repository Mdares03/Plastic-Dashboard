-- DropForeignKey
ALTER TABLE "alert_contacts" DROP CONSTRAINT "alert_contacts_org_id_fkey";

-- DropForeignKey
ALTER TABLE "alert_contacts" DROP CONSTRAINT "alert_contacts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "alert_notifications" DROP CONSTRAINT "alert_notifications_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "alert_notifications" DROP CONSTRAINT "alert_notifications_machine_id_fkey";

-- DropForeignKey
ALTER TABLE "alert_notifications" DROP CONSTRAINT "alert_notifications_org_id_fkey";

-- DropForeignKey
ALTER TABLE "alert_notifications" DROP CONSTRAINT "alert_notifications_user_id_fkey";

-- DropForeignKey
ALTER TABLE "alert_policies" DROP CONSTRAINT "alert_policies_org_id_fkey";

-- AlterTable
ALTER TABLE "alert_contacts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "alert_policies" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ReasonEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "episodeId" TEXT,
    "durationSeconds" INTEGER,
    "episodeEndTs" TIMESTAMP(3),
    "scrapEntryId" TEXT,
    "scrapQty" INTEGER,
    "scrapUnit" TEXT,
    "reasonCode" TEXT NOT NULL,
    "reasonLabel" TEXT,
    "reasonText" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "workOrderId" TEXT,
    "meta" JSONB,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReasonEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReasonEntry_reasonId_key" ON "ReasonEntry"("reasonId");

-- CreateIndex
CREATE INDEX "ReasonEntry_orgId_machineId_capturedAt_idx" ON "ReasonEntry"("orgId", "machineId", "capturedAt");

-- CreateIndex
CREATE INDEX "ReasonEntry_orgId_kind_capturedAt_idx" ON "ReasonEntry"("orgId", "kind", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReasonEntry_orgId_kind_episodeId_key" ON "ReasonEntry"("orgId", "kind", "episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ReasonEntry_orgId_kind_scrapEntryId_key" ON "ReasonEntry"("orgId", "kind", "scrapEntryId");

-- AddForeignKey
ALTER TABLE "alert_policies" ADD CONSTRAINT "alert_policies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_contacts" ADD CONSTRAINT "alert_contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_contacts" ADD CONSTRAINT "alert_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "alert_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReasonEntry" ADD CONSTRAINT "ReasonEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReasonEntry" ADD CONSTRAINT "ReasonEntry_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "alert_notifications_org_event_role_channel_idx" RENAME TO "alert_notifications_org_id_event_id_role_channel_idx";

-- RenameIndex
ALTER INDEX "alert_notifications_org_machine_sent_idx" RENAME TO "alert_notifications_org_id_machine_id_sent_at_idx";
