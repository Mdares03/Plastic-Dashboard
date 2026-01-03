/*
  Warnings:

  - A unique constraint covering the columns `[apiKey]` on the table `Machine` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "apiKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Machine_apiKey_key" ON "Machine"("apiKey");
