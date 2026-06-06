export type RouteStub = {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly summary: string;
};

export const pptProxyRouteStubs = [
  { method: "GET", path: "/api/ppt-proxy/:port/*", summary: "Proxy a PPT preview session" }
] as const satisfies readonly RouteStub[];
