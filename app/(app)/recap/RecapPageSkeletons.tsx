/**
 * Shared markup for loading states (used by `loading.tsx` and explicit `<Suspense>` in pages)
 * so the recap UI always shows the same skeleton while server data is pending.
 */
export function RecapGridPageSkeleton() {
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

export function RecapDetailPageSkeleton() {
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
