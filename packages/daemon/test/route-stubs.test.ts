import { describe, expect, it } from "vitest";

import { deploymentsRouteStubs } from "../src/routes/deployments.ts";
import { rewritePptProxyLocation } from "../src/routes/ppt-proxy.ts";

describe("V1.2 daemon route stub contracts", () => {
  it("exposes the OpenSpec deployment REST surface", () => {
    expect(deploymentsRouteStubs.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /deployments",
      "POST /deployments",
      "GET /deployments/:id",
      "GET /deployments/:id/download",
      "POST /deployments/:id/redeploy",
      "POST /deployments/:id/retry",
      "POST /deployments/:id/cancel",
      "POST /deployments/:id/unpublish",
      "GET /deployments/:id/logs"
    ]);
  });

  it("rewrites PPT proxy Location headers back under the guarded proxy base", () => {
    expect(rewritePptProxyLocation("http://localhost:61234/assets/app.js", 61234)).toBe("/api/ppt-proxy/61234/assets/app.js");
    expect(rewritePptProxyLocation("/viewer", 61234)).toBe("/api/ppt-proxy/61234/viewer");
  });
});
