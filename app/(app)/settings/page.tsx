"use client";

import { useState } from "react";

function Toggle({
  label,
  helper,
  enabled,
  onChange,
}: {
  label: string;
  helper: string;
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left hover:bg-white/5"
    >
      <div>
        <div className="text-sm font-semibold text-white">{label}</div>
        <div className="text-xs text-zinc-400">{helper}</div>
      </div>
      <span
        className={`h-6 w-12 rounded-full border border-white/10 p-0.5 transition ${
          enabled ? "bg-emerald-500/20" : "bg-white/5"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full transition ${
            enabled ? "translate-x-6 bg-emerald-400" : "bg-zinc-500"
          }`}
        />
      </span>
    </button>
  );
}

export default function SettingsPage() {
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [webhookEnabled, setWebhookEnabled] = useState(true);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="text-sm text-zinc-400">Configure alerts, shifts, and integrations.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-1">
          <div className="text-sm font-semibold text-white">Organization</div>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">Plant Name</div>
              <div className="mt-1 text-sm text-zinc-300">MIS Plant</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">Time Zone</div>
              <div className="mt-1 text-sm text-zinc-300">America/Mexico_City</div>
            </div>
            <button className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10">
              Edit Organization
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="text-sm font-semibold text-white">Alert Thresholds</div>
            <div className="text-xs text-zinc-400">Applies to all machines</div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[
              { label: "OEE Alert", value: "85%", helper: "Trigger when OEE drops below this" },
              { label: "Availability Alert", value: "85%", helper: "Low run time detection" },
              { label: "Performance Alert", value: "85%", helper: "Slow cycle detection" },
              { label: "Quality Alert", value: "95%", helper: "Scrap spike detection" },
              { label: "Microstop (sec)", value: "60s", helper: "Stop longer than this" },
              { label: "Macrostop (sec)", value: "300s", helper: "Major stop threshold" },
            ].map((row) => (
              <div key={row.label} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-zinc-400">{row.label}</div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-sm text-white">{row.value}</div>
                  <button className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white hover:bg-white/10">
                    Edit
                  </button>
                </div>
                <div className="mt-2 text-xs text-zinc-500">{row.helper}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="text-sm font-semibold text-white">Shift Schedule</div>
            <div className="text-xs text-zinc-400">Used for Availability calculations</div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              { label: "Shift A", time: "06:00 - 14:00", days: "Mon - Fri" },
              { label: "Shift B", time: "14:00 - 22:00", days: "Mon - Fri" },
              { label: "Shift C", time: "22:00 - 06:00", days: "Mon - Fri" },
            ].map((shift) => (
              <div key={shift.label} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-sm font-semibold text-white">{shift.label}</div>
                <div className="mt-1 text-xs text-zinc-400">{shift.time}</div>
                <div className="mt-2 text-xs text-zinc-500">{shift.days}</div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <button className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10">
              Edit Shifts
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm font-semibold text-white">Notification Channels</div>
          <div className="mt-4 space-y-3">
            <Toggle
              label="Email Alerts"
              helper="Send alerts to supervisors and managers"
              enabled={emailEnabled}
              onChange={setEmailEnabled}
            />
            <Toggle
              label="SMS Alerts"
              helper="Send critical alerts to on-call staff"
              enabled={smsEnabled}
              onChange={setSmsEnabled}
            />
            <Toggle
              label="Webhook"
              helper="POST events to external systems"
              enabled={webhookEnabled}
              onChange={setWebhookEnabled}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Integrations</div>
            <div className="text-xs text-zinc-400">Live endpoints</div>
          </div>
          <div className="space-y-3 text-sm text-zinc-300">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">Webhook URL</div>
              <div className="mt-1 text-sm text-white">https://hooks.example.com/iiot</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">ERP Sync</div>
              <div className="mt-1 text-sm text-zinc-300">Not configured</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-3 text-sm font-semibold text-white">Users & Roles</div>
          <div className="space-y-3 text-sm text-zinc-300">
            {[
              { name: "Juan Perez", role: "Plant Manager" },
              { name: "Sandra Rivera", role: "Supervisor" },
              { name: "Maintenance", role: "Technician" },
            ].map((user) => (
              <div key={user.name} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
                <div>
                  <div className="text-sm text-white">{user.name}</div>
                  <div className="text-xs text-zinc-400">{user.role}</div>
                </div>
                <button className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white hover:bg-white/10">
                  Manage
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <button className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10">
              Invite User
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
