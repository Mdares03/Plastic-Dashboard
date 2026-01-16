"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";

type RoleName = "MEMBER" | "ADMIN" | "OWNER";
type Channel = "email" | "sms";

type RoleRule = {
  enabled: boolean;
  afterMinutes: number;
  channels: Channel[];
};

type AlertRule = {
  id: string;
  eventType: string;
  roles: Record<RoleName, RoleRule>;
  repeatMinutes?: number;
};

type AlertPolicy = {
  version: number;
  defaults: Record<RoleName, RoleRule>;
  rules: AlertRule[];
};

type AlertContact = {
  id: string;
  name: string;
  roleScope: string;
  email?: string | null;
  phone?: string | null;
  eventTypes?: string[] | null;
  isActive: boolean;
  userId?: string | null;
};

type ContactDraft = {
  name: string;
  roleScope: string;
  email: string;
  phone: string;
  eventTypes: string[];
  isActive: boolean;
};

const ROLE_ORDER: RoleName[] = ["MEMBER", "ADMIN", "OWNER"];
const CHANNELS: Channel[] = ["email", "sms"];
const EVENT_TYPES = [
  { value: "macrostop", labelKey: "alerts.event.macrostop" },
  { value: "microstop", labelKey: "alerts.event.microstop" },
  { value: "slow-cycle", labelKey: "alerts.event.slow-cycle" },
  { value: "offline", labelKey: "alerts.event.offline" },
  { value: "error", labelKey: "alerts.event.error" },
] as const;

function normalizeContactDraft(contact: AlertContact): ContactDraft {
  return {
    name: contact.name,
    roleScope: contact.roleScope,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    eventTypes: Array.isArray(contact.eventTypes) ? contact.eventTypes : [],
    isActive: contact.isActive,
  };
}

export function AlertsConfig() {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<AlertPolicy | null>(null);
  const [policyDraft, setPolicyDraft] = useState<AlertPolicy | null>(null);
  const [contacts, setContacts] = useState<AlertContact[]>([]);
  const [contactEdits, setContactEdits] = useState<Record<string, ContactDraft>>({});
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<RoleName>("MEMBER");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [savingContactId, setSavingContactId] = useState<string | null>(null);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);
  const [selectedEventType, setSelectedEventType] = useState<string>("");

  const [newContact, setNewContact] = useState<ContactDraft>({
    name: "",
    roleScope: "CUSTOM",
    email: "",
    phone: "",
    eventTypes: [],
    isActive: true,
  });
  const [creatingContact, setCreatingContact] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setPolicyError(null);
      setContactsError(null);
      try {
        const [policyRes, contactsRes, meRes] = await Promise.all([
          fetch("/api/alerts/policy", { cache: "no-store" }),
          fetch("/api/alerts/contacts", { cache: "no-store" }),
          fetch("/api/me", { cache: "no-store" }),
        ]);
        const policyJson = await policyRes.json().catch(() => ({}));
        const contactsJson = await contactsRes.json().catch(() => ({}));
        const meJson = await meRes.json().catch(() => ({}));

        if (!alive) return;

        if (!policyRes.ok || !policyJson?.ok) {
          setPolicyError(policyJson?.error || t("alerts.error.loadPolicy"));
        } else {
          setPolicy(policyJson.policy);
          setPolicyDraft(policyJson.policy);
          if (policyJson.policy?.rules?.length) {
            setSelectedEventType((prev) => prev || policyJson.policy.rules[0].eventType);
          }
        }

        if (!contactsRes.ok || !contactsJson?.ok) {
          setContactsError(contactsJson?.error || t("alerts.error.loadContacts"));
        } else {
          setContacts(contactsJson.contacts ?? []);
          const nextEdits: Record<string, ContactDraft> = {};
          for (const contact of contactsJson.contacts ?? []) {
            nextEdits[contact.id] = normalizeContactDraft(contact);
          }
          setContactEdits(nextEdits);
        }

        if (meRes.ok && meJson?.ok && meJson?.membership?.role) {
          setRole(String(meJson.membership.role).toUpperCase() as RoleName);
        }
      } catch {
        if (!alive) return;
        setPolicyError(t("alerts.error.loadPolicy"));
        setContactsError(t("alerts.error.loadContacts"));
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [t]);

  useEffect(() => {
    if (!policyDraft?.rules?.length) return;
    setSelectedEventType((prev) => {
      if (prev && policyDraft.rules.some((rule) => rule.eventType === prev)) {
        return prev;
      }
      return policyDraft.rules[0].eventType;
    });
  }, [policyDraft]);

  function updatePolicyDefaults(role: RoleName, patch: Partial<RoleRule>) {
    setPolicyDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        defaults: {
          ...prev.defaults,
          [role]: {
            ...prev.defaults[role],
            ...patch,
          },
        },
      };
    });
  }

  function updateRule(eventType: string, patch: Partial<AlertRule>) {
    setPolicyDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rules: prev.rules.map((rule) =>
          rule.eventType === eventType ? { ...rule, ...patch } : rule
        ),
      };
    });
  }

  function updateRuleRole(eventType: string, role: RoleName, patch: Partial<RoleRule>) {
    setPolicyDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rules: prev.rules.map((rule) => {
          if (rule.eventType !== eventType) return rule;
          return {
            ...rule,
            roles: {
              ...rule.roles,
              [role]: {
                ...rule.roles[role],
                ...patch,
              },
            },
          };
        }),
      };
    });
  }

  function applyDefaultsToEvent(eventType: string) {
    setPolicyDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rules: prev.rules.map((rule) => {
          if (rule.eventType !== eventType) return rule;
          return {
            ...rule,
            roles: {
              MEMBER: { ...prev.defaults.MEMBER },
              ADMIN: { ...prev.defaults.ADMIN },
              OWNER: { ...prev.defaults.OWNER },
            },
          };
        }),
      };
    });
  }

  async function savePolicy() {
    if (!policyDraft) return;
    setSavingPolicy(true);
    setPolicyError(null);
    try {
      const res = await fetch("/api/alerts/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy: policyDraft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setPolicyError(json?.error || t("alerts.error.savePolicy"));
      } else {
        setPolicy(policyDraft);
      }
    } catch {
      setPolicyError(t("alerts.error.savePolicy"));
    } finally {
      setSavingPolicy(false);
    }
  }

  function updateContactDraft(id: string, patch: Partial<ContactDraft>) {
    setContactEdits((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { name: "", roleScope: "CUSTOM", email: "", phone: "", eventTypes: [], isActive: true }),
        ...patch,
      },
    }));
  }

  async function saveContact(id: string) {
    const payload = contactEdits[id];
    if (!payload) return;
    setSavingContactId(id);
    try {
      const res = await fetch(`/api/alerts/contacts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setContactsError(json?.error || t("alerts.error.saveContact"));
      } else if (json.contact) {
        const contact = json.contact as AlertContact;
        setContacts((prev) => prev.map((row) => (row.id === id ? contact : row)));
        setContactEdits((prev) => ({ ...prev, [id]: normalizeContactDraft(contact) }));
      }
    } catch {
      setContactsError(t("alerts.error.saveContact"));
    } finally {
      setSavingContactId(null);
    }
  }

  async function deleteContact(id: string) {
    setDeletingContactId(id);
    try {
      const res = await fetch(`/api/alerts/contacts/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setContactsError(json?.error || t("alerts.error.deleteContact"));
      } else {
        setContacts((prev) => prev.filter((row) => row.id !== id));
        setContactEdits((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    } catch {
      setContactsError(t("alerts.error.deleteContact"));
    } finally {
      setDeletingContactId(null);
    }
  }

  async function createContact() {
    setCreatingContact(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/alerts/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newContact),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setCreateError(json?.error || t("alerts.error.createContact"));
        return;
      }
      const contact = json.contact as AlertContact;
      setContacts((prev) => [contact, ...prev]);
      setContactEdits((prev) => ({ ...prev, [contact.id]: normalizeContactDraft(contact) }));
      setNewContact({
        name: "",
        roleScope: "CUSTOM",
        email: "",
        phone: "",
        eventTypes: [],
        isActive: true,
      });
    } catch {
      setCreateError(t("alerts.error.createContact"));
    } finally {
      setCreatingContact(false);
    }
  }

  const policyDirty = useMemo(
    () => JSON.stringify(policy) !== JSON.stringify(policyDraft),
    [policy, policyDraft]
  );
  const canEdit = role === "OWNER";

  return (
    <div className="space-y-6">
      {loading && (
        <div className="text-sm text-zinc-400">{t("alerts.loading")}</div>
      )}

      {!loading && policyError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
          {policyError}
        </div>
      )}

      {!loading && policyDraft && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-white">{t("alerts.policy.title")}</div>
              <div className="text-xs text-zinc-400">{t("alerts.policy.subtitle")}</div>
            </div>
            <button
              type="button"
              onClick={savePolicy}
              disabled={!canEdit || !policyDirty || savingPolicy}
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {savingPolicy ? t("alerts.policy.saving") : t("alerts.policy.save")}
            </button>
          </div>

          {!canEdit && (
            <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-300">
              {t("alerts.policy.readOnly")}
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-xs text-zinc-400">{t("alerts.policy.defaults")}</div>
            <div className="mb-4 text-xs text-zinc-500">{t("alerts.policy.defaultsHelp")}</div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {ROLE_ORDER.map((role) => {
                const rule = policyDraft.defaults[role];
                return (
                  <div key={role} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-sm font-semibold text-white">{role}</div>
                    <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(event) => updatePolicyDefaults(role, { enabled: event.target.checked })}
                        disabled={!canEdit}
                        className="h-4 w-4 rounded border border-white/20 bg-black/20"
                      />
                      {t("alerts.policy.enabled")}
                    </label>
                    <label className="mt-3 block text-xs text-zinc-400">
                      {t("alerts.policy.afterMinutes")}
                      <input
                        type="number"
                        min={0}
                        value={rule.afterMinutes}
                        onChange={(event) =>
                          updatePolicyDefaults(role, { afterMinutes: Number(event.target.value) })
                        }
                        disabled={!canEdit}
                        className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <div className="mt-3 text-xs text-zinc-400">{t("alerts.policy.channels")}</div>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {CHANNELS.map((channel) => (
                        <label key={channel} className="flex items-center gap-2 text-xs text-zinc-400">
                          <input
                            type="checkbox"
                            checked={rule.channels.includes(channel)}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...rule.channels, channel]
                                : rule.channels.filter((c) => c !== channel);
                              updatePolicyDefaults(role, { channels: next });
                            }}
                            disabled={!canEdit}
                            className="h-4 w-4 rounded border border-white/20 bg-black/20"
                          />
                          {channel.toUpperCase()}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{t("alerts.policy.eventSelectLabel")}</div>
                  <div className="text-xs text-zinc-400">{t("alerts.policy.eventSelectHelper")}</div>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={selectedEventType}
                    onChange={(event) => setSelectedEventType(event.target.value)}
                    disabled={!canEdit}
                    className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  >
                    {policyDraft.rules.map((rule) => (
                      <option key={rule.eventType} value={rule.eventType}>
                        {t(`alerts.event.${rule.eventType}`)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => applyDefaultsToEvent(selectedEventType)}
                    disabled={!canEdit || !selectedEventType}
                    className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white disabled:opacity-40"
                  >
                    {t("alerts.policy.applyDefaults")}
                  </button>
                </div>
              </div>
            </div>

            {policyDraft.rules
              .filter((rule) => rule.eventType === selectedEventType)
              .map((rule) => (
                <div key={rule.eventType} className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">
                      {t(`alerts.event.${rule.eventType}`)}
                    </div>
                    <label className="text-xs text-zinc-400">
                      {t("alerts.policy.repeatMinutes")}
                      <input
                        type="number"
                        min={0}
                        value={rule.repeatMinutes ?? 0}
                        onChange={(event) =>
                          updateRule(rule.eventType, { repeatMinutes: Number(event.target.value) })
                        }
                        disabled={!canEdit}
                        className="ml-2 w-20 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                      />
                    </label>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    {ROLE_ORDER.map((role) => {
                      const roleRule = rule.roles[role];
                      return (
                        <div key={role} className="rounded-xl border border-white/10 bg-black/20 p-3">
                          <div className="text-sm font-semibold text-white">{role}</div>
                          <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                            <input
                              type="checkbox"
                              checked={roleRule.enabled}
                              onChange={(event) =>
                                updateRuleRole(rule.eventType, role, { enabled: event.target.checked })
                              }
                              disabled={!canEdit}
                              className="h-4 w-4 rounded border border-white/20 bg-black/20"
                            />
                            {t("alerts.policy.enabled")}
                          </label>
                          <label className="mt-3 block text-xs text-zinc-400">
                            {t("alerts.policy.afterMinutes")}
                            <input
                              type="number"
                              min={0}
                              value={roleRule.afterMinutes}
                              onChange={(event) =>
                                updateRuleRole(rule.eventType, role, { afterMinutes: Number(event.target.value) })
                              }
                              disabled={!canEdit}
                              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                            />
                          </label>
                          <div className="mt-3 text-xs text-zinc-400">{t("alerts.policy.channels")}</div>
                          <div className="mt-2 flex flex-wrap gap-3">
                            {CHANNELS.map((channel) => (
                              <label key={channel} className="flex items-center gap-2 text-xs text-zinc-400">
                                <input
                                  type="checkbox"
                                  checked={roleRule.channels.includes(channel)}
                                  onChange={(event) => {
                                    const next = event.target.checked
                                      ? [...roleRule.channels, channel]
                                      : roleRule.channels.filter((c) => c !== channel);
                                    updateRuleRole(rule.eventType, role, { channels: next });
                                  }}
                                  disabled={!canEdit}
                                  className="h-4 w-4 rounded border border-white/20 bg-black/20"
                                />
                                {channel.toUpperCase()}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white">{t("alerts.contacts.title")}</div>
            <div className="text-xs text-zinc-400">{t("alerts.contacts.subtitle")}</div>
          </div>
        </div>

        {!canEdit && (
          <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-300">
            {t("alerts.contacts.readOnly")}
          </div>
        )}

        {contactsError && (
          <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {contactsError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
            {t("alerts.contacts.name")}
            <input
              value={newContact.name}
              onChange={(event) => setNewContact((prev) => ({ ...prev, name: event.target.value }))}
              disabled={!canEdit}
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
            {t("alerts.contacts.roleScope")}
            <select
              value={newContact.roleScope}
              onChange={(event) => setNewContact((prev) => ({ ...prev, roleScope: event.target.value }))}
              disabled={!canEdit}
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              <option value="CUSTOM">{t("alerts.contacts.role.custom")}</option>
              <option value="MEMBER">{t("alerts.contacts.role.member")}</option>
              <option value="ADMIN">{t("alerts.contacts.role.admin")}</option>
              <option value="OWNER">{t("alerts.contacts.role.owner")}</option>
            </select>
          </label>
          <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
            {t("alerts.contacts.email")}
            <input
              value={newContact.email}
              onChange={(event) => setNewContact((prev) => ({ ...prev, email: event.target.value }))}
              disabled={!canEdit}
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
            {t("alerts.contacts.phone")}
            <input
              value={newContact.phone}
              onChange={(event) => setNewContact((prev) => ({ ...prev, phone: event.target.value }))}
              disabled={!canEdit}
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400 md:col-span-2">
            {t("alerts.contacts.eventTypes")}
            <div className="mt-2 flex flex-wrap gap-3">
              {EVENT_TYPES.map((eventType) => (
                <label key={eventType.value} className="flex items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={newContact.eventTypes.includes(eventType.value)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...newContact.eventTypes, eventType.value]
                        : newContact.eventTypes.filter((value) => value !== eventType.value);
                      setNewContact((prev) => ({ ...prev, eventTypes: next }));
                    }}
                    disabled={!canEdit}
                    className="h-4 w-4 rounded border border-white/20 bg-black/20"
                  />
                  {t(eventType.labelKey)}
                </label>
              ))}
            </div>
            <div className="mt-2 text-xs text-zinc-500">{t("alerts.contacts.eventTypesHelper")}</div>
          </label>
        </div>

        {createError && (
          <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {createError}
          </div>
        )}

        <div className="mt-3">
          <button
            type="button"
            onClick={createContact}
            disabled={!canEdit || creatingContact}
            className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            {creatingContact ? t("alerts.contacts.creating") : t("alerts.contacts.add")}
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {contacts.length === 0 && (
            <div className="text-sm text-zinc-400">{t("alerts.contacts.empty")}</div>
          )}
          {contacts.map((contact) => {
            const draft = contactEdits[contact.id] ?? normalizeContactDraft(contact);
            const locked = !!contact.userId;
            return (
              <div key={contact.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="text-xs text-zinc-400">
                    {t("alerts.contacts.name")}
                    <input
                      value={draft.name}
                      onChange={(event) => updateContactDraft(contact.id, { name: event.target.value })}
                      disabled={!canEdit || locked}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white disabled:opacity-50"
                    />
                  </label>
                  <label className="text-xs text-zinc-400">
                    {t("alerts.contacts.roleScope")}
                    <select
                      value={draft.roleScope}
                      onChange={(event) => updateContactDraft(contact.id, { roleScope: event.target.value })}
                      disabled={!canEdit}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                    >
                      <option value="CUSTOM">{t("alerts.contacts.role.custom")}</option>
                      <option value="MEMBER">{t("alerts.contacts.role.member")}</option>
                      <option value="ADMIN">{t("alerts.contacts.role.admin")}</option>
                      <option value="OWNER">{t("alerts.contacts.role.owner")}</option>
                    </select>
                  </label>
                  <label className="text-xs text-zinc-400">
                    {t("alerts.contacts.email")}
                    <input
                      value={draft.email}
                      onChange={(event) => updateContactDraft(contact.id, { email: event.target.value })}
                      disabled={!canEdit || locked}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white disabled:opacity-50"
                    />
                  </label>
                  <label className="text-xs text-zinc-400">
                    {t("alerts.contacts.phone")}
                    <input
                      value={draft.phone}
                      onChange={(event) => updateContactDraft(contact.id, { phone: event.target.value })}
                      disabled={!canEdit || locked}
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white disabled:opacity-50"
                    />
                  </label>
                  <label className="text-xs text-zinc-400 md:col-span-2">
                    {t("alerts.contacts.eventTypes")}
                    <div className="mt-2 flex flex-wrap gap-3">
                      {EVENT_TYPES.map((eventType) => (
                        <label key={eventType.value} className="flex items-center gap-2 text-xs text-zinc-400">
                          <input
                            type="checkbox"
                            checked={draft.eventTypes.includes(eventType.value)}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...draft.eventTypes, eventType.value]
                                : draft.eventTypes.filter((value) => value !== eventType.value);
                              updateContactDraft(contact.id, { eventTypes: next });
                            }}
                            disabled={!canEdit}
                            className="h-4 w-4 rounded border border-white/20 bg-black/20"
                          />
                          {t(eventType.labelKey)}
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">{t("alerts.contacts.eventTypesHelper")}</div>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-400">
                    <input
                      type="checkbox"
                      checked={draft.isActive}
                      onChange={(event) => updateContactDraft(contact.id, { isActive: event.target.checked })}
                      disabled={!canEdit}
                      className="h-4 w-4 rounded border border-white/20 bg-black/20"
                    />
                    {t("alerts.contacts.active")}
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => saveContact(contact.id)}
                    disabled={!canEdit || savingContactId === contact.id}
                    className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-xs text-white disabled:opacity-40"
                  >
                    {savingContactId === contact.id ? t("alerts.contacts.saving") : t("alerts.contacts.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteContact(contact.id)}
                    disabled={!canEdit || deletingContactId === contact.id}
                    className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-200 disabled:opacity-40"
                  >
                    {deletingContactId === contact.id ? t("alerts.contacts.deleting") : t("alerts.contacts.delete")}
                  </button>
                  {locked && (
                    <span className="text-xs text-zinc-500">{t("alerts.contacts.linkedUser")}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
