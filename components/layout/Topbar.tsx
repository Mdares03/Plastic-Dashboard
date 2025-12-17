"use client";

export function Topbar({ title }: { title: string }) {
  return (
    <div className="h-16 flex items-center justify-between px-4 border-b border-white/10 bg-black/20 backdrop-blur">
      <div className="text-lg font-semibold tracking-tight">{title}</div>
      <div className="text-xs text-zinc-400">
        Live • (mock for now)
      </div>
    </div>
  );
}
