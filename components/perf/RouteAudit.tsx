"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const PERF_ENABLED = process.env.NEXT_PUBLIC_PERF_LOGS === "1";
const STORAGE_KEY = "perf_nav_start";

type NavMark = {
  href?: string;
  from?: string;
  ts: number;
};

function readNavMark(): NavMark | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavMark;
    if (!parsed || typeof parsed.ts !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearNavMark() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function RouteAudit() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!PERF_ENABLED) return;

    const params = searchParams?.toString();
    const to = params ? `${pathname}?${params}` : pathname;
    const mark = readNavMark();
    if (!mark) return;

    const durationMs = Date.now() - mark.ts;
    const payload = {
      from: mark.from ?? "",
      to,
      href: mark.href ?? "",
      durationMs,
      startedAt: mark.ts,
    };

    console.info("[perf.nav]", payload);
    fetch("/api/debug/perf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "nav", data: payload }),
      keepalive: true,
    }).catch(() => {});

    clearNavMark();
  }, [pathname, searchParams]);

  return null;
}
