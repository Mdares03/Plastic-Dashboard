-- CreateTable
CREATE TABLE "MachineCycle" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cycleCount" INTEGER,
    "actualCycleTime" DOUBLE PRECISION NOT NULL,
    "theoreticalCycleTime" DOUBLE PRECISION,
    "workOrderId" TEXT,
    "sku" TEXT,
    "cavities" INTEGER,
    "goodDelta" INTEGER,
    "scrapDelta" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineCycle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineCycle_orgId_machineId_ts_idx" ON "MachineCycle"("orgId", "machineId", "ts");

-- CreateIndex
CREATE INDEX "MachineCycle_orgId_machineId_cycleCount_idx" ON "MachineCycle"("orgId", "machineId", "cycleCount");

-- AddForeignKey
ALTER TABLE "MachineCycle" ADD CONSTRAINT "MachineCycle_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
