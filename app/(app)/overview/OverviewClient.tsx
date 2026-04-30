"use client";

import Link from "next/link";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";
import { RECAP_HEARTBEAT_STALE_MS } from "@/lib/recap/recapUiConstants";
import type { EventRow, Heartbeat, MachineRow } from "./types";

const OFFLINE_MS = RECAP_HEARTBEAT_STALE_MS;
const MAX_EVENT_MACHINES = 6;
const OverviewTimeline = lazy(() => import("./OverviewTimeline"));

function secondsAgo(ts: string | undefined, locale: string, fallback: string) {
  if (!ts) return fallback;
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diff < 60) return rtf.format(-diff, "second");
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), "minute");
  return rtf.format(-Math.floor(diff / 3600), "hour");
}

function isOffline(ts?: string) {
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > OFFLINE_MS;
}

function normalizeStatus(status?: string) {
  const s = (status ?? "").toUpperCase();
  if (s === "ONLINE") return "RUN";
  return s;
}

function heartbeatTime(hb?: Heartbeat | null) {
  return hb?.tsServer ?? hb?.ts;
}

function fmtPct(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "--";
  return `${v.toFixed(1)}%`;
}

function fmtNum(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "--";
  return `${Math.round(v)}`;
}

function OverviewTimelineSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <div className="h-4 w-32 rounded bg-white/10" />
        <div className="h-3 w-20 rounded bg-white/5" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="h-20 rounded-xl border border-white/10 bg-black/20" />
        ))}
      </div>
    </div>
  );
}

export default function OverviewClient({
  initialMachines = [],
  initialEvents = [],
}: {
  initialMachines?: MachineRow[];
  initialEvents?: EventRow[];
}) {
  const { t, locale } = useI18n();
  const [machines, setMachines] = useState<MachineRow[]>(() => initialMachines);
  const [events, setEvents] = useState<EventRow[]>(() => initialEvents);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(() => initialEvents.length === 0);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setEventsLoading(true);
        const res = await fetch(
          `/api/overview?detail=1&events=critical&eventMachines=${MAX_EVENT_MACHINES}`,
          {
            cache: "no-cache",
          }
        );
        if (res.status === 304) {
          if (alive) setLoading(false);
          return;
        }
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        setMachines(json.machines ?? []);
        setEvents(json.events ?? []);
        setLoading(false);
      } catch {
        if (!alive) return;
        setMachines([]);
        setEvents([]);
        setLoading(false);
      } finally {
        if (alive) setEventsLoading(false);
      }
    }

    load();
    const t = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const stats = useMemo(() => {
    const total = machines.length;
    let online = 0;
    let running = 0;
    let idle = 0;
    let stopped = 0;
    let oeeSum = 0;
    let oeeCount = 0;
    let availSum = 0;
    let availCount = 0;
    let perfSum = 0;
    let perfCount = 0;
    let qualSum = 0;
    let qualCount = 0;
    let goodSum = 0;
    let scrapSum = 0;
    let targetSum = 0;
    let hasKpi = false;

    for (const m of machines) {
      const hb = m.latestHeartbeat;
      const offline = isOffline(heartbeatTime(hb));
      if (!offline) online += 1;

      const status = normalizeStatus(hb?.status);
      if (!offline) {
        if (status === "RUN") running += 1;
        else if (status === "IDLE") idle += 1;
        else if (status === "STOP" || status === "DOWN") stopped += 1;
      }

      const k = m.latestKpi;
      if (k?.oee != null) {
        oeeSum += Number(k.oee);
        oeeCount += 1;
        hasKpi = true;
      }
      if (k?.availability != null) {
        availSum += Number(k.availability);
        availCount += 1;
        hasKpi = true;
      }
      if (k?.performance != null) {
        perfSum += Number(k.performance);
        perfCount += 1;
        hasKpi = true;
      }
      if (k?.quality != null) {
        qualSum += Number(k.quality);
        qualCount += 1;
        hasKpi = true;
      }
      if (k?.good != null) {
        goodSum += Number(k.good);
        hasKpi = true;
      }
      if (k?.scrap != null) {
        scrapSum += Number(k.scrap);
        hasKpi = true;
      }
      if (k?.target != null) {
        targetSum += Number(k.target);
        hasKpi = true;
      }
    }

    return {
      total,
      online,
      offline: total - online,
      running,
      idle,
      stopped,
      oee: oeeCount ? oeeSum / oeeCount : null,
      availability: availCount ? availSum / availCount : null,
      performance: perfCount ? perfSum / perfCount : null,
      quality: qualCount ? qualSum / qualCount : null,
      goodSum: hasKpi ? goodSum : null,
      scrapSum: hasKpi ? scrapSum : null,
      targetSum: hasKpi ? targetSum : null,
    };
  }, [machines]);

  const attention = useMemo(() => {
    const list = machines
      .map((m) => {
        const hb = m.latestHeartbeat;
        const offline = isOffline(heartbeatTime(hb));
        const status = normalizeStatus(hb?.status);
        const k = m.latestKpi;
        const oee = k?.oee ?? null;
        const good = k?.good ?? null;
        const scrap = k?.scrap ?? null;
        const availability = k?.availability ?? null;

        const reasons: string[] = [];
        let score = 0;

        // Trigger 1: offline (highest priority — can't tell what's wrong)
        if (offline) {
          score += 100;
          reasons.push(t("overview.attention.offline"));
        }

        // Trigger 2: stopped right now (and online — operator should act)
        if (!offline && (status === "STOP" || status === "DOWN")) {
          score += 60;
          reasons.push(t("overview.attention.stopped"));
        }

        // Trigger 3: low OEE
        if (!offline && oee != null) {
          if (oee < 50) {
            score += 50;
            reasons.push(t("overview.attention.oeeCritical", { value: oee.toFixed(0) }));
          } else if (oee < 75) {
            score += 30;
            reasons.push(t("overview.attention.oeeLow", { value: oee.toFixed(0) }));
          }
        }

        // Trigger 4: scrap rate >5% on active WO
        if (!offline && good != null && scrap != null && good + scrap > 0) {
          const scrapPct = (scrap / (good + scrap)) * 100;
          if (scrapPct > 10) {
            score += 40;
            reasons.push(t("overview.attention.scrapHigh", { value: scrapPct.toFixed(1) }));
          } else if (scrapPct > 5) {
            score += 20;
            reasons.push(t("overview.attention.scrapMod", { value: scrapPct.toFixed(1) }));
          }
        }

        // Trigger 5: availability collapse (often means undeclared stops)
        if (!offline && availability != null && availability < 60) {
          score += 25;
          reasons.push(t("overview.attention.availLow", { value: availability.toFixed(0) }));
        }

        return { machine: m, offline, oee, score, reasons };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    return list;
  }, [machines, t]);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("overview.title")}</h1>
          <p className="text-sm text-zinc-400">{t("overview.subtitle")}</p>
        </div>

        <Link
          href="/machines"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center text-sm text-white hover:bg-white/10 sm:w-auto"
        >
          {t("overview.viewMachines")}
        </Link>
      </div>

      {loading && <div className="mb-4 text-sm text-zinc-400">{t("overview.loading")}</div>}

      <div className="mb-4 rounded-2xl border border-white/10 bg-black/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">{t("overview.recap.title")}</div>
            <div className="text-xs text-zinc-400">{t("overview.recap.subtitle")}</div>
          </div>
          <Link
            href="/recap"
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20"
          >
            {t("overview.recap.cta")}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs text-zinc-400">{t("overview.fleetHealth")}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{stats.total}</div>
          <div className="mt-2 text-xs text-zinc-400">{t("overview.machinesTotal")}</div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
              {t("overview.online")} {stats.online}
            </span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-zinc-300">
              {t("overview.offline")} {stats.offline}
            </span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
              {t("overview.run")} {stats.running}
            </span>
            <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-yellow-300">
              {t("overview.idle")} {stats.idle}
            </span>
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-300">
              {t("overview.stop")} {stats.stopped}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs text-zinc-400">{t("overview.productionTotals")}</div>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-[11px] text-zinc-400">{t("overview.good")}</div>
              <div className="mt-1 text-sm font-semibold text-white">{fmtNum(stats.goodSum)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-[11px] text-zinc-400">{t("overview.scrap")}</div>
              <div className="mt-1 text-sm font-semibold text-white">{fmtNum(stats.scrapSum)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-[11px] text-zinc-400">{t("overview.target")}</div>
              <div className="mt-1 text-sm font-semibold text-white">{fmtNum(stats.targetSum)}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-400">{t("overview.kpiSumNote")}</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs text-zinc-400">{t("overview.activityFeed")}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{events.length}</div>
          <div className="mt-2 text-xs text-zinc-400">
            {eventsLoading ? t("overview.eventsRefreshing") : t("overview.eventsLast30")}
          </div>
          <div className="mt-4 space-y-2">
            {events.slice(0, 3).map((e) => (
              <div key={e.id} className="flex items-center justify-between text-xs text-zinc-300">
                <div className="truncate">
                  {e.machineName ? `${e.machineName}: ` : ""}
                  {e.title}
                </div>
                <div className="shrink-0 text-zinc-500">
                  {secondsAgo(e.ts, locale, t("common.never"))}
                </div>
              </div>
            ))}
            {events.length === 0 && !eventsLoading ? (
              <div className="text-xs text-zinc-500">{t("overview.eventsNone")}</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs text-zinc-400">{t("overview.oeeAvg")}</div>
          <div className="mt-2 text-3xl font-semibold text-emerald-300">{fmtPct(stats.oee)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs text-zinc-400">{t("overview.availabilityAvg")}</div>
          <div className="mt-2 text-2xl font-semibold text-white">{fmtPct(stats.availability)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs text-zinc-400">{t("overview.performanceAvg")}</div>
          <div className="mt-2 text-2xl font-semibold text-white">{fmtPct(stats.performance)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-xs text-zinc-400">{t("overview.qualityAvg")}</div>
          <div className="mt-2 text-2xl font-semibold text-white">{fmtPct(stats.quality)}</div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-white">{t("overview.attentionList")}</div>
            <div className="text-xs text-zinc-400">
              {attention.length} {t("overview.shown")}
            </div>
          </div>
          {attention.length === 0 ? (
            <div className="text-sm text-zinc-400">{t("overview.noUrgent")}</div>
          ) : (
            <div className="space-y-3">
              {attention.map(({ machine, offline, oee, reasons }) => (
                <Link
                  key={machine.id}
                  href={`/recap/${machine.id}`}
                  className="block rounded-xl border border-white/10 bg-black/20 p-3 hover:border-white/20 hover:bg-black/30 transition"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{machine.name}</div>
                      <div className="mt-1 text-xs text-zinc-400">
                        {machine.code ?? ""} {machine.location ? `- ${machine.location}` : ""}
                      </div>
                    </div>
                    <div className="text-xs text-zinc-400">
                      {secondsAgo(heartbeatTime(machine.latestHeartbeat), locale, t("common.never"))}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        offline ? "bg-white/10 text-zinc-300" : "bg-emerald-500/15 text-emerald-300"
                      }`}
                    >
                      {offline ? t("overview.status.offline") : t("overview.status.online")}
                    </span>
                    {oee != null && !offline && (
                      <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-yellow-300">
                        OEE {fmtPct(oee)}
                      </span>
                    )}
                  </div>
                  {reasons.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-[11px] text-zinc-400">
                      {reasons.map((r, i) => (
                        <li key={i}>· {r}</li>
                      ))}
                    </ul>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>

        <Suspense fallback={<OverviewTimelineSkeleton />}>
          <OverviewTimeline events={events} eventsLoading={eventsLoading} locale={locale} t={t} />
        </Suspense>
      </div>
    </div>
  );
}
