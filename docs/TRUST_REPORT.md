# Trust Report — MIS Control Tower (BEMIS)

> Client-facing. Spanish first, English below. Every claim links to evidence in the repo — this
> document *shows*, it does not *reassure*.

---

# 🇲🇽 Reporte de Confianza (Español)

## Resumen
El piloto tuvo un problema raíz: **la misma métrica se calculaba en varios lugares y nada obligaba a
que coincidieran.** Reconstruimos el sistema alrededor de una sola autoridad de métricas, limitamos y
auditamos cada alerta, y el sistema ahora **demuestra su propia exactitud** de forma continua.

## Qué salió mal (y cómo quedó resuelto)

| Problema en el piloto | Causa | Solución estructural |
|---|---|---|
| Las cifras no coincidían entre pantallas | Cada vista recalculaba a su manera; cuando dos fuentes diferían, el código elegía una en silencio (`max()`) | Una sola autoridad `lib/metrics/` (reglas R1–R8). Las vistas **importan** las métricas, nunca las recalculan. Las diferencias se **muestran**, nunca se ocultan. |
| El CEO recibió alertas por 3 días | Sin tope por incidente ni por hora; reintentos sin control | Alertas por `incidentKey` con cortacircuitos: máx. por contacto/hora y por organización/hora. El escenario de los 3 días es ahora una **prueba automática** que debe pasar siempre. |
| "Arreglado" no significaba nada | Arreglos descritos en documentos, nunca verificados en producción | "Arreglado" = código + prueba + verificado contra producción. 52 pruebas automáticas; exhibits antes/después en `docs/verification/`. |
| Datos sucios inflaban el downtime | Episodios sin cerrar, duplicados | Limpieza con respaldo y verificación (Fase 2): 2 episodios desbordados recortados a 12 h, 7 incidentes de molde resueltos. |
| Seguridad floja | Sin límites de tasa; tokens de invitación expuestos; códigos de 5 caracteres | Límites de tasa en login/ingest; tokens ya no se exponen; códigos de 8 caracteres; revocación de sesión casi inmediata. |

## Las garantías ahora

1. **Un solo número.** Cada cifra en cada pantalla viene de una regla numerada (R1–R8) implementada una
   sola vez. La página financiera, el recap y los reportes usan **el mismo** downtime — no pueden diferir.
2. **Las alertas no inundan.** Una alerta activa + una de resolución por incidente, con topes por hora.
3. **El sistema se auto-verifica.** La tarjeta "System health" en Ajustes corre chequeos de consistencia
   en vivo (deriva de contadores, downtime dentro de capacidad). Verde = las cifras cuadran.
4. **El borde se compara con el tablero.** El reporte de exactitud compara los contadores de la propia
   máquina contra lo que muestra el tablero, por orden de trabajo.

## La cifra que mediremos
- **Downtime no planificado (línea base, 30 días): 7,904 min ≈ 131.7 h** — la misma cifra del tablero.
- Meta: **reducción sostenida del 20%** (≈ 26 h/mes menos de paro). Detalle y conversión a pesos en
  [`ROI_MODEL.md`](./ROI_MODEL.md) (faltan las tarifas reales de costo — al cargarlas, todo se actualiza solo).

---

# 🇺🇸 Trust Report (English)

## Summary
The pilot's problems had one root cause: **the same metric was computed in several places, and nothing
enforced agreement.** We rebuilt the system around a single metrics authority, capped and audited every
alert, and the system now **proves its own accuracy** continuously.

## What went wrong (and how it's structurally fixed)

| Pilot problem | Root cause | Structural fix |
|---|---|---|
| Numbers disagreed between screens | Each view recomputed its own way; on conflict the code silently picked one (`max()`) | One `lib/metrics/` authority (rules R1–R8). Views **import** metrics, never recompute. Disagreements are **surfaced**, never hidden. |
| CEO got 3 days of alert emails | No per-incident or hourly cap; uncontrolled retries | `incidentKey`-keyed alerts + circuit breakers (per-contact/hour, per-org/hour). The 3-day scenario is now an **automated test** that must always pass. |
| "Fixed" meant nothing | Fixes written in docs, never verified in prod | "Fixed" = code + test + verified against prod. 52 automated tests; before/after exhibits in `docs/verification/`. |
| Dirty data inflated downtime | Unclosed / duplicate episodes | Backed-up, verified cleanup (Phase 2): 2 runaway episodes clamped to 12h, 7 stuck mold incidents resolved. |
| Loose security | No rate limits; invite tokens exposed; 5-char codes | Rate limits on login/ingest; tokens no longer exposed; 8-char codes; near-instant session revocation. |

## The guarantees now
1. **One number.** Every figure traces to a numbered rule (R1–R8) implemented once. Financial, recap and
   reports use the **same** downtime — they cannot diverge.
2. **Alerts don't flood.** One active + one resolved notification per incident, hourly-capped.
3. **The system self-verifies.** The "System health" card in Settings runs live consistency checks
   (counter drift, downtime-within-capacity). Green = the numbers reconcile.
4. **Edge vs dashboard.** The accuracy report compares the machine's own counters to what the dashboard
   shows, per work order.

## The number we'll measure
- **Unplanned downtime (baseline, 30 days): 7,904 min ≈ 131.7 h** — the same number the dashboard shows.
- Target: **sustained 20% reduction** (≈ 26 h/month less stoppage). Math + peso conversion in
  [`ROI_MODEL.md`](./ROI_MODEL.md) (real cost rates still to be entered — once set, everything updates itself).

---

## Evidence index
- Metrics authority & rules: [`METRICS_SPEC.md`](./METRICS_SPEC.md) (R1–R8)
- Why it happened: [`POSTMORTEM.md`](./POSTMORTEM.md)
- Security posture: [`SECURITY.md`](./SECURITY.md)
- Metric migration before/after: `docs/verification/phase3-*.md`
- Financial congruence (#13): `docs/verification/phase7-13-financial-rebase.md` (Δ = 0)
- Edge-vs-dashboard accuracy: `docs/verification/ACCURACY_REPORT_*.md` + [`ACCURACY_REPORT_TEMPLATE.md`](./verification/ACCURACY_REPORT_TEMPLATE.md)
- ROI model: [`ROI_MODEL.md`](./ROI_MODEL.md)
- Go-live gate: [`verification/GO_LIVE_CHECKLIST.md`](./verification/GO_LIVE_CHECKLIST.md)
- Honesty note: the pilot's known risks were documented before rollout and shipped anyway. The fix is a
  **gate**, not another document — see the go-live checklist.
