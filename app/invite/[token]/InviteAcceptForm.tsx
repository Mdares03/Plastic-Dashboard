"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/useI18n";

type InviteInfo = {
  email: string;
  role: string;
  org: { id: string; name: string; slug: string };
  expiresAt: string;
};

type InviteAcceptFormProps = {
  token: string;
  initialInvite?: InviteInfo | null;
  initialError?: string | null;
};

export default function InviteAcceptForm({
  token,
  initialInvite = null,
  initialError = null,
}: InviteAcceptFormProps) {
  const router = useRouter();
  const { t } = useI18n();
  const cleanedToken = token.trim();
  const [invite, setInvite] = useState<InviteInfo | null>(initialInvite);
  const [loading, setLoading] = useState(!initialInvite && !initialError);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (initialInvite || initialError) {
      setLoading(false);
      return;
    }

    let alive = true;
    async function loadInvite() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/invites/${encodeURIComponent(cleanedToken)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || t("invite.error.notFound"));
        }
        if (alive) setInvite(data.invite);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : null;
        if (alive) setError(message || t("invite.error.notFound"));
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadInvite();
    return () => {
      alive = false;
    };
  }, [cleanedToken, initialInvite, initialError, t]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(cleanedToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t("invite.error.acceptFailed"));
      }
      router.push("/machines");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || t("invite.error.acceptFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6 text-zinc-300">
        {t("invite.loading")}
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
          {error || t("invite.notFound")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-2xl font-semibold text-white">
          {t("invite.joinTitle", { org: invite.org.name })}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {t("invite.acceptCopy", { email: invite.email, role: invite.role })}
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="text-sm text-zinc-300">{t("invite.yourName")}</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <div>
            <label className="text-sm text-zinc-300">{t("invite.password")}</label>
            <input
              type="password"
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {error && <div className="text-sm text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-xl bg-emerald-400 py-3 font-semibold text-black disabled:opacity-70"
          >
            {submitting ? t("invite.submit.loading") : t("invite.submit.default")}
          </button>
        </div>
      </form>
    </div>
  );
}
