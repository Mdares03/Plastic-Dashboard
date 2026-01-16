"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ct_token");
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const token = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const hasToken = Boolean(token);

  useEffect(() => {
    if (!hasToken) {
      router.replace("/login");
    }
  }, [router, pathname, hasToken]);

  if (!hasToken) {
    return (
      <div className="min-h-screen bg-black text-zinc-200 flex items-center justify-center">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}
