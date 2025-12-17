-- CreateTable
CREATE TABLE "MachineKpiSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workOrderId" TEXT,
    "sku" TEXT,
    "target" INTEGER,
    "good" INTEGER,
    "scrap" INTEGER,
    "cycleCount" INTEGER,
    "goodParts" INTEGER,
    "scrapParts" INTEGER,
    "cavities" INTEGER,
    "cycleTime" DOUBLE PRECISION,
    "actualCycle" DOUBLE PRECISION,
    "availability" DOUBLE PRECISION,
    "performance" DOUBLE PRECISION,
    "quality" DOUBLE PRECISION,
    "oee" DOUBLE PRECISION,
    "trackingEnabled" BOOLEAN,
    "productionStarted" BOOLEAN,

    CONSTRAINT "MachineKpiSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "topic" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "requiresAck" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "data" JSONB,
    "workOrderId" TEXT,
    "sku" TEXT,

    CONSTRAINT "MachineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineKpiSnapshot_orgId_machineId_ts_idx" ON "MachineKpiSnapshot"("orgId", "machineId", "ts");

-- CreateIndex
CREATE INDEX "MachineEvent_orgId_machineId_ts_idx" ON "MachineEvent"("orgId", "machineId", "ts");

-- CreateIndex
CREATE INDEX "MachineEvent_orgId_machineId_eventType_ts_idx" ON "MachineEvent"("orgId", "machineId", "eventType", "ts");

-- AddForeignKey
ALTER TABLE "MachineKpiSnapshot" ADD CONSTRAINT "MachineKpiSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineKpiSnapshot" ADD CONSTRAINT "MachineKpiSnapshot_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineEvent" ADD CONSTRAINT "MachineEvent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
