import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { EVENT_PAYLOAD_SCHEMAS, EVENT_REGISTRY, checkProtocolSchemas } from "../src/events/index.ts";

const workflowEventTypes = [
  "workflow.created",
  "workflow.version.updated",
  "workflow.deleted",
  "workflow.run.started",
  "workflow.run.completed",
  "workflow.run.failed",
  "workflow.run.cancelled",
  "workflow.node.queued",
  "workflow.node.started",
  "workflow.node.completed",
  "workflow.node.failed",
  "workflow.node.skipped",
  "workflow.node.cancelled",
  "workflow.edge.delivery.created",
  "workflow.edge.delivery.mailbox_created",
  "workflow.edge.delivery.delivered",
  "workflow.edge.delivery.cancelled",
  "workflow.edge.delivery.failed"
] as const;

const workflow = {
  id: "workflow_01",
  workspaceId: "workspace_01",
  roomId: "room_01",
  name: "Review pipeline",
  description: "Move context between agents",
  draftVersionId: "workflow_version_01",
  createdBy: "user_01",
  createdAt: 1,
  updatedAt: 1
};

const version = {
  id: "workflow_version_01",
  workflowId: "workflow_01",
  versionNumber: 1,
  state: "draft" as const,
  valid: true,
  validationErrors: [],
  viewport: {},
  createdAt: 1,
  updatedAt: 1
};

const node = {
  id: "workflow_node_row_01",
  workflowVersionId: "workflow_version_01",
  nodeId: "node-a",
  kind: "agent_context" as const,
  displayName: "Planner",
  agentBindingId: "binding_01",
  roleLabel: "Planner",
  prompt: "Plan the work",
  position: { x: 100, y: 120 },
  enabled: true,
  locked: false,
  config: {},
  createdAt: 1,
  updatedAt: 1
};

const edge = {
  id: "workflow_edge_row_01",
  workflowVersionId: "workflow_version_01",
  edgeId: "edge-a-b",
  sourceNodeId: "node-a",
  targetNodeId: "node-b",
  label: "handoff",
  enabled: true,
  config: {},
  createdAt: 1,
  updatedAt: 1
};

const validation = {
  runnable: true,
  issues: [],
  upstreamByNodeId: {},
  downstreamByNodeId: { "node-a": ["node-b"] }
};

const run = {
  id: "workflow_run_01",
  workflowId: "workflow_01",
  workflowVersionId: "workflow_version_01",
  workspaceId: "workspace_01",
  roomId: "room_01",
  status: "running" as const,
  seedContext: "Investigate auth flow",
  startedBy: "user_01",
  startedAt: 1,
  createdAt: 1,
  updatedAt: 1
};

const nodeRun = {
  id: "workflow_node_run_01",
  workflowRunId: "workflow_run_01",
  workflowNodeId: "workflow_node_row_01",
  nodeId: "node-a",
  agentRunId: "run_01",
  agentBindingId: "binding_01",
  status: "queued" as const,
  inputContexts: [],
  createdAt: 1,
  updatedAt: 1
};

const delivery = {
  id: "workflow_delivery_01",
  workflowRunId: "workflow_run_01",
  workflowEdgeId: "workflow_edge_row_01",
  edgeId: "edge-a-b",
  sourceNodeId: "node-a",
  targetNodeId: "node-b",
  sourceNodeRunId: "workflow_node_run_01",
  mailboxMessageId: "mailbox_01",
  status: "mailbox_created" as const,
  context: {},
  idempotencyKey: "workflow_run_01:edge-a-b:1",
  attemptCount: 1,
  createdAt: 1,
  updatedAt: 1
};

describe("schema registry checks", () => {
  it("validates canonical registry consistency", () => {
    const result = checkProtocolSchemas();

    expect(result.ok).toBe(true);
    expect(result.checkedEventTypes).toBe(EVENT_REGISTRY.length);
    expect(EVENT_REGISTRY.length).toBeGreaterThan(0);
  });

  it("registers workflow events as durable canvas-visible events", () => {
    for (const type of workflowEventTypes) {
      const entry = EVENT_REGISTRY.find((candidate) => candidate.type === type);

      expect(entry, type).toBeDefined();
      expect(entry?.category, type).toBe("workflow");
      expect(entry?.durability, type).toBe("durable");
      expect(entry?.visibility, type).toBe("both");
      expect(entry?.schemaVersion, type).toBe(1);
    }
  });

  it("keeps workflow event payload schemas registered with the event literals", () => {
    const payloadSchemaTypes = Object.keys(EVENT_PAYLOAD_SCHEMAS).filter((type) => type.startsWith("workflow."));

    expect(payloadSchemaTypes.sort()).toEqual([...workflowEventTypes].sort());
  });

  it("decodes representative workflow payloads", () => {
    Schema.decodeUnknownSync(EVENT_PAYLOAD_SCHEMAS["workflow.created"])({
      workflow,
      version,
      nodes: [node],
      edges: [edge],
      validation
    });
    Schema.decodeUnknownSync(EVENT_PAYLOAD_SCHEMAS["workflow.version.updated"])({
      workflowId: workflow.id,
      version,
      nodes: [node],
      edges: [edge],
      validation
    });
    Schema.decodeUnknownSync(EVENT_PAYLOAD_SCHEMAS["workflow.run.started"])({ workflowId: workflow.id, run });
    Schema.decodeUnknownSync(EVENT_PAYLOAD_SCHEMAS["workflow.node.queued"])({
      workflowId: workflow.id,
      workflowRunId: run.id,
      nodeRun
    });
    Schema.decodeUnknownSync(EVENT_PAYLOAD_SCHEMAS["workflow.node.cancelled"])({
      workflowId: workflow.id,
      workflowRunId: run.id,
      nodeRun: { ...nodeRun, status: "cancelled" }
    });
    Schema.decodeUnknownSync(EVENT_PAYLOAD_SCHEMAS["workflow.edge.delivery.mailbox_created"])({
      workflowId: workflow.id,
      workflowRunId: run.id,
      delivery
    });
    Schema.decodeUnknownSync(EVENT_PAYLOAD_SCHEMAS["workflow.edge.delivery.cancelled"])({
      workflowId: workflow.id,
      workflowRunId: run.id,
      delivery: { ...delivery, status: "cancelled" }
    });
  });
});
