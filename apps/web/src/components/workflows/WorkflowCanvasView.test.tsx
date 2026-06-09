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

import { WorkflowCanvasView, workflowDraftPayload } from "./WorkflowCanvasView.tsx";

describe("WorkflowCanvasView", () => {
  it("renders the canvas toolbar and inspector from a local draft", () => {
    const html = renderToStaticMarkup(createElement(WorkflowCanvasView, { workflows: [] }));

    expect(html).toContain("工作流画布");
    expect(html).toContain("添加节点");
    expect(html).toContain("添加备注");
    expect(html).toContain("导入角色节点");
    expect(html).toContain("保存草稿");
    expect(html).toContain("启动");
    expect(html).toContain("停止");
    expect(html).toContain("A 输入内容");
    expect(html).toContain("B 最终输出");
    expect(html).toContain("输入要交给第一个节点的内容");
    expect(html).toContain("最后一个节点的输出会显示在这里");
    expect(html).toContain("提示词");
    expect(html).toContain("运行内核");
    expect(html).toContain("未选择运行内核");
    expect(html).toContain("运行历史");
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
    expect(html).toContain("运行中");
    expect(html).toContain("1 个节点运行，1 次边投递");
    expect(html).toContain("agent-run-1");
    expect(html).toContain("hello world");
    expect(html).toContain("节点运行");
    expect(html).toContain("边投递");
    expect(html).toContain("B 最终输出");
  });

  it("keeps an imported role binding when building the draft payload", () => {
    const workflow: WorkflowViewModel = {
      id: "workflow-1",
      workspaceId: "default-workspace",
      name: "角色工作流",
      draftVersionId: "version-1",
      createdAt: 1,
      updatedAt: 1,
      versions: [],
      nodes: [],
      edges: [],
      runs: []
    };
    const payload = workflowDraftPayload(workflow, [
      {
        id: "node-imported",
        position: { x: 10, y: 20 },
        width: 260,
        height: 150,
        data: {
          label: "规划助手",
          roleLabel: "规划师",
          prompt: "请根据上游上下文规划下一步。",
          runtimeId: "runtime-1",
          agentBindingId: "binding-1",
          roleId: "role-1",
          modelConfigId: "model-1",
          upstreamCount: 0,
          downstreamCount: 0,
          enabled: true,
          locked: false,
          kind: "agent_context",
          config: { runtimeId: "runtime-1", agentBindingId: "binding-1", roleId: "role-1", modelConfigId: "model-1" }
        }
      } as never
    ], []);

    expect(payload.nodes[0]).toMatchObject({
      nodeId: "node-imported",
      displayName: "规划助手",
      roleLabel: "规划师",
      agentBindingId: "binding-1",
      config: {
        agentBindingId: "binding-1",
        roleId: "role-1",
        runtimeId: "runtime-1",
        modelConfigId: "model-1"
      }
    });
  });
});
