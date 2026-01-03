-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "pairing_code" TEXT,
ADD COLUMN     "pairing_code_expires_at" TIMESTAMP(3),
ADD COLUMN     "pairing_code_used_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Machine_pairing_code_key" ON "Machine"("pairing_code");

