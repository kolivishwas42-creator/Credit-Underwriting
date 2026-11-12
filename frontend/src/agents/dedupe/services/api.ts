// The page's API calls. Same origin (the Vite dev / preview proxy, or the deploying server, forwards /api to the LOS
// backend). The bearer token, when the backend asks for sign-in, lives only in sessionStorage ("los-copilot-token")
// and is gone when the tab closes. Nothing sensitive is logged.
import { withoutDevNames } from "../../../shared/lib/people";
import * as C from "../core";
import type { SampleConfig, UiText } from "../types";

export const TOKEN_KEY = "los-copilot-token";

export function token(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

/** Set by the page: opens the sign-in dialog and resolves true once signed in (false on Cancel). */
let signInHandler: (() => Promise<boolean>) | null = null;
export function onSignIn(handler: (() => Promise<boolean>) | null) { signInHandler = handler; }

type RequestOptions = NonNullable<Parameters<typeof C.request>[1]>;

/** C.request with the held token; a 401 opens the sign-in dialog once and retries. */
export async function api(path: string, options: RequestOptions = {}) {
  try {
    return await C.request(path, { token: token(), ...options });
  } catch (err) {
    if ((err as { status?: number }).status === 401 && signInHandler) {
      const ok = await signInHandler();
      if (ok) return C.request(path, { token: token(), ...options });
    }
    throw err;
  }
}

/** POST /api/v1/auth/login: keeps the token for this tab. */
export async function login(username: string, password: string) {
  const { data } = await C.request("/api/v1/auth/login", { method: "POST", timeoutMs: 15000, body: { username, password } });
  try { sessionStorage.setItem(TOKEN_KEY, (data as { access_token: string }).access_token); } catch { /* memory only */ }
}

/** Officer-facing words and the sample pools: optional files served next to the page and read at runtime (edited
 * without a rebuild, as before). A missing file is never an error: the page falls back to the backend's words / no
 * Fill sample button. Relative URLs, so the build works under any base path. */
async function optionalJson<T>(name: string): Promise<T | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}dedupe/${name}`, { cache: "no-store" });
    if (res.ok) return withoutDevNames((await res.json()) as T);
  } catch { /* not available */ }
  return null;
}
export const loadUiText = () => optionalJson<UiText>("ui_text.json");
export const loadSampleConfig = () => optionalJson<SampleConfig>("sample_config.json");

/** The last case opened in this browser (a per-viewer convenience; may be unavailable). */
export function rememberCase(caseId: string) {
  try { localStorage.setItem("los-copilot-last-case", caseId); } catch { /* storage unavailable */ }
}
export function lastCase(): string {
  try { return localStorage.getItem("los-copilot-last-case") || ""; } catch { return ""; }
}
