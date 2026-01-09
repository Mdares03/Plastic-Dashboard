import "server-only";

import mqtt, { MqttClient } from "mqtt";

type SettingsUpdate = {
  orgId: string;
  version: number;
  source?: string;
  updatedAt?: string;
  machineId?: string;
  overridesUpdatedAt?: string;
};

type WorkOrdersUpdate = {
  orgId: string;
  machineId: string;
  count?: number;
  source?: string;
  updatedAt?: string;
};

const MQTT_URL = process.env.MQTT_BROKER_URL || "";
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_CLIENT_ID = process.env.MQTT_CLIENT_ID;
const MQTT_TOPIC_PREFIX = (process.env.MQTT_TOPIC_PREFIX || "mis").replace(/\/+$/, "");
const MQTT_QOS_RAW = Number(process.env.MQTT_QOS ?? "2");
const MQTT_QOS = MQTT_QOS_RAW === 0 || MQTT_QOS_RAW === 1 || MQTT_QOS_RAW === 2 ? MQTT_QOS_RAW : 2;

let client: MqttClient | null = null;
let connecting: Promise<MqttClient> | null = null;

function buildSettingsTopic(orgId: string, machineId?: string) {
  const base = `${MQTT_TOPIC_PREFIX}/org/${orgId}`;
  if (machineId) return `${base}/machines/${machineId}/settings/updated`;
  return `${base}/settings/updated`;
}

function buildWorkOrdersTopic(orgId: string, machineId: string) {
  const base = `${MQTT_TOPIC_PREFIX}/org/${orgId}`;
  return `${base}/machines/${machineId}/work_orders/updated`;
}

async function getClient() {
  if (!MQTT_URL) return null;
  if (client?.connected) return client;
  if (connecting) return connecting;

  connecting = new Promise((resolve, reject) => {
    const next = mqtt.connect(MQTT_URL, {
      clientId: MQTT_CLIENT_ID,
      username: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      clean: true,
      reconnectPeriod: 5000,
    });

    next.once("connect", () => {
      client = next;
      connecting = null;
      resolve(next);
    });

    next.once("error", (err) => {
      next.end(true);
      client = null;
      connecting = null;
      reject(err);
    });

    next.once("close", () => {
      client = null;
    });
  });

  return connecting;
}

export async function publishSettingsUpdate(update: SettingsUpdate) {
  if (!MQTT_URL) return { ok: false, reason: "MQTT_NOT_CONFIGURED" as const };
  const mqttClient = await getClient();
  if (!mqttClient) return { ok: false, reason: "MQTT_NOT_CONFIGURED" as const };

  const topic = buildSettingsTopic(update.orgId, update.machineId);
  const payload = JSON.stringify({
    type: update.machineId ? "machine_settings_updated" : "org_settings_updated",
    orgId: update.orgId,
    machineId: update.machineId,
    version: update.version,
    source: update.source || "control_tower",
    updatedAt: update.updatedAt,
    overridesUpdatedAt: update.overridesUpdatedAt,
  });

  return new Promise<{ ok: true }>((resolve, reject) => {
    mqttClient.publish(topic, payload, { qos: MQTT_QOS }, (err) => {
      if (err) return reject(err);
      resolve({ ok: true });
    });
  });
}

export async function publishWorkOrdersUpdate(update: WorkOrdersUpdate) {
  if (!MQTT_URL) return { ok: false, reason: "MQTT_NOT_CONFIGURED" as const };
  const mqttClient = await getClient();
  if (!mqttClient) return { ok: false, reason: "MQTT_NOT_CONFIGURED" as const };

  const topic = buildWorkOrdersTopic(update.orgId, update.machineId);
  const payload = JSON.stringify({
    type: "work_orders_updated",
    orgId: update.orgId,
    machineId: update.machineId,
    count: update.count ?? null,
    source: update.source || "control_tower",
    updatedAt: update.updatedAt,
  });

  return new Promise<{ ok: true }>((resolve, reject) => {
    mqttClient.publish(topic, payload, { qos: MQTT_QOS }, (err) => {
      if (err) return reject(err);
      resolve({ ok: true });
    });
  });
}
