export default function LoadingRecapDetail() {
  return (
    <div className="p-4 sm:p-6">
      <div className="h-16 animate-pulse rounded-2xl border border-white/10 bg-black/40" />
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-2xl border border-white/10 bg-black/30" />
        ))}
      </div>
      <div className="mt-4 h-48 animate-pulse rounded-2xl border border-white/10 bg-black/30" />
    </div>
  );
}
