import { useState, useEffect, useMemo } from "react";
import type { RoomViewModel, RunViewModel } from "../types.ts";
import { useProjector } from "../hooks/useProjector.ts";
import { useRawStream } from "../hooks/useRawStream.ts";
import { TerminalCard, type TerminalLine } from "./cards/TerminalCard.tsx";
import { useCsrfFetch } from "../hooks/useSdk.ts";

type RunDetailTab = "transcript" | "tools" | "context" | "permissions" | "artifacts" | "raw" | "cost";

type RunDetailProps = {
  readonly roomId: string;
  readonly runId: string;
  readonly onClose: () => void;
};

type RunDetailTabDefinition = {
  readonly key: RunDetailTab;
  readonly label: string;
  readonly count?: number;
};

export function RunDetail({ roomId, runId, onClose }: RunDetailProps) {
  const projector = useProjector("detail", roomId, runId);
  const room = projector.rooms.get(roomId);
  const run = room?.runs.find((r) => r.id === runId);
  const [activeTab, setActiveTab] = useState<RunDetailTab>("transcript");

  const messages = room?.messages.filter((m) => m.runId === runId) ?? [];
  const toolCount = messages.flatMap((m) => m.parts.filter((p) => p.type === "tool_call" || p.type === "tool_result")).length;
  const contextCount = room?.contextItems.filter((c) => c.runId === runId).length ?? 0;
  const permissionCount = room?.pendingPermissions.filter((p) => p.runId === runId).length ?? 0;
  const artifactCount = messages.flatMap((m) => m.parts.filter((p) => p.type === "card" && (p.card.type === "diff" || p.card.type === "preview"))).length;
  const duration = formatDuration(run);
  const tabs: RunDetailTabDefinition[] = [
    { key: "transcript", label: "Transcript", count: messages.length },
    { key: "tools", label: "Tools", count: toolCount },
    { key: "context", label: "Context", count: contextCount },
    { key: "permissions", label: "Permissions", count: permissionCount },
    { key: "artifacts", label: "Artifacts", count: artifactCount },
    { key: "raw", label: "Raw Stream" },
    { key: "cost", label: "Cost" }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--ah-bg-primary)" }}>
      <div
        style={{
          padding: "var(--ah-space-4) var(--ah-space-5)",
          borderBottom: "1px solid var(--ah-border)",
          background: "linear-gradient(180deg, var(--ah-bg-elevated) 0%, var(--ah-bg-primary) 100%)",
          flexShrink: 0
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--ah-space-4)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", textTransform: "uppercase", letterSpacing: "var(--ah-letter-spacing-wide)", fontWeight: 800, marginBottom: "var(--ah-space-1)" }}>
              {room?.title ?? "Room"} / right-side run workbench
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)", minWidth: 0 }}>
              <div style={{ fontFamily: "var(--ah-font-heading)", fontSize: "var(--ah-font-size-xl)", fontWeight: 800, color: "var(--ah-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Run Detail
              </div>
              {run?.status ? <StatusBadge status={run.status} /> : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)", flexWrap: "wrap", marginTop: "var(--ah-space-2)", fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)" }}>
              <span>{run?.agentName ?? "Unknown agent"}</span>
              <span aria-hidden="true">·</span>
              <span style={{ fontFamily: "var(--ah-font-mono)" }}>{runId}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: "var(--ah-space-7)",
              height: "var(--ah-space-7)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--ah-bg-elevated)",
              border: "1px solid var(--ah-border)",
              borderRadius: "var(--ah-radius-full)",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-lg)",
              color: "var(--ah-text-muted)",
              boxShadow: "var(--ah-shadow-sm)"
            }}
            aria-label="Close run detail"
          >
            x
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "var(--ah-space-2)", marginTop: "var(--ah-space-4)" }}>
          <RunMetric label="Messages" value={messages.length} tone={messages.length > 0 ? "accent" : "neutral"} />
          <RunMetric label="Tools" value={toolCount} tone={toolCount > 0 ? "accent" : "neutral"} />
          <RunMetric label="Artifacts" value={artifactCount} tone={artifactCount > 0 ? "success" : "neutral"} />
          <RunMetric label="Duration" value={duration} tone="neutral" />
        </div>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--ah-border)", overflowX: "auto", overflowY: "hidden", background: "var(--ah-bg-elevated)", flexShrink: 0 }} data-testid="run-detail-tabs" role="tablist" aria-label="Run detail tabs">
        {tabs.map((tab) => {
          const selected = activeTab === tab.key;
          const label = `${tab.label}${tab.count && tab.count > 0 ? ` (${tab.count})` : ""}`;
          return (
            <button
              key={tab.key}
              type="button"
              data-testid={`run-detail-tab-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "var(--ah-space-3) var(--ah-space-4)",
                border: "none",
                borderBottom: selected ? "2px solid var(--ah-accent)" : "2px solid transparent",
                background: selected ? "var(--ah-bg-primary)" : "transparent",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-sm)",
                fontWeight: selected ? 800 : 600,
                color: selected ? "var(--ah-accent)" : "var(--ah-text-muted)",
                whiteSpace: "nowrap",
                transition: "background var(--ah-transition-fast), color var(--ah-transition-fast), border-color var(--ah-transition-fast)"
              }}
              role="tab"
              aria-selected={selected}
              aria-label={`${label} tab`}
            >
              {tab.label}
              {tab.count && tab.count > 0 ? <span style={{ marginLeft: "var(--ah-space-2)", fontSize: "var(--ah-font-size-xs)", color: "inherit" }}>{tab.count}</span> : null}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "var(--ah-space-4) var(--ah-space-5)" }}>
        {activeTab === "transcript" && <TranscriptTab room={room} runId={runId} />}
        {activeTab === "tools" && <ToolsTab room={room} runId={runId} />}
        {activeTab === "context" && <ContextTab room={room} runId={runId} />}
        {activeTab === "permissions" && <PermissionsTab room={room} runId={runId} />}
        {activeTab === "artifacts" && <ArtifactsTab room={room} runId={runId} />}
        {activeTab === "raw" && <RawStreamTab roomId={roomId} runId={runId} />}
        {activeTab === "cost" && <CostTab run={run} room={room} />}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { readonly status: string }) {
  const tone = status === "completed" ? "success" : status === "failed" ? "danger" : status === "waiting_permission" ? "warning" : status === "running" || status === "starting" ? "accent" : "muted";
  return <Pill tone={tone}>Status: {status}</Pill>;
}

function TranscriptTab({ room, runId }: { readonly room: RoomViewModel | undefined; readonly runId: string }) {
  const messages = room?.messages.filter((m) => m.runId === runId) ?? [];
  const hasPreCompact = room?.contextItems.some((c) => c.runId === runId && c.status === "draft" && c.title.toLowerCase().includes("summary"));

  return (
    <PanelStack title="Transcript timeline" caption="Run-scoped messages in chronological order.">
      {hasPreCompact && (
        <Notice tone="accent" role="status">
          <strong>PreCompact Summary:</strong> This run triggered a context compression. Check the Context tab for the summary draft.
        </Notice>
      )}
      {messages.length === 0 && <EmptyState title="No transcript entries" body="Run messages will appear here as the projector receives them." />}
      {messages.map((m) => (
        <SurfaceCard key={m.id}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--ah-space-3)", marginBottom: "var(--ah-space-2)" }}>
            <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 800, color: "var(--ah-text-secondary)" }}>
              {m.senderName} <span style={{ fontWeight: 500, color: "var(--ah-text-muted)" }}>{m.role}</span>
            </div>
            <span style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", fontFamily: "var(--ah-font-mono)" }}>{m.status}</span>
          </div>
          <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-primary)", whiteSpace: "pre-wrap", lineHeight: "var(--ah-line-height-normal)" }}>{m.text}</div>
        </SurfaceCard>
      ))}
    </PanelStack>
  );
}

function ToolsTab({ room, runId }: { readonly room: RoomViewModel | undefined; readonly runId: string }) {
  const toolParts = room?.messages.filter((m) => m.runId === runId).flatMap((m) => m.parts.filter((p) => p.type === "tool_call" || p.type === "tool_result")) ?? [];
  const subagentRuns = room?.runs.filter((r) => r.id !== runId && room.messages.some((m) => m.runId === runId && m.parts.some((p) => p.type === "tool_call" && p.name === "subagent"))) ?? [];

  return (
    <PanelStack title="Tool execution" caption="Tool calls, results, and subagent runs produced by this run.">
      {toolParts.length === 0 && subagentRuns.length === 0 && <EmptyState title="No tool calls" body="Tool inputs and outputs will populate this execution ledger." />}
      {toolParts.map((part, idx) => (
        <SurfaceCard key={idx}>
          {part.type === "tool_call" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--ah-space-2)" }}>
                <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 800, color: "var(--ah-accent)" }}>{part.name}</div>
                <Pill tone="accent">Call</Pill>
              </div>
              <WorkbenchPre>{JSON.stringify(part.input, null, 2)}</WorkbenchPre>
            </>
          )}
          {part.type === "tool_result" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--ah-space-2)" }}>
                <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 800, color: part.ok ? "var(--ah-success)" : "var(--ah-danger)" }}>Result</div>
                <Pill tone={part.ok ? "success" : "danger"}>{part.ok ? "OK" : "Error"}</Pill>
              </div>
              <WorkbenchPre>{JSON.stringify(part.output, null, 2)}</WorkbenchPre>
            </>
          )}
        </SurfaceCard>
      ))}
      {subagentRuns.map((subrun) => (
        <SurfaceCard key={subrun.id} accent="accent">
          <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 800, color: "var(--ah-accent-text)" }}>Subagent: {subrun.agentName}</div>
          <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)" }}>
            Status: {subrun.status}
            {subrun.cost ? <span style={{ marginLeft: "var(--ah-space-2)" }}>Cost: ${subrun.cost.costUsd.toFixed(4)} · {subrun.cost.inputTokens + subrun.cost.outputTokens} tokens</span> : null}
          </div>
          {subrun.startedAt && subrun.endedAt ? <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)" }}>Duration: {((subrun.endedAt - subrun.startedAt) / 1000).toFixed(1)}s</div> : null}
        </SurfaceCard>
      ))}
    </PanelStack>
  );
}

function ContextTab({ room, runId }: { readonly room: RoomViewModel | undefined; readonly runId: string }) {
  const items = room?.contextItems.filter((c) => c.runId === runId) ?? [];
  const preCompactItems = items.filter((c) => c.status === "draft" && c.title.toLowerCase().includes("summary"));

  return (
    <PanelStack title="Run context" caption="Context snapshots and summary drafts created during this run.">
      {preCompactItems.length > 0 && (
        <Notice tone="warning" role="status">
          <strong>PreCompact Triggered:</strong> {preCompactItems.length} summary draft(s) generated during this run.
        </Notice>
      )}
      {items.length === 0 && <EmptyState title="No context snapshot" body="This run has not produced context ledger entries." />}
      {items.map((item) => (
        <SurfaceCard key={item.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--ah-space-2)", alignItems: "flex-start" }}>
            <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 800, color: "var(--ah-text-primary)" }}>{item.title}</div>
            <Pill tone={item.status === "draft" ? "warning" : item.status === "confirmed" ? "success" : "muted"}>{item.status}</Pill>
          </div>
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-2)", whiteSpace: "pre-wrap", lineHeight: "var(--ah-line-height-normal)" }}>{item.content}</div>
          {item.status === "draft" ? <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-warning)", marginTop: "var(--ah-space-2)", fontWeight: 700 }}>Draft - awaiting confirmation</div> : null}
        </SurfaceCard>
      ))}
    </PanelStack>
  );
}

function PermissionsTab({ room, runId }: { readonly room: RoomViewModel | undefined; readonly runId: string }) {
  const perms = room?.pendingPermissions.filter((p) => p.runId === runId) ?? [];
  return (
    <PanelStack title="Permission gates" caption="Endpoint contracts are unchanged; this is a run-scoped readout.">
      {perms.length === 0 && <EmptyState title="No permission requests" body="Pending, allowed, and denied requests will appear here." />}
      {perms.map((p) => (
        <SurfaceCard key={p.id} accent="warning">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--ah-space-2)", alignItems: "flex-start" }}>
            <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 800, color: "var(--ah-text-primary)" }}>{p.resource.type}</div>
            <Pill tone={p.status === "allowed" ? "success" : p.status === "denied" ? "danger" : "warning"}>{p.status}</Pill>
          </div>
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-2)" }}>{p.reason ?? "No reason"}</div>
          <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-2)", fontFamily: "var(--ah-font-mono)" }}>{p.agentName}</div>
        </SurfaceCard>
      ))}
    </PanelStack>
  );
}

function ArtifactsTab({ room, runId }: { readonly room: RoomViewModel | undefined; readonly runId: string }) {
  const [terminalArtifacts, setTerminalArtifacts] = useState<readonly TerminalArtifact[]>([]);
  const artifactParts = room?.messages.filter((m) => m.runId === runId).flatMap((m) => m.parts.filter((p) => p.type === "card" && (p.card.type === "diff" || p.card.type === "preview"))) ?? [];

  useEffect(() => {
    let cancelled = false;
    fetch(`/artifacts?roomId=${encodeURIComponent(room?.id ?? "")}`)
      .then(async (res) => res.ok ? await res.json() as { readonly artifacts?: readonly TerminalArtifact[] } : { artifacts: [] })
      .then((payload) => {
        if (!cancelled) setTerminalArtifacts((payload.artifacts ?? []).filter((artifact) => artifact.runId === runId && artifact.type === "terminal"));
      })
      .catch(() => {
        if (!cancelled) setTerminalArtifacts([]);
      });
    return () => { cancelled = true; };
  }, [room?.id, runId]);

  const terminalCards = useMemo(() => terminalArtifacts.map((artifact) => ({ artifact, lines: terminalLinesFromMetadata(artifact.metadata), exitCode: numberField(artifact.metadata.exitCode) })), [terminalArtifacts]);

  return (
    <PanelStack title="Artifacts" caption="Diff, preview, and terminal artifacts produced by this run.">
      {artifactParts.length === 0 && terminalCards.length === 0 && <EmptyState title="No artifacts" body="Generated artifacts will appear here without changing artifact endpoints." />}
      {artifactParts.map((part, idx) => {
        if (part.type !== "card") return null;
        if (part.card.type === "diff") {
          const card = part.card;
          return (
            <SurfaceCard key={idx} accent="success">
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--ah-space-2)", alignItems: "flex-start" }}>
                <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 800, color: "var(--ah-text-primary)" }}>Diff Artifact</div>
                <Pill tone="success">{card.applyStatus}</Pill>
              </div>
              <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-2)" }}>{card.files.length} files</div>
            </SurfaceCard>
          );
        }
        if (part.card.type === "preview") {
          const card = part.card;
          return (
            <SurfaceCard key={idx}>
              <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 800, color: "var(--ah-text-primary)" }}>Preview</div>
              <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-2)", overflowWrap: "anywhere" }}>{card.kind}: {card.url}</div>
            </SurfaceCard>
          );
        }
        return null;
      })}
      {terminalCards.map(({ artifact, lines, exitCode }) => (
        <div key={artifact.id} style={{ display: "flex", flexDirection: "column", gap: "var(--ah-space-2)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--ah-space-2)" }}>
            <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 800, color: "var(--ah-text-muted)", textTransform: "uppercase", letterSpacing: "var(--ah-letter-spacing-wide)" }}>{artifact.title}</div>
            <Pill tone={exitCode === 0 ? "success" : exitCode === undefined ? "muted" : "danger"}>{exitCode === undefined ? "terminal" : `exit ${exitCode}`}</Pill>
          </div>
          <TerminalCard lines={lines} exitCode={exitCode} collapsed={false} />
        </div>
      ))}
    </PanelStack>
  );
}

type TerminalArtifact = {
  readonly id: string;
  readonly runId?: string;
  readonly type: string;
  readonly title: string;
  readonly metadata: Record<string, unknown>;
};

function terminalLinesFromMetadata(metadata: Record<string, unknown>): TerminalLine[] {
  return [
    ...previewLines(metadata.stdout ?? metadata.stdoutPreview, "stdout"),
    ...previewLines(metadata.stderr ?? metadata.stderrPreview, "stderr")
  ];
}

function previewLines(value: unknown, stream: TerminalLine["stream"]): TerminalLine[] {
  return typeof value === "string" && value.length > 0 ? value.split(/\r?\n/u).map((text) => ({ text, stream })) : [];
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function RawStreamTab({ roomId, runId }: { readonly roomId: string; readonly runId: string }) {
  const rawStream = useRawStream(roomId, runId);
  const hasLines = rawStream.lines.length > 0;

  return (
    <PanelStack title="Raw stream" caption={`Adapter stdout/stderr for run ${runId}.`}>
      <div
        style={{
          padding: "var(--ah-space-3)",
          borderRadius: "var(--ah-radius-lg)",
          background: "var(--ah-bg-inverse)",
          color: "var(--ah-text-inverse)",
          fontFamily: "var(--ah-font-mono)",
          fontSize: "var(--ah-font-size-sm)",
          minHeight: 240,
          whiteSpace: "pre-wrap",
          border: "1px solid var(--ah-border-strong)",
          boxShadow: "var(--ah-shadow-sm)"
        }}
        data-testid="raw-stream-content"
      >
        {!hasLines && <div style={{ color: "var(--ah-text-muted)" }}>{rawStream.status === "connected" ? "No raw output has arrived yet." : "Raw stream content requires admin scope or debug mode."}</div>}
        {hasLines && rawStream.lines.map((line, idx) => <div key={idx} style={{ color: line.stream === "stderr" ? "var(--ah-danger)" : "var(--ah-text-inverse)" }}>{line.text}</div>)}
      </div>
    </PanelStack>
  );
}

function CostTab({ run, room }: { readonly run: RunViewModel | undefined; readonly room: RoomViewModel | undefined }) {
  const [comparisonData, setComparisonData] = useState<{ avgCostUsd: number; count: number } | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const csrfFetch = useCsrfFetch();

  useEffect(() => {
    if (!run?.agentId || !room) return;
    setLoading(true);
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();
    csrfFetch(`/workspaces/default-workspace/cost-summary?groupBy=agent&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { groups?: readonly { key: string; totalCostUsd: number; runCount: number }[] };
        const group = data.groups?.find((g) => g.key === run.agentId);
        if (group && group.runCount > 1) setComparisonData({ avgCostUsd: group.totalCostUsd / group.runCount, count: group.runCount });
      })
      .catch(() => {
        // ignore
      })
      .finally(() => setLoading(false));
  }, [run?.agentId, room, csrfFetch]);

  if (!run?.cost) return <EmptyState title="No cost data" body="Cost telemetry will appear when the run reports token usage." />;

  const costRows = [
    ["Input Tokens", run.cost.inputTokens.toLocaleString()],
    ["Output Tokens", run.cost.outputTokens.toLocaleString()],
    ["Cached Tokens", run.cost.cachedTokens.toLocaleString()],
    ["Cost USD", `$${run.cost.costUsd.toFixed(4)}`],
    ["Model", run.cost.modelId]
  ] as const;

  return (
    <PanelStack title="Cost intelligence" caption="Run-level token and model spend telemetry.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--ah-space-2)" }}>
        {costRows.map(([label, value]) => <RunMetric key={label} label={label} value={value} tone={label === "Cost USD" ? "success" : "neutral"} />)}
      </div>
      {loading && <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-2)" }}>Loading comparison...</div>}
      {comparisonData && (
        <SurfaceCard accent="accent">
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-accent-text)", fontWeight: 800 }}>Comparison</div>
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-secondary)", marginTop: "var(--ah-space-1)" }}>Average cost for {run.agentName} over last 7 days ({comparisonData.count} runs):</div>
          <div style={{ fontFamily: "var(--ah-font-heading)", fontSize: "var(--ah-font-size-lg)", fontWeight: 800, color: "var(--ah-accent-text)", marginTop: "var(--ah-space-1)" }}>${comparisonData.avgCostUsd.toFixed(4)}</div>
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)" }}>{run.cost.costUsd > comparisonData.avgCostUsd ? "Above" : "Below"} average by {Math.abs(((run.cost.costUsd - comparisonData.avgCostUsd) / comparisonData.avgCostUsd) * 100).toFixed(1)}%</div>
        </SurfaceCard>
      )}
    </PanelStack>
  );
}

function PanelStack({ title, caption, children }: { readonly title: string; readonly caption: string; readonly children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--ah-space-3)" }}>
      <div>
        <div style={{ fontFamily: "var(--ah-font-heading)", fontSize: "var(--ah-font-size-base)", fontWeight: 800, color: "var(--ah-text-primary)" }}>{title}</div>
        <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)", lineHeight: "var(--ah-line-height-normal)" }}>{caption}</div>
      </div>
      {children}
    </div>
  );
}

function RunMetric({ label, value, tone }: { readonly label: string; readonly value: number | string; readonly tone: "accent" | "success" | "neutral" }) {
  const color = tone === "accent" ? "var(--ah-accent)" : tone === "success" ? "var(--ah-success)" : "var(--ah-text-primary)";
  return (
    <div style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-lg)", border: "1px solid var(--ah-border)", background: "var(--ah-bg-elevated)", boxShadow: "var(--ah-shadow-sm)", minWidth: 0 }}>
      <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", textTransform: "uppercase", letterSpacing: "var(--ah-letter-spacing-wide)", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontFamily: "var(--ah-font-heading)", fontSize: "var(--ah-font-size-lg)", fontWeight: 800, color, lineHeight: "var(--ah-line-height-tight)", marginTop: "var(--ah-space-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function SurfaceCard({ children, accent }: { readonly children: React.ReactNode; readonly accent?: "accent" | "success" | "warning" }) {
  const border = accent === "accent" ? "var(--ah-accent)" : accent === "success" ? "var(--ah-success)" : accent === "warning" ? "var(--ah-warning)" : "var(--ah-border)";
  return <div style={{ padding: "var(--ah-space-3) var(--ah-space-4)", borderRadius: "var(--ah-radius-lg)", background: "var(--ah-bg-elevated)", border: `1px solid ${border}`, boxShadow: "var(--ah-shadow-sm)" }}>{children}</div>;
}

function Notice({ tone, role, children }: { readonly tone: "accent" | "warning"; readonly role: "status"; readonly children: React.ReactNode }) {
  return (
    <div style={{ background: tone === "accent" ? "var(--ah-accent-light)" : "var(--ah-warning-light)", border: `1px solid ${tone === "accent" ? "var(--ah-accent)" : "var(--ah-warning)"}`, borderRadius: "var(--ah-radius-lg)", padding: "var(--ah-space-3) var(--ah-space-4)", fontSize: "var(--ah-font-size-sm)", color: tone === "accent" ? "var(--ah-accent-text)" : "var(--ah-text-warning)" }} role={role} aria-live="polite">
      {children}
    </div>
  );
}

function Pill({ tone, children }: { readonly tone: "accent" | "success" | "warning" | "danger" | "muted"; readonly children: React.ReactNode }) {
  const styles = {
    accent: { background: "var(--ah-accent-light)", color: "var(--ah-accent-text)", border: "var(--ah-accent)" },
    success: { background: "var(--ah-success-light)", color: "var(--ah-text-success)", border: "var(--ah-success)" },
    warning: { background: "var(--ah-warning-light)", color: "var(--ah-text-warning)", border: "var(--ah-warning)" },
    danger: { background: "var(--ah-danger-light)", color: "var(--ah-text-danger)", border: "var(--ah-danger)" },
    muted: { background: "var(--ah-bg-secondary)", color: "var(--ah-text-muted)", border: "var(--ah-border)" }
  }[tone];

  return <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "var(--ah-space-1) var(--ah-space-2)", borderRadius: "var(--ah-radius-full)", border: `1px solid ${styles.border}`, background: styles.background, color: styles.color, fontSize: "var(--ah-font-size-xs)", fontWeight: 800, whiteSpace: "nowrap" }}>{children}</span>;
}

function WorkbenchPre({ children }: { readonly children: string }) {
  return <pre style={{ fontSize: "var(--ah-font-size-xs)", marginTop: "var(--ah-space-2)", overflow: "auto", padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-primary)", border: "1px solid var(--ah-border)", color: "var(--ah-text-secondary)", lineHeight: "var(--ah-line-height-normal)", maxHeight: 320 }}>{children}</pre>;
}

function EmptyState({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div style={{ padding: "var(--ah-space-6)", borderRadius: "var(--ah-radius-lg)", border: "1px dashed var(--ah-border-strong)", background: "var(--ah-bg-elevated)", textAlign: "center" }}>
      <div style={{ fontFamily: "var(--ah-font-heading)", fontSize: "var(--ah-font-size-sm)", fontWeight: 800, color: "var(--ah-text-primary)" }}>{title}</div>
      <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-2)", lineHeight: "var(--ah-line-height-normal)" }}>{body}</div>
    </div>
  );
}

function formatDuration(run: RunViewModel | undefined): string {
  if (!run?.startedAt) return "Pending";
  const end = run.endedAt ?? Date.now();
  return `${Math.max(0, (end - run.startedAt) / 1000).toFixed(1)}s`;
}
