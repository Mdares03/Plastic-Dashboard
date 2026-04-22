"use client";

import type { EventRow } from "./types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function secondsAgo(ts: string | undefined, locale: string, fallback: string) {
  if (!ts) return fallback;
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diff < 60) return rtf.format(-diff, "second");
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), "minute");
  return rtf.format(-Math.floor(diff / 3600), "hour");
}

function severityClass(sev?: string) {
  const s = (sev ?? "").toLowerCase();
  if (s === "critical") return "bg-red-500/15 text-red-300";
  if (s === "warning") return "bg-yellow-500/15 text-yellow-300";
  if (s === "info") return "bg-blue-500/15 text-blue-300";
  return "bg-white/10 text-zinc-200";
}

function sourceClass(src: EventRow["source"]) {
  if (src === "ingested") return "bg-white/10 text-zinc-200";
  return "bg-white/10 text-zinc-200";
}

function formatEventType(eventType: string | undefined, t: Translator) {
  if (!eventType) return "";
  const key = `overview.event.${eventType}`;
  const label = t(key);
  return label === key ? eventType : label;
}

function formatSource(source: string | undefined, t: Translator) {
  if (!source) return "";
  const key = `overview.source.${source}`;
  const label = t(key);
  return label === key ? source : label;
}

function formatSeverity(severity: string | undefined, t: Translator) {
  if (!severity) return "";
  const key = `overview.severity.${severity}`;
  const label = t(key);
  return label === key ? severity.toUpperCase() : label;
}

export default function OverviewTimeline({
  events,
  eventsLoading,
  locale,
  t,
}: {
  events: EventRow[];
  eventsLoading: boolean;
  locale: string;
  t: Translator;
}) {
  if (eventsLoading && events.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-2 animate-pulse">
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

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-white">{t("overview.timeline")}</div>
        <div className="text-xs text-zinc-400">
          {events.length} {t("overview.items")}
        </div>
      </div>

      {events.length === 0 && !eventsLoading ? (
        <div className="text-sm text-zinc-400">{t("overview.noEvents")}</div>
      ) : (
        <div className="h-[360px] space-y-3 overflow-y-auto no-scrollbar">
          {events.map((e) => (
            <div key={`${e.id}-${e.source}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${severityClass(e.severity)}`}>
                      {formatSeverity(e.severity, t)}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-zinc-200">
                      {formatEventType(e.eventType, t)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${sourceClass(e.source)}`}>
                      {formatSource(e.source, t)}
                    </span>
                    {e.requiresAck ? (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white">
                        {t("overview.ack")}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 truncate text-sm font-semibold text-white">
                    {e.machineName ? `${e.machineName}: ` : ""}
                    {e.title}
                  </div>
                  {e.description ? (
                    <div className="mt-1 text-sm text-zinc-300">{e.description}</div>
                  ) : null}
                </div>
                <div className="shrink-0 text-xs text-zinc-400">
                  {secondsAgo(e.ts, locale, t("common.never"))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
