import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ArtifactCardPayloadSchema,
  DeploymentCardPayloadSchema,
  MessageCreatePayloadSchema,
  RoomViewModelSchema
} from "../src/domains.ts";
import { EVENT_PAYLOAD_SCHEMAS, EVENT_REGISTRY } from "../src/events/index.ts";

const V12_EVENT_EXPECTATIONS = [
  { type: "artifact.version.created", category: "artifact", durability: "durable", visibility: "both" },
  { type: "deployment.created", category: "deployment", durability: "durable", visibility: "main" },
  { type: "deployment.status.changed", category: "deployment", durability: "durable", visibility: "main" },
  { type: "deployment.log.appended", category: "deployment", durability: "ephemeral", visibility: "main" },
  { type: "deployment.ready", category: "deployment", durability: "durable", visibility: "main" },
  { type: "deployment.failed", category: "deployment", durability: "durable", visibility: "main" },
  { type: "deployment.cancelled", category: "deployment", durability: "durable", visibility: "main" },
  { type: "deployment.expired", category: "deployment", durability: "durable", visibility: "main" },
  { type: "deployment.unpublished", category: "deployment", durability: "durable", visibility: "main" },
  { type: "deployment.provider.created", category: "deployment", durability: "durable", visibility: "detail" },
  { type: "deployment.provider.updated", category: "deployment", durability: "durable", visibility: "detail" },
  { type: "deployment.provider.deleted", category: "deployment", durability: "durable", visibility: "detail" },
  { type: "room.pinned", category: "room", durability: "durable", visibility: "both" },
  { type: "room.unpinned", category: "room", durability: "durable", visibility: "both" },
  { type: "message.pinned", category: "message", durability: "durable", visibility: "both" },
  { type: "message.unpinned", category: "message", durability: "durable", visibility: "both" },
  { type: "agent.contact.updated", category: "agent", durability: "durable", visibility: "both" },
  { type: "task.unblocked", category: "task", durability: "durable", visibility: "both" },
  { type: "wake_outbox.dispatched", category: "orchestrator", durability: "durable", visibility: "detail" }
] as const;

describe("V1.2 contract registry", () => {
  it("includes deployment and artifact version events", () => {
    const eventTypes = new Set(EVENT_REGISTRY.map((entry) => entry.type));

    for (const { type } of V12_EVENT_EXPECTATIONS) {
      expect(eventTypes.has(type)).toBe(true);
    }
  });

  it("registers the expected V1.2 event shape", () => {
    for (const { type, category, durability, visibility } of V12_EVENT_EXPECTATIONS) {
      const entry = EVENT_REGISTRY.find((candidate) => candidate.type === type);

      expect(entry?.category).toBe(category);
      expect(entry?.durability).toBe(durability);
      expect(entry?.visibility).toBe(visibility);
    }
  });

  it("registers payload schemas for the V1.2 additions", () => {
    for (const { type } of V12_EVENT_EXPECTATIONS) {
      expect(type in EVENT_PAYLOAD_SCHEMAS).toBe(true);
    }
  });

  it("uses the OpenSpec payload shapes for V1.2 events", () => {
    const validPayloads: Record<(typeof V12_EVENT_EXPECTATIONS)[number]["type"], Record<string, unknown>> = {
      "artifact.version.created": {
        artifactId: "artifact-1",
        version: 2,
        createdBy: "agent-1",
        message: "updated copy"
      },
      "deployment.created": {
        deploymentId: "deployment-1",
        artifactId: "artifact-1",
        kind: "preview-url",
        provider: "agenthub-local",
        status: "queued"
      },
      "deployment.status.changed": {
        deploymentId: "deployment-1",
        status: "ready",
        url: "http://127.0.0.1:4173/preview/token",
        downloadUrl: "/deployments/deployment-1/download",
        imageTag: "agenthub/demo:latest"
      },
      "deployment.log.appended": {
        deploymentId: "deployment-1",
        line: "Detecting providers..."
      },
      "deployment.ready": {
        deploymentId: "deployment-1",
        url: "http://127.0.0.1:4173/preview/token",
        downloadUrl: "/deployments/deployment-1/download",
        imageTag: "agenthub/demo:latest"
      },
      "deployment.failed": {
        deploymentId: "deployment-1",
        error: "build failed"
      },
      "deployment.cancelled": {
        deploymentId: "deployment-1"
      },
      "deployment.expired": {
        deploymentId: "deployment-1"
      },
      "deployment.unpublished": {
        deploymentId: "deployment-1"
      },
      "deployment.provider.created": {
        providerId: "provider-1",
        kind: "caprover",
        name: "Captain",
        baseUrl: "https://captain.example",
        hasCredential: true
      },
      "deployment.provider.updated": {
        providerId: "provider-1",
        kind: "caprover",
        name: "Captain 2",
        baseUrl: "https://captain.example",
        hasCredential: true
      },
      "deployment.provider.deleted": {
        providerId: "provider-1",
        kind: "caprover"
      },
      "room.pinned": {
        roomId: "room-1",
        pinnedAt: 1_764_000_000_000
      },
      "room.unpinned": {
        roomId: "room-1"
      },
      "message.pinned": {
        roomId: "room-1",
        messageId: "message-1",
        pinnedAt: 1_764_000_000_000
      },
      "message.unpinned": {
        roomId: "room-1",
        messageId: "message-1"
      },
      "agent.contact.updated": {
        agentBindingId: "binding-1",
        displayName: "Builder",
        avatarUrl: "agenthub://avatar/builder",
        description: "Frontend builder",
        disabledAt: 1_764_000_000_000
      },
      "task.unblocked": {
        taskId: "task-1",
        roomId: "room-1",
        unlockedBy: "task-0"
      },
      "wake_outbox.dispatched": {
        outboxId: "outbox-1",
        runId: "run-1"
      }
    };

    for (const { type } of V12_EVENT_EXPECTATIONS) {
      const schema = EVENT_PAYLOAD_SCHEMAS[type] as Schema.Schema<unknown>;
      Schema.decodeUnknownSync(schema)(validPayloads[type]);
    }
  });
});

describe("V1.2 shared domain contracts", () => {
  it("defines artifact and deployment card payloads for message.part.added", () => {
    Schema.decodeUnknownSync(ArtifactCardPayloadSchema)({
      type: "artifact",
      artifactId: "artifact-1",
      kind: "web_page",
      title: "Landing page",
      version: 1
    });

    Schema.decodeUnknownSync(DeploymentCardPayloadSchema)({
      type: "deployment",
      deploymentId: "deployment-1",
      artifactId: "artifact-1",
      kind: "preview-url",
      provider: "agenthub-local",
      status: "queued"
    });
  });

  it("defines message.create payloads and normalized RoomViewModel fields", () => {
    const decodedMessage = Schema.decodeUnknownSync(MessageCreatePayloadSchema)({
      messageId: "message-1",
      role: "assistant",
      senderId: "agent-1",
      senderType: "agent",
      text: "Created a deployment card",
      mentions: [{ agentBindingId: "agent-binding-1" }],
      refs: [
        { type: "artifact", artifactId: "artifact-1", lineStart: 12, lineEnd: 30 },
        { type: "artifact", artifactId: "deck-1", slide: 3 },
        { type: "workspace", path: "src/auth.ts", lineStart: 5, lineEnd: 20 }
      ],
      parts: [
        {
          type: "card",
          seq: 1,
          card: {
            type: "deployment",
            deploymentId: "deployment-1",
            artifactId: "artifact-1",
            kind: "preview-url",
            provider: "agenthub-local",
            status: "queued"
          }
        }
      ]
    }) as { readonly mentions?: readonly { readonly agentBindingId: string }[]; readonly refs?: readonly unknown[] };

    expect(decodedMessage.mentions).toEqual([{ agentBindingId: "agent-binding-1" }]);
    expect(decodedMessage.refs).toEqual([
      { type: "artifact", artifactId: "artifact-1", lineStart: 12, lineEnd: 30 },
      { type: "artifact", artifactId: "deck-1", slide: 3 },
      { type: "workspace", path: "src/auth.ts", lineStart: 5, lineEnd: 20 }
    ]);

    Schema.decodeUnknownSync(RoomViewModelSchema)({
      id: "room-1",
      title: "Room",
      mode: "assisted",
      participants: [],
      participantContactNames: {},
      messages: [],
      briefs: [],
      unresolvedInterventions: [],
      pendingPermissions: [],
      contextItems: [],
      tasks: [],
      runs: [],
      pendingTurns: [],
      mailboxFailures: [],
      artifactVersionsById: {},
      deploymentsById: {},
      deploymentLogsById: {},
      unreadCount: 0
    });
  });
});
