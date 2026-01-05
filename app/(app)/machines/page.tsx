"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";

type MachineRow = {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
  latestHeartbeat: null | {
    ts: string;
    status: string;
    message?: string | null;
    ip?: string | null;
    fwVersion?: string | null;
  };
};

function secondsAgo(ts: string | undefined, locale: string, fallback: string) {
  if (!ts) return fallback;
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diff < 60) return rtf.format(-diff, "second");
  return rtf.format(-Math.floor(diff / 60), "minute");
}

function isOffline(ts?: string) {
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > 30000; // 30s threshold
}

function normalizeStatus(status?: string) {
  const s = (status ?? "").toUpperCase();
  if (s === "ONLINE") return "RUN";
  return s;
}

function badgeClass(status?: string, offline?: boolean) {
  if (offline) return "bg-white/10 text-zinc-300";
  const s = (status ?? "").toUpperCase();
  if (s === "RUN") return "bg-emerald-500/15 text-emerald-300";
  if (s === "IDLE") return "bg-yellow-500/15 text-yellow-300";
  if (s === "STOP" || s === "DOWN") return "bg-red-500/15 text-red-300";
  return "bg-white/10 text-white";
}

export default function MachinesPage() {
  const { t, locale } = useI18n();
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdMachine, setCreatedMachine] = useState<{
    id: string;
    name: string;
    pairingCode: string;
    pairingExpiresAt: string;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const res = await fetch("/api/machines", { cache: "no-store" });
        const json = await res.json();
        if (alive) {
          setMachines(json.machines ?? []);
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    }

    load();
    const t = setInterval(load, 5000);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  async function createMachine() {
    if (!createName.trim()) {
      setCreateError(t("machines.create.error.nameRequired"));
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const res = await fetch("/api/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName,
          code: createCode,
          location: createLocation,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t("machines.create.error.failed"));
      }

      const nextMachine = {
        ...data.machine,
        latestHeartbeat: null,
      };
      setMachines((prev) => [nextMachine, ...prev]);
      setCreatedMachine({
        id: data.machine.id,
        name: data.machine.name,
        pairingCode: data.machine.pairingCode,
        pairingExpiresAt: data.machine.pairingCodeExpiresAt,
      });
      setCreateName("");
      setCreateCode("");
      setCreateLocation("");
      setShowCreate(false);
    } catch (err: any) {
      setCreateError(err?.message || t("machines.create.error.failed"));
    } finally {
      setCreating(false);
    }
  }

  async function copyText(text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopyStatus(t("machines.pairing.copied"));
      } else {
        setCopyStatus(t("machines.pairing.copyUnsupported"));
      }
    } catch {
      setCopyStatus(t("machines.pairing.copyFailed"));
    }
    setTimeout(() => setCopyStatus(null), 2000);
  }

  const showCreateCard = showCreate || (!loading && machines.length === 0);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("machines.title")}</h1>
          <p className="text-sm text-zinc-400">{t("machines.subtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreate((prev) => !prev)}
            className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/30"
          >
            {showCreate ? t("machines.cancel") : t("machines.addMachine")}
          </button>
          <Link
            href="/overview"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            {t("machines.backOverview")}
          </Link>
        </div>
      </div>

      {showCreateCard && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-white">{t("machines.addCardTitle")}</div>
              <div className="text-xs text-zinc-400">{t("machines.addCardSubtitle")}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              {t("machines.field.name")}
              <input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              {t("machines.field.code")}
              <input
                value={createCode}
                onChange={(event) => setCreateCode(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              {t("machines.field.location")}
              <input
                value={createLocation}
                onChange={(event) => setCreateLocation(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={createMachine}
              disabled={creating}
              className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-60"
            >
            {creating ? t("machines.create.loading") : t("machines.create.default")}
          </button>
            {createError && <div className="text-xs text-red-200">{createError}</div>}
          </div>
        </div>
      )}

      {createdMachine && (
      <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
          <div className="text-sm font-semibold text-white">{t("machines.pairing.title")}</div>
          <div className="mt-2 text-xs text-zinc-300">
            {t("machines.pairing.machine")} <span className="text-white">{createdMachine.name}</span>
          </div>
          <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-400">{t("machines.pairing.codeLabel")}</div>
            <div className="mt-2 text-3xl font-semibold text-white">{createdMachine.pairingCode}</div>
            <div className="mt-2 text-xs text-zinc-400">
              {t("machines.pairing.expires")}{" "}
              {createdMachine.pairingExpiresAt
                ? new Date(createdMachine.pairingExpiresAt).toLocaleString(locale)
                : t("machines.pairing.soon")}
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-300">
            {t("machines.pairing.instructions")}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => copyText(createdMachine.pairingCode)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
            >
              {t("machines.pairing.copy")}
            </button>
            {copyStatus && <div className="text-xs text-zinc-300">{copyStatus}</div>}
          </div>
        </div>
      )}

      {loading && <div className="mb-4 text-sm text-zinc-400">{t("machines.loading")}</div>}

      {!loading && machines.length === 0 && (
        <div className="mb-4 text-sm text-zinc-400">{t("machines.empty")}</div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(!loading ? machines : []).map((m) => {
          const hb = m.latestHeartbeat;
          const offline = isOffline(hb?.ts);
          const normalizedStatus = normalizeStatus(hb?.status);
          const statusLabel = offline ? t("machines.status.offline") : (normalizedStatus || t("machines.status.unknown"));
          const lastSeen = secondsAgo(hb?.ts, locale, t("common.never"));

          return (
            <Link
              key={m.id}
              href={`/machines/${m.id}`}
              className="rounded-2xl border border-white/10 bg-white/5 p-5 hover:bg-white/10"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-white">{m.name}</div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {m.code ? m.code : t("common.na")} - {t("machines.lastSeen", { time: lastSeen })}
                  </div>
                </div>

                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs ${badgeClass(
                    normalizedStatus,
                    offline
                  )}`}
                >
                  {statusLabel}
                </span>
              </div>

              <div className="mt-4 text-sm text-zinc-400">{t("machines.status")}</div>
              <div className="text-xl font-semibold text-white">
                {offline ? t("machines.status.noHeartbeat") : (hb?.message ?? t("machines.status.ok"))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}




