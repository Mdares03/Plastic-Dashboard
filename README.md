This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Downtime Action Reminders

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

If you prefer systemd instead of cron, you can create a small service + timer that runs the same curl command.

Example systemd units:

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

## Production build and deploy

**Dev uses Turbopack, production build uses Webpack.** Next.js 16 defaults to Turbopack for both, but Turbopack production builds have known issues. This project uses:

- `npm run dev` → `next dev --turbopack` (fast dev)
- `npm run build` → `next build --webpack` (stable production build)

**When deploying** (e.g. for `https://mis.maliountech.com.mx`):

1. **Build:** Run `npm run build` (Webpack).
2. **Start:** Run `npm run start` (or your process manager) to serve the built app.
3. If you previously built with Turbopack, run `rm -rf .next` then `npm run build` for a clean Webpack build.
4. Hard-refresh the browser (or clear site data) after redeploying so clients don’t load old Turbopack chunks.

## Logging and debugging

See **[LOGGING.md](./LOGGING.md)** for where errors are logged (log file, process stdout, optional `/api/debug/logs`), how to tail them, and how to debug "Internal Server Error".


To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
