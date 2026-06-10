# Security

> Stub — hardening lands in Phase 5 of [OVERHAUL_PLAN.md](./OVERHAUL_PLAN.md).
> The pre-pilot risk inventory is preserved at `docs/archive/security_risks.md`.

## Known issues being addressed

| Issue | Where | Phase | Status |
|-------|-------|-------|--------|
| Leaked session cookie committed as `cookies.txt` | repo history | 0 | file removed; revocation script ready (see RUNBOOK) |
| Machine API keys in committed flow exports | `edge/`, history | 0 | rotation script ready (see RUNBOOK) |
| Reminders route falls back to any session when secret unset | `app/api/downtime/actions/reminders/route.ts` | 4 | open — will fail closed (503) |
| GET `/api/org/members` returns raw invite tokens to any member | `app/api/org/members/route.ts` | 5 | open |
| No rate limiting (login, signup, pairing, ingest) | global | 5 | open |
| 5-char pairing codes return apiKey | pairing routes | 5 | open — extend to 8 chars + expiry |
| 30s session-revocation lag (`requireSession` cache) | `lib/auth/requireSession.ts` | 5 | open — TTL 30s→10s + invalidation hook |

## Accepted risks

- Plaintext `api_key` stored on the Pi (`current_config`). Mitigation: device is
  on-prem behind the plant network; key is rotatable per machine.

_Full review (`/security-review`) runs at the end of Phase 5; residual findings land here._
