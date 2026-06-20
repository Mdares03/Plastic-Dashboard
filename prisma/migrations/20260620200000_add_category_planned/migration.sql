-- Per-org planned-downtime classification: mark a reason category as planned.
ALTER TABLE "reason_catalog_category" ADD COLUMN "planned" BOOLEAN NOT NULL DEFAULT false;
