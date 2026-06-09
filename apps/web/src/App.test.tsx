import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  csrfFetch: vi.fn<typeof fetch>(),
  sdk: {
    createRoom: vi.fn(),
    sendMessage: vi.fn()
  },
  featureRail: vi.fn(() => null),
  homeView: vi.fn(() => null),
  newRoomDialog: vi.fn(() => null),
  settingsModal: vi.fn(() => null),
  workflowCanvasView: vi.fn(() => null)
}));

vi.mock("react-hotkeys-hook", () => ({ useHotkeys: vi.fn() }));
vi.mock("./hooks/useProjector.ts", () => ({
  useProjector: () => ({
    rooms: new Map([
      ["room-1", {
        id: "room-1",
        title: "Workflow room",
        mode: "team",
        participants: [],
        messages: [],
        briefs: [],
        unresolvedInterventions: [],
        pendingPermissions: [],
        contextItems: [],
        tasks: [],
        runs: [],
        pendingTurns: [],
        mailboxFailures: [],
        unreadCount: 0
      }]
    ]),
    workflows: [
      {
        id: "workflow-1",
        workspaceId: "default-workspace",
        name: "Workspace workflow",
        createdAt: 1,
        updatedAt: 1,
        versions: [],
        nodes: [],
        edges: [],
        runs: []
      }
    ],
    connectionStatus: "connected",
    connectionError: undefined
  })
}));
vi.mock("./hooks/useSdk.ts", () => ({
  useSdk: () => mocks.sdk,
  useCsrfFetch: () => mocks.csrfFetch
}));
vi.mock("./hooks/useTheme.ts", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
    setDensity: vi.fn()
  })
}));
vi.mock("./components/settings/index.ts", () => ({
  SettingsModal: mocks.settingsModal
}));
vi.mock("./components/shell/AppShell.tsx", () => ({
  AppShell: ({ topBar, rail, rooms, center, panel }: { topBar?: ReactNode; rail?: ReactNode; rooms?: ReactNode; center?: ReactNode; panel?: ReactNode }) => createElement("div", null, topBar, rail, rooms, center, panel)
}));
vi.mock("./components/shell/TopBar.tsx", () => ({ TopBar: () => null }));
vi.mock("./components/shell/FeatureRail.tsx", () => ({ FeatureRail: mocks.featureRail }));
vi.mock("./components/rooms/RoomList.tsx", () => ({ RoomList: () => null }));
vi.mock("./components/home/HomeView.tsx", () => ({ HomeView: mocks.homeView }));
vi.mock("./components/chat/ChatStream.tsx", () => ({ ChatStream: () => null }));
vi.mock("./components/chat/InputBox.tsx", () => ({ InputBox: () => null }));
vi.mock("./components/chat/PendingTurnList.tsx", () => ({ PendingTurnList: () => null }));
vi.mock("./components/panels/SidePanel.tsx", () => ({ SidePanel: () => null }));
vi.mock("./components/run/RunDetailDrawer.tsx", () => ({ RunDetailDrawer: () => null }));
vi.mock("./components/workflows/WorkflowCanvasView.tsx", () => ({ WorkflowCanvasView: mocks.workflowCanvasView }));
vi.mock("./components/CommandPalette.tsx", () => ({ CommandPalette: () => null }));
vi.mock("./components/KeymapModal.tsx", () => ({ KeymapModal: () => null }));
vi.mock("./components/NewRoomDialog.tsx", () => ({ NewRoomDialog: mocks.newRoomDialog }));

import App, { ChatRoomLayout, isWorkspaceRailItem } from "./App.tsx";

describe("App integration wiring", () => {
  beforeEach(() => {
    mocks.csrfFetch.mockReset();
    mocks.sdk.createRoom.mockReset();
    mocks.sdk.sendMessage.mockReset();
    mocks.featureRail.mockClear();
    mocks.homeView.mockClear();
    mocks.newRoomDialog.mockClear();
    mocks.settingsModal.mockClear();
    mocks.workflowCanvasView.mockClear();
  });

  it("passes csrfFetch into SettingsModal so settings writes use browser CSRF", () => {
    renderToStaticMarkup(createElement(App));

    expect(mocks.settingsModal).toHaveBeenCalled();
    const [props] = mocks.settingsModal.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(props).toEqual(expect.objectContaining({
      fetchImpl: mocks.csrfFetch
    }));
  });

  it("forwards selected room skills when creating a room", async () => {
    mocks.sdk.createRoom.mockResolvedValue({ data: { roomId: "room_skilled" } });
    renderToStaticMarkup(createElement(App));

    expect(mocks.newRoomDialog).toHaveBeenCalled();
    const [props] = mocks.newRoomDialog.mock.calls[0] as unknown as [{
      readonly onCreate: (input: {
        readonly title: string;
        readonly mode: "team";
        readonly primaryAgentId: string;
        readonly leaderRoleId: string;
        readonly skillIds: readonly string[];
        readonly participants: readonly unknown[];
      }) => Promise<void>;
    }];
    await props.onCreate({
      title: "Skilled room",
      mode: "team",
      primaryAgentId: "binding_leader",
      leaderRoleId: "role_leader",
      skillIds: ["skill_task_planner"],
      participants: []
    });

    expect(mocks.sdk.createRoom).toHaveBeenCalledWith(expect.objectContaining({
      skillIds: ["skill_task_planner"]
    }));
  });

  it("keeps chat messages scrollable without pushing the composer out of view", () => {
    const html = renderToStaticMarkup(
      createElement(ChatRoomLayout, {
        chat: createElement("div", null, "messages"),
        pendingTurns: createElement("div", null, "pending"),
        input: createElement("div", null, "composer")
      })
    );

    expect(html).toContain('data-testid="chat-room-layout"');
    expect(html).toContain("flex h-full min-h-0 flex-col overflow-hidden");
    expect(html).toContain('data-testid="chat-scroll-region"');
    expect(html).toContain("min-h-0 flex-1 overflow-hidden");
    expect(html).toContain('data-testid="chat-input-region"');
    expect(html).toContain("shrink-0");
  });

  it("treats workflow as a workspace-level rail item", () => {
    renderToStaticMarkup(createElement(App));

    expect(isWorkspaceRailItem("workflow")).toBe(true);
    expect(isWorkspaceRailItem("chat")).toBe(false);
    expect(isWorkspaceRailItem("tasks")).toBe(false);
  });
});
