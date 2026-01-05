"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/machines";
  const { t } = useI18n();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, next }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setErr(data.error || t("login.error.default"));
        return;
      }

      router.push(next);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || t("login.error.network"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-2xl font-semibold text-white">{t("login.title")}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t("login.subtitle")}</p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="text-sm text-zinc-300">{t("login.email")}</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div>
            <label className="text-sm text-zinc-300">{t("login.password")}</label>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {err && <div className="text-sm text-red-400">{err}</div>}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-xl bg-emerald-400 py-3 font-semibold text-black disabled:opacity-70"
          >
            {loading ? t("login.submit.loading") : t("login.submit.default")}
          </button>

          <div className="text-xs text-zinc-500">
            {t("login.newHere")}{" "}
            <a href="/signup" className="text-emerald-300 hover:text-emerald-200">
              {t("login.createAccount")}
            </a>
          </div>
        </div>
      </form>
    </div>
  );
}
