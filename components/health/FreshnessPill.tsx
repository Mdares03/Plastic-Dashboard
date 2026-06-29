"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";
import { formatElapsedSince } from "@/lib/time/elapsed";
import { RECAP_HEARTBEAT_STALE_MS } from "@/lib/metrics/spec";

/**
 * Always-on "data flowing" pill in the header. Shows the most-recent contact
 * across the fleet so everyone (operators + CEO) has ambient proof the pipe is
 * alive — the opposite of "did the site break again?". Closes the 5–10 min
 * silent-staleness gap (green ≤5 min, amber 5–10 min or data-loss, red >10 min).
 */

type Status = {
  machines: number;
  online: number;
  stale: number;
  dataLoss: number;
  lastSyncTs: string | null;
};

const POLL_MS = 45 * 1000;
const RED_MS = 2 * RECAP_HEARTBEAT_STALE_MS; // >10 min → no data

export default function FreshnessPill() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [hidden, setHidden] = useState(false);
  // `now` lives in state (updated on a tick) so the "synced X ago" label counts
  // up without calling Date.now() during render.
  const [now, setNow] = useState(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (alive) setNow(Date.now());
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          if (alive) setHidden(true);
          return;
        }
        const data = (await res.json().catch(() => null)) as (Status & { ok?: boolean }) | null;
        if (alive && data && typeof data.machines === "number") setStatus(data);
      } catch {
        /* keep last-known state */
      }
    }
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  if (hidden || !status || status.machines === 0 || now === 0) return null;

  const ageMs = status.lastSyncTs ? now - new Date(status.lastSyncTs).getTime() : Infinity;
  const level: "live" | "delayed" | "noData" =
    ageMs > RED_MS || status.lastSyncTs == null
      ? "noData"
      : ageMs > RECAP_HEARTBEAT_STALE_MS || status.dataLoss > 0
        ? "delayed"
        : "live";

  const tone =
    level === "live"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : level === "delayed"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : "border-red-500/30 bg-red-500/10 text-red-200";
  const dot = level === "live" ? "bg-emerald-400" : level === "delayed" ? "bg-amber-400" : "bg-red-400";
  const label = t(`status.${level}`);

  const synced = status.lastSyncTs ? formatElapsedSince(status.lastSyncTs, "", { maxUnits: 1 }) : "";
  const syncedLabel = synced ? t("status.synced", { ago: synced }) : "";

  const titleParts = [t("status.reporting", { online: status.online, total: status.machines })];
  if (status.dataLoss > 0) titleParts.push(t("status.dataLoss", { n: status.dataLoss }));
  if (syncedLabel) titleParts.push(syncedLabel);

  return (
    <span
      title={titleParts.join(" · ")}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot} ${level === "live" ? "animate-pulse" : ""}`} />
      <span>{label}</span>
      {syncedLabel ? <span className="hidden text-[11px] opacity-80 md:inline">· {syncedLabel}</span> : null}
    </span>
  );
}
