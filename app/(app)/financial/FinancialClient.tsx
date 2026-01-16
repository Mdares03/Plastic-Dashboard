"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n/useI18n";

type MachineRow = {
  id: string;
  name: string;
  location?: string | null;
};

type ImpactSummary = {
  currency: string;
  totals: {
    total: number;
    slowCycle: number;
    microstop: number;
    macrostop: number;
    scrap: number;
  };
  byDay: Array<{
    day: string;
    total: number;
    slowCycle: number;
    microstop: number;
    macrostop: number;
    scrap: number;
  }>;
};

type ImpactResponse = {
  ok: boolean;
  currencySummaries: ImpactSummary[];
};

function formatMoney(value: number, currency: string, locale: string) {
  if (!Number.isFinite(value)) return "--";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value.toFixed(0)} ${currency}`;
  }
}

export default function FinancialClient({
  initialRole = null,
  initialMachines = [],
  initialImpact = null,
}: {
  initialRole?: string | null;
  initialMachines?: MachineRow[];
  initialImpact?: ImpactResponse | null;
}) {
  const { locale, t } = useI18n();
  const [role, setRole] = useState<string | null>(initialRole);
  const [machines, setMachines] = useState<MachineRow[]>(() => initialMachines);
  const [impact, setImpact] = useState<ImpactResponse | null>(initialImpact);
  const [range, setRange] = useState("7d");
  const [machineFilter, setMachineFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [skuFilter, setSkuFilter] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [loading, setLoading] = useState(() => initialMachines.length === 0);
  const skipInitialImpactRef = useRef(true);

  const locations = useMemo(() => {
    const seen = new Set<string>();
    for (const m of machines) {
      if (!m.location) continue;
      seen.add(m.location);
    }
    return Array.from(seen).sort();
  }, [machines]);

  useEffect(() => {
    if (initialRole != null) return;
    let alive = true;

    async function loadMe() {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        setRole(data?.membership?.role ?? null);
      } catch {
        if (alive) setRole(null);
      }
    }

    loadMe();
    return () => {
      alive = false;
    };
  }, [initialRole]);

  useEffect(() => {
    if (initialMachines.length) {
      setLoading(false);
      return;
    }
    let alive = true;

    async function loadMachines() {
      try {
        const res = await fetch("/api/machines", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        setMachines(json.machines ?? []);
      } catch {
        if (!alive) return;
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadMachines();
    return () => {
      alive = false;
    };
  }, [initialMachines]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function loadImpact() {
      if (role == null) return;
      if (role !== "OWNER") return;

      const isDefault =
        range === "7d" &&
        !machineFilter &&
        !locationFilter &&
        !skuFilter &&
        !currencyFilter;
      if (skipInitialImpactRef.current) {
        skipInitialImpactRef.current = false;
        if (initialImpact && isDefault) return;
      }

      const params = new URLSearchParams();
      params.set("range", range);
      if (machineFilter) params.set("machineId", machineFilter);
      if (locationFilter) params.set("location", locationFilter);
      if (skuFilter) params.set("sku", skuFilter);
      if (currencyFilter) params.set("currency", currencyFilter);

      try {
        const res = await fetch(`/api/financial/impact?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        setImpact(json);
      } catch {
        if (alive) setImpact(null);
      }
    }

    loadImpact();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [currencyFilter, initialImpact, locationFilter, machineFilter, range, role, skuFilter]);

  const selectedSummary = impact?.currencySummaries?.[0] ?? null;
  const chartData = selectedSummary?.byDay ?? [];
  const exportQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("range", range);
    if (machineFilter) params.set("machineId", machineFilter);
    if (locationFilter) params.set("location", locationFilter);
    if (skuFilter) params.set("sku", skuFilter);
    if (currencyFilter) params.set("currency", currencyFilter);
    return params.toString();
  }, [range, machineFilter, locationFilter, skuFilter, currencyFilter]);

  const htmlHref = `/api/financial/export/pdf?${exportQuery}`;
  const csvHref = `/api/financial/export/excel?${exportQuery}`;

  if (role && role !== "OWNER") {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-2xl border border-white/10 bg-black/40 p-6 text-zinc-300">
          {t("financial.ownerOnly")}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("financial.title")}</h1>
          <p className="text-sm text-zinc-400">{t("financial.subtitle")}</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <a
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center text-sm text-zinc-200 hover:bg-white/10 sm:w-auto"
            href={htmlHref}
            target="_blank"
            rel="noreferrer"
          >
            {t("financial.export.html")}
          </a>
          <a
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center text-sm text-zinc-200 hover:bg-white/10 sm:w-auto"
            href={csvHref}
            target="_blank"
            rel="noreferrer"
          >
            {t("financial.export.csv")}
          </a>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-zinc-300">
        {t("financial.costsMoved")}{" "}
        <Link className="text-emerald-200 hover:text-emerald-100" href="/settings">
          {t("financial.costsMovedLink")}
        </Link>
        .
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {(impact?.currencySummaries ?? []).slice(0, 4).map((summary) => (
          <div key={summary.currency} className="rounded-2xl border border-white/10 bg-black/40 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{t("financial.totalLoss")}</div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {formatMoney(summary.totals.total, summary.currency, locale)}
            </div>
            <div className="mt-3 text-xs text-zinc-400">
              {t("financial.currencyLabel", { currency: summary.currency })}
            </div>
          </div>
        ))}
        {!impact?.currencySummaries?.length && (
          <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-zinc-400">
            {t("financial.noImpact")}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">{t("financial.chart.title")}</h2>
              <p className="text-xs text-zinc-500">{t("financial.chart.subtitle")}</p>
            </div>
            <div className="flex gap-2">
              {["24h", "7d", "30d"].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRange(value)}
                  className={
                    value === range
                      ? "rounded-full bg-emerald-500/20 px-3 py-1 text-xs text-emerald-200"
                      : "rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300"
                  }
                >
                  {value === "24h"
                    ? t("financial.range.day")
                    : value === "7d"
                      ? t("financial.range.week")
                      : t("financial.range.month")}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="slowFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#facc15" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#facc15" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="microFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fb7185" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#fb7185" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="macroFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="scrapFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
                <XAxis dataKey="day" tick={{ fill: "var(--app-chart-tick)", fontSize: 10 }} />
                <YAxis tick={{ fill: "var(--app-chart-tick)", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--app-chart-tooltip-bg)",
                    border: "1px solid var(--app-chart-tooltip-border)",
                  }}
                  labelStyle={{ color: "var(--app-chart-label)" }}
                />
                <Area type="monotone" dataKey="slowCycle" stackId="1" stroke="#facc15" fill="url(#slowFill)" />
                <Area type="monotone" dataKey="microstop" stackId="1" stroke="#fb7185" fill="url(#microFill)" />
                <Area type="monotone" dataKey="macrostop" stackId="1" stroke="#f97316" fill="url(#macroFill)" />
                <Area type="monotone" dataKey="scrap" stackId="1" stroke="#38bdf8" fill="url(#scrapFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-4">
          <h2 className="text-lg font-semibold text-white">{t("financial.filters.title")}</h2>
          <div className="space-y-3 text-sm text-zinc-300">
            <div>
              <label className="text-xs uppercase text-zinc-500">{t("financial.filters.machine")}</label>
              <select
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                value={machineFilter}
                onChange={(event) => setMachineFilter(event.target.value)}
              >
                <option value="">{t("financial.filters.allMachines")}</option>
                {machines.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-zinc-500">{t("financial.filters.location")}</label>
              <select
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                value={locationFilter}
                onChange={(event) => setLocationFilter(event.target.value)}
              >
                <option value="">{t("financial.filters.allLocations")}</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-zinc-500">{t("financial.filters.sku")}</label>
              <input
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                value={skuFilter}
                onChange={(event) => setSkuFilter(event.target.value)}
                placeholder={t("financial.filters.skuPlaceholder")}
              />
            </div>
            <div>
              <label className="text-xs uppercase text-zinc-500">{t("financial.filters.currency")}</label>
              <input
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                value={currencyFilter}
                onChange={(event) => setCurrencyFilter(event.target.value.toUpperCase())}
                placeholder={t("financial.filters.currencyPlaceholder")}
              />
            </div>
          </div>
        </div>
      </div>

      {loading && <div className="text-xs text-zinc-500">{t("financial.loadingMachines")}</div>}
    </div>
  );
}
