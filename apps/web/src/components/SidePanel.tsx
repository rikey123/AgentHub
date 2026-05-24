import { useState } from "react";
import type { RoomViewModel } from "../types.ts";
import { CostPanel } from "./CostPanel.tsx";

type SidePanelProps = {
  readonly room: RoomViewModel;
  readonly activeTab: "context" | "tasks" | "members" | "debug" | "cost";
  readonly onChangeTab: (tab: "context" | "tasks" | "members" | "debug" | "cost") => void;
  readonly onOpenRunDetail?: (runId: string) => void;
  readonly workspaceId?: string;
};

export function SidePanel({ room, activeTab, onChangeTab, onOpenRunDetail, workspaceId }: SidePanelProps) {
  const tabs: { key: SidePanelProps["activeTab"]; label: string }[] = [
    { key: "context", label: "Context" },
    { key: "tasks", label: "Tasks" },
    { key: "members", label: "Members" },
    { key: "debug", label: "Debug" },
    { key: "cost", label: "Cost" }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onChangeTab(tab.key)}
            style={{
              flex: 1,
              padding: "10px 4px",
              border: "none",
              borderBottom: activeTab === tab.key ? "2px solid #3b82f6" : "2px solid transparent",
              background: "transparent",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? "#3b82f6" : "#6b7280"
            }}
            data-testid={`side-panel-tab-${tab.key}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {activeTab === "context" && <ContextTab room={room} />}
        {activeTab === "tasks" && <TasksTab room={room} />}
        {activeTab === "members" && <MembersTab room={room} />}
        {activeTab === "debug" && <DebugTab room={room} />}
        {activeTab === "cost" && <CostPanel workspaceId={workspaceId ?? "default-workspace"} />}
      </div>
    </div>
  );
}

function ContextTab({ room }: { readonly room: RoomViewModel }) {
  const draft = room.contextItems.filter((c) => c.status === "draft");
  const confirmed = room.contextItems.filter((c) => c.status === "confirmed");
  const deprecated = room.contextItems.filter((c) => c.status === "deprecated");

  return (
    <div>
      {draft.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#d97706", textTransform: "uppercase", marginBottom: 8 }}>Draft</div>
          {draft.map((item) => (
            <ContextItemRow key={item.id} item={item} />
          ))}
        </div>
      )}
      {confirmed.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#059669", textTransform: "uppercase", marginBottom: 8 }}>Confirmed</div>
          {confirmed.map((item) => (
            <ContextItemRow key={item.id} item={item} />
          ))}
        </div>
      )}
      {deprecated.length > 0 && (
        <details>
          <summary style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", cursor: "pointer" }}>Deprecated ({deprecated.length})</summary>
          <div style={{ marginTop: 8 }}>
            {deprecated.map((item) => (
              <ContextItemRow key={item.id} item={item} />
            ))}
          </div>
        </details>
      )}
      {room.contextItems.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>No context items</div>}
    </div>
  );
}

function ContextItemRow({ item }: { readonly item: import("../types.ts").ContextItemViewModel }) {
  return (
    <div style={{ padding: "8px 10px", borderRadius: 6, background: "#ffffff", border: "1px solid #e5e7eb", marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{item.title}</div>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, lineHeight: 1.4 }}>{item.content.slice(0, 120)}...</div>
      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>{item.scope} {item.pinned && "pinned"}</div>
    </div>
  );
}

function TasksTab({ room }: { readonly room: RoomViewModel }) {
  const columns = ["todo", "running", "review", "done"] as const;
  const byStatus: Record<string, import("../types.ts").TaskViewModel[]> = {};
  for (const task of room.tasks) {
    const list = byStatus[task.status] ?? [];
    byStatus[task.status] = list;
    list.push(task);
  }

  return (
    <div>
      {columns.map((status) => (
        <div key={status} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", marginBottom: 8 }}>{status}</div>
          {(byStatus[status] ?? []).map((task) => (
            <div key={task.id} style={{ padding: "8px 10px", borderRadius: 6, background: "#ffffff", border: "1px solid #e5e7eb", marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{task.title}</div>
              {task.assigneeAgentId && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{task.assigneeAgentId}</div>}
            </div>
          ))}
          {(byStatus[status] ?? []).length === 0 && <div style={{ fontSize: 12, color: "#d1d5db" }}>None</div>}
        </div>
      ))}
      {room.tasks.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>No tasks</div>}
    </div>
  );
}

function MembersTab({ room }: { readonly room: RoomViewModel }) {
  return (
    <div>
      {room.participants.map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              background: "#e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
              color: "#374151"
            }}
          >
            {p.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#111827" }}>{p.name}</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>
              {p.role} {p.presence}
            </div>
          </div>
        </div>
      ))}
      {room.participants.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af" }}>No participants</div>}
    </div>
  );
}

function DebugTab({ room }: { readonly room: RoomViewModel }) {
  return (
    <div style={{ fontSize: 12, color: "#6b7280" }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Room:</strong> {room.id}
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Messages:</strong> {room.messages.length}
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Briefs:</strong> {room.briefs.length}
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Runs:</strong> {room.runs.length}
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Pending Turns:</strong> {room.pendingTurns.length}
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Interventions:</strong> {room.unresolvedInterventions.length}
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Permissions:</strong> {room.pendingPermissions.length}
      </div>
    </div>
  );
}
