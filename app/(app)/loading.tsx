export default function AppLoading() {
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-pulse">
      <div className="h-7 w-48 rounded-lg bg-white/10" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="h-28 rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>
      <div className="h-80 rounded-2xl border border-white/10 bg-white/5" />
    </div>
  );
}
