# Security

> Phase 5 (security hardening) of [OVERHAUL_PLAN.md](./OVERHAUL_PLAN.md).
> The pre-pilot risk inventory is preserved at `docs/archive/security_risks.md`.

## Resolved in this overhaul

| Issue | Where | Phase | Resolution |
|-------|-------|-------|------------|
| Leaked session cookie committed as `cookies.txt` | repo history | 0 | file removed + gitignored; session revoked (RUNBOOK) |
| Machine API keys in committed flow exports | `edge/`, history | 0 | rotation script ready (RUNBOOK) |
| Reminders route falls back to any session when secret unset | `app/api/downtime/actions/reminders/route.ts` | 4 | fail-closed: 503 when `DOWNTIME_ACTION_REMINDER_SECRET` unset; session fallback removed |
| GET `/api/org/members` leaks raw invite tokens to any member | `app/api/org/members/route.ts` | 5 | invites gated to OWNER/ADMIN; token replaced by `tokenPreview` (last 6 chars). Full token only ever in the POST create/resend response, to the manager who triggered it |
| No rate limiting (login, signup, pairing, ingest) | global | 5 | in-process fixed-window limiter (`lib/rateLimit.ts`) |
| 5-char pairing codes | pairing routes | 5 | codes now 8 chars (`PAIRING_CODE_LENGTH`); failed/invalid attempts logged; expiry enforced via `pairingCodeExpiresAt` (already present) |
| 30s session-revocation lag | `lib/auth/requireSession.ts` | 5 | cache TTL 30s→10s; `invalidateSessionCache()` called on logout for instant same-process revocation |

## Rate limiting

In-process fixed-window limiter, `lib/rateLimit.ts`. Named policies:

| Policy | Limit | Window | Key | Applied to |
|--------|-------|--------|-----|------------|
| `auth` | 10 | 60s | client IP | `POST /api/login`, `POST /api/signup`, `GET /api/verify-email` |
| `pair` | 5 | 60s | client IP | `POST /api/machines/pair` |
| `ingest` | 600 | 60s | machineId (post-auth) | `POST /api/ingest/{event,cycle,kpi,heartbeat,reason}` |

Over-limit requests get `429` with `Retry-After` and `X-RateLimit-*` headers.
Client IP is read from `x-forwarded-for` (first hop) then `x-real-ip`.

**Single-instance limitation (accepted).** Counters live in the Node process's
memory. With multiple instances behind a load balancer each keeps its own
window, so the effective limit is `limit × instanceCount`, and a restart resets
every window. This is acceptable for the current single-instance deployment.
Multi-instance scaling requires swapping the backing store for something shared
(e.g. Redis); only `lib/rateLimit.ts` changes — call sites use the small
`checkRateLimit(policy, identifier)` surface.

## Session revocation model

`requireSession` caches `{sessionId → {userId, orgId}}` for 10s to avoid a DB
hit per request. Trade-off: a revoked or deactivated session can remain valid
for up to the TTL within a given process.

- **Logout** revokes the `Session` row *and* calls `invalidateSessionCache(id)`,
  so revocation is immediate in the serving process; other processes converge
  within the 10s TTL.
- A session whose user becomes inactive or unverified is self-revoked (row +
  cache) the next time `requireSession` re-reads it from the DB.
- There is no member-deactivation endpoint today. When one is added it must call
  `invalidateSessionCache()` (no arg clears all) after flipping `isActive`.

## Accepted risks

- **Plaintext `api_key` on the Pi** (`current_config`). Mitigation: device is
  on-prem behind the plant network; key is rotatable per machine (RUNBOOK).
- **Rate-limit state is per-process** (see above). Acceptable single-instance.
- **Pairing returns the machine `apiKey`** on success — inherent to the pairing
  handshake; mitigated by 8-char codes, single-use (`pairingCodeUsedAt`), short
  expiry, and the `pair` rate limit.

_Run `/security-review` after Phase 5 edits; fold residual findings here._
