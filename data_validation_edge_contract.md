# MIS Edge → Cloud Contract (v1.0)

All ingest payloads MUST include these top-level meta fields:

- schemaVersion: "1.0"
- machineId: UUID
- tsDevice: epoch milliseconds (number)
- seq: monotonic integer per machine (persisted across reboots)

## POST /api/ingest/heartbeat
{
  "schemaVersion": "1.0",
  "machineId": "uuid",
  "tsDevice": 1766427568335,
  "seq": 123,
  "online": true,
  "message": "NR heartbeat",
  "ip": "192.168.18.33",
  "fwVersion": "raspi-nodered-1.0"
}

## POST /api/ingest/kpi (snapshot)
{
  "schemaVersion": "1.0",
  "machineId": "uuid",
  "tsDevice": 1766427568335,
  "seq": 124,
  "activeWorkOrder": { "id": "OT-10001", "sku": "YoguFrut", "target": 600000, "good": 312640, "scrap": 0 },
  "cycle_count": 31264,
  "good_parts": 312640,
  "trackingEnabled": true,
  "productionStarted": true,
  "cycleTime": 14,
  "kpis": { "oee": 100, "availability": 100, "performance": 100, "quality": 100 }
}

## POST /api/ingest/cycle
{
  "schemaVersion": "1.0",
  "machineId": "uuid",
  "tsDevice": 1766427568335,
  "seq": 125,
  "cycle": {
    "timestamp": 1766427568335,
    "cycle_count": 31264,
    "actual_cycle_time": 10.141,
    "theoretical_cycle_time": 14,
    "work_order_id": "OT-10001",
    "sku": "YoguFrut",
    "cavities": 10,
    "good_delta": 10,
    "scrap_total": 0
  }
}

## POST /api/ingest/event
Edge MUST split arrays; cloud expects one event per request.
{
  "schemaVersion": "1.0",
  "machineId": "uuid",
  "tsDevice": 1766427568335,
  "seq": 126,
  "event": {
    "anomaly_type": "slow-cycle",
    "severity": "warning",
    "title": "Slow Cycle Detected",
    "description": "Cycle took 23.6s",
    "timestamp": 1766427568335,
    "work_order_id": "OT-10001",
    "cycle_count": 31265,
    "data": {},
    "kpi_snapshot": {}
  }
}
