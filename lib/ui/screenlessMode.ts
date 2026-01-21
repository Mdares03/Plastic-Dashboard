"use client";

import { useEffect, useState } from "react";

let current: boolean | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<(next: boolean) => void>();

function notify(next: boolean) {
  current = next;
  listeners.forEach((fn) => fn(next));
}

async function loadScreenlessMode() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        const mode = data?.settings?.modules?.screenlessMode === true;
        notify(mode);
      }
    } catch {
      // ignore fetch failures; keep current state
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useScreenlessMode() {
  const [screenlessMode, setScreenlessMode] = useState(current ?? false);

  useEffect(() => {
    listeners.add(setScreenlessMode);
    return () => {
      listeners.delete(setScreenlessMode);
    };
  }, []);

  useEffect(() => {
    void loadScreenlessMode();
  }, []);

  function set(next: boolean) {
    notify(next);
  }

  return { screenlessMode, setScreenlessMode: set };
}
