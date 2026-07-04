#!/usr/bin/env bash
# =============================================================================
# Offsite nightly backup for control_tower_db.
#
# Dumps the DB (custom/compressed format), verifies the dump is restorable,
# ships it over SSH to an off-box host, confirms it landed intact, then rotates
# old remote copies. The whole point is OFFSITE: if control-tower dies, the ROI
# baseline (ReasonEntry) survives on another machine.
#
# Auth model:
#   - pg_dump connects locally via the Unix socket as `mdares` (peer auth), so
#     no DB password lives in this file.
#   - SSH uses key auth (id_ed25519), so no host password lives here either.
#
# Restore (on any box with postgres 16):
#   pg_restore --clean --if-exists -d control_tower_db <file>.dump
#   (or --create to a fresh DB). List contents: pg_restore --list <file>.dump
# =============================================================================
set -euo pipefail

DB="${DB:-control_tower_db}"
PGHOST="${PGHOST:-/var/run/postgresql}"        # socket + peer auth as mdares
export PGHOST
REMOTE="${REMOTE:-mdares@10.200.130.194}"       # offsite host (ZeroTier peer marcelovm2)
REMOTE_DIR="${REMOTE_DIR:-backups/control_tower_db}"  # relative to remote $HOME
KEEP="${KEEP:-14}"                              # nightly copies to retain on remote
STAGING="${STAGING:-$HOME/backups-staging}"     # local temp; file deleted after it ships
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15)

STATUS_FILE="${STATUS_FILE:-$HOME/.backup-offsite-status}"  # read by backup-status.sh on login
log() { echo "[$(date -Is)] $*"; }
# tab-separated: STATE <tab> ISO-timestamp <tab> human-readable detail
write_status() { printf '%s\t%s\t%s\n' "$1" "$(date -Is)" "$2" > "$STATUS_FILE"; }
mkdir -p "$STAGING"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DB-$STAMP.dump"
LOCAL="$STAGING/$FILE"

# ---- serialize: never let two backups overlap -----------------------------
exec 9>"$STAGING/.lock"
if ! flock -n 9; then log "another backup is running; exiting"; exit 0; fi

cleanup_fail() { write_status FAIL "staged file kept: $LOCAL — see ~/backup-offsite.log"; log "FAILED — staged file kept for inspection: $LOCAL"; }
trap cleanup_fail ERR

# ---- 1. dump (custom format is compressed + supports selective restore) ----
# Exclude the `cron` schema: it belongs to the pg_cron extension, its `cron.job`
# table is row-level-security protected (a non-superuser dump errors on it), and
# the scheduler is reconstructed by re-running SCHEDULING.md, not from app data.
log "dumping $DB -> $LOCAL"
pg_dump -Fc --exclude-schema=cron -d "$DB" -f "$LOCAL"
SIZE_LOCAL=$(stat -c%s "$LOCAL")
log "dump complete: $(numfmt --to=iec "$SIZE_LOCAL")"

# ---- 2. verify the dump is actually restorable BEFORE trusting it ----------
if ! pg_restore --list "$LOCAL" >/dev/null 2>&1; then
  log "ERROR: pg_restore could not read the dump — aborting (not shipping a corrupt file)"
  exit 1
fi
log "dump verified restorable (pg_restore --list ok)"

# ---- 3. ship offsite over SSH ----------------------------------------------
log "shipping to $REMOTE:$REMOTE_DIR/"
ssh "${SSH_OPTS[@]}" "$REMOTE" "umask 077; mkdir -p '$REMOTE_DIR'"
scp -q "${SSH_OPTS[@]}" "$LOCAL" "$REMOTE:$REMOTE_DIR/$FILE"

# ---- 4. confirm it landed intact (byte-for-byte size match) ----------------
SIZE_REMOTE=$(ssh "${SSH_OPTS[@]}" "$REMOTE" "stat -c%s '$REMOTE_DIR/$FILE'")
if [ "$SIZE_LOCAL" != "$SIZE_REMOTE" ]; then
  log "ERROR: size mismatch (local=$SIZE_LOCAL remote=$SIZE_REMOTE) — leaving staged copy"
  exit 1
fi
log "verified on remote: $SIZE_REMOTE bytes match"

# ---- 5. rotate remote copies + drop the local staging file -----------------
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "ls -1t '$REMOTE_DIR'/$DB-*.dump 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f; \
   echo \"remote now holds \$(ls -1 '$REMOTE_DIR'/$DB-*.dump 2>/dev/null | wc -l) dump(s)\""
rm -f "$LOCAL"

trap - ERR
write_status OK "$FILE ($(numfmt --to=iec "$SIZE_LOCAL")) -> $REMOTE:$REMOTE_DIR/"
log "backup OK: $FILE offsite at $REMOTE:$REMOTE_DIR/ (retention: $KEEP nightly)"
