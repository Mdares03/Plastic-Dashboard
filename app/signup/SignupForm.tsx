"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";

export default function SignupForm() {
  const { t } = useI18n();
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [emailSent, setEmailSent] = useState(true);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, name, email, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setErr(data.error || t("signup.error.default"));
        return;
      }

      setVerificationSent(true);
      setEmailSent(data.emailSent !== false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : null;
      setErr(message || t("signup.error.network"));
    } finally {
      setLoading(false);
    }
  }

  if (verificationSent) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8">
          <h1 className="text-2xl font-semibold text-white">{t("signup.verify.title")}</h1>
          <p className="mt-2 text-sm text-zinc-300">
            {t("signup.verify.sent", { email: email || t("common.na") })}
          </p>
          {!emailSent && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              {t("signup.verify.failed")}
            </div>
          )}
          <div className="mt-4 text-xs text-zinc-500">{t("signup.verify.notice")}</div>
          <div className="mt-6">
            <a
              href="/login"
              className="inline-flex rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
            >
              {t("signup.verify.back")}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-2xl font-semibold text-white">{t("signup.title")}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t("signup.subtitle")}</p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="text-sm text-zinc-300">{t("signup.orgName")}</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              autoComplete="organization"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm text-zinc-300">{t("signup.yourName")}</label>
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </div>
            <div>
              <label className="text-sm text-zinc-300">{t("signup.email")}</label>
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-zinc-300">{t("signup.password")}</label>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {err && <div className="text-sm text-red-400">{err}</div>}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-xl bg-emerald-400 py-3 font-semibold text-black disabled:opacity-70"
          >
            {loading ? t("signup.submit.loading") : t("signup.submit.default")}
          </button>

          <div className="text-xs text-zinc-500">
            {t("signup.alreadyHave")}{" "}
            <a href="/login" className="text-emerald-300 hover:text-emerald-200">
              {t("signup.signIn")}
            </a>
          </div>
        </div>
      </form>
    </div>
  );
}
