import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  csrfFetch: vi.fn<typeof fetch>(),
  sdk: {
    createRoom: vi.fn(),
    sendMessage: vi.fn()
  },
  settingsModal: vi.fn(() => null)
}));

vi.mock("react-hotkeys-hook", () => ({ useHotkeys: vi.fn() }));
vi.mock("./hooks/useProjector.ts", () => ({
  useProjector: () => ({
    rooms: new Map(),
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
vi.mock("./components/rooms/RoomList.tsx", () => ({ RoomList: () => null }));
vi.mock("./components/home/HomeView.tsx", () => ({ HomeView: () => null }));
vi.mock("./components/chat/ChatStream.tsx", () => ({ ChatStream: () => null }));
vi.mock("./components/chat/InputBox.tsx", () => ({ InputBox: () => null }));
vi.mock("./components/chat/PendingTurnList.tsx", () => ({ PendingTurnList: () => null }));
vi.mock("./components/panels/SidePanel.tsx", () => ({ SidePanel: () => null }));
vi.mock("./components/run/RunDetailDrawer.tsx", () => ({ RunDetailDrawer: () => null }));
vi.mock("./components/CommandPalette.tsx", () => ({ CommandPalette: () => null }));
vi.mock("./components/KeymapModal.tsx", () => ({ KeymapModal: () => null }));
vi.mock("./components/NewRoomDialog.tsx", () => ({ NewRoomDialog: () => null }));

import App, { ChatRoomLayout } from "./App.tsx";

describe("App integration wiring", () => {
  it("passes csrfFetch into SettingsModal so settings writes use browser CSRF", () => {
    renderToStaticMarkup(createElement(App));

    expect(mocks.settingsModal).toHaveBeenCalled();
    const [props] = mocks.settingsModal.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(props).toEqual(expect.objectContaining({
      fetchImpl: mocks.csrfFetch
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
});
