#!/usr/bin/env bash
#
# Phase C — scheduled report emails (item 1). Hits the three secret-gated endpoints.
# They are SELF-DEDUPING now: each reads OrgReportSchedule per org and only sends what
# is due (lastSentAt dedupe), so this can safely run as often as hourly — the per-org
# cadence (daily/weekly/monthly) lives in the app's Settings → Reports tab, not here.
#
# Secrets + base URL are read from the app's .env so nothing is hardcoded in crontab.
#   ENV_FILE       (default: <repo>/.env)
#   CRON_BASE_URL  (default: http://localhost:3000 — same host as `next start`)
#
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env}"
BASE_URL="${CRON_BASE_URL:-http://localhost:3000}"

getval() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'; }

WEEKLY="$(getval WEEKLY_REPORT_EMAIL_SECRET)"
ROI="$(getval ROI_SUMMARY_EMAIL_SECRET)"
DAILY="$(getval DAILY_REPORT_EMAIL_SECRET)"
[ -z "$DAILY" ] && DAILY="$WEEKLY"   # endpoint falls back to the weekly secret too

hit() { # $1 = path, $2 = token
  local path="$1" token="$2"
  if [ -z "$token" ]; then
    echo "$(date -Is) SKIP $path (no secret in $ENV_FILE)"
    return
  fi
  local body
  body="$(curl -fsS -m 180 -X POST "$BASE_URL$path?token=$token" 2>/dev/null)"
  if [ $? -eq 0 ]; then
    echo "$(date -Is) OK   $path $body"
  else
    echo "$(date -Is) FAIL $path"
  fi
}

hit /api/reports/daily/email  "$DAILY"
hit /api/reports/weekly/email "$WEEKLY"
hit /api/reports/roi/email    "$ROI"
