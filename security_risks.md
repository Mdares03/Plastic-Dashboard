# Security Risks Review (mis-control-tower)

This review focuses on the risks highlighted in the tweet you shared: backend-first architecture, trusting the client, column/role escalation, and missing rate limits.

Good news: this project is backend-first and uses Prisma on the server, not direct-to-DB from the client. Prisma itself is not the core risk here. The main issues are around authorization scope, secret handling, and rate limiting.

## Critical: Cross-org reminder trigger + weak auth fallback

### What can go wrong
Any logged-in user can trigger the reminders job if the secret is not set, and the job queries across all orgs. This can spam email reminders to users in other orgs.

### Source
- Auth fallback to "any session" when secret missing: `app/api/downtime/actions/reminders/route.ts:40`
- Cross-org query (no `orgId` filter): `app/api/downtime/actions/reminders/route.ts:62`

### Why this maps to the tweet
This is a classic "missing backend guardrails" and "rate limits/abuse" problem.

### Fix ideas
- Require `DOWNTIME_ACTION_REMINDER_SECRET` in all environments (fail closed if missing).
- If you want session-based access, also require:
  - role check (OWNER/ADMIN), and
  - explicit `orgId` scoping in the `findMany` query.
- Consider also logging who triggered it.

---

## High: Invite token exposure + invite claim risk

### What can go wrong
A regular member can retrieve active invite tokens and then accept invites intended for other people.

### Source
- Members GET has no role check: `app/api/org/members/route.ts:23`
- Members GET returns raw invite tokens: `app/api/org/members/route.ts:52`
- Accepting an invite creates a user for the invite email and marks it verified based only on the token: `app/api/invites/[token]/route.ts:93`, `app/api/invites/[token]/route.ts:98`

### Why this maps to the tweet
This is a "hidden columns / privilege escalation" flavor of bug: sensitive fields (tokens) are being exposed to users who should not see them.

### Fix ideas
- Add a role check to `GET /api/org/members` (OWNER/ADMIN only).
- Do not return invite tokens from the API (or only return to OWNER/ADMIN).
- Optional hardening:
  - Bind invites more tightly to identity (e.g., require proof of email ownership), or
  - require the invite acceptance flow to complete a verification step before granting access.

---

## Medium: Pairing code brute force path to machine API keys

### What can go wrong
Pairing codes are short and the pairing endpoint returns the machine API key. Without rate limiting, attackers can attempt many codes and occasionally succeed.

### Source
- Pairing codes length = 5: `lib/pairingCode.ts:5`
- Pair endpoint returns `apiKey`: `app/api/machines/pair/route.ts:56`

### Why this maps to the tweet
This aligns with "rate limits are not optional anymore" and "don’t trust defaults."

### Fix ideas
- Add rate limiting to `/api/machines/pair` (by IP and/or code prefix).
- Increase pairing code entropy (length and/or attempt tracking).
- Track failed attempts and temporarily disable pairing for a machine after too many failures.

---

## Medium: Missing rate limiting on high-abuse endpoints

### What can go wrong
Attackers can brute-force or abuse endpoints to consume resources and/or trigger unwanted actions.

### Source (representative endpoints)
- Login: `app/api/login/route.ts:20`
- Signup: `app/api/signup/route.ts:26`
- Pairing: `app/api/machines/pair/route.ts:12`
- Ingest: `app/api/ingest/kpi/route.ts:35`, `app/api/ingest/heartbeat/route.ts:33`, `app/api/ingest/event/route.ts:60`, `app/api/ingest/reason/route.ts:11`

### Why this maps to the tweet
This is directly item #10 in the tweet: rate limits at auth, API routes, and webhooks/ingest.

### Fix ideas
- Apply rate limiting to:
  - auth endpoints (`/api/login`, `/api/signup`, invite acceptance),
  - pairing (`/api/machines/pair`),
  - ingest endpoints (especially if publicly reachable).
- Even a simple KV-based limiter or middleware-based limiter is a large improvement.

---

## Not the core risk: Prisma usage

### Observation
This project uses Prisma server-side via Next.js route handlers and server components. I did not see direct DB calls from the browser.

### Source (representative)
- Session enforcement in API routes: `lib/auth/requireSession.ts:42`
- Server-side data access in routes: `app/api/machines/route.ts:31`, `app/api/settings/route.ts:146`

### Why this matters
This avoids the tweet’s main direct-to-DB + RLS pitfalls, but you still need strong authorization and rate limiting in your own backend.

---

## Quick fix priority order

1. Lock down `POST /api/downtime/actions/reminders` (fail closed + org scoping).
2. Lock down `GET /api/org/members` and stop exposing invite tokens.
3. Add rate limiting to pairing and auth endpoints.
4. Consider increasing pairing code entropy + attempt tracking.

If you want, I can implement the first two fixes in small, safe patches.
