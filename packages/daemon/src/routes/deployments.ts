export type RouteStub = {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly summary: string;
};

export const deploymentsRouteStubs = [
  { method: "GET", path: "/deployments", summary: "List deployments for an artifact" },
  { method: "POST", path: "/deployments", summary: "Create a deployment from an artifact" },
  { method: "POST", path: "/deployments/:id/redeploy", summary: "Redeploy a deployment" },
  { method: "POST", path: "/deployments/:id/retry", summary: "Retry a failed deployment" },
  { method: "POST", path: "/deployments/:id/cancel", summary: "Cancel a deployment" },
  { method: "POST", path: "/deployments/:id/unpublish", summary: "Unpublish a deployment" },
  { method: "GET", path: "/deployments/:id/logs", summary: "Read deployment logs" }
] as const satisfies readonly RouteStub[];
