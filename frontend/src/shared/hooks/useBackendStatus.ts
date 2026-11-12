import { useEffect, useState } from "react";

export type BackendStatus = "checking" | "online" | "offline";

const EVERY_MS = 30000;

/** Is the LOS service answering? Polls GET /health (same origin, proxied like /api) every 30 s. */
export function useBackendStatus(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>("checking");
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/health", { cache: "no-store" });
        if (alive) setStatus(res.ok ? "online" : "offline");
      } catch {
        if (alive) setStatus("offline");
      }
    };
    void check();
    const timer = window.setInterval(check, EVERY_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  return status;
}
