#!/usr/bin/env node

import assert from "node:assert/strict";

const NON_AUTHORITATIVE_REASON_CODES = new Set(["PENDIENTE", "UNCLASSIFIED"]);

function isNonAuthoritativeReasonCode(code) {
  const normalized = String(code ?? "").trim().toUpperCase();
  return !!normalized && NON_AUTHORITATIVE_REASON_CODES.has(normalized);
}

function shouldPreserveManualReason({
  incomingReasonCode,
  existingReasonCode,
  isManualAckEvent,
}) {
  if (isManualAckEvent) return false;
  if (!isNonAuthoritativeReasonCode(incomingReasonCode)) return false;
  if (!existingReasonCode) return false;
  return !isNonAuthoritativeReasonCode(existingReasonCode);
}

function run() {
  // 1) pending -> manual ack -> later pending: preserve manual
  assert.equal(
    shouldPreserveManualReason({
      incomingReasonCode: "PENDIENTE",
      existingReasonCode: "OPERACION__OTRO",
      isManualAckEvent: false,
    }),
    true
  );

  // 2) manual ack followed by another manual reason: latest manual should be allowed
  assert.equal(
    shouldPreserveManualReason({
      incomingReasonCode: "SERVICIOS__OTRO",
      existingReasonCode: "OPERACION__OTRO",
      isManualAckEvent: true,
    }),
    false
  );

  // 3) no manual reason ever applied: pending stays pending
  assert.equal(
    shouldPreserveManualReason({
      incomingReasonCode: "UNCLASSIFIED",
      existingReasonCode: "PENDIENTE",
      isManualAckEvent: false,
    }),
    false
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        testedAt: new Date().toISOString(),
        scenarios: 3,
      },
      null,
      2
    )
  );
}

run();

