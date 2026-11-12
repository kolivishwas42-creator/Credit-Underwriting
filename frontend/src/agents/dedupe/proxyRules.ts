// The routes the dev / preview proxy forwards (vite.config.ts): only the routes this page uses (the old server.js
// allow-list); anything else under /api answers 404 ROUTE_NOT_PROXIED and never leaves. Kept here, not in
// vite.config.ts, so the tests can import it without loading Vite / esbuild into jsdom.
export const ROUTES: [string, RegExp][] = [
  ["GET", /^\/api\/v1\/fos\/form-schema$/],
  ["GET", /^\/api\/v1\/fos\/config$/],
  ["POST", /^\/api\/v1\/fos\/applicants$/],
  ["POST", /^\/api\/v1\/credit\/dedupe$/],
  ["POST", /^\/api\/v1\/credit\/dedupe\/all$/],
  ["GET", /^\/api\/v1\/credit\/dedupe\/ddp_[0-9a-f]{32}\/reason$/],
  ["POST", /^\/api\/v1\/auth\/(login|refresh)$/],
];
export const allowed = (method: string, pathname: string) => ROUTES.some(([m, re]) => m === method && re.test(pathname));
