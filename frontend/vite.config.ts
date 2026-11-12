/// <reference types="vitest" />
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { AGENTS } from "./src/config/agents";

// ONE app for every agent. The page calls same-origin /api/...; in development each agent's base route is proxied
// to the LOS service (LOS_API, default http://127.0.0.1:8010) or to its own override (<agent>.proxyEnv, e.g. ELG_API).
// Cookies are stripped (the backend uses bearer tokens); a slow backend answers 504, an unreachable one 502.
const UPSTREAM_TIMEOUT_MS = 45000;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const fallback = env.LOS_API || "http://127.0.0.1:8010";
  const send = (res: ServerResponse, status: number, code: string, message: string) => {
    if (res.headersSent || res.writableEnded) return;
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ error: { code, message, details: {} } }));
  };
  const route = (target: string): ProxyOptions => ({
    target,
    changeOrigin: true,
    timeout: UPSTREAM_TIMEOUT_MS,
    proxyTimeout: UPSTREAM_TIMEOUT_MS,
    configure(proxy) {
      proxy.on("proxyReq", (proxyReq, req) => {
        proxyReq.removeHeader("cookie");
        proxyReq.on("timeout", () => { (req as IncomingMessage & { timedOut?: boolean }).timedOut = true; });
      });
      proxy.on("proxyRes", (proxyRes) => { proxyRes.headers["cache-control"] = "no-store"; });
      proxy.on("error", (_err, req, res) => {
        if (!res || !("writeHead" in res)) return;
        const late = Boolean((req as IncomingMessage & { timedOut?: boolean }).timedOut);
        if (late) send(res as ServerResponse, 504, "UPSTREAM_TIMEOUT", "The LOS backend took too long to answer.");
        else send(res as ServerResponse, 502, "BACKEND_UNREACHABLE", "The LOS backend is not reachable.");
      });
    },
  });
  const proxy: Record<string, ProxyOptions> = {};
  for (const a of AGENTS) proxy[a.apiBase] = route(env[a.proxyEnv] || fallback);
  // the FULL LOS server's routes the dedupe screen also uses: the "New application" form (/fos) and sign-in (/auth).
  // FOS_API points them at the full LOS (e.g. http://127.0.0.1:8010) when the agents run on a separate service.
  const fos = env.FOS_API || fallback;
  proxy["/api/v1/fos"] = route(fos);
  proxy["/api/v1/auth"] = route(fos);
  proxy["/api"] = route(fallback);                       // anything else -> the LOS service
  proxy["/health"] = route(fallback);                    // the sidebar's backend status

  return {
    plugins: [react()],
    server: { port: 5190, strictPort: true, proxy },
    preview: { port: 5190, strictPort: true, proxy },
    build: { outDir: "dist", chunkSizeWarningLimit: 900 },
  };
});
