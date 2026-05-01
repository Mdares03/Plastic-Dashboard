"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/useI18n";
import type { RecapDetailResponse, RecapRangeMode, RecapTimelineResponse } from "@/lib/recap/types";
import RecapBanners from "@/components/recap/RecapBanners";
import RecapKpiRow from "@/components/recap/RecapKpiRow";
import RecapProductionBySku from "@/components/recap/RecapProductionBySku";
import RecapDowntimeTop from "@/components/recap/RecapDowntimeTop";
import RecapWorkOrders from "@/components/recap/RecapWorkOrders";
import RecapMachineStatus from "@/components/recap/RecapMachineStatus";
import RecapFullTimeline from "@/components/recap/RecapFullTimeline";

type Props = {
  machineId: string;
  initialData: RecapDetailResponse;
};

function toInputDate(value: string) {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeInputDate(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

export default function RecapDetailClient({ machineId, initialData }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [timeline, setTimeline] = useState<RecapTimelineResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [customStart, setCustomStart] = useState(toInputDate(initialData.range.start));
  const [customEnd, setCustomEnd] = useState(toInputDate(initialData.range.end));

  const requestedRange =
    (searchParams.get("range") as RecapRangeMode | null) ?? initialData.range.requestedMode ?? initialData.range.mode;
  const selectedRange = requestedRange;
  const shiftAvailable = initialData.range.shiftAvailable ?? true;
  const shiftFallbackReason = initialData.range.fallbackReason;
  const shiftFallbackActive = selectedRange === "shift" && initialData.range.mode !== "shift";

  function pushRange(nextRange: RecapRangeMode, start?: string, end?: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", nextRange);

    if (nextRange === "custom" && start && end) {
      params.set("start", start);
      params.set("end", end);
    } else {
      params.delete("start");
      params.delete("end");
    }

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function applyCustomRange() {
    const start = normalizeInputDate(customStart);
    const end = normalizeInputDate(customEnd);
    if (!start || !end || end <= start) return;
    pushRange("custom", start, end);
  }

  const machine = initialData.machine;
  const generatedAtMs = new Date(initialData.generatedAt).getTime();
  const freshAgeSec = Number.isFinite(generatedAtMs) ? Math.max(0, Math.floor((nowMs - generatedAtMs) / 1000)) : null;
  const timelineStart = timeline?.range.start ?? initialData.range.start;
  const timelineEnd = timeline?.range.end ?? initialData.range.end;
  const timelineSegments = timeline?.segments ?? [];
  const timelineHasData = timeline?.hasData ?? false;

  useEffect(() => {
    let alive = true;
    setTimeline(null);
    setTimelineLoading(true);

    async function loadTimeline() {
      try {
        const params = new URLSearchParams({
          start: initialData.range.start,
          end: initialData.range.end,
        });
        const res = await fetch(`/api/recap/${machineId}/timeline?${params.toString()}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!alive || !res.ok || !json) return;
        setTimeline(json as RecapTimelineResponse);
      } catch {
      } finally {
        if (alive) setTimelineLoading(false);
      }
    }

    void loadTimeline();
    return () => {
      alive = false;
    };
  }, [initialData.range.end, initialData.range.start, machineId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link href="/recap" className="text-sm text-zinc-400 hover:text-zinc-200">
            {`← ${t("recap.detail.back")}`}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-white">{machine.name || machineId}</h1>
          <div className="text-sm text-zinc-400">{machine.location || t("common.na")}</div>
          {freshAgeSec != null ? (
            <div className="mt-1 text-xs text-zinc-500">{t("recap.grid.updatedAgo", { sec: freshAgeSec })}</div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          {(["24h", "shift", "yesterday", "custom"] as const).map((range) => (
            <button
              key={range}
              type="button"
              disabled={range === "shift" && !shiftAvailable}
              onClick={() => {
                if (range === "shift" && !shiftAvailable) return;
                if (range === "custom") {
                  pushRange("custom", normalizeInputDate(customStart) ?? undefined, normalizeInputDate(customEnd) ?? undefined);
                  return;
                }
                pushRange(range);
              }}
              className={`rounded-xl border px-3 py-2 ${
                selectedRange === range
                  ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
                  : "border-white/10 bg-black/40 text-zinc-200"
              } ${range === "shift" && !shiftAvailable ? "cursor-not-allowed opacity-60" : ""}`}
            >
              {range === "24h" ? t("recap.range.24h") : null}
              {range === "shift" ? t("recap.range.shiftCurrent") : null}
              {range === "yesterday" ? t("recap.range.yesterday") : null}
              {range === "custom" ? t("recap.range.custom") : null}
            </button>
          ))}
        </div>
      </div>

      {!shiftAvailable ? (
        <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {t("recap.range.shiftUnavailable")}
        </div>
      ) : null}

      {shiftFallbackActive ? (
        <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {shiftFallbackReason === "shift-inactive" ? t("recap.range.shiftFallbackInactive") : t("recap.range.shiftFallbackUnavailable")}
        </div>
      ) : null}

      {selectedRange === "custom" ? (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <input
            type="datetime-local"
            value={customStart}
            onChange={(event) => setCustomStart(event.target.value)}
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-zinc-200"
          />
          <input
            type="datetime-local"
            value={customEnd}
            onChange={(event) => setCustomEnd(event.target.value)}
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-zinc-200"
          />
          <button
            type="button"
            onClick={applyCustomRange}
            className="rounded-xl border border-emerald-300/50 bg-emerald-500/20 px-3 py-2 text-emerald-100"
          >
            {t("recap.range.apply")}
          </button>
        </div>
      ) : null}

      {isPending ? <div className="mb-3 text-xs text-zinc-500">{t("common.loading")}</div> : null}

      <div className="mb-4">
        <RecapBanners
          moldChangeStartMs={machine.moldChange?.active ? machine.moldChange.startMs : null}
          offlineForMin={machine.offlineForMin}
          ongoingStopMin={machine.ongoingStopMin}
        />
      </div>

      <RecapKpiRow
        oeeAvg={machine.oee}
        goodParts={machine.goodParts}
        totalStops={Math.round(machine.stopMinutes)}
        scrapParts={machine.scrap}
        rangeMode={initialData.range.mode}
      />

      <div className="mt-4">
        <RecapFullTimeline
          rangeStart={timelineStart}
          rangeEnd={timelineEnd}
          segments={timelineSegments}
          hasData={timelineHasData}
          loading={timelineLoading}
          locale={locale}
          rangeMode={initialData.range.mode}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <RecapProductionBySku rows={machine.productionBySku} />
        <RecapDowntimeTop rows={machine.downtimeTop} />
      </div>

      <div className="mt-4">
        <RecapWorkOrders workOrders={machine.workOrders} />
      </div>

      <div className="mt-4">
        <RecapMachineStatus heartbeat={machine.heartbeat} />
      </div>
    </div>
  );
}
