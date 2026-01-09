-- CreateTable
CREATE TABLE "org_settings" (
    "org_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "shift_change_comp_min" INTEGER NOT NULL DEFAULT 10,
    "lunch_break_min" INTEGER NOT NULL DEFAULT 30,
    "stoppage_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "oee_alert_threshold_pct" DOUBLE PRECISION NOT NULL DEFAULT 90,
    "macro_stoppage_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "performance_threshold_pct" DOUBLE PRECISION NOT NULL DEFAULT 85,
    "quality_spike_delta_pct" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "alerts_json" JSONB,
    "defaults_json" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "org_settings_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "org_shifts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "org_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_settings" (
    "machine_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "overrides_json" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "machine_settings_pkey" PRIMARY KEY ("machine_id")
);

-- CreateTable
CREATE TABLE "settings_audit" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "machine_id" TEXT,
    "actor_id" TEXT,
    "source" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_shifts_org_id_idx" ON "org_shifts"("org_id");

-- CreateIndex
CREATE INDEX "org_shifts_org_id_sort_order_idx" ON "org_shifts"("org_id", "sort_order");

-- CreateIndex
CREATE INDEX "machine_settings_org_id_idx" ON "machine_settings"("org_id");

-- CreateIndex
CREATE INDEX "settings_audit_org_id_created_at_idx" ON "settings_audit"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "settings_audit_machine_id_created_at_idx" ON "settings_audit"("machine_id", "created_at");

-- AddForeignKey
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_shifts" ADD CONSTRAINT "org_shifts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_settings" ADD CONSTRAINT "machine_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_settings" ADD CONSTRAINT "machine_settings_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings_audit" ADD CONSTRAINT "settings_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings_audit" ADD CONSTRAINT "settings_audit_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

