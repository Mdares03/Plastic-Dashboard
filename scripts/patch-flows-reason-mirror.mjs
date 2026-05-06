#!/usr/bin/env node
/**
 * Patches flows_may_4_26.json:
 * - Apply settings: pass reasonCode/active in catalog; 3 outputs; trigger MySQL mirror sync
 * - New nodes: Build reason catalog mirror SQL → mysql
 */
import { readFileSync, writeFileSync } from "fs";

const path = new URL("../flows_may_4_26.json", import.meta.url).pathname;
const j = JSON.parse(readFileSync(path, "utf8"));

const applyId = "abbec199700a5e29";
const gateId = "f8e0d1c2b3a40911";
const mysqlPersistId = "f8e0d1c2b3a40912";

const apply = j.find((n) => n.id === applyId);
if (!apply || apply.type !== "function") {
  console.error("Apply settings node not found");
  process.exit(1);
}

const oldDetails =
  "const details = detailsRaw.map((d, jdx) => ({\n        id: String(d.id || d.detailId || (categoryId + \"_d\" + jdx)),\n        label: String(d.label || d.detailLabel || (\"Detalle \" + (jdx + 1)))\n      }));";

const newDetails = `const details = detailsRaw.map((d, jdx) => {
        const row = {
          id: String(d.id || d.detailId || (categoryId + "_d" + jdx)),
          label: String(d.label || d.detailLabel || ("Detalle " + (jdx + 1)))
        };
        if (d.reasonCode != null && String(d.reasonCode).trim()) {
          row.reasonCode = String(d.reasonCode).trim();
        } else if (d.code != null && String(d.code).trim()) {
          row.reasonCode = String(d.code).trim();
        }
        if (d.active === false) {
          row.active = false;
        }
        return row;
      });`;

if (!apply.func.includes(oldDetails)) {
  console.error("Expected normalizeCatalog details snippet not found; abort.");
  process.exit(1);
}
apply.func = apply.func.replace(oldDetails, newDetails);

apply.func = apply.func.replaceAll("node.send([uiConfigMsg, null]);", "node.send([uiConfigMsg, null, null]);");
apply.func = apply.func.replaceAll("node.send([uiMoldMsg, null]);", "node.send([uiMoldMsg, null, null]);");
apply.func = apply.func.replaceAll("node.send([uiReadOnlyMsg, null]);", "node.send([uiReadOnlyMsg, null, null]);");
apply.func = apply.func.replaceAll("node.send([uiReasonCatalogMsg, null]);", "node.send([uiReasonCatalogMsg, null, null]);");

const oldReturnAck = `const ackMsg = {
  topic: ackTopic,
  payload: JSON.stringify({
    type: "settings_ack",
    orgId,
    machineId,
    version,
    source: "node-red",
    ts: new Date().toISOString()
  })
};

return [null, ackMsg];
`;

const newReturnAck = `const ackMsg = {
  topic: ackTopic,
  payload: JSON.stringify({
    type: "settings_ack",
    orgId,
    machineId,
    version,
    source: "node-red",
    ts: new Date().toISOString()
  })
};

const mirrorTrigger = { payload: { _syncReasonCatalog: true } };
return [null, ackMsg, mirrorTrigger];
`;

if (!apply.func.includes(oldReturnAck.trim())) {
  console.error("Expected ack return block not found");
  process.exit(1);
}
apply.func = apply.func.replace(oldReturnAck.trim(), newReturnAck.trim());

apply.func = apply.func.replace(
  `if (!orgId || !machineId) {
  return [null, null];
}`,
  `if (!orgId || !machineId) {
  return [null, null, null];
}`
);

apply.outputs = 3;
apply.wires = [
  ["2c8562b2471078ab", "dbfd127c516efa87", "9748899355370bae"],
  [],
  [gateId],
];

const gateFunc = `const p = msg.payload || {};
if (!p._syncReasonCatalog) {
  return null;
}
const settings = global.get("settings") || {};
const cat = settings.reasonCatalog || {};
const ver = Number(cat.version || 1);
function esc(v) {
  return String(v ?? "").replace(/\\\\/g, "\\\\\\\\").replace(/'/g, "''");
}
const parts = [];
function walk(kind, list) {
  if (!Array.isArray(list)) {
    return;
  }
  let sort = 0;
  list.forEach((c) => {
    const categoryId = esc(String(c.id || ""));
    const categoryLabel = esc(String(c.label || ""));
    const ch = c.children || c.details || [];
    if (!Array.isArray(ch)) {
      return;
    }
    ch.forEach((d) => {
      const id = String(d.id || "").trim();
      const label = String(d.label || "").trim();
      const rc = String(d.reasonCode || d.code || id || "").trim();
      if (!rc) {
        return;
      }
      const active = d.active === false ? 0 : 1;
      parts.push(
        "('" +
          kind +
          "','" +
          categoryId +
          "','" +
          categoryLabel +
          "','" +
          esc(rc) +
          "','" +
          esc(label) +
          "'," +
          sort +
          "," +
          active +
          "," +
          ver +
          ")"
      );
      sort += 1;
    });
  });
}
walk("downtime", cat.downtime || []);
walk("scrap", cat.scrap || []);
if (!parts.length) {
  node.status({ fill: "yellow", shape: "ring", text: "No reason rows to mirror" });
  return null;
}
const sql =
  "INSERT INTO reason_catalog_row (kind,category_id,category_label,reason_code,reason_label,sort_order,active,catalog_version) VALUES " +
  parts.join(",") +
  " ON DUPLICATE KEY UPDATE category_id=VALUES(category_id),category_label=VALUES(category_label),reason_label=VALUES(reason_label),sort_order=VALUES(sort_order),active=VALUES(active),catalog_version=VALUES(catalog_version),updated_at=CURRENT_TIMESTAMP(3)";
node.status({ fill: "green", shape: "dot", text: "Reason mirror SQL built" });
msg.topic = sql;
msg.payload = [];
return msg;
`;

const gateNode = {
  id: gateId,
  type: "function",
  z: "05d4cb231221b842",
  g: "a1b43a9e095c10db",
  name: "Build reason catalog mirror SQL",
  func: gateFunc,
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: "",
  finalize: "",
  libs: [],
  x: 1500,
  y: 1020,
  wires: [[mysqlPersistId]],
};

const mysqlNode = {
  id: mysqlPersistId,
  type: "mysql",
  z: "05d4cb231221b842",
  g: "a1b43a9e095c10db",
  mydb: "fc9634aabefee16b",
  name: "Persist reason catalog mirror",
  x: 1820,
  y: 1020,
  wires: [[]],
};

if (j.some((n) => n.id === gateId)) {
  console.log("Patch already applied (gate node exists). Skipping insert.");
} else {
  const idx = j.findIndex((n) => n.id === applyId);
  j.splice(idx + 1, 0, gateNode, mysqlNode);
}

writeFileSync(path, JSON.stringify(j, null, 4) + "\n");
console.log("Patched", path);
