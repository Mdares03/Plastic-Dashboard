"use client";

import { useState } from "react";

export default function SignupForm() {
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
        setErr(data.error || "Signup failed");
        return;
      }

      setVerificationSent(true);
      setEmailSent(data.emailSent !== false);
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  if (verificationSent) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8">
          <h1 className="text-2xl font-semibold text-white">Verify your email</h1>
          <p className="mt-2 text-sm text-zinc-300">
            We sent a verification link to <span className="text-white">{email}</span>.
          </p>
          {!emailSent && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              Verification email failed to send. Please contact support.
            </div>
          )}
          <div className="mt-4 text-xs text-zinc-500">
            Once verified, you can sign in and invite your team.
          </div>
          <div className="mt-6">
            <a
              href="/login"
              className="inline-flex rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
            >
              Back to login
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8">
        <h1 className="text-2xl font-semibold text-white">Create your Control Tower</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Set up your organization and invite the team.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="text-sm text-zinc-300">Organization name</label>
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              autoComplete="organization"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
              <label className="text-sm text-zinc-300">Email</label>
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
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

          {err && <div className="text-sm text-red-400">{err}</div>}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-xl bg-emerald-400 py-3 font-semibold text-black disabled:opacity-70"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>

          <div className="text-xs text-zinc-500">
            Already have access?{" "}
            <a href="/login" className="text-emerald-300 hover:text-emerald-200">
              Sign in
            </a>
          </div>
        </div>
      </form>
    </div>
  );
}
