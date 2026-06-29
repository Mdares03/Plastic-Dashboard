"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";
import HealthChecks, { type HealthOverall } from "@/components/health/HealthChecks";

/**
 * Client-facing reliability page — the "can I trust these numbers now?" answer.
 * A live hero status driven by the same checks behind the header badge, the
 * detailed consistency cards (shared HealthChecks), and a plain-language list of
 * the guarantees, cross-linked to the methodology and ROI pages.
 */
export default function TrustClient() {
  const { t } = useI18n();
  const [overall, setOverall] = useState<HealthOverall>(null);
  const [emailState, setEmailState] = useState<{ status: "idle" | "sending" | "done" | "error"; message?: string }>({
    status: "idle",
  });

  async function emailSummary() {
    setEmailState({ status: "sending" });
    try {
      const res = await fetch("/api/trust/assurance-email", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; sent?: number; error?: string };
      if (!res.ok || !data.ok) {
        setEmailState({ status: "error", message: data.error || t("trust.emailFailed") });
        return;
      }
      setEmailState({
        status: "done",
        message: data.sent ? t("trust.emailSent", { n: data.sent }) : t("trust.emailNone"),
      });
    } catch {
      setEmailState({ status: "error", message: t("trust.emailFailed") });
    }
  }

  // Until the live checks report back (or for non-admins who can't see them),
  // overall is null — show a neutral "verifying" hero rather than optimistically
  // claiming the numbers reconcile.
  const status: "checking" | "ok" | "warn" | "fail" = overall ?? "checking";

  const heroTone =
    status === "checking"
      ? "border-white/10 bg-white/5"
      : status === "ok"
        ? "border-emerald-500/30 bg-emerald-500/10"
        : status === "warn"
          ? "border-amber-500/30 bg-amber-500/10"
          : "border-red-500/30 bg-red-500/10";
  const heroIconTone =
    status === "checking"
      ? "text-zinc-300"
      : status === "ok"
        ? "text-emerald-300"
        : status === "warn"
          ? "text-amber-300"
          : "text-red-300";
  const HeroIcon = status === "checking" ? Loader2 : status === "ok" ? ShieldCheck : ShieldAlert;
  const heroTitle = t(`trust.hero.${status}.title`);
  const heroBody = t(`trust.hero.${status}.body`);

  const guarantees = ["g1", "g2", "g3", "g4", "g5"] as const;

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/40 p-6 backdrop-blur-xl">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(900px 500px at 20% 10%, rgba(16,185,129,.18), transparent 60%)," +
              "radial-gradient(900px 500px at 85% 30%, rgba(59,130,246,.12), transparent 60%)," +
              "radial-gradient(900px 600px at 50% 100%, rgba(244,63,94,.10), transparent 60%)",
          }}
        />
        <div className="relative">
          <div className="text-2xl font-semibold text-white">{t("trust.title")}</div>
          <div className="mt-1 text-sm text-zinc-300">{t("trust.subtitle")}</div>
        </div>
      </div>

      {/* Live hero status */}
      <div className={`mt-6 flex items-start gap-4 rounded-3xl border p-6 ${heroTone}`}>
        <HeroIcon
          className={`mt-0.5 h-8 w-8 shrink-0 ${heroIconTone} ${status === "checking" ? "animate-spin" : ""}`}
        />
        <div className="min-w-0">
          <div className="text-lg font-semibold text-white">{heroTitle}</div>
          <div className="mt-1 text-sm text-zinc-300">{heroBody}</div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Live checks */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 xl:col-span-2">
          <div className="text-lg font-semibold text-white">{t("trust.checks.title")}</div>
          <p className="mt-1 mb-4 text-xs text-zinc-400">{t("settings.integrity.subtitle")}</p>
          <HealthChecks onOverall={setOverall} />
        </div>

        {/* Guarantees */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="text-lg font-semibold text-white">{t("trust.guarantees.title")}</div>
          <ul className="mt-3 space-y-3">
            {guarantees.map((g) => (
              <li key={g} className="flex items-start gap-2 text-sm text-zinc-300">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                <span>{t(`trust.guarantees.${g}`)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-col gap-2">
            <Link
              href="/methodology"
              prefetch={false}
              className="text-sm text-emerald-300 hover:text-emerald-200"
            >
              {t("trust.methodologyLink")}
            </Link>
            <Link
              href="/reports/roi"
              prefetch={false}
              className="text-sm text-emerald-300 hover:text-emerald-200"
            >
              {t("trust.roiLink")}
            </Link>
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={emailSummary}
              disabled={emailState.status === "sending"}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white hover:bg-white/10 disabled:opacity-50"
            >
              {emailState.status === "sending" ? t("trust.emailSending") : t("trust.emailSummary")}
            </button>
            {emailState.message && (
              <div className={`mt-2 text-xs ${emailState.status === "error" ? "text-red-300" : "text-emerald-300"}`}>
                {emailState.message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
