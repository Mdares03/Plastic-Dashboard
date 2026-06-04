ALTER TABLE "org_financial_profiles"
ADD COLUMN IF NOT EXISTS "formulas_json" JSONB;
