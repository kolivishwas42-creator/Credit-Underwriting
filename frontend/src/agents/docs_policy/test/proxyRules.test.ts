import { describe, expect, it } from "vitest";
import { isAllowedApiPath, MAX_BODY, refuse, upstreamFailure } from "../proxyRules";

describe("proxy allow-list (server.js rules)", () => {
  it("forwards only the document readiness routes", () => {
    expect(isAllowedApiPath("/api/v1/credit/document-readiness/CASE-1/rules")).toBe(true);
    expect(isAllowedApiPath("/api/v1/credit/document-readiness/CASE-1")).toBe(true);
    expect(isAllowedApiPath("/api/v1/credit/document-readiness/CASE-1/rules?x=1")).toBe(true);
    expect(isAllowedApiPath("/api/v1/other")).toBe(false);
    expect(isAllowedApiPath("/api/v1/credit/document-readiness")).toBe(false);
    expect(isAllowedApiPath("/api/v1/credit/legal-verification/config")).toBe(false);
  });

  it("refuses a path that climbs out of the prefix", () => {
    expect(isAllowedApiPath("/api/v1/credit/document-readiness/../../eligibility/cases")).toBe(false);
    expect(isAllowedApiPath("/api/v1/credit/document-readiness/%2e%2e/%2e%2e/eligibility/cases")).toBe(false);
    expect(isAllowedApiPath("/api/v1/credit/document-readiness/%E0%A4%A")).toBe(false);
  });

  it("answers 404 NOT_FOUND and 413 PAYLOAD_TOO_LARGE without leaving", () => {
    expect(refuse("/api/v1/other")).toEqual({ status: 404, body: JSON.stringify({ detail: { error: "NOT_FOUND" } }) });
    expect(refuse("/api/v1/credit/document-readiness/CASE-1/rules", String(MAX_BODY + 1))?.status).toBe(413);
    expect(refuse("/api/v1/credit/document-readiness/CASE-1/rules", "0")).toBeNull();
  });

  it("names a timeout 504 and anything else 502", () => {
    expect(upstreamFailure(true).status).toBe(504);
    expect(JSON.parse(upstreamFailure(false).body).detail.error).toBe("BACKEND_UNREACHABLE");
  });
});
