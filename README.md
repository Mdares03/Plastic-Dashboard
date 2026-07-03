# MIS Control Tower

Next.js 16 + Prisma + PostgreSQL dashboard for injection-molding OEE, downtime, and
financial-loss tracking, fed by Raspberry Pi edge devices (Node-RED) over the ingest API.

- **Architecture / data flow:** [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- **Metrics rules (R1–R8) — every number's authority:** [docs/METRICS_SPEC.md](./docs/METRICS_SPEC.md)
- **ROI model:** [docs/ROI_MODEL.md](./docs/ROI_MODEL.md)
- **Operations / deploy runbook:** [docs/RUNBOOK.md](./docs/RUNBOOK.md)
- **Security posture:** [docs/SECURITY.md](./docs/SECURITY.md)
- **DB retention + rollups:** [scripts/retention/](./scripts/retention/SCHEDULING.md)

## Development

```bash
npm install
npm run dev        # Turbopack dev server on http://localhost:3000
npm test           # vitest golden tests (metrics/financial/alerts)
npm run lint
```

## Production build and deploy

**Dev uses Turbopack, production build uses Webpack.** Next.js 16 defaults to Turbopack for both, but Turbopack production builds have known issues. This project uses:

- `npm run dev` → `next dev --turbopack` (fast dev)
- `npm run build` → `next build --webpack` (stable production build)

**When deploying** (e.g. for `https://mis.maliountech.com.mx`):

1. **Build:** Run `npm run build` (Webpack).
2. **Migrate (required):** Run `npm run prisma:migrate:deploy` and confirm it exits successfully before restart.
3. **Start/Restart:** Run `npm run start` (or your process manager such as `sudo systemctl restart mis-control-tower`) to serve the built app.
4. **Schema drift check:** Verify `_prisma_migrations` includes `20260519190000_add_org_financial_formulas` after deploy.
5. **Smoke check:** Open `/financial` as an OWNER user and confirm the page renders (no "Something went wrong").
6. If you previously built with Turbopack, run `rm -rf .next` then `npm run build` for a clean Webpack build.
7. Hard-refresh the browser (or clear site data) after redeploying so clients don’t load old Turbopack chunks.

## Downtime action reminders

Reminders are sent by calling `POST /api/downtime/actions/reminders`. This endpoint does not run automatically, so you need to schedule it with cron or systemd. It sends at most one reminder per threshold (1w/1d/1h/overdue) and resets if the due date changes.
The secret can be any random string; it just needs to match what your scheduler sends in the Authorization header.

1) Set a secret in your env file (example: `/etc/mis-control-tower.env`):

```
DOWNTIME_ACTION_REMINDER_SECRET=your-secret-here
APP_BASE_URL=https://your-domain
```

2) Cron example (runs hourly for 1w/1d/1h/overdue thresholds):

```
0 * * * * . /etc/mis-control-tower.env && curl -s -X POST "$APP_BASE_URL/api/downtime/actions/reminders?dueInDays=7" -H "Authorization: Bearer $DOWNTIME_ACTION_REMINDER_SECRET"
```

If you prefer systemd instead of cron, create a small service + timer that runs the same curl command:

`/etc/systemd/system/mis-control-tower-reminders.service`

```
[Unit]
Description=MIS Control Tower downtime action reminders

[Service]
Type=oneshot
EnvironmentFile=/etc/mis-control-tower.env
ExecStart=/usr/bin/curl -s -X POST "$APP_BASE_URL/api/downtime/actions/reminders?dueInDays=7" -H "Authorization: Bearer $DOWNTIME_ACTION_REMINDER_SECRET"
```

`/etc/systemd/system/mis-control-tower-reminders.timer`

```
[Unit]
Description=Run MIS Control Tower reminders hourly

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

Enable with:

```
sudo systemctl daemon-reload
sudo systemctl enable --now mis-control-tower-reminders.timer
```

## Downtime reason backfill

Control-Tower preserves manual downtime reasons from `downtime-acknowledged` events when later default stop events (`PENDIENTE` / `UNCLASSIFIED`) arrive for the same incident.

If historical rows were already overwritten, run the one-time backfill:

```bash
npm run backfill:downtime-reasons -- --dry-run --since 30d   # preview
npm run backfill:downtime-reasons -- --since 30d             # apply
```

Optional filters: `--org-id <orgId> --machine-id <machineId>`.

## Logging and debugging

See [docs/archive/LOGGING.md](./docs/archive/LOGGING.md) for where errors are logged (log file, process stdout, optional `/api/debug/logs`), how to tail them, and how to debug "Internal Server Error".
