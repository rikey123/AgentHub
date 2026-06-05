import { Tabs, Chip, ScrollShadow } from "@heroui/react";
import type { RoomViewModel } from "../../types.ts";
import { ContextPanel } from "./ContextPanel.tsx";
import { TasksPanel } from "./TasksPanel.tsx";
import { MembersPanel } from "./MembersPanel.tsx";
import { DebugPanel } from "./DebugPanel.tsx";
import { CostPanel } from "./CostPanel.tsx";

interface SidePanelProps {
  room: RoomViewModel;
  csrfFetch: typeof fetch;
  initialTab?: "context" | "tasks" | "members" | "debug" | "cost";
  onOpenArtifact?: ((input: { artifactId: string; runId: string; path: string }) => void) | undefined;
}

export function SidePanel({ room, csrfFetch, initialTab = "context", onOpenArtifact }: SidePanelProps) {
  const panelCounts = {
    context: room.contextItems.length,
    tasks: room.tasks.length,
    members: room.participants.length
  };

  return (
    <div className="ah-side-panel flex h-full flex-col">
      <header className="ah-side-panel-header">
        <p className="text-xs font-medium text-muted">Room</p>
        <h2 className="truncate text-base font-semibold">{room.title}</h2>
      </header>
      <Tabs defaultSelectedKey={initialTab} className="flex min-h-0 flex-1 flex-col">
        <Tabs.ListContainer className="ah-side-tabs-wrap pb-4">
          <Tabs.List aria-label="Workbench panels" className="ah-side-tabs">
            <DashboardTab id="context" testId="side-panel-tab-context" count={panelCounts.context} label="Context" />
            <DashboardTab id="tasks" testId="side-panel-tab-tasks" count={panelCounts.tasks} label="Tasks" />
            <DashboardTab id="members" testId="side-panel-tab-members" count={panelCounts.members} label="Members" />
            <DashboardTab id="debug" testId="side-panel-tab-debug" label="Debug" />
            <DashboardTab id="cost" testId="side-panel-tab-cost" label="Cost" />
          </Tabs.List>
        </Tabs.ListContainer>
        <ScrollShadow className="min-h-0 flex-1 overflow-auto px-2 pb-4" orientation="vertical">
          <Tabs.Panel id="context"><ContextPanel items={room.contextItems} /></Tabs.Panel>
          <Tabs.Panel id="tasks"><TasksPanel roomId={room.id} tasks={room.tasks} executionPlan={room.executionPlan} csrfFetch={csrfFetch} onOpenArtifact={onOpenArtifact} /></Tabs.Panel>
          <Tabs.Panel id="members"><MembersPanel roomId={room.id} members={room.participants} tasks={room.tasks} csrfFetch={csrfFetch} /></Tabs.Panel>
          <Tabs.Panel id="debug"><DebugPanel room={room} /></Tabs.Panel>
          <Tabs.Panel id="cost"><CostPanel csrfFetch={csrfFetch} /></Tabs.Panel>
        </ScrollShadow>
      </Tabs>
    </div>
  );
}

function DashboardTab({ id, testId, label, count }: { id: "context" | "tasks" | "members" | "debug" | "cost"; testId: string; label: string; count?: number | undefined }) {
  return (
    <Tabs.Tab id={id} data-testid={testId} className="ah-side-tab">
      <span>{label}</span>
      {count !== undefined ? <Chip className="ah-side-tab-count" size="sm" variant="soft" color="default">{count}</Chip> : null}
    </Tabs.Tab>
  );
}
