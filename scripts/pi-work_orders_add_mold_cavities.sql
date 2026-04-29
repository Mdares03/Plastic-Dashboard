-- Run on the Pi/MariaDB instance used by Node-RED (local `work_orders` table).
-- Required before importing updated flows that INSERT/UPDATE mold, cavities_total, cavities_active.

ALTER TABLE work_orders ADD COLUMN mold VARCHAR(256) NULL;
ALTER TABLE work_orders ADD COLUMN cavities_total INT NULL;
ALTER TABLE work_orders ADD COLUMN cavities_active INT NULL;

-- If columns already exist, skip this script or adjust manually.
