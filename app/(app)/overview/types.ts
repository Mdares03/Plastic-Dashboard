export type Heartbeat = {
  ts: string;
  tsServer?: string | null;
  status: string;
  message?: string | null;
  ip?: string | null;
  fwVersion?: string | null;
};

export type Kpi = {
  ts: string;
  oee?: number | null;
  availability?: number | null;
  performance?: number | null;
  quality?: number | null;
  workOrderId?: string | null;
  sku?: string | null;
  good?: number | null;
  scrap?: number | null;
  target?: number | null;
  cycleTime?: number | null;
};

export type MachineRow = {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
  latestHeartbeat: Heartbeat | null;
  latestKpi?: Kpi | null;
};

export type EventRow = {
  id: string;
  ts: string;
  topic?: string;
  eventType: string;
  severity: string;
  title: string;
  description?: string | null;
  requiresAck: boolean;
  machineId?: string;
  machineName?: string;
  source: "ingested";
};
