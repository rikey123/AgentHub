import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chip, ListBox, Modal } from "@heroui/react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { initials } from "../../lib/format.ts";
import { runtimeDisplayName, runtimeInstanceLabel } from "../../lib/runtimeDisplay.ts";
import { normalizeAgentContacts } from "../rail/RailViews.tsx";
import { IdentityAvatar } from "../IdentityAvatar.tsx";
import { normalizeRuntimeList, type RuntimeConfig } from "../settings/RuntimesTab.tsx";
import type {
  AgentContactViewModel,
  WorkflowEdgeDeliveryViewModel,
  WorkflowEdgeViewModel,
  WorkflowNodeRunViewModel,
  WorkflowNodeViewModel,
  WorkflowRunViewModel,
  WorkflowViewModel
} from "../../types.ts";

type WorkflowCanvasViewProps = {
  readonly workflows: readonly WorkflowViewModel[];
  readonly csrfFetch?: typeof fetch | undefined;
};

type AgentWorkflowNodeData = {
  readonly label: string;
  readonly roleLabel?: string | undefined;
  readonly prompt: string;
  readonly agentBindingId?: string | undefined;
  readonly roleId?: string | undefined;
  readonly modelConfigId?: string | undefined;
  readonly bindingLabel?: string | undefined;
  readonly modelLabel?: string | undefined;
  readonly contactStatus?: AgentContactViewModel["status"] | undefined;
  readonly runtimeId?: string | undefined;
  readonly runtimeLabel?: string | undefined;
  readonly runtimeKind?: string | undefined;
  readonly status?: string | undefined;
  readonly upstreamCount: number;
  readonly downstreamCount: number;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly kind: "agent_context" | "note";
  readonly config: Record<string, unknown>;
};

type DirtyAgentWorkflowNodeData = Pick<AgentWorkflowNodeData, "agentBindingId" | "bindingLabel" | "config" | "contactStatus" | "modelConfigId" | "modelLabel" | "prompt" | "roleId" | "runtimeId">;

type CanvasSelection =
  | { readonly type: "node"; readonly id: string }
  | { readonly type: "edge"; readonly id: string };

type WorkflowRuntimeOption = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly description: string;
  readonly status?: string | undefined;
};

const nodeTypes = {
  agentContext: AgentWorkflowNode
};

const DEFAULT_AGENT_PROMPT = "接收上游上下文，补充必要分析，然后把简明结果传递给下游节点。";
const DEFAULT_NOTE_PROMPT = "记录这个工作流片段代表的上下文交接说明。";
const IMPORTED_AGENT_PROMPT = "根据上游上下文完成该角色职责，并把结果传递给下游节点。";

export function WorkflowCanvasView({ workflows, csrfFetch = fetch }: WorkflowCanvasViewProps) {
  const projectedWorkflow = workflows.find((workflow) => workflow.deletedAt === undefined);
  const seed = useMemo(() => projectedWorkflow ?? createLocalWorkflow(), [projectedWorkflow]);
  const activeRun = useMemo(() => latestWorkflowRun(seed), [seed]);
  const [nodes, setNodes] = useState<Array<Node<AgentWorkflowNodeData>>>(() => workflowNodesToReactFlow(seed.nodes, seed.edges, activeRun));
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selection, setSelection] = useState<CanvasSelection | undefined>(() => ({ type: "node", id: seed.nodes[0]?.nodeId ?? "node-intake" }));
  const [seedContext, setSeedContext] = useState("");
  const [serviceNotice, setServiceNotice] = useState<string | undefined>();
  const [savingDraft, setSavingDraft] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [stoppingRun, setStoppingRun] = useState(false);
  const [runtimeOptions, setRuntimeOptions] = useState<WorkflowRuntimeOption[]>([]);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | undefined>();
  const [contactOptions, setContactOptions] = useState<AgentContactViewModel[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | undefined>();
  const [importPickerOpen, setImportPickerOpen] = useState(false);
  const [edgeRestoreToken, setEdgeRestoreToken] = useState(0);
  const [visualRunId, setVisualRunId] = useState<string | undefined>();
  const pendingEdgesRef = useRef<Edge[]>(workflowEdgesToReactFlow(seed.edges, activeRun));
  const dirtyNodeDataRef = useRef(new Map<string, DirtyAgentWorkflowNodeData>());
  const nextLocalIdRef = useRef(seed.nodes.length + 1);
  const runtimeById = useMemo(() => new Map(runtimeOptions.map((runtime) => [runtime.id, runtime])), [runtimeOptions]);
  const contactByBindingId = useMemo(() => new Map(contactOptions.map((contact) => [contact.agentBindingId, contact])), [contactOptions]);

  useEffect(() => {
    const nextRun = latestWorkflowRun(seed);
    reconcileDirtyNodeData(seed.nodes, dirtyNodeDataRef.current);
    const visualRun = visualWorkflowRun(seed, visualRunId);
    const nextNodes = hydrateContactNodeData(
      mergeDirtyNodeData(workflowNodesToReactFlow(seed.nodes, seed.edges, nextRun), dirtyNodeDataRef.current),
      contactByBindingId
    );
    const nextEdges = workflowEdgesToReactFlow(seed.edges, visualRun);
    pendingEdgesRef.current = nextEdges;
    nextLocalIdRef.current = nextNodes.length + 1;
    setNodes(nextNodes);
    setEdges([]);
    setSelection((current) => {
      if (current?.type === "node" && nextNodes.some((node) => node.id === current.id)) return current;
      if (current?.type === "edge" && nextEdges.some((edge) => edge.id === current.id)) return current;
      return nextNodes[0] ? { type: "node", id: nextNodes[0].id } : undefined;
    });
    setEdgeRestoreToken((value) => value + 1);
  }, [contactByBindingId, seed, visualRunId]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setRuntimeLoading(true);
    setRuntimeError(undefined);

    void csrfFetch("/runtimes", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`运行内核加载失败：${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!cancelled) setRuntimeOptions(normalizeRuntimeList(payload).map(runtimeOptionFromRuntime));
      })
      .catch((error) => {
        if (cancelled || isAbortError(error)) return;
        setRuntimeError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setRuntimeLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [csrfFetch]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setContactsLoading(true);
    setContactsError(undefined);

    void csrfFetch("/agents/contacts", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`角色联系人加载失败：${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!cancelled) setContactOptions(normalizeAgentContacts(payload));
      })
      .catch((error) => {
        if (cancelled || isAbortError(error)) return;
        setContactsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [csrfFetch]);

  useEffect(() => {
    const restore = () => setEdges(pendingEdgesRef.current);
    if (typeof requestAnimationFrame !== "function") {
      const timeout = setTimeout(restore, 0);
      return () => clearTimeout(timeout);
    }
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [edgeRestoreToken]);

  const neighborIndex = useMemo(() => buildNeighborIndex(edges), [edges]);
  const enrichedNodes = useMemo(
    () => hydrateContactNodeData(nodes, contactByBindingId).map((node) => ({
      ...node,
      data: {
        ...node.data,
        runtimeLabel: node.data.bindingLabel ?? (node.data.runtimeId ? runtimeLabel(node.data.runtimeId, runtimeById.get(node.data.runtimeId)) : undefined),
        runtimeKind: node.data.runtimeId ? runtimeById.get(node.data.runtimeId)?.kind ?? node.data.runtimeKind : node.data.runtimeKind,
        upstreamCount: neighborIndex.upstream[node.id]?.length ?? 0,
        downstreamCount: neighborIndex.downstream[node.id]?.length ?? 0
      }
    })),
    [contactByBindingId, neighborIndex, nodes, runtimeById]
  );
  const selectedNode = selection?.type === "node" ? enrichedNodes.find((node) => node.id === selection.id) : undefined;
  const selectedEdge = selection?.type === "edge" ? edges.find((edge) => edge.id === selection.id) : undefined;
  const finalOutput = useMemo(() => finalWorkflowOutput(activeRun, seed.nodes, seed.edges), [activeRun, seed.edges, seed.nodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current) as Array<Node<AgentWorkflowNodeData>>);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (sourceNode?.data.kind === "note" || targetNode?.data.kind === "note") return;
    const edgeId = `edge-${connection.source}-${connection.target}`;
    setEdges((current) => {
      if (current.some((edge) => edge.source === connection.source && edge.target === connection.target)) return current;
      return addEdge({
        ...connection,
        id: edgeId,
        type: "smoothstep",
        markerEnd: { type: "arrowclosed" },
        className: "ah-workflow-edge ah-workflow-edge-draft",
        data: { status: "draft" }
      }, current);
    });
    setSelection({ type: "edge", id: edgeId });
  }, [nodes]);

  const addAgentNode = useCallback(() => {
    const index = nextLocalIdRef.current++;
    const id = `node-local-${index}`;
    setNodes((current) => [
      ...current,
      {
        id,
        type: "agentContext",
        position: { x: 140 + index * 42, y: 120 + index * 34 },
        data: {
          label: `Agent ${index}`,
          roleLabel: "上下文 Agent",
          prompt: DEFAULT_AGENT_PROMPT,
          status: "draft",
          upstreamCount: 0,
          downstreamCount: 0,
          enabled: true,
          locked: false,
          kind: "agent_context",
          runtimeId: "native-default",
          config: { runtimeId: "native-default" }
        }
      }
    ]);
    setSelection({ type: "node", id });
  }, []);

  const importContactNode = useCallback((contact: AgentContactViewModel) => {
    const index = nextLocalIdRef.current++;
    const id = `node-contact-${contact.agentBindingId}-${index}`;
    const data = agentNodeDataFromContact(contact, {
      status: "draft",
      upstreamCount: 0,
      downstreamCount: 0,
      enabled: true,
      locked: false,
      kind: "agent_context"
    });
    setNodes((current) => [
      ...current,
      {
        id,
        type: "agentContext",
        position: { x: 160 + index * 40, y: 120 + index * 32 },
        data
      }
    ]);
    dirtyNodeDataRef.current.set(id, dirtyNodeData(data));
    setSelection({ type: "node", id });
    setImportPickerOpen(false);
  }, []);

  const addNote = useCallback(() => {
    const index = nextLocalIdRef.current++;
    const id = `note-local-${index}`;
    setNodes((current) => [
      ...current,
      {
        id,
        type: "agentContext",
        position: { x: 220 + index * 30, y: 40 + index * 24 },
        data: {
          label: `Note ${index}`,
          roleLabel: "画布备注",
          prompt: DEFAULT_NOTE_PROMPT,
          status: "note",
          upstreamCount: 0,
          downstreamCount: 0,
          enabled: true,
          locked: false,
          kind: "note",
          config: {}
        }
      }
    ]);
    setSelection({ type: "node", id });
  }, []);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.type === "node") {
      setNodes((current) => current.filter((node) => node.id !== selection.id));
      setEdges((current) => current.filter((edge) => edge.source !== selection.id && edge.target !== selection.id));
    } else {
      setEdges((current) => current.filter((edge) => edge.id !== selection.id));
    }
    setSelection(undefined);
  }, [selection]);

  const updateSelectedNodeRuntime = useCallback((runtimeId: string) => {
    if (selection?.type !== "node") return;
    const nextRuntimeId = runtimeId.length > 0 ? runtimeId : undefined;
    setNodes((current) => current.map((node) => {
      if (node.id !== selection.id || node.data.kind !== "agent_context") return node;
      const config = { ...node.data.config };
      if (nextRuntimeId) config.runtimeId = nextRuntimeId;
      else delete config.runtimeId;
      const nextNode = {
        ...node,
        data: {
          ...node.data,
          runtimeId: nextRuntimeId,
          config
        }
      };
      dirtyNodeDataRef.current.set(node.id, dirtyNodeData(nextNode.data));
      return nextNode;
    }));
  }, [selection]);

  const updateSelectedNodePrompt = useCallback((prompt: string) => {
    if (selection?.type !== "node") return;
    setNodes((current) => current.map((node) => {
      if (node.id !== selection.id) return node;
      const nextNode = { ...node, data: { ...node.data, prompt } };
      dirtyNodeDataRef.current.set(node.id, dirtyNodeData(nextNode.data));
      return nextNode;
    }));
  }, [selection]);

  const unbindSelectedNode = useCallback(() => {
    if (selection?.type !== "node") return;
    setNodes((current) => current.map((node) => {
      if (node.id !== selection.id || node.data.kind !== "agent_context") return node;
      const config = { ...node.data.config };
      delete config.agentBindingId;
      delete config.roleId;
      delete config.modelConfigId;
      const nextNode = {
        ...node,
        data: {
          ...node.data,
          agentBindingId: undefined,
          roleId: undefined,
          modelConfigId: undefined,
          bindingLabel: undefined,
          modelLabel: undefined,
          contactStatus: undefined,
          config
        }
      };
      dirtyNodeDataRef.current.set(node.id, dirtyNodeData(nextNode.data));
      return nextNode;
    }));
  }, [selection]);

  const showUnavailable = useCallback((action: string) => {
    setServiceNotice(`${action} 暂不可用。`);
  }, []);

  const persistDraft = useCallback(async () => {
    const payload = workflowDraftPayload(seed, nodes, edges);
    const isLocalWorkflow = seed.id.startsWith("workflow-local");
    const response = await csrfFetch(
      isLocalWorkflow ? "/workflows" : `/workflows/${encodeURIComponent(seed.id)}/draft`,
      {
        method: isLocalWorkflow ? "POST" : "PUT",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) throw new Error(`工作流保存失败：${response.status}`);
    const graph = await response.json() as { readonly workflow?: { readonly id?: string } };
    return graph.workflow?.id ?? seed.id;
  }, [csrfFetch, edges, nodes, seed]);

  const saveDraft = useCallback(async () => {
    setSavingDraft(true);
    setServiceNotice(undefined);
    try {
      await persistDraft();
      setServiceNotice("草稿已保存。");
    } catch (error) {
      setServiceNotice(error instanceof Error ? error.message : "草稿保存失败。");
    } finally {
      setSavingDraft(false);
    }
  }, [persistDraft]);

  const startWorkflow = useCallback(async () => {
    setStartingRun(true);
    setServiceNotice(undefined);
    try {
      const workflowId = await persistDraft();
      const response = await csrfFetch(`/workflows/${encodeURIComponent(workflowId)}/runs`, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ seedContext: seedContext.trim().length > 0 ? seedContext : "A" })
      });
      if (!response.ok) throw new Error(`工作流启动失败：${response.status}`);
      const payload = await response.json() as { readonly run?: { readonly id?: string } };
      if (payload.run?.id) setVisualRunId(payload.run.id);
      setServiceNotice("运行已启动。节点完成后会显示输出。");
    } catch (error) {
      setServiceNotice(error instanceof Error ? error.message : "工作流启动失败。");
    } finally {
      setStartingRun(false);
    }
  }, [csrfFetch, persistDraft, seed.id, seedContext]);

  const stopWorkflow = useCallback(async () => {
    if (!activeRun || (activeRun.status !== "queued" && activeRun.status !== "running")) return;
    setStoppingRun(true);
    setServiceNotice(undefined);
    try {
      const response = await csrfFetch(`/workflows/${encodeURIComponent(activeRun.workflowId)}/runs/${encodeURIComponent(activeRun.id)}/cancel`, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json" }
      });
      if (!response.ok) throw new Error(`工作流停止失败：${response.status}`);
      setServiceNotice("运行已停止。活跃节点输出和边投递已取消。");
    } catch (error) {
      setServiceNotice(error instanceof Error ? error.message : "工作流停止失败。");
    } finally {
      setStoppingRun(false);
    }
  }, [activeRun, csrfFetch]);

  return (
    <section className="ah-workflow-view" aria-label="Agent 工作流画布">
      <header className="ah-workflow-toolbar">
        <div className="min-w-0">
          <p className="ah-workflow-kicker">工作流画布</p>
          <h2>{projectedWorkflow?.name ?? "Agent 上下文交接"}</h2>
        </div>
        <div className="ah-workflow-actions">
          <button type="button" className="ah-workflow-button" onClick={addAgentNode}>添加节点</button>
          <button type="button" className="ah-workflow-button" onClick={addNote}>添加备注</button>
          <button type="button" className="ah-workflow-button" onClick={() => setImportPickerOpen(true)}>导入角色节点</button>
          <button type="button" className="ah-workflow-button" onClick={deleteSelection} disabled={!selection}>删除</button>
          <button type="button" className="ah-workflow-button ah-workflow-button-primary" onClick={() => void saveDraft()} disabled={savingDraft || startingRun || stoppingRun}>
            {savingDraft ? "保存中..." : "保存草稿"}
          </button>
        </div>
      </header>

      {serviceNotice ? (
        <div className="ah-workflow-notice" role="status">
          <span>{serviceNotice}</span>
          <button type="button" onClick={() => setServiceNotice(undefined)}>关闭</button>
        </div>
      ) : null}

      <div className="ah-workflow-runbar" aria-label="工作流运行控制">
        <label className="ah-workflow-run-io">
          <span>A</span>
          <textarea
            aria-label="A 输入内容"
            value={seedContext}
            onChange={(event) => setSeedContext(event.currentTarget.value)}
            placeholder="输入要交给第一个节点的内容"
            rows={2}
          />
        </label>
        <div className="ah-workflow-run-center">
          <div className="ah-workflow-run-summary">
            <span className={`ah-workflow-run-badge ah-workflow-status-${statusClass(activeRun?.status ?? "draft")}`}>
              {workflowStatusLabel(activeRun?.status ?? "draft")}
            </span>
            <span>{workflowRunSummary(activeRun)}</span>
          </div>
          <div className="ah-workflow-run-actions">
            <button type="button" className="ah-workflow-button ah-workflow-button-run" onClick={() => void startWorkflow()} disabled={startingRun || savingDraft || stoppingRun}>
              {startingRun ? "启动中..." : "启动"}
            </button>
            <button
              type="button"
              className="ah-workflow-button ah-workflow-button-stop"
              onClick={() => void stopWorkflow()}
              disabled={stoppingRun || !activeRun || (activeRun.status !== "queued" && activeRun.status !== "running")}
            >
              {stoppingRun ? "停止中..." : "停止"}
            </button>
          </div>
        </div>
        <label className="ah-workflow-run-io">
          <span>B</span>
          <textarea aria-label="B 最终输出" value={finalOutput} readOnly placeholder="最后一个节点的输出会显示在这里" rows={2} />
        </label>
      </div>

      <div className="ah-workflow-body">
        <div className="ah-workflow-canvas" data-testid="workflow-canvas" data-edge-restore="deferred">
          <ReactFlow
            nodes={enrichedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelection({ type: "node", id: node.id })}
            onEdgeClick={(_, edge) => setSelection({ type: "edge", id: edge.id })}
            onPaneClick={() => setSelection(undefined)}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.45}
            maxZoom={1.5}
          >
            <Background color="rgba(48, 91, 145, 0.18)" gap={18} size={1.2} />
            <Controls position="bottom-left" />
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeColor={(node) => node.data?.kind === "note" ? "#f3d36f" : "#2f7de1"}
              maskColor="rgba(219, 234, 247, 0.68)"
            />
          </ReactFlow>
        </div>

        <aside className="ah-workflow-inspector" aria-label="工作流检查器">
          <Inspector
            nodes={enrichedNodes}
            edges={edges}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            activeRun={activeRun}
            edgeRun={visualWorkflowRun(seed, visualRunId)}
            runtimeOptions={runtimeOptions}
            runtimeLoading={runtimeLoading}
            runtimeError={runtimeError}
            upstream={selectedNode ? neighborIndex.upstream[selectedNode.id] ?? [] : []}
            downstream={selectedNode ? neighborIndex.downstream[selectedNode.id] ?? [] : []}
            onSelectNode={(id) => setSelection({ type: "node", id })}
            onRuntimeChange={updateSelectedNodeRuntime}
            onPromptChange={updateSelectedNodePrompt}
            onUnbindNode={unbindSelectedNode}
            onRetryEdge={() => showUnavailable("重试边投递")}
          />
          <RunHistoryPanel run={activeRun} nodes={enrichedNodes} />
        </aside>
      </div>
      <ContactImportModal
        contacts={contactOptions}
        loading={contactsLoading}
        error={contactsError}
        isOpen={importPickerOpen}
        onOpenChange={setImportPickerOpen}
        onImport={importContactNode}
      />
    </section>
  );
}

function AgentWorkflowNode({ data, selected }: NodeProps<Node<AgentWorkflowNodeData>>) {
  const isNote = data.kind === "note";
  return (
    <article
      className={[
        "ah-workflow-node",
        `ah-workflow-node-${data.kind}`,
        `ah-workflow-node-status-${statusClass(data.status ?? "draft")}`,
        selected ? "ah-workflow-node-selected" : "",
        data.enabled ? "" : "ah-workflow-node-disabled"
      ].join(" ")}
    >
      {!isNote ? <Handle type="target" position={Position.Left} className="ah-workflow-handle" /> : null}
      <div className="ah-workflow-node-top">
        <span className="ah-workflow-node-dot" />
        <span className="ah-workflow-node-title">{data.label}</span>
        <span className="ah-workflow-node-status">{workflowStatusLabel(data.status ?? "draft")}</span>
      </div>
      <p className="ah-workflow-node-role">{data.roleLabel ?? (isNote ? "备注" : "Agent 角色")}</p>
      {!isNote ? (
        <div className="ah-workflow-node-foot">
          <span>入 {data.upstreamCount}</span>
          <span>出 {data.downstreamCount}</span>
          {data.agentBindingId ? <span>已绑定</span> : null}
          {data.runtimeLabel ? <span>{data.runtimeLabel}</span> : null}
          {data.locked ? <span>已锁定</span> : null}
        </div>
      ) : null}
      {!isNote ? <Handle type="source" position={Position.Right} className="ah-workflow-handle" /> : null}
    </article>
  );
}

function Inspector({
  nodes,
  edges,
  selectedNode,
  selectedEdge,
  activeRun,
  edgeRun,
  runtimeOptions,
  runtimeLoading,
  runtimeError,
  upstream,
  downstream,
  onSelectNode,
  onRuntimeChange,
  onPromptChange,
  onUnbindNode,
  onRetryEdge
}: {
  readonly nodes: ReadonlyArray<Node<AgentWorkflowNodeData>>;
  readonly edges: readonly Edge[];
  readonly selectedNode?: Node<AgentWorkflowNodeData> | undefined;
  readonly selectedEdge?: Edge | undefined;
  readonly activeRun?: WorkflowRunViewModel | undefined;
  readonly edgeRun?: WorkflowRunViewModel | undefined;
  readonly runtimeOptions: readonly WorkflowRuntimeOption[];
  readonly runtimeLoading: boolean;
  readonly runtimeError?: string | undefined;
  readonly upstream: readonly string[];
  readonly downstream: readonly string[];
  readonly onSelectNode: (id: string) => void;
  readonly onRuntimeChange: (runtimeId: string) => void;
  readonly onPromptChange: (prompt: string) => void;
  readonly onUnbindNode: () => void;
  readonly onRetryEdge: () => void;
}) {
  if (selectedNode) {
    const nodeRun = activeRun?.nodeRuns.find((item) => item.nodeId === selectedNode.id);
    return (
      <div className="ah-workflow-inspector-content">
        <p className="ah-workflow-kicker">已选节点</p>
        <h3>{selectedNode.data.label}</h3>
        <dl className="ah-workflow-meta">
          <div><dt>角色</dt><dd>{selectedNode.data.roleLabel ?? "Agent"}</dd></div>
          <div><dt>状态</dt><dd>{workflowStatusLabel(selectedNode.data.status ?? "draft")}</dd></div>
          {nodeRun?.agentRunId ? <div><dt>Agent 运行</dt><dd>{nodeRun.agentRunId}</dd></div> : null}
          {nodeRun?.inputContexts.length ? <div className="ah-workflow-meta-context"><dt>输入</dt><dd>{nodeRun.inputContexts.map(contextLabel).join("\n")}</dd></div> : null}
          {contextTextFromRecord(nodeRun?.outputContext) ? <div className="ah-workflow-meta-context"><dt>输出</dt><dd>{contextTextFromRecord(nodeRun?.outputContext)}</dd></div> : null}
          {nodeRun?.error ? <div><dt>错误</dt><dd>{nodeRun.error}</dd></div> : null}
        </dl>
        {selectedNode.data.kind === "agent_context" ? (
          <>
            <NodeBindingPanel node={selectedNode.data} onUnbind={onUnbindNode} />
            <PromptEditor value={selectedNode.data.prompt} onChange={onPromptChange} />
            <KernelSelect
              value={selectedNode.data.runtimeId ?? ""}
              currentLabel={selectedNode.data.runtimeLabel}
              runtimeOptions={runtimeOptions}
              loading={runtimeLoading}
              error={runtimeError}
              locked={selectedNode.data.agentBindingId !== undefined}
              onChange={onRuntimeChange}
            />
            <NeighborList title="上游" emptyLabel="暂无上游节点" nodeIds={upstream} nodes={nodes} onSelectNode={onSelectNode} />
            <NeighborList title="下游" emptyLabel="暂无下游节点" nodeIds={downstream} nodes={nodes} onSelectNode={onSelectNode} />
          </>
        ) : (
          <div className="ah-workflow-empty-help">备注节点只停留在画布上，不参与执行。</div>
        )}
      </div>
    );
  }

  if (selectedEdge) {
    const source = nodes.find((node) => node.id === selectedEdge.source);
    const target = nodes.find((node) => node.id === selectedEdge.target);
    const delivery = edgeRun?.edgeDeliveries.find((item) => item.edgeId === selectedEdge.id);
    const status = delivery?.status ?? edgeDataString(selectedEdge, "status") ?? "draft";
    const error = delivery?.error ?? edgeDataString(selectedEdge, "error");
    const detailReference = delivery?.mailboxMessageId ?? delivery?.id ?? edgeDataString(selectedEdge, "mailboxMessageId");
    const contextText = contextTextFromRecord(delivery?.context) ?? edgeDataString(selectedEdge, "contextText");
    const stateMessage = edgeStateMessage(status, source?.data.label ?? selectedEdge.source, target?.data.label ?? selectedEdge.target);
    return (
      <div className="ah-workflow-inspector-content">
        <p className="ah-workflow-kicker">已选连线</p>
        <h3>{source?.data.label ?? selectedEdge.source} {"->"} {target?.data.label ?? selectedEdge.target}</h3>
        <dl className="ah-workflow-meta">
          <div><dt>投递</dt><dd>{workflowStatusLabel(status)}</dd></div>
          <div><dt>状态</dt><dd>{stateMessage}</dd></div>
          <div><dt>来源</dt><dd>{source?.data.label ?? selectedEdge.source}</dd></div>
          <div><dt>目标</dt><dd>{target?.data.label ?? selectedEdge.target}</dd></div>
          {contextText ? <div className="ah-workflow-meta-context"><dt>上下文</dt><dd>{contextText}</dd></div> : null}
          {error ? <div><dt>错误</dt><dd>{error}</dd></div> : null}
          {detailReference ? <div><dt>详情</dt><dd>{detailReference}</dd></div> : null}
        </dl>
        {status === "failed" ? (
          <button type="button" className="ah-workflow-button ah-workflow-button-full" onClick={onRetryEdge}>重试失败连线</button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ah-workflow-inspector-content">
      <p className="ah-workflow-kicker">画布</p>
      <h3>上下文图</h3>
      <dl className="ah-workflow-meta">
        <div><dt>节点</dt><dd>{nodes.length}</dd></div>
        <div><dt>连线</dt><dd>{edges.length}</dd></div>
        <div><dt>模式</dt><dd>有向流程</dd></div>
      </dl>
      <div className="ah-workflow-empty-help">
        选择节点或连线后，可以查看上下游上下文和运行状态。
      </div>
    </div>
  );
}

function PromptEditor({ value, onChange }: { readonly value: string; readonly onChange: (prompt: string) => void }) {
  return (
    <label className="ah-workflow-field">
      <span>提示词</span>
      <textarea
        className="ah-workflow-textarea"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        rows={6}
      />
    </label>
  );
}

function NodeBindingPanel({ node, onUnbind }: { readonly node: AgentWorkflowNodeData; readonly onUnbind: () => void }) {
  if (!node.agentBindingId) {
    return (
      <div className="ah-workflow-empty-help">
        这是独立工作流节点。可以在工具栏导入已有角色节点，复用联系人里的运行时、模型和权限配置。
      </div>
    );
  }
  return (
    <div className="ah-workflow-binding-card">
      <div className="ah-workflow-binding-head">
        <div className="min-w-0">
          <p className="ah-workflow-kicker">角色来源</p>
          <h4>{node.bindingLabel ?? node.label}</h4>
        </div>
        {node.contactStatus ? (
          <Chip size="sm" variant="soft" color={contactStatusColor(node.contactStatus)}>
            {contactStatusLabel(node.contactStatus)}
          </Chip>
        ) : null}
      </div>
      <dl className="ah-workflow-binding-meta">
        <div><dt>绑定</dt><dd>{node.agentBindingId}</dd></div>
        <div><dt>角色</dt><dd>{node.roleLabel ?? node.roleId ?? "未命名角色"}</dd></div>
        {node.runtimeLabel ? <div><dt>运行内核</dt><dd>{node.runtimeLabel}</dd></div> : null}
        {node.modelLabel ?? node.modelConfigId ? <div><dt>模型</dt><dd>{node.modelLabel ?? node.modelConfigId}</dd></div> : null}
      </dl>
      <button type="button" className="ah-workflow-button ah-workflow-button-full" onClick={onUnbind}>解除绑定</button>
    </div>
  );
}

function KernelSelect({
  value,
  currentLabel,
  runtimeOptions,
  loading,
  error,
  locked,
  onChange
}: {
  readonly value: string;
  readonly currentLabel?: string | undefined;
  readonly runtimeOptions: readonly WorkflowRuntimeOption[];
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly locked: boolean;
  readonly onChange: (runtimeId: string) => void;
}) {
  const hasCurrentOption = value.length > 0 && runtimeOptions.some((runtime) => runtime.id === value);
  return (
    <div className="ah-workflow-field">
      <label htmlFor="workflow-node-kernel">运行内核</label>
      <select
        id="workflow-node-kernel"
        className="ah-workflow-select"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        disabled={loading || locked}
      >
        <option value="">{loading ? "正在加载运行内核..." : "未选择运行内核"}</option>
        {!hasCurrentOption && value.length > 0 ? <option value={value}>{currentLabel ?? value}</option> : null}
        {runtimeOptions.map((runtime) => (
          <option key={runtime.id} value={runtime.id}>
            {runtime.name} - {runtimeDisplayName(runtime.kind)}
          </option>
        ))}
      </select>
      {locked ? <p className="ah-workflow-field-hint">绑定节点使用联系人配置。需要修改运行内核时，请先解除绑定。</p> : null}
      {error ? <p className="ah-workflow-field-error">{error}</p> : null}
    </div>
  );
}

function NeighborList({ title, emptyLabel, nodeIds, nodes, onSelectNode }: { readonly title: string; readonly emptyLabel: string; readonly nodeIds: readonly string[]; readonly nodes: ReadonlyArray<Node<AgentWorkflowNodeData>>; readonly onSelectNode: (id: string) => void }) {
  return (
    <div className="ah-workflow-neighbors">
      <h4>{title}</h4>
      {nodeIds.length === 0 ? (
        <p>{emptyLabel}</p>
      ) : (
        <div className="ah-workflow-neighbor-list">
          {nodeIds.map((nodeId) => {
            const node = nodes.find((item) => item.id === nodeId);
            return (
              <button key={nodeId} type="button" onClick={() => onSelectNode(nodeId)}>
                {node?.data.label ?? nodeId}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ContactImportModal({
  contacts,
  loading,
  error,
  isOpen,
  onOpenChange,
  onImport
}: {
  readonly contacts: readonly AgentContactViewModel[];
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onImport: (contact: AgentContactViewModel) => void;
}) {
  const sorted = [...contacts].sort((a, b) => contactStatusRank(a.status) - contactStatusRank(b.status) || a.displayName.localeCompare(b.displayName));
  const handleAction = (key: unknown) => {
    const contact = contacts.find((item) => item.agentBindingId === String(key));
    if (contact) onImport(contact);
  };
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg">
        <Modal.Dialog className="ah-workflow-import-dialog" aria-label="导入角色节点">
          <Modal.CloseTrigger aria-label="关闭导入角色节点" />
          <Modal.Header>
            <Modal.Heading>导入角色节点</Modal.Heading>
            <p className="text-sm text-muted">选择已有 Agent 联系人后，节点会复用它的角色、运行内核、模型和权限配置。</p>
          </Modal.Header>
          <Modal.Body>
            {error ? <p className="ah-workflow-field-error">{error}</p> : null}
            {loading ? <p className="ah-workflow-empty-help">正在加载已有角色...</p> : null}
            {sorted.length === 0 && !loading ? (
              <p className="ah-workflow-empty-help">暂无可导入的角色联系人。可以先在联系人或设置中创建 Agent。</p>
            ) : (
              <ListBox aria-label="可导入角色节点" className="ah-workflow-contact-list" onAction={handleAction}>
                {sorted.map((contact) => {
                  const subtitle = [
                    contact.roleName ?? contact.roleId,
                    contactRuntimeLabel(contact),
                    contact.modelName
                  ].filter(Boolean).join(" / ");
                  return (
                    <ListBox.Item
                      key={contact.agentBindingId}
                      id={contact.agentBindingId}
                      textValue={contact.displayName}
                      className="ah-workflow-contact-item"
                    >
                      <IdentityAvatar
                        name={contact.displayName}
                        avatarUrl={contact.avatarUrl}
                        className="ah-workflow-contact-avatar"
                        size="sm"
                      />
                      <span className="ah-workflow-contact-main">
                        <span className="ah-workflow-contact-title">
                          <span>{contact.displayName}</span>
                          <span className={`ah-workflow-contact-presence is-${contact.status}`} aria-hidden="true" />
                        </span>
                        <span className="ah-workflow-contact-subtitle">{subtitle}</span>
                        {contact.description ?? contact.systemPrompt ? (
                          <span className="ah-workflow-contact-description">{contact.description ?? contact.systemPrompt}</span>
                        ) : null}
                      </span>
                      <span className="ah-workflow-contact-tags">
                        <Chip size="sm" variant="soft" color={contactStatusColor(contact.status)}>{contactStatusLabel(contact.status)}</Chip>
                        <Chip size="sm" variant="soft" color="accent">导入</Chip>
                      </span>
                    </ListBox.Item>
                  );
                })}
              </ListBox>
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function RunHistoryPanel({ run, nodes }: { readonly run?: WorkflowRunViewModel | undefined; readonly nodes: ReadonlyArray<Node<AgentWorkflowNodeData>> }) {
  const nodeRuns = run?.nodeRuns ?? [];
  const deliveries = run?.edgeDeliveries ?? [];
  return (
    <div className="ah-workflow-run-panel">
      <p className="ah-workflow-kicker">运行历史</p>
      <div className="ah-workflow-run-grid">
        <div><span>节点运行</span><strong>{nodeRuns.length}</strong></div>
        <div><span>边投递</span><strong>{deliveries.length}</strong></div>
        <div><span>状态</span><strong>{workflowStatusLabel(run?.status ?? "draft")}</strong></div>
      </div>
      <div className="ah-workflow-run-list">
        {nodeRuns.length === 0 && deliveries.length === 0 ? (
          <p>暂无运行事件</p>
        ) : (
          [...nodeRuns.map((nodeRun) => runHistoryItemFromNodeRun(nodeRun, nodes)), ...deliveries.map(runHistoryItemFromDelivery)]
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .slice(0, 8)
            .map((item) => (
              <div key={item.id} className={`ah-workflow-run-row ah-workflow-status-${statusClass(item.status)}`}>
                <span>
                  {item.label}
                  {item.context ? <small>{item.context}</small> : null}
                </span>
                <strong>{workflowStatusLabel(item.status)}</strong>
              </div>
            ))
        )}
      </div>
    </div>
  );
}

function workflowNodesToReactFlow(nodes: readonly WorkflowNodeViewModel[], edges: readonly WorkflowEdgeViewModel[], run?: WorkflowRunViewModel | undefined): Array<Node<AgentWorkflowNodeData>> {
  const index = buildNeighborIndex(workflowEdgesToReactFlow(edges, run));
  const nodeRunByNodeId = latestNodeRunByNodeId(run);
  return nodes.map((node) => {
    const nodeRun = nodeRunByNodeId.get(node.nodeId);
    return {
      id: node.nodeId,
      type: "agentContext",
      position: node.position,
      ...(node.size?.width !== undefined ? { width: node.size.width } : {}),
      ...(node.size?.height !== undefined ? { height: node.size.height } : {}),
      data: {
        label: node.displayName,
        roleLabel: node.roleLabel,
        prompt: node.prompt,
        agentBindingId: node.agentBindingId ?? configString(node.config, "agentBindingId"),
        roleId: configString(node.config, "roleId"),
        modelConfigId: configString(node.config, "modelConfigId"),
        bindingLabel: configString(node.config, "bindingLabel"),
        modelLabel: configString(node.config, "modelLabel"),
        contactStatus: contactStatusFromConfig(node.config),
        runtimeId: configString(node.config, "runtimeId"),
        status: node.kind === "note" ? "note" : nodeRun?.status ?? (node.enabled ? "ready" : "disabled"),
        upstreamCount: index.upstream[node.nodeId]?.length ?? 0,
        downstreamCount: index.downstream[node.nodeId]?.length ?? 0,
        enabled: node.enabled,
        locked: node.locked,
        kind: node.kind,
        config: node.config
      }
    };
  });
}

function workflowEdgesToReactFlow(edges: readonly WorkflowEdgeViewModel[], run?: WorkflowRunViewModel | undefined): Edge[] {
  const deliveryByEdgeId = latestDeliveryByEdgeId(run);
  const nodeRunByNodeId = latestNodeRunByNodeId(run);
  return edges.map((edge) => {
    const delivery = deliveryByEdgeId.get(edge.edgeId);
    const status = workflowEdgeStatus(edge, delivery, nodeRunByNodeId.get(edge.targetNodeId));
    return {
      id: edge.edgeId,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      type: "smoothstep",
      animated: status === "queued" || status === "mailbox_created" || status === "transferring",
      markerEnd: { type: "arrowclosed" },
      className: `ah-workflow-edge ah-workflow-edge-${statusClass(status)}`,
      data: {
        status,
        ...(contextTextFromRecord(delivery?.context) ? { contextText: contextTextFromRecord(delivery?.context) } : {}),
        ...(delivery?.error ? { error: delivery.error } : {}),
        ...(delivery?.mailboxMessageId ? { mailboxMessageId: delivery.mailboxMessageId } : {})
      }
    };
  });
}

export function workflowDraftPayload(workflow: WorkflowViewModel, nodes: ReadonlyArray<Node<AgentWorkflowNodeData>>, edges: readonly Edge[]) {
  return {
    id: workflow.id.startsWith("workflow-local") ? undefined : workflow.id,
    workspaceId: workflow.workspaceId,
    roomId: workflow.roomId,
    name: workflow.name,
    description: workflow.description,
    viewport: latestDraftVersion(workflow)?.viewport ?? {},
    nodes: nodes.map((node) => ({
      nodeId: node.id,
      kind: node.data.kind,
      displayName: node.data.label,
      agentBindingId: node.data.agentBindingId,
      roleLabel: node.data.roleLabel,
      prompt: node.data.prompt,
      position: node.position,
      size: node.width !== undefined && node.height !== undefined ? { width: node.width, height: node.height } : undefined,
      enabled: node.data.enabled,
      locked: node.data.locked,
      config: workflowNodeConfig(node.data)
    })),
    edges: edges.map((edge) => ({
      edgeId: edge.id,
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      label: typeof edge.label === "string" && edge.label.trim().length > 0 ? edge.label : undefined,
      enabled: true,
      config: {}
    }))
  };
}

function workflowEdgeStatus(edge: WorkflowEdgeViewModel, delivery: WorkflowEdgeDeliveryViewModel | undefined, targetNodeRun: WorkflowNodeRunViewModel | undefined): string {
  if (!edge.enabled) return "disabled";
  if (delivery?.status === "mailbox_created" && (targetNodeRun?.status === "running" || targetNodeRun?.status === "queued")) return "transferring";
  if (targetNodeRun?.status === "running" || targetNodeRun?.status === "queued") return "transferring";
  if (targetNodeRun?.status === "failed") return "failed";
  if (delivery?.status === "mailbox_created" && targetNodeRun?.status === "completed") return "delivered";
  return delivery?.status ?? "ready";
}

function visualWorkflowRun(workflow: WorkflowViewModel, visualRunId: string | undefined): WorkflowRunViewModel | undefined {
  if (visualRunId) {
    const visualRun = workflow.runs.find((run) => run.id === visualRunId);
    if (visualRun) return visualRun;
  }
  return workflow.runs.find((run) => run.status === "queued" || run.status === "running" || run.status === "failed");
}

function mergeDirtyNodeData(nodes: Array<Node<AgentWorkflowNodeData>>, dirty: Map<string, DirtyAgentWorkflowNodeData>): Array<Node<AgentWorkflowNodeData>> {
  if (dirty.size === 0) return nodes;
  return nodes.map((node) => {
    const override = dirty.get(node.id);
    if (!override) return node;
    return {
      ...node,
      data: {
        ...node.data,
        ...override
      }
    };
  });
}

function reconcileDirtyNodeData(nodes: readonly WorkflowNodeViewModel[], dirty: Map<string, DirtyAgentWorkflowNodeData>): void {
  if (dirty.size === 0) return;
  const byNodeId = new Map(nodes.map((node) => [node.nodeId, node]));
  for (const [nodeId, override] of dirty) {
    const node = byNodeId.get(nodeId);
    if (!node) {
      dirty.delete(nodeId);
      continue;
    }
    if (
      node.prompt === override.prompt
      && configString(node.config, "runtimeId") === override.runtimeId
      && (node.agentBindingId ?? configString(node.config, "agentBindingId")) === override.agentBindingId
    ) {
      dirty.delete(nodeId);
    }
  }
}

function latestDraftVersion(workflow: WorkflowViewModel) {
  return workflow.versions.find((version) => version.id === workflow.draftVersionId)
    ?? workflow.versions.find((version) => version.state === "draft");
}

function buildNeighborIndex(edges: readonly Edge[]): { upstream: Record<string, string[]>; downstream: Record<string, string[]> } {
  const upstream: Record<string, string[]> = {};
  const downstream: Record<string, string[]> = {};
  for (const edge of edges) {
    downstream[edge.source] = [...(downstream[edge.source] ?? []), edge.target];
    upstream[edge.target] = [...(upstream[edge.target] ?? []), edge.source];
  }
  return { upstream, downstream };
}

function latestWorkflowRun(workflow: WorkflowViewModel): WorkflowRunViewModel | undefined {
  const live = workflow.runs.find((run) => run.status === "running" || run.status === "queued");
  if (live) return live;
  return [...workflow.runs].sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

function latestNodeRunByNodeId(run: WorkflowRunViewModel | undefined): Map<string, WorkflowNodeRunViewModel> {
  const result = new Map<string, WorkflowNodeRunViewModel>();
  for (const nodeRun of run?.nodeRuns ?? []) {
    const existing = result.get(nodeRun.nodeId);
    if (!existing || existing.updatedAt <= nodeRun.updatedAt) result.set(nodeRun.nodeId, nodeRun);
  }
  return result;
}

function latestDeliveryByEdgeId(run: WorkflowRunViewModel | undefined): Map<string, WorkflowEdgeDeliveryViewModel> {
  const result = new Map<string, WorkflowEdgeDeliveryViewModel>();
  for (const delivery of run?.edgeDeliveries ?? []) {
    const existing = result.get(delivery.edgeId);
    if (!existing || existing.updatedAt <= delivery.updatedAt) result.set(delivery.edgeId, delivery);
  }
  return result;
}

function runHistoryItemFromNodeRun(nodeRun: WorkflowNodeRunViewModel, nodes: ReadonlyArray<Node<AgentWorkflowNodeData>>) {
  const node = nodes.find((item) => item.id === nodeRun.nodeId);
  return {
    id: `node-run:${nodeRun.id}`,
    label: node?.data.label ?? nodeRun.nodeId,
    context: contextTextFromRecord(nodeRun.outputContext),
    status: nodeRun.status,
    updatedAt: nodeRun.updatedAt
  };
}

function finalWorkflowOutput(run: WorkflowRunViewModel | undefined, nodes: readonly WorkflowNodeViewModel[], edges: readonly WorkflowEdgeViewModel[]): string {
  if (!run) return "";
  const enabledTargets = new Set(edges.filter((edge) => edge.enabled).map((edge) => edge.targetNodeId));
  const sinkNodeIds = nodes
    .filter((node) => node.enabled && node.kind === "agent_context" && !edges.some((edge) => edge.enabled && edge.sourceNodeId === node.nodeId))
    .map((node) => node.nodeId);
  const preferredNodeIds = sinkNodeIds.length > 0 ? sinkNodeIds : nodes.filter((node) => node.enabled && node.kind === "agent_context" && enabledTargets.has(node.nodeId)).map((node) => node.nodeId);
  const completed = run.nodeRuns
    .filter((nodeRun) => nodeRun.status === "completed" && preferredNodeIds.includes(nodeRun.nodeId))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  return contextTextFromRecord(completed?.outputContext) ?? "";
}

function runHistoryItemFromDelivery(delivery: WorkflowEdgeDeliveryViewModel) {
  const context = contextTextFromRecord(delivery.context);
  return {
    id: `edge-delivery:${delivery.id}`,
    label: `${delivery.sourceNodeId} -> ${delivery.targetNodeId}`,
    context,
    status: delivery.status,
    updatedAt: delivery.updatedAt
  };
}

function workflowRunSummary(run: WorkflowRunViewModel | undefined): string {
  if (!run) return "暂无运行事件";
  const failedEdges = run.edgeDeliveries.filter((delivery) => delivery.status === "failed").length;
  const waitingNodes = run.nodeRuns.filter((nodeRun) => nodeRun.status === "waiting" || nodeRun.status === "queued").length;
  if (failedEdges > 0) return `${failedEdges} 次投递失败`;
  if (waitingNodes > 0) return `${waitingNodes} 个节点等待中`;
  return `${run.nodeRuns.length} 个节点运行，${run.edgeDeliveries.length} 次边投递`;
}

function edgeDataString(edge: Edge | undefined, key: string): string | undefined {
  const value = edge?.data?.[key];
  return typeof value === "string" ? value : undefined;
}

function edgeStateMessage(status: string, source: string, target: string): string {
  if (status === "ready" || status === "draft") return `就绪：尚未从 ${source} 向 ${target} 传递上下文。`;
  if (status === "queued" || status === "mailbox_created" || status === "transferring") return `正在从 ${source} 向 ${target} 传递上下文。`;
  if (status === "delivered" || status === "completed") return `${source} 到 ${target} 的上下文投递已完成。`;
  if (status === "failed") return `${source} 到 ${target} 的投递失败。`;
  if (status === "cancelled") return `${source} 到 ${target} 的投递已停止。`;
  if (status === "disabled" || status === "skipped") return `这条连线未参与当前运行。`;
  return `当前连线状态：${workflowStatusLabel(status)}。`;
}

function contextTextFromRecord(context: Record<string, unknown> | undefined): string | undefined {
  const text = context?.text;
  return typeof text === "string" && text.trim().length > 0 ? text : undefined;
}

function contextLabel(context: Record<string, unknown>): string {
  const text = contextTextFromRecord(context);
  const source = typeof context.fromNodeName === "string"
    ? context.fromNodeName
    : typeof context.fromNodeId === "string"
      ? context.fromNodeId
      : typeof context.source === "string"
        ? context.source
        : "context";
  return text ? `${source}: ${text}` : `${source}: ${JSON.stringify(context)}`;
}

function workflowNodeConfig(data: AgentWorkflowNodeData): Record<string, unknown> {
  const config = { ...data.config };
  if (data.runtimeId) config.runtimeId = data.runtimeId;
  else delete config.runtimeId;
  if (data.agentBindingId) config.agentBindingId = data.agentBindingId;
  else delete config.agentBindingId;
  if (data.roleId) config.roleId = data.roleId;
  else delete config.roleId;
  if (data.modelConfigId) config.modelConfigId = data.modelConfigId;
  else delete config.modelConfigId;
  if (data.bindingLabel) config.bindingLabel = data.bindingLabel;
  else delete config.bindingLabel;
  if (data.modelLabel) config.modelLabel = data.modelLabel;
  else delete config.modelLabel;
  if (data.contactStatus) config.contactStatus = data.contactStatus;
  else delete config.contactStatus;
  return config;
}

function dirtyNodeData(data: AgentWorkflowNodeData): DirtyAgentWorkflowNodeData {
  return {
    agentBindingId: data.agentBindingId,
    roleId: data.roleId,
    modelConfigId: data.modelConfigId,
    bindingLabel: data.bindingLabel,
    modelLabel: data.modelLabel,
    contactStatus: data.contactStatus,
    prompt: data.prompt,
    runtimeId: data.runtimeId,
    config: data.config
  };
}

function agentNodeDataFromContact(contact: AgentContactViewModel, base: Pick<AgentWorkflowNodeData, "downstreamCount" | "enabled" | "kind" | "locked" | "status" | "upstreamCount">): AgentWorkflowNodeData {
  const runtimeLabel = contactRuntimeLabel(contact);
  const config = workflowNodeConfig({
    label: contact.displayName,
    roleLabel: contact.roleName ?? contact.roleId,
    prompt: contact.systemPrompt ?? contact.description ?? IMPORTED_AGENT_PROMPT,
    agentBindingId: contact.agentBindingId,
    roleId: contact.roleId,
    runtimeId: contact.runtimeId,
    runtimeKind: contact.runtimeKind,
    runtimeLabel,
    modelConfigId: contact.modelConfigId,
    bindingLabel: runtimeLabel,
    modelLabel: contact.modelName,
    contactStatus: contact.status,
    ...base,
    config: {}
  });
  return {
    label: contact.displayName,
    roleLabel: contact.roleName ?? contact.roleId,
    prompt: contact.systemPrompt ?? contact.description ?? IMPORTED_AGENT_PROMPT,
    agentBindingId: contact.agentBindingId,
    roleId: contact.roleId,
    runtimeId: contact.runtimeId,
    runtimeKind: contact.runtimeKind,
    runtimeLabel,
    modelConfigId: contact.modelConfigId,
    bindingLabel: runtimeLabel,
    modelLabel: contact.modelName,
    contactStatus: contact.status,
    ...base,
    config
  };
}

function hydrateContactNodeData(nodes: Array<Node<AgentWorkflowNodeData>>, contacts: ReadonlyMap<string, AgentContactViewModel>): Array<Node<AgentWorkflowNodeData>> {
  if (contacts.size === 0) return nodes;
  return nodes.map((node) => {
    if (!node.data.agentBindingId) return node;
    const contact = contacts.get(node.data.agentBindingId);
    if (!contact) return node;
    return {
      ...node,
      data: {
        ...node.data,
        roleId: node.data.roleId ?? contact.roleId,
        modelConfigId: node.data.modelConfigId ?? contact.modelConfigId,
        bindingLabel: contactRuntimeLabel(contact),
        modelLabel: contact.modelName ?? node.data.modelLabel,
        contactStatus: contact.status,
        runtimeId: node.data.runtimeId ?? contact.runtimeId,
        runtimeKind: node.data.runtimeKind ?? contact.runtimeKind,
        runtimeLabel: node.data.runtimeLabel ?? contactRuntimeLabel(contact),
        roleLabel: node.data.roleLabel ?? contact.roleName ?? contact.roleId
      }
    };
  });
}

function workflowStatusLabel(status: string): string {
  switch (status) {
    case "cancelled":
      return "已取消";
    case "completed":
    case "delivered":
      return "已完成";
    case "disabled":
      return "已禁用";
    case "draft":
      return "草稿";
    case "failed":
      return "失败";
    case "mailbox_created":
      return "已入信箱";
    case "note":
      return "备注";
    case "queued":
      return "排队中";
    case "ready":
      return "就绪";
    case "running":
    case "transferring":
      return "运行中";
    case "skipped":
      return "已跳过";
    case "waiting":
      return "等待中";
    default:
      return status;
  }
}

function contactStatusColor(status: AgentContactViewModel["status"]): "success" | "warning" | "default" {
  if (status === "available") return "success";
  if (status === "busy") return "warning";
  return "default";
}

function contactStatusLabel(status: AgentContactViewModel["status"]): string {
  if (status === "available") return "在线";
  if (status === "busy") return "忙碌";
  return "离线";
}

function contactStatusRank(status: AgentContactViewModel["status"]): number {
  if (status === "available") return 0;
  if (status === "busy") return 1;
  return 2;
}

function contactStatusFromConfig(config: Record<string, unknown>): AgentContactViewModel["status"] | undefined {
  const status = configString(config, "contactStatus");
  return status === "available" || status === "busy" || status === "offline" ? status : undefined;
}

function configString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function runtimeOptionFromRuntime(runtime: RuntimeConfig): WorkflowRuntimeOption {
  const detected = runtime.detectedVersion ?? runtime.version;
  return {
    id: runtime.id,
    name: runtime.name,
    kind: runtime.kind,
    description: detected ?? runtime.command ?? runtimeDisplayName(runtime.kind),
    status: runtime.status ?? undefined
  };
}

function runtimeLabel(runtimeId: string, runtime: WorkflowRuntimeOption | undefined): string {
  return runtime ? runtime.name : runtimeId;
}

function contactRuntimeLabel(contact: Pick<AgentContactViewModel, "runtimeKind" | "runtimeName">): string {
  return runtimeInstanceLabel(contact.runtimeKind, contact.runtimeName);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function statusClass(status: string): string {
  return status.replaceAll("_", "-").toLowerCase();
}

function createLocalWorkflow(): WorkflowViewModel {
  const createdAt = 1;
  return {
    id: "workflow-local-workspace",
    workspaceId: "default-workspace",
    name: "Agent 上下文交接",
    description: "本地草稿，可保存为正式工作流。",
    draftVersionId: "workflow-version-local",
    createdAt,
    updatedAt: createdAt,
    versions: [],
    nodes: [
      localNode("workflow-node-a", "node-a", "A", "AgentHub 原生发送者", "从输入内容开始，并把上下文传递给下游节点。", { x: 110, y: 150 }),
      localNode("workflow-node-b", "node-b", "B", "AgentHub 原生接收者", "接收上游上下文，并输出实际收到的内容。", { x: 470, y: 150 })
    ],
    edges: [
      localEdge("workflow-edge-a-b", "edge-a-b", "node-a", "node-b")
    ],
    runs: [],
    validation: {
      runnable: true,
      issues: [],
      upstreamByNodeId: {},
      downstreamByNodeId: {}
    }
  };
}

function localNode(id: string, nodeId: string, displayName: string, roleLabel: string, prompt: string, position: { readonly x: number; readonly y: number }): WorkflowNodeViewModel {
  return {
    id,
    workflowVersionId: "workflow-version-local",
    nodeId,
    kind: "agent_context",
    displayName,
    roleLabel,
    prompt,
    position,
    size: { width: 260, height: 150 },
    enabled: true,
    locked: false,
    config: { runtimeId: "native-default" },
    createdAt: 1,
    updatedAt: 1
  };
}

function localEdge(id: string, edgeId: string, sourceNodeId: string, targetNodeId: string): WorkflowEdgeViewModel {
  return {
    id,
    workflowVersionId: "workflow-version-local",
    edgeId,
    sourceNodeId,
    targetNodeId,
    enabled: true,
    config: {},
    createdAt: 1,
    updatedAt: 1
  };
}
