-- Reason catalog: relational storage (replaces JSON in org_settings for new data).

CREATE TABLE "reason_catalog_category" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code_prefix" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reason_catalog_category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reason_catalog_item" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code_suffix" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reason_catalog_item_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reason_catalog_category_org_id_kind_active_idx" ON "reason_catalog_category"("org_id", "kind", "active");

CREATE UNIQUE INDEX "reason_catalog_item_org_id_reason_code_key" ON "reason_catalog_item"("org_id", "reason_code");

CREATE INDEX "reason_catalog_item_org_id_category_id_idx" ON "reason_catalog_item"("org_id", "category_id");

ALTER TABLE "reason_catalog_category" ADD CONSTRAINT "reason_catalog_category_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reason_catalog_item" ADD CONSTRAINT "reason_catalog_item_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reason_catalog_item" ADD CONSTRAINT "reason_catalog_item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "reason_catalog_category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
