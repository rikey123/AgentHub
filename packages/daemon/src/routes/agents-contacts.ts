export type RouteStub = {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly summary: string;
};

export const agentContactRouteStubs = [
  { method: "GET", path: "/agents/contacts", summary: "List agent contacts" },
  { method: "POST", path: "/agents/custom", summary: "Create a custom agent" },
  { method: "PATCH", path: "/agents/custom/:id", summary: "Update a custom agent" }
] as const satisfies readonly RouteStub[];
