export default function LoadingRecapGrid() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 h-24 animate-pulse rounded-2xl border border-white/10 bg-black/40" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-[220px] animate-pulse rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>
    </div>
  );
}
