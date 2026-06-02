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
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold truncate">{room.title}</h2>
      </header>
      <Tabs defaultSelectedKey={initialTab} className="flex flex-1 min-h-0 flex-col">
        <Tabs.ListContainer>
          <Tabs.List aria-label="Workbench panels">
            <Tabs.Tab id="context" data-testid="side-panel-tab-context">
              Context
              <Chip className="ml-2" size="sm" variant="soft" color="default">{room.contextItems.length}</Chip>
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="tasks" data-testid="side-panel-tab-tasks">
              <Tabs.Separator />
              Tasks
              <Chip className="ml-2" size="sm" variant="soft" color="default">{room.tasks.length}</Chip>
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="members" data-testid="side-panel-tab-members">
              <Tabs.Separator />
              Members
              <Chip className="ml-2" size="sm" variant="soft" color="default">{room.participants.length}</Chip>
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="debug" data-testid="side-panel-tab-debug">
              <Tabs.Separator />
              Debug
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="cost" data-testid="side-panel-tab-cost">
              <Tabs.Separator />
              Cost
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <ScrollShadow className="flex-1 min-h-0 overflow-auto" orientation="vertical">
          <Tabs.Panel id="context"><ContextPanel items={room.contextItems} /></Tabs.Panel>
          <Tabs.Panel id="tasks"><TasksPanel roomId={room.id} tasks={room.tasks} executionPlan={room.executionPlan} csrfFetch={csrfFetch} onOpenArtifact={onOpenArtifact} /></Tabs.Panel>
          <Tabs.Panel id="members"><MembersPanel members={room.participants} /></Tabs.Panel>
          <Tabs.Panel id="debug"><DebugPanel room={room} /></Tabs.Panel>
          <Tabs.Panel id="cost"><CostPanel csrfFetch={csrfFetch} /></Tabs.Panel>
        </ScrollShadow>
      </Tabs>
    </div>
  );
}
