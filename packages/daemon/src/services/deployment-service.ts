import type { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export type DeploymentKind = "preview-url" | "static-site" | "source-zip" | "container-export" | "container-build" | "self-hosted";
export type DeploymentStatus = "queued" | "in_progress" | "ready" | "failed" | "cancelled" | "expired" | "unpublished";

export type DeploymentRecord = {
  readonly id: string;
  readonly artifactId: string;
  readonly workspaceId: string;
  readonly kind: DeploymentKind;
  readonly status: DeploymentStatus;
};

export type CreateDeploymentInput = {
  readonly artifactId: string;
  readonly kind: DeploymentKind;
  readonly roomId?: string | undefined;
  readonly providerId?: string | undefined;
};

export type DeploymentService = {
  readonly createDeployment: (input: CreateDeploymentInput) => Promise<DeploymentRecord>;
  readonly redeploy: (deploymentId: string) => Promise<DeploymentRecord>;
  readonly retry: (deploymentId: string) => Promise<DeploymentRecord>;
  readonly cancel: (deploymentId: string) => Promise<DeploymentRecord>;
  readonly unpublish: (deploymentId: string) => Promise<DeploymentRecord>;
  readonly appendLog: (deploymentId: string, chunk: string) => Promise<void>;
  readonly listDeployments: (artifactId: string) => Promise<readonly DeploymentRecord[]>;
  readonly readLogs: (deploymentId: string) => Promise<string>;
};

export type DeploymentServiceOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly now?: () => number;
};

function notImplemented(method: string): never {
  throw new Error(`DeploymentService.${method} is not implemented in the V1.2 contract foundation`);
}

export function createDeploymentService(_options: DeploymentServiceOptions): DeploymentService {
  return {
    createDeployment: async () => notImplemented("createDeployment"),
    redeploy: async () => notImplemented("redeploy"),
    retry: async () => notImplemented("retry"),
    cancel: async () => notImplemented("cancel"),
    unpublish: async () => notImplemented("unpublish"),
    appendLog: async () => notImplemented("appendLog"),
    listDeployments: async () => notImplemented("listDeployments"),
    readLogs: async () => notImplemented("readLogs")
  };
}
