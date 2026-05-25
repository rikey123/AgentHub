import type { ContextItemViewModel, RoomViewModel, TaskViewModel } from "../types.ts";
import { CostPanel } from "./CostPanel.tsx";

type SidePanelTab = "context" | "tasks" | "members" | "debug" | "cost";

type SidePanelProps = {
  readonly room: RoomViewModel;
  readonly activeTab: SidePanelTab;
  readonly onChangeTab: (tab: SidePanelTab) => void;
  readonly workspaceId?: string;
};

type TabDefinition = {
  readonly key: SidePanelTab;
  readonly label: string;
  readonly shortLabel: string;
  readonly count?: number;
};

export function SidePanel({ room, activeTab, onChangeTab, workspaceId }: SidePanelProps) {
  const activeContextCount = room.contextItems.filter((c) => c.status !== "deprecated").length;
  const activeRunCount = room.runs.filter((run) => run.status === "running" || run.status === "starting" || run.status === "queued").length;
  const tabs: TabDefinition[] = [
    { key: "context", label: "Context", shortLabel: "Ctx", count: activeContextCount },
    { key: "tasks", label: "Tasks", shortLabel: "Tasks", count: room.tasks.length },
    { key: "members", label: "Members", shortLabel: "Team", count: room.participants.length },
    { key: "debug", label: "Debug", shortLabel: "Debug" },
    { key: "cost", label: "Cost", shortLabel: "Cost" }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--ah-bg-primary)" }}>
      <div
        style={{
          padding: "var(--ah-space-4)",
          borderBottom: "1px solid var(--ah-border)",
          background: "linear-gradient(180deg, var(--ah-bg-elevated) 0%, var(--ah-bg-primary) 100%)",
          flexShrink: 0
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--ah-space-3)", marginBottom: "var(--ah-space-3)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", textTransform: "uppercase", letterSpacing: "var(--ah-letter-spacing-wide)", fontWeight: 700 }}>
              Enterprise workbench
            </div>
            <div style={{ fontFamily: "var(--ah-font-heading)", fontSize: "var(--ah-font-size-lg)", fontWeight: 700, color: "var(--ah-text-primary)", marginTop: "var(--ah-space-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {room.title}
            </div>
          </div>
          <WorkbenchBadge tone={activeRunCount > 0 ? "success" : "muted"}>{activeRunCount > 0 ? `${activeRunCount} live` : room.mode}</WorkbenchBadge>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--ah-space-2)", marginBottom: "var(--ah-space-3)" }}>
          <MetricTile label="Runs" value={room.runs.length} tone={activeRunCount > 0 ? "success" : "neutral"} />
          <MetricTile label="Tasks" value={room.tasks.length} tone={room.tasks.length > 0 ? "accent" : "neutral"} />
          <MetricTile label="Context" value={activeContextCount} tone={activeContextCount > 0 ? "accent" : "neutral"} />
          <MetricTile label="Permissions" value={room.pendingPermissions.length} tone={room.pendingPermissions.length > 0 ? "warning" : "neutral"} />
        </div>

        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "var(--ah-space-1)", padding: "var(--ah-space-1)", borderRadius: "var(--ah-radius-lg)", background: "var(--ah-bg-secondary)", border: "1px solid var(--ah-border)" }}
          role="tablist"
          aria-label="Workbench tabs"
        >
          {tabs.map((tab) => {
            const selected = activeTab === tab.key;
            const label = `${tab.label}${tab.count && tab.count > 0 ? ` (${tab.count})` : ""}`;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onChangeTab(tab.key)}
                style={{
                  minWidth: 0,
                  padding: "var(--ah-space-2) var(--ah-space-1)",
                  border: "1px solid transparent",
                  borderRadius: "var(--ah-radius-md)",
                  background: selected ? "var(--ah-bg-elevated)" : "transparent",
                  boxShadow: selected ? "var(--ah-shadow-sm)" : "none",
                  cursor: "pointer",
                  fontSize: "var(--ah-font-size-xs)",
                  fontWeight: selected ? 700 : 600,
                  color: selected ? "var(--ah-accent)" : "var(--ah-text-muted)",
                  transition: "background var(--ah-transition-fast), color var(--ah-transition-fast), box-shadow var(--ah-transition-fast)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
                data-testid={`side-panel-tab-${tab.key}`}
                aria-label={`${label} tab`}
                aria-selected={selected}
                role="tab"
              >
                {tab.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "var(--ah-space-3)", display: "flex", flexDirection: "column", gap: "var(--ah-space-3)" }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--ah-space-3)" }}>
      <WorkbenchSection title="Context ledger" caption="Confirmed knowledge, drafts, and archived snippets for this room." />
      {draft.length > 0 && (
        <ContextGroup title="Draft" tone="warning" count={draft.length}>
          {draft.map((item) => <ContextItemRow key={item.id} item={item} />)}
        </ContextGroup>
      )}
      {confirmed.length > 0 && (
        <ContextGroup title="Confirmed" tone="success" count={confirmed.length}>
          {confirmed.map((item) => <ContextItemRow key={item.id} item={item} />)}
        </ContextGroup>
      )}
      {deprecated.length > 0 && (
        <details style={{ borderRadius: "var(--ah-radius-lg)", border: "1px solid var(--ah-border)", background: "var(--ah-bg-elevated)", padding: "var(--ah-space-3)" }}>
          <summary style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 700, color: "var(--ah-text-muted)", cursor: "pointer", textTransform: "uppercase", letterSpacing: "var(--ah-letter-spacing-wide)" }}>
            Deprecated ({deprecated.length})
          </summary>
          <div style={{ marginTop: "var(--ah-space-3)" }}>{deprecated.map((item) => <ContextItemRow key={item.id} item={item} />)}</div>
        </details>
      )}
      {room.contextItems.length === 0 && <EmptyState title="No context items yet" body="Confirmed context from runs will appear in this ledger." />}
    </div>
  );
}

function ContextGroup({ title, tone, count, children }: { readonly title: string; readonly tone: "success" | "warning"; readonly count: number; readonly children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--ah-space-2)" }}>
      <SectionHeader title={title} count={count} tone={tone} />
      {children}
    </section>
  );
}

function ContextItemRow({ item }: { readonly item: ContextItemViewModel }) {
  return (
    <SurfaceCard>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--ah-space-2)", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 700, color: "var(--ah-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
          <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)", lineHeight: "var(--ah-line-height-normal)" }}>{item.content.slice(0, 120)}{item.content.length > 120 ? "..." : ""}</div>
        </div>
        {item.pinned ? <WorkbenchBadge tone="accent">Pinned</WorkbenchBadge> : null}
      </div>
      <div style={{ marginTop: "var(--ah-space-2)", display: "flex", alignItems: "center", gap: "var(--ah-space-2)", color: "var(--ah-text-muted)", fontSize: "var(--ah-font-size-xs)" }}>
        <StatusDot tone={item.status === "confirmed" ? "success" : item.status === "draft" ? "warning" : "muted"} />
        <span>{item.scope}</span>
        <span>{item.status}</span>
      </div>
    </SurfaceCard>
  );
}

function TasksTab({ room }: { readonly room: RoomViewModel }) {
  const columns = ["todo", "running", "review", "done"] as const;
  const byStatus: Record<string, TaskViewModel[]> = {};
  for (const task of room.tasks) {
    const list = byStatus[task.status] ?? [];
    byStatus[task.status] = list;
    list.push(task);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--ah-space-3)" }}>
      <WorkbenchSection title="Task board" caption="Operational lanes today; Kanban and workflow routing are visual affordances only." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--ah-space-2)" }} aria-label="Future workflow affordances">
        <AffordancePill label="Kanban" detail="Planned" />
        <AffordancePill label="Workflow" detail="Planned" />
      </div>
      {columns.map((status) => (
        <section key={status} style={{ display: "flex", flexDirection: "column", gap: "var(--ah-space-2)" }}>
          <SectionHeader title={status} count={(byStatus[status] ?? []).length} tone={status === "running" ? "accent" : status === "done" ? "success" : "muted"} />
          {(byStatus[status] ?? []).map((task) => <TaskRow key={task.id} task={task} />)}
          {(byStatus[status] ?? []).length === 0 && <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", padding: "0 var(--ah-space-1)" }}>No cards in this lane</div>}
        </section>
      ))}
      {room.tasks.length === 0 && <EmptyState title="No tasks yet" body="Runs can create tasks automatically when work is decomposed." />}
    </div>
  );
}

function TaskRow({ task }: { readonly task: TaskViewModel }) {
  return (
    <SurfaceCard>
      <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 700, color: "var(--ah-text-primary)" }}>{task.title}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--ah-space-2)", marginTop: "var(--ah-space-2)", fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)" }}>
        <span>{task.status}</span>
        {task.assigneeAgentId ? <WorkbenchBadge tone="muted">{task.assigneeAgentId}</WorkbenchBadge> : <span>Unassigned</span>}
      </div>
    </SurfaceCard>
  );
}

function MembersTab({ room }: { readonly room: RoomViewModel }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--ah-space-3)" }}>
      <WorkbenchSection title="Members" caption="Agents and collaborators attached to this room." />
      {room.participants.map((p) => (
        <SurfaceCard key={p.id}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-3)" }}>
            <div
              style={{
                width: "var(--ah-space-7)",
                height: "var(--ah-space-7)",
                borderRadius: "var(--ah-radius-lg)",
                background: "var(--ah-accent-light)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--ah-font-size-sm)",
                fontWeight: 800,
                color: "var(--ah-accent-text)",
                fontFamily: "var(--ah-font-heading)",
                flexShrink: 0
              }}
            >
              {p.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--ah-font-size-sm)", fontWeight: 700, color: "var(--ah-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
              <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)" }}>{p.role} · {p.adapterId}</div>
            </div>
            <WorkbenchBadge tone={p.presence === "active" ? "success" : "muted"}>{p.presence}</WorkbenchBadge>
          </div>
        </SurfaceCard>
      ))}
      {room.participants.length === 0 && <EmptyState title="No agents in this room" body="Assigned agents and observers will appear here." />}
    </div>
  );
}

function DebugTab({ room }: { readonly room: RoomViewModel }) {
  const rows = [
    ["Room", room.id],
    ["Messages", room.messages.length],
    ["Briefs", room.briefs.length],
    ["Runs", room.runs.length],
    ["Pending Turns", room.pendingTurns.length],
    ["Interventions", room.unresolvedInterventions.length],
    ["Permissions", room.pendingPermissions.length]
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--ah-space-3)" }}>
      <WorkbenchSection title="Debug telemetry" caption="Read-only room diagnostics for operators." />
      <div style={{ border: "1px solid var(--ah-border)", borderRadius: "var(--ah-radius-lg)", overflow: "hidden", background: "var(--ah-bg-elevated)" }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "var(--ah-space-3)", padding: "var(--ah-space-2) var(--ah-space-3)", borderBottom: label === "Permissions" ? "none" : "1px solid var(--ah-border-light)", fontSize: "var(--ah-font-size-sm)" }}>
            <span style={{ color: "var(--ah-text-muted)", fontWeight: 600 }}>{label}</span>
            <span style={{ color: "var(--ah-text-primary)", fontFamily: "var(--ah-font-mono)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "calc(var(--ah-col-right-width) - var(--ah-space-8))" }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkbenchSection({ title, caption }: { readonly title: string; readonly caption: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--ah-font-heading)", fontSize: "var(--ah-font-size-sm)", fontWeight: 700, color: "var(--ah-text-primary)" }}>{title}</div>
      <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-1)", lineHeight: "var(--ah-line-height-normal)" }}>{caption}</div>
    </div>
  );
}

function MetricTile({ label, value, tone }: { readonly label: string; readonly value: number; readonly tone: "accent" | "success" | "warning" | "neutral" }) {
  const color = tone === "accent" ? "var(--ah-accent)" : tone === "success" ? "var(--ah-success)" : tone === "warning" ? "var(--ah-warning)" : "var(--ah-text-secondary)";
  return (
    <div style={{ padding: "var(--ah-space-2)", borderRadius: "var(--ah-radius-lg)", border: "1px solid var(--ah-border)", background: "var(--ah-bg-elevated)", boxShadow: "var(--ah-shadow-sm)" }}>
      <div style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-text-muted)", textTransform: "uppercase", letterSpacing: "var(--ah-letter-spacing-wide)", fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "var(--ah-font-heading)", fontSize: "var(--ah-font-size-xl)", fontWeight: 800, color, lineHeight: "var(--ah-line-height-tight)", marginTop: "var(--ah-space-1)" }}>{value}</div>
    </div>
  );
}

function SurfaceCard({ children }: { readonly children: React.ReactNode }) {
  return <div style={{ padding: "var(--ah-space-3)", borderRadius: "var(--ah-radius-lg)", background: "var(--ah-bg-elevated)", border: "1px solid var(--ah-border)", boxShadow: "var(--ah-shadow-sm)" }}>{children}</div>;
}

function SectionHeader({ title, count, tone }: { readonly title: string; readonly count: number; readonly tone: "accent" | "success" | "warning" | "muted" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--ah-space-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)", fontSize: "var(--ah-font-size-xs)", fontWeight: 800, color: "var(--ah-text-muted)", textTransform: "uppercase", letterSpacing: "var(--ah-letter-spacing-wide)" }}>
        <StatusDot tone={tone} />
        <span>{title}</span>
      </div>
      <WorkbenchBadge tone={tone}>{count}</WorkbenchBadge>
    </div>
  );
}

function StatusDot({ tone }: { readonly tone: "accent" | "success" | "warning" | "muted" }) {
  const color = tone === "accent" ? "var(--ah-accent)" : tone === "success" ? "var(--ah-success)" : tone === "warning" ? "var(--ah-warning)" : "var(--ah-border-strong)";
  return <span aria-hidden="true" style={{ width: "var(--ah-space-2)", height: "var(--ah-space-2)", borderRadius: "var(--ah-radius-full)", background: color, flexShrink: 0 }} />;
}

function WorkbenchBadge({ tone, children }: { readonly tone: "accent" | "success" | "warning" | "muted"; readonly children: React.ReactNode }) {
  const styles = {
    accent: { background: "var(--ah-accent-light)", color: "var(--ah-accent-text)", border: "var(--ah-accent)" },
    success: { background: "var(--ah-success-light)", color: "var(--ah-text-success)", border: "var(--ah-success)" },
    warning: { background: "var(--ah-warning-light)", color: "var(--ah-text-warning)", border: "var(--ah-warning)" },
    muted: { background: "var(--ah-bg-secondary)", color: "var(--ah-text-muted)", border: "var(--ah-border)" }
  }[tone];

  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "var(--ah-space-6)", padding: "var(--ah-space-1) var(--ah-space-2)", borderRadius: "var(--ah-radius-full)", border: `1px solid ${styles.border}`, background: styles.background, color: styles.color, fontSize: "var(--ah-font-size-xs)", fontWeight: 800, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function AffordancePill({ label, detail }: { readonly label: string; readonly detail: string }) {
  return (
    <div style={{ padding: "var(--ah-space-2)", borderRadius: "var(--ah-radius-lg)", border: "1px dashed var(--ah-border-strong)", background: "var(--ah-bg-elevated)", color: "var(--ah-text-muted)" }}>
      <div style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "var(--ah-letter-spacing-wide)" }}>{label}</div>
      <div style={{ fontSize: "var(--ah-font-size-xs)", marginTop: "var(--ah-space-1)" }}>{detail}</div>
    </div>
  );
}

function EmptyState({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div style={{ padding: "var(--ah-space-5)", borderRadius: "var(--ah-radius-lg)", border: "1px dashed var(--ah-border-strong)", background: "var(--ah-bg-elevated)", textAlign: "center" }}>
      <div style={{ fontFamily: "var(--ah-font-heading)", fontSize: "var(--ah-font-size-sm)", fontWeight: 700, color: "var(--ah-text-primary)" }}>{title}</div>
      <div style={{ fontSize: "var(--ah-font-size-sm)", color: "var(--ah-text-muted)", marginTop: "var(--ah-space-2)", lineHeight: "var(--ah-line-height-normal)" }}>{body}</div>
    </div>
  );
}
