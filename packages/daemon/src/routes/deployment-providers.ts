export type RouteStub = {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly summary: string;
};

export const deploymentProviderRouteStubs = [
  { method: "GET", path: "/deployment-providers", summary: "List deployment providers" },
  { method: "POST", path: "/deployment-providers", summary: "Create a deployment provider" },
  { method: "PATCH", path: "/deployment-providers/:id", summary: "Update a deployment provider" },
  { method: "DELETE", path: "/deployment-providers/:id", summary: "Delete a deployment provider" },
  { method: "POST", path: "/deployment-providers/:id/test", summary: "Test a deployment provider connection" }
] as const satisfies readonly RouteStub[];
