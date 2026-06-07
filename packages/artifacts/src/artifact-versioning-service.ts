import type { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export type ArtifactVersionEncoding = "text" | "binary";

export type ArtifactVersionRecord = {
  readonly id: string;
  readonly artifactId: string;
  readonly version: number;
  readonly contentEncoding: ArtifactVersionEncoding;
  readonly createdAt: number;
  readonly createdBy?: string | undefined;
  readonly message?: string | undefined;
};

export type CreateArtifactVersionInput = {
  readonly artifactId: string;
  readonly content?: string | undefined;
  readonly filePath?: string | undefined;
  readonly createdBy?: string | undefined;
  readonly message?: string | undefined;
};

export type ArtifactVersioningService = {
  readonly createVersion: (input: CreateArtifactVersionInput) => Promise<ArtifactVersionRecord>;
  readonly createBinaryVersion: (input: CreateArtifactVersionInput) => Promise<ArtifactVersionRecord>;
  readonly listVersions: (artifactId: string) => Promise<readonly ArtifactVersionRecord[]>;
  readonly restoreVersion: (artifactId: string, version: number) => Promise<ArtifactVersionRecord>;
  readonly diffVersions: (artifactId: string, fromVersion: number, toVersion: number) => Promise<string>;
};

export type ArtifactVersioningServiceOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly now?: () => number;
};

function notImplemented(method: string): never {
  throw new Error(`ArtifactVersioningService.${method} is not implemented in the V1.2 contract foundation`);
}

export function createArtifactVersioningService(options: ArtifactVersioningServiceOptions): ArtifactVersioningService {
  void options;
  return {
    createVersion: async () => notImplemented("createVersion"),
    createBinaryVersion: async () => notImplemented("createBinaryVersion"),
    listVersions: async () => notImplemented("listVersions"),
    restoreVersion: async () => notImplemented("restoreVersion"),
    diffVersions: async () => notImplemented("diffVersions")
  };
}
