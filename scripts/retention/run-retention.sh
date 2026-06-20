#!/usr/bin/env bash
# Host-cron fallback for control_tower_db retention (Option B in SCHEDULING.md).
# Calls the in-DB app_retention_run() which rolls up oee_daily then prunes per policy.
#
# Credentials: relies on ~/.pgpass (chmod 600) so no password lives in this file, e.g.
#   127.0.0.1:5432:control_tower_db:mdares:<password>
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-mdares}"
PGDATABASE="${PGDATABASE:-control_tower_db}"
export PGHOST PGPORT PGUSER PGDATABASE

echo "[$(date -Is)] retention start"
psql -X -v ON_ERROR_STOP=1 -c "SELECT app_retention_run();"
echo "[$(date -Is)] retention done"
