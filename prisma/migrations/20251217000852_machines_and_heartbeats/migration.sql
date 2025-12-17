/*
  Warnings:

  - A unique constraint covering the columns `[orgId,name]` on the table `Machine` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Machine` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Machine_orgId_code_key";

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "location" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "MachineHeartbeat" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "ip" TEXT,
    "fwVersion" TEXT,

    CONSTRAINT "MachineHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineHeartbeat_orgId_machineId_ts_idx" ON "MachineHeartbeat"("orgId", "machineId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_orgId_name_key" ON "Machine"("orgId", "name");

-- AddForeignKey
ALTER TABLE "MachineHeartbeat" ADD CONSTRAINT "MachineHeartbeat_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineHeartbeat" ADD CONSTRAINT "MachineHeartbeat_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
