-- ROI tracker config on org_settings (UI-editable baseline window + target).
ALTER TABLE "org_settings" ADD COLUMN "roi_baseline_start" TIMESTAMP(3);
ALTER TABLE "org_settings" ADD COLUMN "roi_baseline_end" TIMESTAMP(3);
ALTER TABLE "org_settings" ADD COLUMN "roi_target_reduction_pct" DOUBLE PRECISION;
