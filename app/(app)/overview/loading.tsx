export default function OverviewLoading() {
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-pulse">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="h-6 w-40 rounded-lg bg-white/10" />
          <div className="h-4 w-64 rounded-lg bg-white/5" />
        </div>
        <div className="h-9 w-40 rounded-xl border border-white/10 bg-white/5" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="h-36 rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="h-24 rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="h-64 rounded-2xl border border-white/10 bg-white/5 xl:col-span-1" />
        <div className="h-64 rounded-2xl border border-white/10 bg-white/5 xl:col-span-2" />
      </div>
    </div>
  );
}
