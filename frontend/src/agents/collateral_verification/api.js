// The agent's API base: the service mounts it at /api/v1/credit/collateral-verification (VITE_API_BASE overrides).
export const API_BASE = import.meta.env.VITE_API_BASE || "/api/v1/credit/collateral-verification";

export const api = (path) => `${API_BASE}${path}`;
