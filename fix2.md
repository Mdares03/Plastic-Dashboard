Traced. Here's the truth for each filter.

Range logic (lib/recap/redesign.ts line 458-490)
Filter	Window computed	What it shows
24h	now - 24h → now	Rolling last 24h. Mold change at right edge = started ~9:46pm today
Turno actual	Current-shift window from orgShift table	Needs configured shifts; else falls back to 24h
Ayer	now-48h → now-24h (rolling!)	NOT "yesterday 00:00-23:59" — it's "24-48h ago". Label is misleading
Personalizado	User-picked	Explicit
What's actually wrong
1. "Paros totales 3,102,444 min" and "144,409 min" are stale data. Those are huge because old duplicate ReasonEntry rows (from before the is_update/is_auto_ack filter was deployed) are still in DB. The filter stops NEW duplicates but doesn't delete old ones.

Fix:

TRUNCATE TABLE "ReasonEntry";
Or targeted:

DELETE FROM "ReasonEntry" WHERE "capturedAt" < '<date-when-filter-deployed>';
After that, numbers will be realistic.

2. "Ayer" window is wrong. Current code is rolling 48-24h ago, not calendar yesterday. Fix in resolveDetailRange:

if (mode === "yesterday") {
  // use local timezone calendar day, not rolling 24h
  const tz = orgSettings.timezone ?? "America/Mexico_City";
  const today0 = zonedToUtcDate({ ...localDayStart(now, tz), hours: 0, minutes: 0, timeZone: tz });
  const yesterday0 = new Date(today0.getTime() - 24 * 60 * 60 * 1000);
  return { mode, start: yesterday0, end: today0 };
}
3. "Sin señal hace 376 min" is real. Pi stopped sending heartbeats 6h ago. Simultaneously "Cambio de molde en curso" is stuck active because Pi went offline DURING the mold change — no resolved event ever arrived. Both facts are true. Banner logic is correct, UX could be improved:

If offlineMin > moldChangeAgeMin, show only the offline banner (more severe). Or combined: "Sin señal hace 376m — último estado: cambio de molde".

4. Different OEE across filters is expected (different windows, different math). Labels should make it obvious: OEE PROMEDIO 24h, OEE DEL TURNO, OEE AYER. Currently they all say "OEE PROMEDIO 24H" regardless of filter → confusing. Check RecapKpiRow.tsx — the label should come from the range mode, not be hardcoded.

5. Shift mode falls through to 24h if no shifts configured. That's why the numbers are slightly different — it actually ran with a real shift. Verify: SELECT * FROM "OrgShift" WHERE "orgId" = '<id>';. If empty, shifts aren't set; the filter is silently showing 24h and labeling it "Turno actual" → more confusion.

Priority order
Truncate ReasonEntry (kills 99% of the insanity).
Fix "Ayer" to be calendar-based.
Fix KPI row label to reflect selected range.
If no OrgShift rows exist, show a toast or disable "Turno actual" button instead of silently falling back.
Improve dual-banner priority (offline > mold-change).