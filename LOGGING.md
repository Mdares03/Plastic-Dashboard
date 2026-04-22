# Logging & debugging errors

## Where errors are logged

### 1. **Log file** (JSON lines)

- **Path:** `LOG_FILE` env var, or **`/tmp/mis-control-tower.log`** if unset.
- **Contents:** JSON lines for `requireSession.error`, `getOverviewData.error`, `OverviewPage.getOverviewData.error`, plus any `logLine(...)` usage (e.g. health, signup).

**View recent entries:**
```bash
tail -f /tmp/mis-control-tower.log
```

**Or with a custom path:**
```bashls -la
export LOG_FILE=/var/log/mis-control-tower.log
# then start the app; tail that path
tail -f /var/log/mis-control-tower.log
```

### 2. **Process stdout / stderr**

- **`console.error`** and **`console.log`** go to the process that runs Next.js.
- **Dev:** terminal where you run `npm run dev`.
- **Production:** PM2 logs (`pm2 logs`), Docker (`docker logs ...`), systemd (`journalctl -u your-service -f`), etc.

### 3. **Debug logs API** (optional)

- **URL:** `GET /api/debug/logs?key=YOUR_DEBUG_LOGS_KEY`
- **Purpose:** Returns the last 100 lines of the log file as JSON.
- **Setup:** Add to `.env`:
  ```
  DEBUG_LOGS_KEY=your-secret-string
  ```
- **Usage:**  
  `curl "https://mis.maliountech.com.mx/api/debug/logs?key=your-secret-string"`
- If `DEBUG_LOGS_KEY` is unset or the `key` param is wrong, the route returns 401.

## Error events we log

| Event | When |
|-------|------|
| `requireSession.error` | Session lookup (cookies / DB) fails |
| `getOverviewData.error` | Overview data fetch (DB) fails |
| `OverviewPage.getOverviewData.error` | Overview page catch-around fetch fails |

Each includes `message` and `stack` when available.

## Quick checks when you see "Internal Server Error"

1. **Tail the log file:**  
   `tail -f /tmp/mis-control-tower.log`  
   (or `$LOG_FILE` if you set it.)

2. **Check process logs:**  
   Wherever `next start` or `npm run dev` runs (PM2, Docker, systemd). Look for `[requireSession]`, `[getOverviewData]`, `[OverviewPage]`, or `[middleware]`.

3. **Call the debug API** (if configured):  
   `curl "https://your-domain/api/debug/logs?key=YOUR_DEBUG_LOGS_KEY"`  
   and inspect the `entries` array for recent errors.

## KPI quality trace (Node-RED vs processing)

Use this when `Quality` is shown as `0` and you need to see exactly what was received and saved.

1. Enable trace logging:
   `TRACE_KPI_INGEST=1`

2. Send KPI payloads as usual from Node-RED.

3. Inspect logs:
   `tail -f /tmp/mis-control-tower.log`
   or:
   `curl "https://your-domain/api/debug/logs?key=YOUR_DEBUG_LOGS_KEY"`

4. Look for event `ingest.kpi.trace`, which includes:
   `trace.rawQualityCandidates` (raw payload values found at multiple paths),
   `trace.normalizedQuality` (post-normalization),
   `trace.persistedQuality` (value written to DB).

Optional one-shot trace without env var:
- Send header `x-debug-ingest: 1` on a KPI request.
- The response will include a `trace` object with the same quality details.
