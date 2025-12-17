"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("ct_token");
    if (!token) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router, pathname]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#070A0C] text-zinc-200 flex items-center justify-center">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}
