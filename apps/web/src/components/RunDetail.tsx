import { useState, useEffect, useMemo } from "react";
import { useProjector } from "../hooks/useProjector.ts";
import { useRawStream } from "../hooks/useRawStream.ts";
import { TerminalCard, type TerminalLine } from "./cards/TerminalCard.tsx";
import { useCsrfFetch } from "../hooks/useSdk.ts";

type RunDetailProps = {
  readonly roomId: string;
  readonly runId: string;
  readonly onClose: () => void;
};

export function RunDetail({ roomId, runId, onClose }: RunDetailProps) {
  const projector = useProjector("detail", roomId, runId);
  const room = projector.rooms.get(roomId);
  const run = room?.runs.find((r) => r.id === runId);
  const [activeTab, setActiveTab] = useState<"transcript" | "tools" | "context" | "permissions" | "artifacts" | "raw" | "cost">("transcript");

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: "transcript", label: "Transcript" },
    { key: "tools", label: "Tools" },
    { key: "context", label: "Context" },
    { key: "permissions", label: "Permissions" },
    { key: "artifacts", label: "Artifacts" },
    { key: "raw", label: "Raw Stream" },
    { key: "cost", label: "Cost" }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "var(--ah-space-3) var(--ah-space-4)",
          borderBottom: "1px solid var(--ah-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--ah-bg-elevated)"
        }}
      >
        <div>
          <div style={{ fontSize: "var(--ah-font-size-base)", fontWeight: 600, color: "var(--ah-text-primary)" }}>Run Detail</div>
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: 2 }}>
            {run?.agentName ?? "Unknown"} {run?.status && <StatusBadge status={run.status} />}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "var(--ah-font-size-lg)",
            color: "var(--ah-text-muted)",
            padding: "var(--ah-space-1)"
          }}
          aria-label="Close run detail"
        >
          x
        </button>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--ah-border)", overflow: "auto" }} data-testid="run-detail-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            data-testid={`run-detail-tab-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "var(--ah-space-3) var(--ah-space-4)",
              border: "none",
              borderBottom: activeTab === tab.key ? "2px solid var(--ah-accent)" : "2px solid transparent",
              background: "transparent",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-sm)",
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? "var(--ah-accent)" : "var(--ah-text-muted)",
              whiteSpace: "nowrap"
            }}
            role="tab"
            aria-selected={activeTab === tab.key}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "var(--ah-space-4)" }}>
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
  const colors: Record<string, string> = {
    queued: "var(--ah-text-muted)",
    starting: "var(--ah-accent)",
    running: "var(--ah-accent)",
    waiting_permission: "var(--ah-warning)",
    completed: "var(--ah-success)",
    failed: "var(--ah-danger)",
    cancelled: "var(--ah-text-muted)"
  };
  return (
    <span
      style={{
        fontSize: "var(--ah-font-size-xs)",
        fontWeight: 600,
        color: "var(--ah-text-inverse)",
        background: colors[status] ?? "var(--ah-text-muted)",
        padding: "2px var(--ah-space-2)",
        borderRadius: "var(--ah-radius-full)",
        marginLeft: "var(--ah-space-2)"
      }}
      aria-label={`Status: ${status}`}
    >
      {status}
    </span>
  );
}

function TranscriptTab({ room, runId }: { readonly room: import("../types.ts").RoomViewModel | undefined; readonly runId: string }) {
  const messages = room?.messages.filter((m) => m.runId === runId) ?? [];
  const hasPreCompact = room?.contextItems.some((c) => c.runId === runId && c.status === "draft" && c.title.toLowerCase().includes("summary"));

  return (
    <div>
      {hasPreCompact && (
        <div
          style={{
            background: "var(--ah-accent-light)",
            border: "1px solid var(--ah-accent)",
            borderRadius: "var(--ah-radius-lg)",
            padding: "var(--ah-space-3) var(--ah-space-4)",
            marginBottom: "var(--ah-space-3)",
            fontSize: "var(--ah-font-size-sm)",
            color: "var(--ah-accent-text)"
          }}
          role="status"
          aria-live="polite"
        >
          <strong>PreCompact Summary:</strong> This run triggered a context compression. Check the Context tab for the summary draft.
        </div>
      )}
      {messages.length === 0 && <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)" }}>No transcript entries</div>}
      {messages.map((m) => (
        <div key={m.id} style={{ padding: "var(--ah-space-3) 0", borderBottom: "1px solid var(--ah-border-light)" }}>
          <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-text-secondary)" }}>
            {m.senderName} <span style={{ fontWeight: 400, color: "var(--ah-text-muted)" }}>{m.role}</span>
          </div>
          <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-primary)", marginTop: "var(--ah-space-1)", whiteSpace: "pre-wrap" }}>{m.text}</div>
        </div>
      ))}
    </div>
  );
}

function ToolsTab({ room, runId }: { readonly room: import("../types.ts").RoomViewModel | undefined; readonly runId: string }) {
  const toolParts =
    room?.messages
      .filter((m) => m.runId === runId)
      .flatMap((m) => m.parts.filter((p) => p.type === "tool_call" || p.type === "tool_result")) ?? [];

  const subagentRuns = room?.runs.filter((r) => r.id !== runId && room.messages.some((m) => m.runId === runId && m.parts.some((p) => p.type === "tool_call" && p.name === "subagent"))) ?? [];

  return (
    <div>
      {toolParts.length === 0 && subagentRuns.length === 0 && <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)" }}>No tool calls</div>}
      {toolParts.map((part, idx) => (
        <div key={idx} style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-elevated)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-2)" }}>
          {part.type === "tool_call" && (
            <>
              <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-accent)" }}>{part.name}</div>
              <pre style={{ fontSize: "var(--ah-font-size-xs)", marginTop: "var(--ah-space-1)", overflow: "auto" }}>{JSON.stringify(part.input, null, 2)}</pre>
            </>
          )}
          {part.type === "tool_result" && (
            <>
              <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: part.ok ? "var(--ah-success)" : "var(--ah-danger)" }}>Result</div>
              <pre style={{ fontSize: "var(--ah-font-size-xs)", marginTop: "var(--ah-space-1)", overflow: "auto" }}>{JSON.stringify(part.output, null, 2)}</pre>
            </>
          )}
        </div>
      ))}
      {subagentRuns.map((subrun) => (
        <div key={subrun.id} style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-accent-light)", border: "1px solid var(--ah-accent)", marginBottom: "var(--ah-space-2)" }}>
          <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-accent-text)" }}>Subagent: {subrun.agentName}</div>
          <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)" }}>
            Status: {subrun.status}
            {subrun.cost && (
              <span style={{ marginLeft: "var(--ah-space-2)" }}>
                Cost: ${subrun.cost.costUsd.toFixed(4)} · {subrun.cost.inputTokens + subrun.cost.outputTokens} tokens
              </span>
            )}
          </div>
          {subrun.startedAt && subrun.endedAt && (
            <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: 2 }}>
              Duration: {((subrun.endedAt - subrun.startedAt) / 1000).toFixed(1)}s
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ContextTab({ room, runId }: { readonly room: import("../types.ts").RoomViewModel | undefined; readonly runId: string }) {
  const items = room?.contextItems.filter((c) => c.runId === runId) ?? [];
  const preCompactItems = items.filter((c) => c.status === "draft" && c.title.toLowerCase().includes("summary"));

  return (
    <div>
      {preCompactItems.length > 0 && (
        <div
          style={{
            background: "var(--ah-warning-light)",
            border: "1px solid var(--ah-warning)",
            borderRadius: "var(--ah-radius-lg)",
            padding: "var(--ah-space-3) var(--ah-space-4)",
            marginBottom: "var(--ah-space-3)",
            fontSize: "var(--ah-font-size-sm)",
            color: "var(--ah-text-warning)"
          }}
          role="status"
          aria-live="polite"
        >
          <strong>PreCompact Triggered:</strong> {preCompactItems.length} summary draft(s) generated during this run.
        </div>
      )}
      {items.length === 0 && <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)" }}>No context snapshot</div>}
      {items.map((item) => (
        <div key={item.id} style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-elevated)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-2)" }}>
          <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-text-primary)" }}>{item.title}</div>
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)", whiteSpace: "pre-wrap" }}>{item.content}</div>
          {item.status === "draft" && (
            <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-warning)", marginTop: "var(--ah-space-1)", fontWeight: 500 }}>Draft - awaiting confirmation</div>
          )}
        </div>
      ))}
    </div>
  );
}

function PermissionsTab({ room, runId }: { readonly room: import("../types.ts").RoomViewModel | undefined; readonly runId: string }) {
  const perms = room?.pendingPermissions.filter((p) => p.runId === runId) ?? [];
  return (
    <div>
      {perms.length === 0 && <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)" }}>No permission requests</div>}
      {perms.map((p) => (
        <div key={p.id} style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-elevated)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-2)" }}>
          <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-text-primary)" }}>{p.resource.type}</div>
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)" }}>{p.reason ?? "No reason"}</div>
          <div style={{ fontSize: "var(--ah-font-size-xs)", color: p.status === "allowed" ? "var(--ah-success)" : p.status === "denied" ? "var(--ah-danger)" : "var(--ah-warning)", marginTop: "var(--ah-space-1)", fontWeight: 600 }}>
            {p.status}
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtifactsTab({ room, runId }: { readonly room: import("../types.ts").RoomViewModel | undefined; readonly runId: string }) {
  const [terminalArtifacts, setTerminalArtifacts] = useState<readonly TerminalArtifact[]>([]);
  const artifactParts =
    room?.messages
      .filter((m) => m.runId === runId)
      .flatMap((m) => m.parts.filter((p) => p.type === "card" && (p.card.type === "diff" || p.card.type === "preview"))) ?? [];

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
    <div>
      {artifactParts.length === 0 && terminalCards.length === 0 && <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)" }}>No artifacts</div>}
      {artifactParts.map((part, idx) => {
        if (part.type !== "card") return null;
        if (part.card.type === "diff") {
          const card = part.card;
          return (
            <div key={idx} style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-elevated)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-2)" }}>
              <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-text-primary)" }}>Diff Artifact</div>
              <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)" }}>Status: {card.applyStatus}</div>
              <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: 2 }}>{card.files.length} files</div>
            </div>
          );
        }
        if (part.card.type === "preview") {
          const card = part.card;
          return (
            <div key={idx} style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-elevated)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-2)" }}>
              <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-text-primary)" }}>Preview</div>
              <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)" }}>{card.kind}: {card.url}</div>
            </div>
          );
        }
        return null;
      })}
      {terminalCards.map(({ artifact, lines, exitCode }) => (
        <div key={artifact.id} style={{ marginTop: "var(--ah-space-3)" }}>
          <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-text-muted)", marginBottom: "var(--ah-space-2)", textTransform: "uppercase" }}>{artifact.title}</div>
          <TerminalCard lines={lines} exitCode={exitCode} collapsed={false} />
        </div>
      ))}
    </div>
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
    <div>
      <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)", marginBottom: "var(--ah-space-2)" }}>Raw adapter stdout/stderr for run {runId}</div>
      <div
        style={{
          padding: "var(--ah-space-3)",
          borderRadius: "var(--ah-radius-md)",
          background: "var(--ah-bg-inverse)",
          color: "var(--ah-text-inverse)",
          fontFamily: "monospace",
          fontSize: "var(--ah-font-size-sm)",
          minHeight: 200,
          whiteSpace: "pre-wrap"
        }}
        data-testid="raw-stream-content"
      >
        {!hasLines && (
          <div style={{ color: "var(--ah-text-muted)" }}>
            {rawStream.status === "connected"
              ? "No raw output has arrived yet."
              : "Raw stream content requires admin scope or debug mode."}
          </div>
        )}
        {hasLines &&
          rawStream.lines.map((line, idx) => (
            <div
              key={idx}
              style={{
                color: line.stream === "stderr" ? "var(--ah-danger)" : "var(--ah-text-inverse)"
              }}
            >
              {line.text}
            </div>
          ))}
      </div>
    </div>
  );
}

function CostTab({ run, room }: { readonly run: import("../types.ts").RunViewModel | undefined; readonly room: import("../types.ts").RoomViewModel | undefined }) {
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
        if (group && group.runCount > 1) {
          setComparisonData({ avgCostUsd: group.totalCostUsd / group.runCount, count: group.runCount });
        }
      })
      .catch(() => {
        // ignore
      })
      .finally(() => setLoading(false));
  }, [run?.agentId, room, csrfFetch]);

  if (!run?.cost) {
    return <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)" }}>No cost data</div>;
  }

  return (
    <div>
      <div style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-elevated)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-2)" }}>
        <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)" }}>Input Tokens</div>
        <div style={{ fontSize: "var(--ah-font-size-base)", fontWeight: 600, color: "var(--ah-text-primary)" }}>{run.cost.inputTokens}</div>
      </div>
      <div style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-elevated)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-2)" }}>
        <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)" }}>Output Tokens</div>
        <div style={{ fontSize: "var(--ah-font-size-base)", fontWeight: 600, color: "var(--ah-text-primary)" }}>{run.cost.outputTokens}</div>
      </div>
      <div style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-elevated)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-2)" }}>
        <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)" }}>Cached Tokens</div>
        <div style={{ fontSize: "var(--ah-font-size-base)", fontWeight: 600, color: "var(--ah-text-primary)" }}>{run.cost.cachedTokens}</div>
      </div>
      <div style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-elevated)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-2)" }}>
        <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)" }}>Cost USD</div>
        <div style={{ fontSize: "var(--ah-font-size-base)", fontWeight: 600, color: "var(--ah-text-primary)" }}>${run.cost.costUsd.toFixed(4)}</div>
      </div>
      <div style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-elevated)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-2)" }}>
        <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)" }}>Model</div>
        <div style={{ fontSize: "var(--ah-font-size-base)", fontWeight: 600, color: "var(--ah-text-primary)" }}>{run.cost.modelId}</div>
      </div>

      {loading && <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-2)" }}>Loading comparison...</div>}
      {comparisonData && (
        <div
          style={{
            padding: "var(--ah-space-3)",
            borderRadius: "var(--ah-radius-md)",
            background: "var(--ah-accent-light)",
            border: "1px solid var(--ah-accent)",
            marginBottom: "var(--ah-space-2)"
          }}
        >
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-accent-text)", fontWeight: 600 }}>Comparison</div>
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-secondary)", marginTop: "var(--ah-space-1)" }}>
            Average cost for {run.agentName} over last 7 days ({comparisonData.count} runs):
          </div>
          <div style={{ fontSize: "var(--ah-font-size-base)", fontWeight: 600, color: "var(--ah-accent-text)", marginTop: 2 }}>
            ${comparisonData.avgCostUsd.toFixed(4)}
          </div>
          <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: 2 }}>
            {run.cost.costUsd > comparisonData.avgCostUsd ? "Above" : "Below"} average by{" "}
            {Math.abs(((run.cost.costUsd - comparisonData.avgCostUsd) / comparisonData.avgCostUsd) * 100).toFixed(1)}%
          </div>
        </div>
      )}
    </div>
  );
}
