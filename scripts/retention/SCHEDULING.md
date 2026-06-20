# Retention scheduling

The retention + rollup logic lives in `scripts/retention/retention.sql` and is already
installed in `control_tower_db` as three functions (`app_retention_run`,
`app_rollup_oee_daily`, `app_retention_delete`) plus the `oee_daily` table. All that's left
is to call `app_retention_run()` once a day. Two options.

---

## Option A — pg_cron (chosen). Requires sudo + a one-time Postgres restart.

These steps need the OS `postgres` superuser / `sudo`, which the automation could not do.
Run them yourself (you can paste each as `! <command>` in Claude Code, or in a normal shell):

```bash
# 1. Install the extension package for PG16
sudo apt-get update && sudo apt-get install -y postgresql-16-cron

# 2. Enable it in the server config (pg_cron must be preloaded)
echo "shared_preload_libraries = 'pg_cron'" | sudo tee -a /etc/postgresql/16/main/postgresql.conf
echo "cron.database_name = 'control_tower_db'" | sudo tee -a /etc/postgresql/16/main/postgresql.conf

# 3. Restart Postgres (brief outage of the live DB + app)
sudo systemctl restart postgresql

# 4. Create the extension and let mdares schedule jobs
sudo -u postgres psql -d control_tower_db -c "CREATE EXTENSION IF NOT EXISTS pg_cron;"
sudo -u postgres psql -d control_tower_db -c "GRANT USAGE ON SCHEMA cron TO mdares;"
```

Then schedule the daily job (this part `mdares` can run, after the GRANT above):

```sql
-- 03:15 every day
SELECT cron.schedule('control-tower-retention', '15 3 * * *', $$SELECT app_retention_run();$$);

-- verify
SELECT jobid, schedule, command FROM cron.job;
-- after it has run once:
SELECT jobid, status, return_message, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;
```

> Note: with `shared_preload_libraries`, `pg_cron`'s background worker connects only to
> `cron.database_name`. The `cron.schedule` call must be made while connected to that same
> database (control_tower_db).

---

## Option B — host cron (no sudo, no restart). Fallback / interim.

A user crontab for `mdares` (no root needed). The wrapper script is
`scripts/retention/run-retention.sh`.

```bash
crontab -l 2>/dev/null | { cat; echo "15 3 * * * /home/mdares/mis-control-tower/scripts/retention/run-retention.sh >> /home/mdares/retention.log 2>&1"; } | crontab -
crontab -l   # verify
```

---

## Manual run (either option)

```bash
PGPASSWORD=... psql -h 127.0.0.1 -U mdares -d control_tower_db -c "SELECT app_retention_run();"
```
