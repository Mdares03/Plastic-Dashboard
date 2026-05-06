# Reason catalog: Control Tower → settings → MySQL (Pi)

## Authority

- The canonical catalog lives in Control Tower: `org_settings.defaults_json.reasonCatalog` (and `reasonCatalogData` alias), merged in API responses with fallback from `downtime_menu.md`.
- Each **detail** may include:
  - `reasonCode`: official printed code (e.g. `DTPRC-01`, `MX001`). If omitted, a slug `CATEGORY__DETAIL` is derived for backward compatibility.
  - `active`: `false` to hide from operator pickers while keeping history/report labels. **Never remove** a code from JSON once used; only set `active: false`.

## Raspberry Pi

1. Apply [`scripts/mysql/reason_catalog_mirror.sql`](mysql/reason_catalog_mirror.sql) on the same MySQL database used by Node-RED (`node-red-node-mysql`).
2. Deploy [`flows_may_4_26.json`](../flows_may_4_26.json). After each successful **Apply settings + update UI**, the flow emits a message on output 3 to **Build reason catalog mirror SQL**, which reads `global.settings.reasonCatalog` and runs `INSERT ... ON DUPLICATE KEY UPDATE` into `reason_catalog_row` (no deletes).

## Operator payloads (printed codes)

- On downtime acknowledge and scrap entry, send `reason.reasonCode` (and labels) matching the printed sheet. Ingest already normalizes and stores uppercase codes.
- Generate printable lists from the same JSON as CT: [`scripts/export-reason-catalog-csv.mjs`](export-reason-catalog-csv.mjs).

```bash
node scripts/export-reason-catalog-csv.mjs path/to/reasonCatalog.json > claves.csv
```
