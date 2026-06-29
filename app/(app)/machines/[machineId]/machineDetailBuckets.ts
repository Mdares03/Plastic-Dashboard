/**
 * Cycle-bucket palette + tolerance for the machine detail view. Kept in its own
 * recharts-free module so both the page (chips/labels) and the code-split chart
 * module can import BUCKET without pulling Recharts into the page's initial
 * bundle (a static import from MachineDetailCharts would do exactly that).
 */
export const TOL = 0.1;

export const BUCKET = {
  normal: {
    labelKey: "machine.detail.bucket.normal",
    dot: "#12D18E",
    glow: "rgba(18,209,142,.35)",
    chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
  },
  slow: {
    labelKey: "machine.detail.bucket.slow",
    dot: "#F7B500",
    glow: "rgba(247,181,0,.35)",
    chip: "bg-yellow-500/15 text-yellow-300 border-yellow-500/20",
  },
  microstop: {
    labelKey: "machine.detail.bucket.microstop",
    dot: "#FF7A00",
    glow: "rgba(255,122,0,.35)",
    chip: "bg-orange-500/15 text-orange-300 border-orange-500/20",
  },
  macrostop: {
    labelKey: "machine.detail.bucket.macrostop",
    dot: "#FF3B5C",
    glow: "rgba(255,59,92,.35)",
    chip: "bg-rose-500/15 text-rose-300 border-rose-500/20",
  },
  unknown: {
    labelKey: "machine.detail.bucket.unknown",
    dot: "#A1A1AA",
    glow: "rgba(161,161,170,.25)",
    chip: "bg-white/10 text-zinc-200 border-white/10",
  },
} as const;
