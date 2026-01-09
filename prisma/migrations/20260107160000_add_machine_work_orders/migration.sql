-- CreateTable
CREATE TABLE "machine_work_orders" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "sku" TEXT,
    "targetQty" INTEGER,
    "cycleTime" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "machine_work_orders_machineId_workOrderId_key" ON "machine_work_orders"("machineId", "workOrderId");

-- CreateIndex
CREATE INDEX "machine_work_orders_orgId_machineId_idx" ON "machine_work_orders"("orgId", "machineId");

-- CreateIndex
CREATE INDEX "machine_work_orders_orgId_workOrderId_idx" ON "machine_work_orders"("orgId", "workOrderId");

-- AddForeignKey
ALTER TABLE "machine_work_orders" ADD CONSTRAINT "machine_work_orders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_work_orders" ADD CONSTRAINT "machine_work_orders_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
