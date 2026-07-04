#!/usr/bin/env bash
# One-line health banner for the offsite DB backup, meant to run on interactive
# login (wired from ~/.bashrc) so its state is visible the moment you log in.
#
# Reads the local status file that pg-dump-offsite.sh writes after each run — no
# SSH, so it's instant. The backup script only writes STATE=OK *after* it has
# confirmed the dump landed on the remote with a matching byte size, so an OK
# here means the offsite copy genuinely exists.
#
# Verdicts:
#   green ✔  a successful run within STALE_HOURS (default 26h)
#   red   ✗  the last run FAILED
#   yellow ⚠ no run recorded, or the last OK is stale (i.e. the 03:30 cron likely
#            never fired) — the case worth catching in the morning.
set -uo pipefail

STATUS_FILE="${STATUS_FILE:-$HOME/.backup-offsite-status}"
STALE_HOURS="${STALE_HOURS:-26}"
LOG="$HOME/backup-offsite.log"

if [ -t 1 ]; then
  red=$'\033[31m'; grn=$'\033[32m'; ylw=$'\033[33m'; bld=$'\033[1m'; rst=$'\033[0m'
else
  red=""; grn=""; ylw=""; bld=""; rst=""
fi

if [ ! -f "$STATUS_FILE" ]; then
  printf '%s\n' "${ylw}${bld}⚠ offsite DB backup: no run recorded yet${rst} (nightly 03:30; log: $LOG)"
  exit 0
fi

IFS=$'\t' read -r STATE WHEN INFO < "$STATUS_FILE"
now=$(date +%s)
then_s=$(date -d "$WHEN" +%s 2>/dev/null || echo 0)
age_h=$(( (now - then_s) / 3600 ))

case "$STATE" in
  OK)
    if [ "$age_h" -gt "$STALE_HOURS" ]; then
      printf '%s\n' "${ylw}${bld}⚠ offsite DB backup STALE${rst}: last OK ${age_h}h ago (${WHEN}) — the 03:30 cron may not have fired. Check $LOG"
    else
      printf '%s\n' "${grn}${bld}✔ offsite DB backup OK${rst} ${WHEN} — ${INFO}"
    fi
    ;;
  FAIL)
    printf '%s\n' "${red}${bld}✗ offsite DB backup FAILED${rst} ${WHEN} — ${INFO}"
    ;;
  *)
    printf '%s\n' "${ylw}⚠ offsite DB backup: unrecognized status '${STATE}' (${WHEN})${rst}"
    ;;
esac
