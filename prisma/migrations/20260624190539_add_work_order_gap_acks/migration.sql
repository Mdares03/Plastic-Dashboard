-- NOTE: prisma migrate diff also surfaces two pre-existing index drifts
-- (MachineHeartbeat / MachineKpiSnapshot unique indexes) and an oee_daily DropTable.
-- These are deliberately EXCLUDED here — they are unrelated, long-standing drift
-- (see Phase 4 / reliability-overhaul notes), not part of this additive change.

-- CreateTable
CREATE TABLE "work_order_gap_acks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "missing_at_ack" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "acknowledged_by" TEXT,
    "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_gap_acks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_order_gap_acks_org_id_machine_id_idx" ON "work_order_gap_acks"("org_id", "machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_gap_acks_org_id_machine_id_work_order_id_key" ON "work_order_gap_acks"("org_id", "machine_id", "work_order_id");

-- AddForeignKey
ALTER TABLE "work_order_gap_acks" ADD CONSTRAINT "work_order_gap_acks_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_gap_acks" ADD CONSTRAINT "work_order_gap_acks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

