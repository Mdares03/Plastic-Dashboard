export default function MachinesLoading() {
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-pulse">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="h-6 w-36 rounded-lg bg-white/10" />
          <div className="h-4 w-60 rounded-lg bg-white/5" />
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <div className="h-9 w-full rounded-xl border border-emerald-400/40 bg-emerald-500/10 sm:w-36" />
          <div className="h-9 w-full rounded-xl border border-white/10 bg-white/5 sm:w-32" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="h-40 rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>
    </div>
  );
}
