-- Mirror of Control Tower reasonCatalog on the Raspberry Pi (MySQL / MariaDB).
-- Policy: never DELETE rows by reason_code; only INSERT ... ON DUPLICATE KEY UPDATE
-- and set active=0 when CT marks a code inactive.

CREATE TABLE IF NOT EXISTS reason_catalog_row (
  kind VARCHAR(16) NOT NULL COMMENT 'downtime | scrap',
  category_id VARCHAR(128) NOT NULL,
  category_label VARCHAR(255) NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  reason_label VARCHAR(512) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  catalog_version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (kind, reason_code),
  KEY idx_reason_catalog_kind_active (kind, active),
  KEY idx_reason_catalog_version (catalog_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
