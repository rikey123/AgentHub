import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  csrfFetch: vi.fn<typeof fetch>(),
  sdk: {
    createRoom: vi.fn(),
    sendMessage: vi.fn()
  },
  newRoomDialog: vi.fn(() => null),
  settingsModal: vi.fn(() => null),
  commandPalette: vi.fn(() => null),
  homeView: vi.fn(() => null),
  roomList: vi.fn(() => null),
  projectorRooms: new Map<string, unknown>(),
  stateCalls: [] as Array<{ readonly index: number; readonly value: unknown }>,
  stateIndex: 0
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initialState: T | (() => T)) => {
      const [value] = actual.useState(initialState);
      const index = mocks.stateIndex;
      mocks.stateIndex += 1;
      const setValue = (next: T | ((previous: T) => T)) => {
        mocks.stateCalls.push({
          index,
          value: typeof next === "function" ? (next as (previous: T) => T)(value) : next
        });
      };
      return [value, setValue] as const;
    }
  };
});
vi.mock("react-hotkeys-hook", () => ({ useHotkeys: vi.fn() }));
vi.mock("./hooks/useProjector.ts", () => ({
  useProjector: () => ({
    rooms: new Map(mocks.projectorRooms),
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
vi.mock("./components/shell/FeatureRail.tsx", () => ({ FeatureRail: () => null }));
vi.mock("./components/rooms/RoomList.tsx", () => ({ RoomList: mocks.roomList }));
vi.mock("./components/home/HomeView.tsx", () => ({ HomeView: mocks.homeView }));
vi.mock("./components/rail/RailViews.tsx", () => ({
  ContactsRailContainer: () => createElement("section", { "data-testid": "contacts-rail-view" }, "Contacts rail view"),
  ArtifactsRailContainer: () => createElement("section", { "data-testid": "artifacts-rail-view" }, "Artifacts rail view")
}));
vi.mock("./components/chat/ChatStream.tsx", () => ({ ChatStream: () => null }));
vi.mock("./components/chat/InputBox.tsx", () => ({ InputBox: () => null }));
vi.mock("./components/chat/PendingTurnList.tsx", () => ({ PendingTurnList: () => null }));
vi.mock("./components/panels/SidePanel.tsx", () => ({ SidePanel: () => null }));
vi.mock("./components/run/RunDetailDrawer.tsx", () => ({ RunDetailDrawer: () => null }));
vi.mock("./components/CommandPalette.tsx", () => ({ CommandPalette: mocks.commandPalette }));
vi.mock("./components/KeymapModal.tsx", () => ({ KeymapModal: () => null }));
vi.mock("./components/NewRoomDialog.tsx", () => ({ NewRoomDialog: mocks.newRoomDialog }));

import App, { ChatRoomLayout, messagePinRequestFor, workbenchCenterModeForRail, workbenchNavigationForRoomOpen } from "./App.tsx";

function renderApp() {
  mocks.stateIndex = 0;
  return renderToStaticMarkup(createElement(App));
}

function expectRoomOpenState(roomId: string) {
  expect(mocks.stateCalls.map((call) => call.value).filter((value) => value !== undefined)).toEqual([roomId, "chat"]);
}

describe("App integration wiring", () => {
  beforeEach(() => {
    mocks.csrfFetch.mockReset();
    mocks.sdk.createRoom.mockReset();
    mocks.sdk.sendMessage.mockReset();
    mocks.newRoomDialog.mockClear();
    mocks.settingsModal.mockClear();
    mocks.commandPalette.mockClear();
    mocks.homeView.mockClear();
    mocks.roomList.mockClear();
    mocks.projectorRooms.clear();
    mocks.stateCalls = [];
    mocks.stateIndex = 0;
  });

  it("passes csrfFetch into SettingsModal so settings writes use browser CSRF", () => {
    renderApp();

    expect(mocks.settingsModal).toHaveBeenCalled();
    const [props] = mocks.settingsModal.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(props).toEqual(expect.objectContaining({
      fetchImpl: mocks.csrfFetch
    }));
  });

  it("forwards selected room skills when creating a room", async () => {
    mocks.sdk.createRoom.mockResolvedValue({ data: { roomId: "room_skilled" } });
    renderApp();

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

  it("uses room-scoped pin routes when toggling a message pin", () => {
    expect(messagePinRequestFor("room-1", "message-pinned", true)).toEqual({
      url: "/rooms/room-1/messages/message-pinned/pin",
      method: "DELETE"
    });
    expect(messagePinRequestFor("room-1", "message-unpinned", false)).toEqual({
      url: "/rooms/room-1/messages/message-unpinned/pin",
      method: "POST"
    });
  });

  it("maps contacts and artifacts rail selection to dedicated center views", () => {
    expect(workbenchCenterModeForRail("contacts", false)).toBe("contacts");
    expect(workbenchCenterModeForRail("artifacts", false)).toBe("artifacts");
    expect(workbenchCenterModeForRail("chat", true)).toBe("room");
    expect(workbenchCenterModeForRail("chat", false)).toBe("home");
  });

  it("returns to chat center when a room is opened from a non-chat rail view", () => {
    const fromContacts = workbenchNavigationForRoomOpen("room_1", "contacts");
    expect(fromContacts).toEqual({ activeRoomId: "room_1", rail: "chat" });
    expect(workbenchCenterModeForRail(fromContacts.rail, true)).toBe("room");

    const fromArtifacts = workbenchNavigationForRoomOpen("room_2", "artifacts");
    expect(fromArtifacts).toEqual({ activeRoomId: "room_2", rail: "chat" });
    expect(workbenchCenterModeForRail(fromArtifacts.rail, true)).toBe("room");
  });

  it("wires every room-opening callback through chat rail restoration", async () => {
    mocks.projectorRooms.set("room_from_command", {
      id: "room_from_command",
      title: "Command room",
      mode: "assisted"
    });
    mocks.sdk.createRoom.mockResolvedValue({ data: { roomId: "room_created" } });
    renderApp();

    const [roomListProps] = mocks.roomList.mock.calls[0] as unknown as [{ readonly onSelect: (roomId: string) => void }];
    mocks.stateCalls = [];
    roomListProps.onSelect("room_from_list");
    expectRoomOpenState("room_from_list");

    const [homeViewProps] = mocks.homeView.mock.calls[0] as unknown as [{ readonly onOpenRoom: (roomId: string) => void }];
    mocks.stateCalls = [];
    homeViewProps.onOpenRoom("room_from_home");
    expectRoomOpenState("room_from_home");

    const [commandPaletteProps] = mocks.commandPalette.mock.calls[0] as unknown as [{ readonly commands: ReadonlyArray<{ readonly id: string; readonly perform: () => void }> }];
    const command = commandPaletteProps.commands.find((item) => item.id === "room-room_from_command");
    expect(command).toBeDefined();
    mocks.stateCalls = [];
    command!.perform();
    expectRoomOpenState("room_from_command");

    const [newRoomProps] = mocks.newRoomDialog.mock.calls[0] as unknown as [{
      readonly onCreate: (input: {
        readonly title: string;
        readonly mode: "assisted";
        readonly primaryAgentId: string;
        readonly participants: readonly unknown[];
      }) => Promise<void>;
    }];
    mocks.stateCalls = [];
    await newRoomProps.onCreate({
      title: "Created room",
      mode: "assisted",
      primaryAgentId: "binding_assistant",
      participants: []
    });
    expectRoomOpenState("room_created");
  });
});
