export default function ReportsLoading() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="h-8 w-56 rounded-lg bg-white/5" />
      <div className="grid gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="h-24 rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="h-80 rounded-2xl border border-white/10 bg-white/5" />
        <div className="h-80 rounded-2xl border border-white/10 bg-white/5" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="h-24 rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>
    </div>
  );
}
