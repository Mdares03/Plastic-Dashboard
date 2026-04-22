"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[App Error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6">
      <h2 className="text-lg font-semibold text-white">Something went wrong</h2>
      <p className="max-w-md text-center text-sm text-zinc-400">
        An error occurred while loading this page. Please try again.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
      >
        Try again
      </button>
    </div>
  );
}
