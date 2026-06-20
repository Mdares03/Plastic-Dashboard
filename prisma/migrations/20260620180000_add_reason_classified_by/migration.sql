-- Accountability for after-the-fact (web) reclassification of downtime reasons.
ALTER TABLE "ReasonEntry" ADD COLUMN "classifiedBy" TEXT;
ALTER TABLE "ReasonEntry" ADD COLUMN "classifiedAt" TIMESTAMP(3);
ALTER TABLE "ReasonEntry" ADD COLUMN "classifiedVia" TEXT;
