export type OverviewLatestHeartbeat = {
  ts: Date;
  tsServer?: Date | null;
  status: string;
  message?: string | null;
  ip?: string | null;
  fwVersion?: string | null;
};

export type OverviewLatestKpi = {
  ts: Date;
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

export type OverviewMachineRow = {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
  createdAt: Date;
  updatedAt: Date;
  latestHeartbeat: OverviewLatestHeartbeat | null;
  latestKpi: OverviewLatestKpi | null;
  heartbeats?: undefined;
  kpiSnapshots?: undefined;
};

export type OverviewEventRow = {
  id: string;
  ts: Date | null;
  topic: string;
  eventType: string;
  severity: string;
  title: string;
  description?: string | null;
  requiresAck: boolean;
  workOrderId?: string | null;
  machineId: string;
  machineName?: string | null;
  source: "ingested";
};

