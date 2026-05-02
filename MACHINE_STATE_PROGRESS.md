# Machine State Progress

## Final State Model (5 states + sub-reasons)

| State | Color | Trigger |
|---|---|---|
| OFFLINE | dark gray | Heartbeat dead >2 min |
| STOPPED | red, pulse >5min | Active WO + no cycles (regardless of tracking) |
| - reason `machine_fault` | | Tracking on, macrostop event active |
| - reason `not_started` | | Tracking off, has WO |
| DATA_LOSS | red + icon, pulse | Tracking off + cycles arriving (>5 cycles or >10 min) |
| MOLD_CHANGE | blue | Active mold-change event |
| - sub at >3h | yellow accent | (Round 2) |
| - sub at >5h | red accent | (Round 2) |
| IDLE | calm gray | No tracking, no WO, no cycles |
| RUNNING | green | Tracking + WO + recent cycles |

## Round 1 — Foundation: classifier + IDLE + STOPPED collapse + DATA_LOSS
- [x] Step 1: Add `"idle"` and `"data-loss"` to `RecapMachineStatus` union
- [x] Step 2: Create `lib/recap/machineState.ts` shared classifier with all reasons
- [x] Step 3: Refactor `statusFromMachine` in redesign.ts to call classifier
- [x] Step 4: Plumb new fields (status reason, ongoing min) through types/responses
- [x] Step 5: UI rendering: IDLE (calm gray) on /recap, /machines, detail
- [x] Step 6: UI rendering: DATA_LOSS (red + icon) on all surfaces
- [x] Step 7: STOPPED reason text: show `not_started` vs `machine_fault` distinction
- [x] Step 8: i18n keys (en + es-MX)
- [x] Step 9: End-to-end verify each state transitions correctly

## Round 2 — Mold change duration escalation (CT-only)
- [ ] MOLD_CHANGE >3h yellow accent
- [ ] MOLD_CHANGE >5h red accent
- [ ] i18n strings

## Notes / parked items
- Prisma drift on (orgId,machineId,seq) unique indexes — pre-existing, not related to this work. Address as separate housekeeping task.
- Node-RED incidentKey rotation behavior verified: 10 distinct keys per real stoppage = correct.
