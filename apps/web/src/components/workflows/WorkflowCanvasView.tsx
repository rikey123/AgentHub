import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { normalizeRuntimeList, type RuntimeConfig } from "../settings/RuntimesTab.tsx";
import type {
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
  const [edgeRestoreToken, setEdgeRestoreToken] = useState(0);
  const [visualRunId, setVisualRunId] = useState<string | undefined>();
  const pendingEdgesRef = useRef<Edge[]>(workflowEdgesToReactFlow(seed.edges, activeRun));
  const dirtyNodeDataRef = useRef(new Map<string, Pick<AgentWorkflowNodeData, "prompt" | "runtimeId" | "config">>());
  const nextLocalIdRef = useRef(seed.nodes.length + 1);
  const runtimeById = useMemo(() => new Map(runtimeOptions.map((runtime) => [runtime.id, runtime])), [runtimeOptions]);

  useEffect(() => {
    const nextRun = latestWorkflowRun(seed);
    reconcileDirtyNodeData(seed.nodes, dirtyNodeDataRef.current);
    const visualRun = visualWorkflowRun(seed, visualRunId);
    const nextNodes = mergeDirtyNodeData(workflowNodesToReactFlow(seed.nodes, seed.edges, nextRun), dirtyNodeDataRef.current);
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
  }, [seed, visualRunId]);

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
        if (!response.ok) throw new Error(`Kernel bootstrap failed: ${response.status}`);
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
    () => nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        runtimeLabel: node.data.runtimeId ? runtimeLabel(node.data.runtimeId, runtimeById.get(node.data.runtimeId)) : undefined,
        runtimeKind: node.data.runtimeId ? runtimeById.get(node.data.runtimeId)?.kind : undefined,
        upstreamCount: neighborIndex.upstream[node.id]?.length ?? 0,
        downstreamCount: neighborIndex.downstream[node.id]?.length ?? 0
      }
    })),
    [neighborIndex, nodes, runtimeById]
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
          roleLabel: "Context agent",
          prompt: "Receive upstream context, add useful analysis, then pass a concise summary downstream.",
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
          roleLabel: "Canvas note",
          prompt: "Document the context handoff this part of the workflow represents.",
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
      dirtyNodeDataRef.current.set(node.id, {
        prompt: nextNode.data.prompt,
        runtimeId: nextNode.data.runtimeId,
        config: nextNode.data.config
      });
      return nextNode;
    }));
  }, [selection]);

  const updateSelectedNodePrompt = useCallback((prompt: string) => {
    if (selection?.type !== "node") return;
    setNodes((current) => current.map((node) => {
      if (node.id !== selection.id) return node;
      const nextNode = { ...node, data: { ...node.data, prompt } };
      dirtyNodeDataRef.current.set(node.id, {
        prompt: nextNode.data.prompt,
        runtimeId: nextNode.data.runtimeId,
        config: nextNode.data.config
      });
      return nextNode;
    }));
  }, [selection]);

  const showUnavailable = useCallback((action: string) => {
    setServiceNotice(`${action} will connect after workflow APIs land in the next backend task group.`);
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
    if (!response.ok) throw new Error(`workflow save failed: ${response.status}`);
    const graph = await response.json() as { readonly workflow?: { readonly id?: string } };
    return graph.workflow?.id ?? seed.id;
  }, [csrfFetch, edges, nodes, seed]);

  const saveDraft = useCallback(async () => {
    setSavingDraft(true);
    setServiceNotice(undefined);
    try {
      await persistDraft();
      setServiceNotice("Draft saved.");
    } catch (error) {
      setServiceNotice(error instanceof Error ? error.message : "Draft save failed.");
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
      if (!response.ok) throw new Error(`workflow start failed: ${response.status}`);
      const payload = await response.json() as { readonly run?: { readonly id?: string } };
      if (payload.run?.id) setVisualRunId(payload.run.id);
      setServiceNotice("Run started. Node outputs will appear as the native agents complete.");
    } catch (error) {
      setServiceNotice(error instanceof Error ? error.message : "Workflow start failed.");
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
      if (!response.ok) throw new Error(`workflow stop failed: ${response.status}`);
      setServiceNotice("Run stopped. Active node output and edge delivery have been cancelled.");
    } catch (error) {
      setServiceNotice(error instanceof Error ? error.message : "Workflow stop failed.");
    } finally {
      setStoppingRun(false);
    }
  }, [activeRun, csrfFetch]);

  return (
    <section className="ah-workflow-view" aria-label="Agent workflow canvas">
      <header className="ah-workflow-toolbar">
        <div className="min-w-0">
          <p className="ah-workflow-kicker">Workflow Canvas</p>
          <h2>{projectedWorkflow?.name ?? "Agent context handoff"}</h2>
        </div>
        <div className="ah-workflow-actions">
          <button type="button" className="ah-workflow-button" onClick={addAgentNode}>Add node</button>
          <button type="button" className="ah-workflow-button" onClick={addNote}>Add note</button>
          <button type="button" className="ah-workflow-button" onClick={deleteSelection} disabled={!selection}>Delete</button>
          <button type="button" className="ah-workflow-button ah-workflow-button-primary" onClick={() => void saveDraft()} disabled={savingDraft || startingRun || stoppingRun}>
            {savingDraft ? "Saving..." : "Save draft"}
          </button>
        </div>
      </header>

      {serviceNotice ? (
        <div className="ah-workflow-notice" role="status">
          <span>{serviceNotice}</span>
          <button type="button" onClick={() => setServiceNotice(undefined)}>Dismiss</button>
        </div>
      ) : null}

      <div className="ah-workflow-runbar" aria-label="Workflow run controls">
        <label className="ah-workflow-run-io">
          <span>A</span>
          <textarea
            aria-label="A input text"
            value={seedContext}
            onChange={(event) => setSeedContext(event.currentTarget.value)}
            placeholder="Input text"
            rows={2}
          />
        </label>
        <div className="ah-workflow-run-center">
          <div className="ah-workflow-run-summary">
            <span className={`ah-workflow-run-badge ah-workflow-status-${statusClass(activeRun?.status ?? "draft")}`}>
              {activeRun?.status ?? "draft"}
            </span>
            <span>{workflowRunSummary(activeRun)}</span>
          </div>
          <div className="ah-workflow-run-actions">
            <button type="button" className="ah-workflow-button ah-workflow-button-run" onClick={() => void startWorkflow()} disabled={startingRun || savingDraft || stoppingRun}>
              {startingRun ? "Starting..." : "Start"}
            </button>
            <button
              type="button"
              className="ah-workflow-button ah-workflow-button-stop"
              onClick={() => void stopWorkflow()}
              disabled={stoppingRun || !activeRun || (activeRun.status !== "queued" && activeRun.status !== "running")}
            >
              {stoppingRun ? "Stopping..." : "Stop"}
            </button>
          </div>
        </div>
        <label className="ah-workflow-run-io">
          <span>B</span>
          <textarea aria-label="B final output text" value={finalOutput} readOnly placeholder="Final node output" rows={2} />
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

        <aside className="ah-workflow-inspector" aria-label="Workflow inspector">
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
            onRetryEdge={() => showUnavailable("Retry edge delivery")}
          />
          <RunHistoryPanel run={activeRun} nodes={enrichedNodes} />
        </aside>
      </div>
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
        <span className="ah-workflow-node-status">{data.status ?? "draft"}</span>
      </div>
      <p className="ah-workflow-node-role">{data.roleLabel ?? (isNote ? "Note" : "Agent role")}</p>
      {!isNote ? (
        <div className="ah-workflow-node-foot">
          <span>In {data.upstreamCount}</span>
          <span>Out {data.downstreamCount}</span>
          {data.runtimeLabel ? <span>{data.runtimeLabel}</span> : null}
          {data.locked ? <span>Locked</span> : null}
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
  readonly onRetryEdge: () => void;
}) {
  if (selectedNode) {
    const nodeRun = activeRun?.nodeRuns.find((item) => item.nodeId === selectedNode.id);
    return (
      <div className="ah-workflow-inspector-content">
        <p className="ah-workflow-kicker">Selected node</p>
        <h3>{selectedNode.data.label}</h3>
        <dl className="ah-workflow-meta">
          <div><dt>Role</dt><dd>{selectedNode.data.roleLabel ?? "Agent"}</dd></div>
          <div><dt>Status</dt><dd>{selectedNode.data.status ?? "draft"}</dd></div>
          {nodeRun?.agentRunId ? <div><dt>Agent run</dt><dd>{nodeRun.agentRunId}</dd></div> : null}
          {nodeRun?.inputContexts.length ? <div className="ah-workflow-meta-context"><dt>Input</dt><dd>{nodeRun.inputContexts.map(contextLabel).join("\n")}</dd></div> : null}
          {contextTextFromRecord(nodeRun?.outputContext) ? <div className="ah-workflow-meta-context"><dt>Output</dt><dd>{contextTextFromRecord(nodeRun?.outputContext)}</dd></div> : null}
          {nodeRun?.error ? <div><dt>Error</dt><dd>{nodeRun.error}</dd></div> : null}
        </dl>
        {selectedNode.data.kind === "agent_context" ? (
          <>
            <PromptEditor value={selectedNode.data.prompt} onChange={onPromptChange} />
            <KernelSelect
              value={selectedNode.data.runtimeId ?? ""}
              currentLabel={selectedNode.data.runtimeLabel}
              runtimeOptions={runtimeOptions}
              loading={runtimeLoading}
              error={runtimeError}
              onChange={onRuntimeChange}
            />
            <NeighborList title="Upstream" nodeIds={upstream} nodes={nodes} onSelectNode={onSelectNode} />
            <NeighborList title="Downstream" nodeIds={downstream} nodes={nodes} onSelectNode={onSelectNode} />
          </>
        ) : (
          <div className="ah-workflow-empty-help">Note nodes stay on the canvas and do not execute.</div>
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
        <p className="ah-workflow-kicker">Selected edge</p>
        <h3>{source?.data.label ?? selectedEdge.source} {"->"} {target?.data.label ?? selectedEdge.target}</h3>
        <dl className="ah-workflow-meta">
          <div><dt>Delivery</dt><dd>{status}</dd></div>
          <div><dt>State</dt><dd>{stateMessage}</dd></div>
          <div><dt>Source</dt><dd>{source?.data.label ?? selectedEdge.source}</dd></div>
          <div><dt>Target</dt><dd>{target?.data.label ?? selectedEdge.target}</dd></div>
          {contextText ? <div className="ah-workflow-meta-context"><dt>Context</dt><dd>{contextText}</dd></div> : null}
          {error ? <div><dt>Error</dt><dd>{error}</dd></div> : null}
          {detailReference ? <div><dt>Detail</dt><dd>{detailReference}</dd></div> : null}
        </dl>
        {status === "failed" ? (
          <button type="button" className="ah-workflow-button ah-workflow-button-full" onClick={onRetryEdge}>Retry failed edge</button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ah-workflow-inspector-content">
      <p className="ah-workflow-kicker">Canvas</p>
      <h3>Context graph</h3>
      <dl className="ah-workflow-meta">
        <div><dt>Nodes</dt><dd>{nodes.length}</dd></div>
        <div><dt>Edges</dt><dd>{edges.length}</dd></div>
        <div><dt>Mode</dt><dd>DAG only</dd></div>
      </dl>
      <div className="ah-workflow-empty-help">
        Select a node or edge to inspect upstream and downstream context.
      </div>
    </div>
  );
}

function PromptEditor({ value, onChange }: { readonly value: string; readonly onChange: (prompt: string) => void }) {
  return (
    <label className="ah-workflow-field">
      <span>Prompt</span>
      <textarea
        className="ah-workflow-textarea"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        rows={6}
      />
    </label>
  );
}

function KernelSelect({
  value,
  currentLabel,
  runtimeOptions,
  loading,
  error,
  onChange
}: {
  readonly value: string;
  readonly currentLabel?: string | undefined;
  readonly runtimeOptions: readonly WorkflowRuntimeOption[];
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly onChange: (runtimeId: string) => void;
}) {
  const hasCurrentOption = value.length > 0 && runtimeOptions.some((runtime) => runtime.id === value);
  return (
    <div className="ah-workflow-field">
      <label htmlFor="workflow-node-kernel">Kernel</label>
      <select
        id="workflow-node-kernel"
        className="ah-workflow-select"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        disabled={loading}
      >
        <option value="">{loading ? "Loading kernels..." : "No kernel selected"}</option>
        {!hasCurrentOption && value.length > 0 ? <option value={value}>{currentLabel ?? value}</option> : null}
        {runtimeOptions.map((runtime) => (
          <option key={runtime.id} value={runtime.id}>
            {runtime.name} - {runtime.kind}
          </option>
        ))}
      </select>
      {error ? <p className="ah-workflow-field-error">{error}</p> : null}
    </div>
  );
}

function NeighborList({ title, nodeIds, nodes, onSelectNode }: { readonly title: string; readonly nodeIds: readonly string[]; readonly nodes: ReadonlyArray<Node<AgentWorkflowNodeData>>; readonly onSelectNode: (id: string) => void }) {
  return (
    <div className="ah-workflow-neighbors">
      <h4>{title}</h4>
      {nodeIds.length === 0 ? (
        <p>No {title.toLowerCase()} nodes</p>
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

function RunHistoryPanel({ run, nodes }: { readonly run?: WorkflowRunViewModel | undefined; readonly nodes: ReadonlyArray<Node<AgentWorkflowNodeData>> }) {
  const nodeRuns = run?.nodeRuns ?? [];
  const deliveries = run?.edgeDeliveries ?? [];
  return (
    <div className="ah-workflow-run-panel">
      <p className="ah-workflow-kicker">Run history</p>
      <div className="ah-workflow-run-grid">
        <div><span>Node runs</span><strong>{nodeRuns.length}</strong></div>
        <div><span>Deliveries</span><strong>{deliveries.length}</strong></div>
        <div><span>Status</span><strong>{run?.status ?? "draft"}</strong></div>
      </div>
      <div className="ah-workflow-run-list">
        {nodeRuns.length === 0 && deliveries.length === 0 ? (
          <p>No run events yet</p>
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
                <strong>{item.status}</strong>
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

function workflowDraftPayload(workflow: WorkflowViewModel, nodes: ReadonlyArray<Node<AgentWorkflowNodeData>>, edges: readonly Edge[]) {
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

function mergeDirtyNodeData(nodes: Array<Node<AgentWorkflowNodeData>>, dirty: Map<string, Pick<AgentWorkflowNodeData, "prompt" | "runtimeId" | "config">>): Array<Node<AgentWorkflowNodeData>> {
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

function reconcileDirtyNodeData(nodes: readonly WorkflowNodeViewModel[], dirty: Map<string, Pick<AgentWorkflowNodeData, "prompt" | "runtimeId" | "config">>): void {
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
  if (!run) return "No run events yet";
  const failedEdges = run.edgeDeliveries.filter((delivery) => delivery.status === "failed").length;
  const waitingNodes = run.nodeRuns.filter((nodeRun) => nodeRun.status === "waiting" || nodeRun.status === "queued").length;
  if (failedEdges > 0) return `${failedEdges} failed delivery${failedEdges === 1 ? "" : "ies"}`;
  if (waitingNodes > 0) return `${waitingNodes} node${waitingNodes === 1 ? "" : "s"} waiting`;
  return `${run.nodeRuns.length} node run${run.nodeRuns.length === 1 ? "" : "s"}, ${run.edgeDeliveries.length} edge deliver${run.edgeDeliveries.length === 1 ? "y" : "ies"}`;
}

function edgeDataString(edge: Edge | undefined, key: string): string | undefined {
  const value = edge?.data?.[key];
  return typeof value === "string" ? value : undefined;
}

function edgeStateMessage(status: string, source: string, target: string): string {
  if (status === "ready" || status === "draft") return `Ready: no context has moved from ${source} to ${target} yet.`;
  if (status === "queued" || status === "mailbox_created" || status === "transferring") return `Transferring context from ${source} to ${target}.`;
  if (status === "delivered" || status === "completed") return `Context delivery from ${source} to ${target} completed.`;
  if (status === "failed") return `Delivery from ${source} to ${target} failed.`;
  if (status === "cancelled") return `Delivery from ${source} to ${target} was stopped.`;
  if (status === "disabled" || status === "skipped") return `This edge is not participating in the current run.`;
  return `Current edge state: ${status}.`;
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
  return config;
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
    description: detected ?? runtime.command ?? runtime.kind,
    status: runtime.status ?? undefined
  };
}

function runtimeLabel(runtimeId: string, runtime: WorkflowRuntimeOption | undefined): string {
  return runtime ? runtime.name : runtimeId;
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
    name: "Agent context handoff",
    description: "Local draft until workflow APIs are connected.",
    draftVersionId: "workflow-version-local",
    createdAt,
    updatedAt: createdAt,
    versions: [],
    nodes: [
      localNode("workflow-node-a", "node-a", "A", "AgentHub native sender", "Start with the seed context and send it downstream unchanged for this MVP.", { x: 110, y: 150 }),
      localNode("workflow-node-b", "node-b", "B", "AgentHub native receiver", "Receive upstream mailbox context and show exactly what arrived.", { x: 470, y: 150 })
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

function localNote(id: string, nodeId: string, displayName: string, prompt: string, position: { readonly x: number; readonly y: number }): WorkflowNodeViewModel {
  return {
    id,
    workflowVersionId: "workflow-version-local",
    nodeId,
    kind: "note",
    displayName,
    roleLabel: "Canvas note",
    prompt,
    position,
    size: { width: 260, height: 120 },
    enabled: true,
    locked: false,
    config: {},
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
