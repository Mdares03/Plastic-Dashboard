-- Phase 4: incident-keyed alerting (CEO-spam fix).
-- Additive only. (Intentionally omits the unrelated pre-existing
-- MachineKpiSnapshot index drift that `migrate diff` surfaced.)

-- AlterTable: per-recipient dedup key on the edge's incidentKey
ALTER TABLE "alert_notifications" ADD COLUMN "incident_key" TEXT;

-- CreateTable: one row per real incident
CREATE TABLE "alert_incidents" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "incident_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_notified_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "notify_count" INTEGER NOT NULL DEFAULT 0,
    "suppressed_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "alert_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_incidents_org_id_machine_id_status_idx" ON "alert_incidents"("org_id", "machine_id", "status");
CREATE UNIQUE INDEX "alert_incidents_org_id_machine_id_incident_key_key" ON "alert_incidents"("org_id", "machine_id", "incident_key");
CREATE INDEX "alert_notifications_org_id_incident_key_role_channel_idx" ON "alert_notifications"("org_id", "incident_key", "role", "channel");
CREATE INDEX "alert_notifications_org_id_status_sent_at_idx" ON "alert_notifications"("org_id", "status", "sent_at");
CREATE INDEX "alert_notifications_contact_id_status_sent_at_idx" ON "alert_notifications"("contact_id", "status", "sent_at");

-- AddForeignKey
ALTER TABLE "alert_incidents" ADD CONSTRAINT "alert_incidents_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "alert_incidents" ADD CONSTRAINT "alert_incidents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
