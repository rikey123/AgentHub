import type { RoomViewModel } from "../types.ts";
import { CostPanel } from "./CostPanel.tsx";

type SidePanelProps = {
  readonly room: RoomViewModel;
  readonly activeTab: "context" | "tasks" | "members" | "debug" | "cost";
  readonly onChangeTab: (tab: "context" | "tasks" | "members" | "debug" | "cost") => void;
  readonly workspaceId?: string;
};

export function SidePanel({ room, activeTab, onChangeTab, workspaceId }: SidePanelProps) {
  const tabs: { key: SidePanelProps["activeTab"]; label: string }[] = [
    { key: "context", label: "Context" },
    { key: "tasks", label: "Tasks" },
    { key: "members", label: "Members" },
    { key: "debug", label: "Debug" },
    { key: "cost", label: "Cost" }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--ah-border)" }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onChangeTab(tab.key)}
            style={{
              flex: 1,
              padding: "var(--ah-space-3) var(--ah-space-1)",
              border: "none",
              borderBottom: activeTab === tab.key ? "2px solid var(--ah-accent)" : "2px solid transparent",
              background: "transparent",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-sm)",
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? "var(--ah-accent)" : "var(--ah-text-muted)"
            }}
            data-testid={`side-panel-tab-${tab.key}`}
            aria-label={`${tab.label} tab`}
            aria-selected={activeTab === tab.key}
            role="tab"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "var(--ah-space-3)" }}>
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
        <div style={{ marginBottom: "var(--ah-space-4)" }}>
          <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-warning)", textTransform: "uppercase", marginBottom: "var(--ah-space-2)" }}>Draft</div>
          {draft.map((item) => (
            <ContextItemRow key={item.id} item={item} />
          ))}
        </div>
      )}
      {confirmed.length > 0 && (
        <div style={{ marginBottom: "var(--ah-space-4)" }}>
          <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-success)", textTransform: "uppercase", marginBottom: "var(--ah-space-2)" }}>Confirmed</div>
          {confirmed.map((item) => (
            <ContextItemRow key={item.id} item={item} />
          ))}
        </div>
      )}
      {deprecated.length > 0 && (
        <details>
          <summary style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-text-muted)", cursor: "pointer" }}>Deprecated ({deprecated.length})</summary>
          <div style={{ marginTop: "var(--ah-space-2)" }}>
            {deprecated.map((item) => (
              <ContextItemRow key={item.id} item={item} />
            ))}
          </div>
        </details>
      )}
      {room.contextItems.length === 0 && <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)" }}>No context items</div>}
    </div>
  );
}

function ContextItemRow({ item }: { readonly item: import("../types.ts").ContextItemViewModel; readonly key?: React.Key }) {
  return (
    <div style={{ padding: "var(--ah-space-2) var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-primary)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-2)" }}>
      <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 600, color: "var(--ah-text-primary)" }}>{item.title}</div>
      <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: 2, lineHeight: "var(--ah-line-height-normal)" }}>{item.content.slice(0, 120)}...</div>
      <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)" }}>{item.scope} {item.pinned && "pinned"}</div>
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
        <div key={status} style={{ marginBottom: "var(--ah-space-4)" }}>
          <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-text-muted)", textTransform: "uppercase", marginBottom: "var(--ah-space-2)" }}>{status}</div>
          {(byStatus[status] ?? []).map((task) => (
            <div key={task.id} style={{ padding: "var(--ah-space-2) var(--ah-space-3)", borderRadius: "var(--ah-radius-md)", background: "var(--ah-bg-primary)", border: "1px solid var(--ah-border)", marginBottom: "var(--ah-space-1)" }}>
              <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 500, color: "var(--ah-text-primary)" }}>{task.title}</div>
              {task.assigneeAgentId && <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: 2 }}>{task.assigneeAgentId}</div>}
            </div>
          ))}
          {(byStatus[status] ?? []).length === 0 && <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-border-strong)" }}>None</div>}
        </div>
      ))}
      {room.tasks.length === 0 && <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)" }}>No tasks</div>}
    </div>
  );
}

function MembersTab({ room }: { readonly room: RoomViewModel }) {
  return (
    <div>
      {room.participants.map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-3)", padding: "var(--ah-space-2) 0", borderBottom: "1px solid var(--ah-border-light)" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--ah-radius-full)",
              background: "var(--ah-bg-tertiary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--ah-font-size-xs)",
              fontWeight: 600,
              color: "var(--ah-text-secondary)"
            }}
          >
            {p.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 500, color: "var(--ah-text-primary)" }}>{p.name}</div>
            <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)" }}>
              {p.role} {p.presence}
            </div>
          </div>
        </div>
      ))}
      {room.participants.length === 0 && <div style={{ fontSize: "var(--ah-font-size-md)", color: "var(--ah-text-muted)" }}>No participants</div>}
    </div>
  );
}

function DebugTab({ room }: { readonly room: RoomViewModel }) {
  return (
    <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)" }}>
      <div style={{ marginBottom: "var(--ah-space-2)" }}>
        <strong>Room:</strong> {room.id}
      </div>
      <div style={{ marginBottom: "var(--ah-space-2)" }}>
        <strong>Messages:</strong> {room.messages.length}
      </div>
      <div style={{ marginBottom: "var(--ah-space-2)" }}>
        <strong>Briefs:</strong> {room.briefs.length}
      </div>
      <div style={{ marginBottom: "var(--ah-space-2)" }}>
        <strong>Runs:</strong> {room.runs.length}
      </div>
      <div style={{ marginBottom: "var(--ah-space-2)" }}>
        <strong>Pending Turns:</strong> {room.pendingTurns.length}
      </div>
      <div style={{ marginBottom: "var(--ah-space-2)" }}>
        <strong>Interventions:</strong> {room.unresolvedInterventions.length}
      </div>
      <div style={{ marginBottom: "var(--ah-space-2)" }}>
        <strong>Permissions:</strong> {room.pendingPermissions.length}
      </div>
    </div>
  );
}
