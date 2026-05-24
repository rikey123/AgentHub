import { useState, useEffect } from "react";
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
          padding: "12px 16px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#f9fafb"
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>Run Detail</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            {run?.agentName ?? "Unknown"} {run?.status && <StatusBadge status={run.status} />}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            color: "#6b7280",
            padding: 4
          }}
          aria-label="Close run detail"
        >
          x
        </button>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", overflow: "auto" }} data-testid="run-detail-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            data-testid={`run-detail-tab-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "10px 14px",
              border: "none",
              borderBottom: activeTab === tab.key ? "2px solid #3b82f6" : "2px solid transparent",
              background: "transparent",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? "#3b82f6" : "#6b7280",
              whiteSpace: "nowrap"
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
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
    queued: "#6b7280",
    starting: "#3b82f6",
    running: "#3b82f6",
    waiting_permission: "#d97706",
    completed: "#10b981",
    failed: "#ef4444",
    cancelled: "#6b7280"
  };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: "#ffffff",
        background: colors[status] ?? "#6b7280",
        padding: "2px 8px",
        borderRadius: 10,
        marginLeft: 8
      }}
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
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: 12,
            color: "#1e40af"
          }}
        >
          <strong>PreCompact Summary:</strong> This run triggered a context compression. Check the Context tab for the summary draft.
        </div>
      )}
      {messages.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>No transcript entries</div>}
      {messages.map((m) => (
        <div key={m.id} style={{ padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
            {m.senderName} <span style={{ fontWeight: 400, color: "#9ca3af" }}>{m.role}</span>
          </div>
          <div style={{ fontSize: 13, color: "#111827", marginTop: 4, whiteSpace: "pre-wrap" }}>{m.text}</div>
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
      {toolParts.length === 0 && subagentRuns.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>No tool calls</div>}
      {toolParts.map((part, idx) => (
        <div key={idx} style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
          {part.type === "tool_call" && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#3b82f6" }}>{part.name}</div>
              <pre style={{ fontSize: 11, marginTop: 4, overflow: "auto" }}>{JSON.stringify(part.input, null, 2)}</pre>
            </>
          )}
          {part.type === "tool_result" && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: part.ok ? "#10b981" : "#ef4444" }}>Result</div>
              <pre style={{ fontSize: 11, marginTop: 4, overflow: "auto" }}>{JSON.stringify(part.output, null, 2)}</pre>
            </>
          )}
        </div>
      ))}
      {subagentRuns.map((subrun) => (
        <div key={subrun.id} style={{ padding: "10px 12px", borderRadius: 6, background: "#eff6ff", border: "1px solid #bfdbfe", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1d4ed8" }}>Subagent: {subrun.agentName}</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            Status: {subrun.status}
            {subrun.cost && (
              <span style={{ marginLeft: 8 }}>
                Cost: ${subrun.cost.costUsd.toFixed(4)} · {subrun.cost.inputTokens + subrun.cost.outputTokens} tokens
              </span>
            )}
          </div>
          {subrun.startedAt && subrun.endedAt && (
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
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
            background: "#fef3c7",
            border: "1px solid #fcd34d",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: 12,
            color: "#92400e"
          }}
        >
          <strong>PreCompact Triggered:</strong> {preCompactItems.length} summary draft(s) generated during this run.
        </div>
      )}
      {items.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>No context snapshot</div>}
      {items.map((item) => (
        <div key={item.id} style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{item.title}</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4, whiteSpace: "pre-wrap" }}>{item.content}</div>
          {item.status === "draft" && (
            <div style={{ fontSize: 11, color: "#d97706", marginTop: 4, fontWeight: 500 }}>Draft - awaiting confirmation</div>
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
      {perms.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>No permission requests</div>}
      {perms.map((p) => (
        <div key={p.id} style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{p.resource.type}</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{p.reason ?? "No reason"}</div>
          <div style={{ fontSize: 11, color: p.status === "allowed" ? "#10b981" : p.status === "denied" ? "#ef4444" : "#d97706", marginTop: 4, fontWeight: 600 }}>
            {p.status}
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtifactsTab({ room, runId }: { readonly room: import("../types.ts").RoomViewModel | undefined; readonly runId: string }) {
  const artifactParts =
    room?.messages
      .filter((m) => m.runId === runId)
      .flatMap((m) => m.parts.filter((p) => p.type === "card" && (p.card.type === "diff" || p.card.type === "preview"))) ?? [];

  // Mock terminal data - in real implementation this would come from artifact data
  const terminalLines: TerminalLine[] = [
    { text: "npm test", stream: "stdout" },
    { text: "\u001b[32mPASS\u001b[0m src/index.test.js", stream: "stdout" },
    { text: "\u001b[31mFAIL\u001b[0m src/utils.test.js", stream: "stdout" },
    { text: "  Expected: 42", stream: "stdout" },
    { text: "  Received: 43", stream: "stdout" },
    { text: "", stream: "stdout" },
    { text: "Test Suites: 1 failed, 1 passed", stream: "stdout" },
    { text: "Tests:       1 failed, 5 passed", stream: "stdout" },
    { text: "Snapshots:   0 total", stream: "stdout" },
    { text: "Time:        1.234s", stream: "stdout" },
    { text: "Ran all test suites.", stream: "stdout" }
  ];

  return (
    <div>
      {artifactParts.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>No artifacts</div>}
      {artifactParts.map((part, idx) => {
        if (part.type !== "card") return null;
        if (part.card.type === "diff") {
          const card = part.card;
          return (
            <div key={idx} style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>Diff Artifact</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Status: {card.applyStatus}</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{card.files.length} files</div>
            </div>
          );
        }
        if (part.card.type === "preview") {
          const card = part.card;
          return (
            <div key={idx} style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>Preview</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{card.kind}: {card.url}</div>
            </div>
          );
        }
        return null;
      })}
      {/* TerminalCard for artifact terminal output */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 6, textTransform: "uppercase" }}>Terminal Output</div>
        <TerminalCard lines={terminalLines} exitCode={1} collapsed={true} />
      </div>
    </div>
  );
}

function RawStreamTab({ roomId, runId }: { readonly roomId: string; readonly runId: string }) {
  const rawStream = useRawStream(roomId, runId);
  const hasLines = rawStream.lines.length > 0;

  return (
    <div>
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Raw adapter stdout/stderr for run {runId}</div>
      <div
        style={{
          padding: 12,
          borderRadius: 6,
          background: "#1f2937",
          color: "#e5e7eb",
          fontFamily: "monospace",
          fontSize: 12,
          minHeight: 200,
          whiteSpace: "pre-wrap"
        }}
        data-testid="raw-stream-content"
      >
        {!hasLines && (
          <div style={{ color: "#9ca3af" }}>
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
                color: line.stream === "stderr" ? "#fca5a5" : "#e5e7eb"
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
    return <div style={{ fontSize: 13, color: "#9ca3af" }}>No cost data</div>;
  }

  return (
    <div>
      <div style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Input Tokens</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{run.cost.inputTokens}</div>
      </div>
      <div style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Output Tokens</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{run.cost.outputTokens}</div>
      </div>
      <div style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Cached Tokens</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{run.cost.cachedTokens}</div>
      </div>
      <div style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Cost USD</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>${run.cost.costUsd.toFixed(4)}</div>
      </div>
      <div style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#6b7280" }}>Model</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{run.cost.modelId}</div>
      </div>

      {loading && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>Loading comparison...</div>}
      {comparisonData && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            marginBottom: 8
          }}
        >
          <div style={{ fontSize: 12, color: "#1d4ed8", fontWeight: 600 }}>Comparison</div>
          <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>
            Average cost for {run.agentName} over last 7 days ({comparisonData.count} runs):
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1d4ed8", marginTop: 2 }}>
            ${comparisonData.avgCostUsd.toFixed(4)}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            {run.cost.costUsd > comparisonData.avgCostUsd ? "Above" : "Below"} average by{" "}
            {Math.abs(((run.cost.costUsd - comparisonData.avgCostUsd) / comparisonData.avgCostUsd) * 100).toFixed(1)}%
          </div>
        </div>
      )}
    </div>
  );
}
