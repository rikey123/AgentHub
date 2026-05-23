import { useState } from "react";
import { useProjector } from "../hooks/useProjector.ts";
import { useRawStream } from "../hooks/useRawStream.ts";

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
        {activeTab === "cost" && <CostTab run={run} />}
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
  return (
    <div>
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

  return (
    <div>
      {toolParts.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>No tool calls</div>}
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
    </div>
  );
}

function ContextTab({ room, runId }: { readonly room: import("../types.ts").RoomViewModel | undefined; readonly runId: string }) {
  const items = room?.contextItems.filter((c) => c.runId === runId) ?? [];
  return (
    <div>
      {items.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>No context snapshot</div>}
      {items.map((item) => (
        <div key={item.id} style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{item.title}</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4, whiteSpace: "pre-wrap" }}>{item.content}</div>
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
      .flatMap((m) => m.parts.filter((p) => p.type === "card" && p.card.type === "diff")) ?? [];

  return (
    <div>
      {artifactParts.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>No artifacts</div>}
      {artifactParts.map((part, idx) => {
        if (part.type !== "card" || part.card.type !== "diff") return null;
        const card = part.card;
        return (
          <div key={idx} style={{ padding: "10px 12px", borderRadius: 6, background: "#f9fafb", border: "1px solid #e5e7eb", marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>Diff Artifact</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Status: {card.applyStatus}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{card.files.length} files</div>
          </div>
        );
      })}
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

function CostTab({ run }: { readonly run: import("../types.ts").RunViewModel | undefined }) {
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
    </div>
  );
}
