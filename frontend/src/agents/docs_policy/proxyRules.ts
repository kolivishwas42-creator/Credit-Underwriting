// The old server.js proxy rules, shared by vite.config.ts (dev + preview) and the tests.
// Only the document readiness API is forwarded, so this page can never reach any other backend route.

export const API_PREFIX = "/api/v1/credit/document-readiness/";
export const MAX_BODY = 64 * 1024;              // 64 KB: the requests are tiny
export const UPSTREAM_TIMEOUT_MS = 30000;      // the answer never waits for the AI

export interface Refusal { status: number; body: string }

const json = (error: string) => JSON.stringify({ detail: { error } });

/** true when an /api URL may be forwarded: the readiness prefix, and no dot-segment that could climb out of it */
export function isAllowedApiPath(url: string): boolean {
  if (!url.startsWith(API_PREFIX)) return false;
  const path = url.split("?")[0];
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  return !decoded.split(/[\\/]/).some((seg) => seg === ".." || seg === ".");
}

/** null: forward it; otherwise the answer to send without leaving (404 NOT_FOUND / 413 PAYLOAD_TOO_LARGE) */
export function refuse(url: string, contentLength?: string | number): Refusal | null {
  if (!isAllowedApiPath(url)) return { status: 404, body: json("NOT_FOUND") };
  if (Number(contentLength || 0) > MAX_BODY) return { status: 413, body: json("PAYLOAD_TOO_LARGE") };
  return null;
}

/** the 502 / 504 answer when the backend fails or is too slow */
export function upstreamFailure(timedOut: boolean): Refusal {
  return {
    status: timedOut ? 504 : 502,
    body: JSON.stringify({ detail: {
      error: timedOut ? "BACKEND_TIMEOUT" : "BACKEND_UNREACHABLE",
      message: timedOut ? "The LOS backend took too long to answer. Retry in a moment."
        : "The LOS backend is not reachable. Retry in a moment; if it persists, contact support.",
    } }),
  };
}
