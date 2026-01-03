-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "schema_version" TEXT,
ADD COLUMN     "seq" BIGINT,
ADD COLUMN     "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "ts_server" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "MachineCycle" ADD COLUMN     "schema_version" TEXT,
ADD COLUMN     "seq" BIGINT,
ADD COLUMN     "ts_server" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "MachineEvent" ADD COLUMN     "schema_version" TEXT,
ADD COLUMN     "seq" BIGINT,
ADD COLUMN     "ts_server" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "MachineHeartbeat" ADD COLUMN     "schema_version" TEXT,
ADD COLUMN     "seq" BIGINT,
ADD COLUMN     "ts_server" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "MachineKpiSnapshot" ADD COLUMN     "schema_version" TEXT,
ADD COLUMN     "seq" BIGINT,
ADD COLUMN     "ts_server" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "IngestLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "machineId" TEXT,
    "endpoint" TEXT NOT NULL,
    "schemaVersion" TEXT,
    "seq" BIGINT,
    "tsDevice" TIMESTAMP(3),
    "tsServer" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER NOT NULL,
    "errorCode" TEXT,
    "errorMsg" TEXT,
    "body" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "IngestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestLog_endpoint_tsServer_idx" ON "IngestLog"("endpoint", "tsServer");

-- CreateIndex
CREATE INDEX "IngestLog_machineId_tsServer_idx" ON "IngestLog"("machineId", "tsServer");

-- CreateIndex
CREATE INDEX "IngestLog_machineId_seq_idx" ON "IngestLog"("machineId", "seq");
