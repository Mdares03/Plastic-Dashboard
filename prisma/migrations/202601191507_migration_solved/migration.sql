-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "public"."alert_contacts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "role_scope" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "event_types" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."alert_notifications" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "contact_id" TEXT,
    "user_id" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "alert_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."alert_policies" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "policy_json" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "alert_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_contacts_org_id_idx" ON "public"."alert_contacts"("org_id" ASC);

-- CreateIndex
CREATE INDEX "alert_contacts_org_id_role_scope_idx" ON "public"."alert_contacts"("org_id" ASC, "role_scope" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "alert_contacts_org_id_user_id_key" ON "public"."alert_contacts"("org_id" ASC, "user_id" ASC);

-- CreateIndex
CREATE INDEX "alert_notifications_contact_id_idx" ON "public"."alert_notifications"("contact_id" ASC);

-- CreateIndex
CREATE INDEX "alert_notifications_org_event_role_channel_idx" ON "public"."alert_notifications"("org_id" ASC, "event_id" ASC, "role" ASC, "channel" ASC);

-- CreateIndex
CREATE INDEX "alert_notifications_org_machine_sent_idx" ON "public"."alert_notifications"("org_id" ASC, "machine_id" ASC, "sent_at" ASC);

-- CreateIndex
CREATE INDEX "alert_notifications_user_id_idx" ON "public"."alert_notifications"("user_id" ASC);

-- CreateIndex
CREATE INDEX "alert_policies_org_id_idx" ON "public"."alert_policies"("org_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "alert_policies_org_id_key" ON "public"."alert_policies"("org_id" ASC);

-- AddForeignKey
ALTER TABLE "public"."alert_contacts" ADD CONSTRAINT "alert_contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."Org"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."alert_contacts" ADD CONSTRAINT "alert_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."alert_notifications" ADD CONSTRAINT "alert_notifications_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."alert_contacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."alert_notifications" ADD CONSTRAINT "alert_notifications_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "public"."Machine"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."alert_notifications" ADD CONSTRAINT "alert_notifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."Org"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."alert_notifications" ADD CONSTRAINT "alert_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."alert_policies" ADD CONSTRAINT "alert_policies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."Org"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

