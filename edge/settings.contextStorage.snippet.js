/**
 * Phase 6 (P6.3) — Node-RED context persistence.
 *
 * Merge this `contextStorage` block into the Pi's Node-RED settings.js (usually
 * ~/.node-red/settings.js). It adds a persistent "file" store while keeping the
 * default store in memory (fast). The flow routes ONLY the state-bearing keys
 * (anomalyState, anomaly, zeroStreak) to "file" so a reboot mid-stoppage resumes
 * the same episode instead of losing it.
 *
 * DEPLOY ORDER (important): add this to settings.js and RESTART Node-RED FIRST,
 * then import the updated edge/flows.json. If the flow loads before the "file"
 * store exists, get/set with store "file" errors.
 *
 * The localfilesystem store batches writes (default flush ~30s) so the SD card
 * isn't hit on every cycle. Persisted context lives under ~/.node-red/context/.
 */
module.exports = {
  // … your existing settings …

  contextStorage: {
    default: { module: "memory" },
    file: { module: "localfilesystem" },
  },

  // … rest of your existing settings …
};
