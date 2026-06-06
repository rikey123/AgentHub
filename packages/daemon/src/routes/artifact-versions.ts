export type RouteStub = {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly summary: string;
};

export const artifactVersionRouteStubs = [
  { method: "GET", path: "/artifacts/:id/versions", summary: "List artifact versions" },
  { method: "GET", path: "/artifacts/:id/versions/:version", summary: "Read an artifact version" },
  { method: "GET", path: "/artifacts/:id/versions/:from/diff/:to", summary: "Diff artifact versions" },
  { method: "POST", path: "/artifacts/:id/versions/:version/restore", summary: "Restore an artifact version" }
] as const satisfies readonly RouteStub[];
