export type RecapSkuRow = {
  sku: string;
  good: number;
  scrap: number;
  target: number | null;
  progressPct: number | null;
};

export type RecapMachine = {
  machineId: string;
  machineName: string;
  location: string | null;
  production: {
    goodParts: number;
    scrapParts: number;
    totalCycles: number;
    bySku: RecapSkuRow[];
  };
  oee: {
    avg: number | null;
    availability: number | null;
    performance: number | null;
    quality: number | null;
  };
  downtime: {
    totalMin: number;
    stopsCount: number;
    topReasons: Array<{
      reasonLabel: string;
      minutes: number;
      count: number;
    }>;
    ongoingStopMin: number | null;
  };
  workOrders: {
    completed: Array<{
      id: string;
      sku: string | null;
      goodParts: number;
      durationHrs: number;
    }>;
    active: {
      id: string;
      sku: string | null;
      progressPct: number | null;
      startedAt: string | null;
    } | null;
    moldChangeInProgress: boolean;
  };
  heartbeat: {
    lastSeenAt: string | null;
    uptimePct: number | null;
  };
};

export type RecapResponse = {
  range: {
    start: string;
    end: string;
  };
  machines: RecapMachine[];
};

export type RecapQuery = {
  orgId: string;
  machineId?: string;
  start?: Date;
  end?: Date;
  shift?: string;
};
