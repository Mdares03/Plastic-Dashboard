"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type InviteInfo = {
  email: string;
  role: string;
  org: { id: string; name: string; slug: string };
  expiresAt: string;
};

export default function InviteAcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let alive = true;
    async function loadInvite() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/invites/${token}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Invite not found");
        }
        if (alive) setInvite(data.invite);
      } catch (err: any) {
        if (alive) setError(err?.message || "Invite not found");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadInvite();
    return () => {
      alive = false;
    };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/invites/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Invite acceptance failed");
      }
      router.push("/machines");
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Invite acceptance failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6 text-zinc-300">
        Loading invite...
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
          {error || "Invite not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-2xl font-semibold text-white">Join {invite.org.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Accept the invite for {invite.email} as {invite.role}.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="text-sm text-zinc-300">Your name</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <div>
            <label className="text-sm text-zinc-300">Password</label>
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
            {submitting ? "Joining..." : "Join organization"}
          </button>
        </div>
      </form>
    </div>
  );
}
