-- CreateTable
CREATE TABLE "org_financial_profiles" (
    "org_id" TEXT NOT NULL,
    "default_currency" TEXT NOT NULL DEFAULT 'USD',
    "machine_cost_per_min" DOUBLE PRECISION,
    "operator_cost_per_min" DOUBLE PRECISION,
    "rated_running_kw" DOUBLE PRECISION,
    "idle_kw" DOUBLE PRECISION,
    "kwh_rate" DOUBLE PRECISION,
    "energy_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "energy_cost_per_min" DOUBLE PRECISION,
    "scrap_cost_per_unit" DOUBLE PRECISION,
    "raw_material_cost_per_unit" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "org_financial_profiles_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "location_financial_overrides" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "currency" TEXT,
    "machine_cost_per_min" DOUBLE PRECISION,
    "operator_cost_per_min" DOUBLE PRECISION,
    "rated_running_kw" DOUBLE PRECISION,
    "idle_kw" DOUBLE PRECISION,
    "kwh_rate" DOUBLE PRECISION,
    "energy_multiplier" DOUBLE PRECISION,
    "energy_cost_per_min" DOUBLE PRECISION,
    "scrap_cost_per_unit" DOUBLE PRECISION,
    "raw_material_cost_per_unit" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "location_financial_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_financial_overrides" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "currency" TEXT,
    "machine_cost_per_min" DOUBLE PRECISION,
    "operator_cost_per_min" DOUBLE PRECISION,
    "rated_running_kw" DOUBLE PRECISION,
    "idle_kw" DOUBLE PRECISION,
    "kwh_rate" DOUBLE PRECISION,
    "energy_multiplier" DOUBLE PRECISION,
    "energy_cost_per_min" DOUBLE PRECISION,
    "scrap_cost_per_unit" DOUBLE PRECISION,
    "raw_material_cost_per_unit" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "machine_financial_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_cost_overrides" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "currency" TEXT,
    "raw_material_cost_per_unit" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "product_cost_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "location_financial_overrides_org_id_location_key" ON "location_financial_overrides"("org_id", "location");

-- CreateIndex
CREATE UNIQUE INDEX "machine_financial_overrides_org_id_machine_id_key" ON "machine_financial_overrides"("org_id", "machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_cost_overrides_org_id_sku_key" ON "product_cost_overrides"("org_id", "sku");

-- CreateIndex
CREATE INDEX "location_financial_overrides_org_id_idx" ON "location_financial_overrides"("org_id");

-- CreateIndex
CREATE INDEX "machine_financial_overrides_org_id_idx" ON "machine_financial_overrides"("org_id");

-- CreateIndex
CREATE INDEX "product_cost_overrides_org_id_idx" ON "product_cost_overrides"("org_id");

-- AddForeignKey
ALTER TABLE "org_financial_profiles" ADD CONSTRAINT "org_financial_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_financial_overrides" ADD CONSTRAINT "location_financial_overrides_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_financial_overrides" ADD CONSTRAINT "machine_financial_overrides_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_financial_overrides" ADD CONSTRAINT "machine_financial_overrides_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cost_overrides" ADD CONSTRAINT "product_cost_overrides_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
