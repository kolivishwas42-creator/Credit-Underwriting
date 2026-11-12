// The dev / preview proxy's route allow-list (src/proxyRules.ts, used by vite.config.ts) -- what still applies of the original test/server.test.js:
// only the page's own routes are proxied; any other /api path, a wrong method, or a reason id that is not a dedupe
// request id is refused (answered 404 ROUTE_NOT_PROXIED by the proxy, never forwarded to the backend).
import { allowed, ROUTES } from "../proxyRules";

describe("proxy allow-list", () => {
  it("every route the page uses is proxied", () => {
    for (const [method, url] of [
      ["GET", "/api/v1/fos/form-schema"],
      ["GET", "/api/v1/fos/config"],
      ["POST", "/api/v1/fos/applicants"],
      ["POST", "/api/v1/credit/dedupe"],
      ["POST", "/api/v1/credit/dedupe/all"],
      ["GET", "/api/v1/credit/dedupe/ddp_0123456789abcdef0123456789abcdef/reason"],
      ["POST", "/api/v1/auth/login"],
      ["POST", "/api/v1/auth/refresh"],
    ]) {
      expect(allowed(method, url), `${method} ${url}`).toBe(true);
    }
    expect(ROUTES.length).toBe(7);
  });

  it("only the page's routes are proxied; anything else is refused", () => {
    for (const [method, url] of [["GET", "/api/v1/credit/dedupe"], ["POST", "/api/v1/los/process"],
      ["GET", "/api/v1/fos/cases"], ["POST", "/api/v1/credit/dedupe/assess"], ["DELETE", "/api/v1/fos/applicants"],
      ["GET", "/api/v1/fos/applicants"], ["PUT", "/api/v1/credit/dedupe"], ["POST", "/api/v1/auth/logout"],
      ["GET", "/api/v1/auth/login"], ["POST", "/api/v1/credit/dedupe/"], ["POST", "/api/v1/credit/dedupe/all/x"],
      ["GET", "/api/v1/fos/form-schema/../../admin"], ["get", "/api/v1/fos/config"]]) {
      expect(allowed(method, url), `${method} ${url}`).toBe(false);
    }
  });

  it("the reason route: GET only, only a dedupe request id", () => {
    expect(allowed("GET", "/api/v1/credit/dedupe/ddp_0123456789abcdef0123456789abcdef/reason")).toBeTruthy();
    expect(!allowed("POST", "/api/v1/credit/dedupe/ddp_0123456789abcdef0123456789abcdef/reason")).toBeTruthy();
    expect(!allowed("GET", "/api/v1/credit/dedupe/../admin/reason")).toBeTruthy();
    expect(!allowed("GET", "/api/v1/credit/dedupe/ddp_x/reason")).toBeTruthy();
    // not ddp_ + exactly 32 lower-case hex digits
    expect(!allowed("GET", "/api/v1/credit/dedupe/ddp_0123456789ABCDEF0123456789ABCDEF/reason")).toBeTruthy();
    expect(!allowed("GET", "/api/v1/credit/dedupe/ddp_0123456789abcdef0123456789abcde/reason")).toBeTruthy();
    expect(!allowed("GET", "/api/v1/credit/dedupe/ddp_0123456789abcdef0123456789abcdef0/reason")).toBeTruthy();
    expect(!allowed("GET", "/api/v1/credit/dedupe/dda_0123456789abcdef0123456789abcdef/reason")).toBeTruthy();
    expect(!allowed("GET", "/api/v1/credit/dedupe/ddp_0123456789abcdef0123456789abcdef/reason/x")).toBeTruthy();
  });
});
