import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowViewModel } from "../../types.ts";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    children,
    nodes,
    edges
  }: {
    readonly children?: React.ReactNode;
    readonly nodes: Array<{ readonly data?: { readonly label?: string; readonly status?: string; readonly kind?: string } }>;
    readonly edges: Array<{ readonly animated?: boolean; readonly className?: string; readonly data?: { readonly status?: string } }>;
  }) => createElement("div", {
    "data-testid": "react-flow",
    "data-node-count": String(nodes.length),
    "data-edge-count": String(edges.length),
    "data-node-labels": nodes.map((node) => node.data?.label).join("|"),
    "data-node-statuses": nodes.map((node) => node.data?.status).join("|"),
    "data-node-kinds": nodes.map((node) => node.data?.kind).join("|"),
    "data-edge-statuses": edges.map((edge) => edge.data?.status).join("|"),
    "data-edge-animated": edges.map((edge) => String(edge.animated ?? false)).join("|"),
    "data-edge-classes": edges.map((edge) => edge.className ?? "").join("|")
  }, children),
  Background: () => createElement("div", { "data-testid": "workflow-background" }),
  Controls: () => createElement("div", { "data-testid": "workflow-controls" }),
  Handle: () => createElement("span", { "data-testid": "workflow-handle" }),
  MiniMap: () => createElement("div", { "data-testid": "workflow-minimap" }),
  Position: { Left: "left", Right: "right" },
  addEdge: vi.fn((edge, edges) => [...edges, edge]),
  applyEdgeChanges: vi.fn((_, edges) => edges),
  applyNodeChanges: vi.fn((_, nodes) => nodes)
}));

import { WorkflowCanvasView } from "./WorkflowCanvasView.tsx";

describe("WorkflowCanvasView", () => {
  it("renders the canvas toolbar and inspector from a local draft", () => {
    const html = renderToStaticMarkup(createElement(WorkflowCanvasView, { workflows: [] }));

    expect(html).toContain("Workflow Canvas");
    expect(html).toContain("Add node");
    expect(html).toContain("Add note");
    expect(html).toContain("Save draft");
    expect(html).toContain("Start");
    expect(html).toContain("Stop");
    expect(html).toContain("A input text");
    expect(html).toContain("B final output text");
    expect(html).toContain("Input text");
    expect(html).toContain("Final node output");
    expect(html).toContain("Prompt");
    expect(html).toContain("Kernel");
    expect(html).toContain("No kernel selected");
    expect(html).toContain("Run history");
    expect(html).toContain('data-testid="react-flow"');
    expect(html).toContain('data-node-count="2"');
    expect(html).toContain('data-edge-count="0"');
    expect(html).toContain('data-node-labels="A|B"');
    expect(html).toContain('data-node-kinds="agent_context|agent_context"');
    expect(html).toContain('data-edge-restore="deferred"');
    expect(html).not.toContain("hello world</text>");
  });

  it("renders projected run state on nodes while saved edges wait for handle restoration", () => {
    const workflow: WorkflowViewModel = {
      id: "workflow-1",
      workspaceId: "default-workspace",
      name: "Projected handoff",
      draftVersionId: "version-1",
      createdAt: 1,
      updatedAt: 3,
      versions: [],
      nodes: [
        {
          id: "row-node-a",
          workflowVersionId: "version-1",
          nodeId: "node-a",
          kind: "agent_context",
          displayName: "Planner",
          prompt: "Plan the handoff",
          position: { x: 0, y: 0 },
          enabled: true,
          locked: false,
          config: { runtimeId: "native-default" },
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: "row-node-b",
          workflowVersionId: "version-1",
          nodeId: "node-b",
          kind: "agent_context",
          displayName: "Reviewer",
          prompt: "Review the handoff",
          position: { x: 280, y: 0 },
          enabled: true,
          locked: false,
          config: {},
          createdAt: 1,
          updatedAt: 1
        }
      ],
      edges: [
        {
          id: "row-edge-ab",
          workflowVersionId: "version-1",
          edgeId: "edge-a-b",
          sourceNodeId: "node-a",
          targetNodeId: "node-b",
          enabled: true,
          config: {},
          createdAt: 1,
          updatedAt: 1
        }
      ],
      runs: [
        {
          id: "run-1",
          workflowId: "workflow-1",
          workflowVersionId: "version-1",
          workspaceId: "default-workspace",
          status: "running",
          seedContext: "Investigate auth flow",
          createdAt: 2,
          updatedAt: 4,
          nodeRuns: [
            {
              id: "node-run-a",
              workflowRunId: "run-1",
              workflowNodeId: "row-node-a",
              nodeId: "node-a",
              agentRunId: "agent-run-1",
              status: "running",
              inputContexts: [],
              createdAt: 2,
              updatedAt: 4
            }
          ],
          edgeDeliveries: [
            {
              id: "delivery-a-b",
              workflowRunId: "run-1",
              workflowEdgeId: "row-edge-ab",
              edgeId: "edge-a-b",
              sourceNodeId: "node-a",
              targetNodeId: "node-b",
              status: "delivered",
              context: { text: "hello world", fromNodeId: "node-a", toNodeId: "node-b" },
              mailboxMessageId: "mailbox-1",
              attemptCount: 1,
              createdAt: 3,
              updatedAt: 3
            }
          ]
        }
      ]
    };
    const html = renderToStaticMarkup(createElement(WorkflowCanvasView, {
      workflows: [workflow]
    }));

    expect(html).toContain("Projected handoff");
    expect(html).toContain("native-default");
    expect(html).toContain('data-node-count="2"');
    expect(html).toContain('data-node-statuses="running|ready"');
    expect(html).toContain('data-edge-count="0"');
    expect(html).toContain("running");
    expect(html).toContain("1 node run, 1 edge delivery");
    expect(html).toContain("agent-run-1");
    expect(html).toContain("hello world");
    expect(html).toContain("Node runs");
    expect(html).toContain("Deliveries");
    expect(html).toContain("B final output text");
  });
});
