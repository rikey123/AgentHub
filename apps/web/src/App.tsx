import { useCallback, useEffect, useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AppShell } from "./components/shell/AppShell.tsx";
import { TopBar } from "./components/shell/TopBar.tsx";
import { FeatureRail, type RailItem } from "./components/shell/FeatureRail.tsx";
import { RoomList } from "./components/rooms/RoomList.tsx";
import { HomeView } from "./components/home/HomeView.tsx";
import { ChatStream } from "./components/chat/ChatStream.tsx";
import { InputBox } from "./components/chat/InputBox.tsx";
import { PendingTurnList } from "./components/chat/PendingTurnList.tsx";
import { SidePanel } from "./components/panels/SidePanel.tsx";
import { RunDetailDrawer } from "./components/run/RunDetailDrawer.tsx";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette.tsx";
import { KeymapModal } from "./components/KeymapModal.tsx";
import { NewRoomDialog, type CreateRoomInput } from "./components/NewRoomDialog.tsx";
import { SettingsModal } from "./components/settings/index.ts";
import { getSettingsSearch, getSettingsStateFromSearch } from "./components/settings/settingsUrl.ts";
import type { SettingsTabId } from "./components/settings/SettingsModal.tsx";
import { useProjector } from "./hooks/useProjector.ts";
import { useSdk, useCsrfFetch } from "./hooks/useSdk.ts";
import { useTheme } from "./hooks/useTheme.ts";

export default function App() {
  const initialSettingsState = useMemo(() => {
    if (typeof window === "undefined") return { isOpen: false, tab: "roles" as SettingsTabId };
    return getSettingsStateFromSearch(window.location.search);
  }, []);
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>();
  const [activeRunId, setActiveRunId] = useState<string | undefined>();
  const [selectedMessageId, setSelectedMessageId] = useState<string | undefined>();
  const [editingTurnId, setEditingTurnId] = useState<string | undefined>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [keymapOpen, setKeymapOpen] = useState(false);
  const [newRoomOpen, setNewRoomOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsState.isOpen);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>(initialSettingsState.tab);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<"context" | "tasks" | "members" | "debug" | "cost">("context");
  const [rail, setRail] = useState<RailItem>("chat");
  const [bannerError, setBannerError] = useState<string | undefined>();

  const projector = useProjector("main", activeRoomId);
  const sdk = useSdk();
  const csrfFetch = useCsrfFetch();
  const { theme, setTheme, toggleTheme, setDensity } = useTheme();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextSearch = getSettingsSearch(window.location.search, settingsOpen, settingsTab);
    if (nextSearch === window.location.search) return;

    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [settingsOpen, settingsTab]);

  const rooms = useMemo(() => Array.from(projector.rooms.values()), [projector.rooms]);
  const activeRoom = activeRoomId ? projector.rooms.get(activeRoomId) : undefined;

  const handleCreateRoom = useCallback(async (input: CreateRoomInput) => {
    setBannerError(undefined);
    try {
      const res = await sdk.createRoom({
        title: input.title,
        mode: input.mode,
        primaryAgentId: input.primaryAgentId,
        participants: input.participants
      }) as { data?: { roomId?: string }; id?: string; roomId?: string };
      const roomId = res?.data?.roomId ?? res?.roomId ?? res?.id;
      if (typeof roomId === "string") {
        // The daemon emits real `agent.joined` + `agent.state.changed` events for every
        // participant inside the same transaction as room.created, so SSE replay gives us the
        // member roster on first render and any future refresh — no local synthesis needed.
        setActiveRoomId(roomId);
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [sdk]);

  const openNewRoom = useCallback(() => setNewRoomOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const handleSettingsOpenChange = useCallback((open: boolean) => {
    setSettingsOpen(open);
  }, []);
  const handleSettingsTabChange = useCallback((tab: SettingsTabId) => {
    setSettingsTab(tab);
  }, []);

  const handleSendMessage = useCallback(async (input: { text: string; quotedMessageId?: string; attachmentIds: string[]; mentions: string[] }) => {
    if (!activeRoomId) return;
    await sdk.sendMessage(activeRoomId, {
      text: input.text,
      ...(input.quotedMessageId ? { quotedMessageId: input.quotedMessageId } : {}),
      ...(input.attachmentIds.length > 0 ? { attachmentIds: input.attachmentIds } : {}),
      ...(input.mentions.length > 0 ? { mentions: input.mentions } : {})
    } as never);
  }, [activeRoomId, sdk]);

  const handleEditSend = useCallback(async (messageId: string, input: { text: string; attachmentIds: string[]; mentions: string[] }) => {
    await csrfFetch(`/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: JSON.stringify({ text: input.text, attachmentIds: input.attachmentIds, mentions: input.mentions })
    });
    setEditingTurnId(undefined);
  }, [csrfFetch]);

  const handleCancelPending = useCallback(async (pendingTurnId: string) => {
    await csrfFetch(`/pending-turns/${encodeURIComponent(pendingTurnId)}`, { method: "DELETE" });
  }, [csrfFetch]);

  const handleQuoteMessage = useCallback((id: string) => {
    if (!activeRoomId) return;
    const m = activeRoom?.messages.find((mm) => mm.id === id);
    const draftKey = `agenthub.draft.${activeRoomId}`;
    try {
      const raw = sessionStorage.getItem(draftKey);
      const next = raw ? JSON.parse(raw) : {};
      next.quotedMessageId = id;
      next.quotePreview = m?.text?.slice(0, 80) ?? "";
      sessionStorage.setItem(draftKey, JSON.stringify(next));
      window.dispatchEvent(new StorageEvent("storage", { key: draftKey, newValue: JSON.stringify(next) }));
    } catch {
      // ignore
    }
  }, [activeRoom, activeRoomId]);

  const handlePin = useCallback(async (id: string) => {
    await csrfFetch(`/messages/${encodeURIComponent(id)}/pin`, { method: "POST" });
  }, [csrfFetch]);

  const handleRegenerate = useCallback(async (id: string) => {
    await csrfFetch(`/messages/${encodeURIComponent(id)}/regenerate`, { method: "POST" });
  }, [csrfFetch]);

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm("Delete this message?")) return;
    await csrfFetch(`/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
  }, [csrfFetch]);

  const openTasksPanel = useCallback(() => {
    setRightCollapsed(false);
    setSidePanelTab("tasks");
  }, []);

  const handleOpenTask = useCallback(() => {
    openTasksPanel();
  }, [openTasksPanel]);

  const handleEditPending = useCallback((messageId: string) => {
    setEditingTurnId(messageId);
    if (!activeRoomId) return;
    const message = activeRoom?.pendingTurns.find((turn) => turn.id === messageId) ?? activeRoom?.messages.find((turn) => turn.id === messageId);
    const draftKey = `agenthub.draft.${activeRoomId}`;
    try {
      const next = {
        text: message?.text ?? "",
        mentions: [] as string[],
        attachments: [] as unknown[]
      };
      const newValue = JSON.stringify(next);
      sessionStorage.setItem(draftKey, newValue);
      window.dispatchEvent(new StorageEvent("storage", { key: draftKey, newValue }));
    } catch {
      // ignore
    }
  }, [activeRoom, activeRoomId]);

  // Global hotkeys
  useHotkeys("mod+k", (e) => { e.preventDefault(); setPaletteOpen((v) => !v); }, { enableOnFormTags: true });
  useHotkeys("shift+/", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    e.preventDefault();
    setKeymapOpen((v) => !v);
  });
  useHotkeys("g+r", () => setLeftCollapsed(false));
  useHotkeys("g+d", () => { setRightCollapsed(false); setSidePanelTab("debug"); });

  // Message navigation
  const messageIds = activeRoom?.messages.map((m) => m.id) ?? [];
  useHotkeys("j", () => {
    if (!messageIds.length) return;
    const idx = selectedMessageId ? messageIds.indexOf(selectedMessageId) : -1;
    setSelectedMessageId(messageIds[Math.min(messageIds.length - 1, idx + 1)]);
  });
  useHotkeys("k", () => {
    if (!messageIds.length) return;
    const idx = selectedMessageId ? messageIds.indexOf(selectedMessageId) : 0;
    setSelectedMessageId(messageIds[Math.max(0, idx - 1)]);
  });
  useHotkeys("q", () => { if (selectedMessageId) handleQuoteMessage(selectedMessageId); });
  useHotkeys("p", () => { if (selectedMessageId) void handlePin(selectedMessageId); });
  useHotkeys("d", () => { if (selectedMessageId) void handleDelete(selectedMessageId); });
  useHotkeys("r", () => {
    const m = activeRoom?.messages.find((mm) => mm.id === selectedMessageId);
    if (m?.runId) setActiveRunId(m.runId);
  });

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      { id: "new-room", label: "New room", group: "Rooms", perform: openNewRoom },
      { id: "open-settings", label: "Open Settings", group: "Settings", keywords: ["roles", "runtimes", "models", "permissions", "workspace", "mcp"], perform: openSettings },
      { id: "toggle-left", label: leftCollapsed ? "Show rooms panel" : "Hide rooms panel", group: "View", perform: () => setLeftCollapsed((v) => !v) },
      { id: "toggle-right", label: rightCollapsed ? "Show workbench panel" : "Hide workbench panel", group: "View", perform: () => setRightCollapsed((v) => !v) },
      { id: "panel-context", label: "Workbench: Context", group: "View", perform: () => { setRightCollapsed(false); setSidePanelTab("context"); } },
      { id: "panel-tasks", label: "Workbench: Tasks", group: "View", perform: () => { setRightCollapsed(false); setSidePanelTab("tasks"); } },
      { id: "panel-members", label: "Workbench: Members", group: "View", perform: () => { setRightCollapsed(false); setSidePanelTab("members"); } },
      { id: "panel-debug", label: "Workbench: Debug", group: "View", perform: () => { setRightCollapsed(false); setSidePanelTab("debug"); } },
      { id: "panel-cost", label: "Workbench: Cost", group: "View", perform: () => { setRightCollapsed(false); setSidePanelTab("cost"); } },
      { id: "theme-light", label: "Theme: Light", group: "Theme", keywords: ["theme", "light"], perform: () => setTheme("light") },
      { id: "theme-dark", label: "Theme: Dark", group: "Theme", keywords: ["theme", "dark"], perform: () => setTheme("dark") },
      { id: "theme-auto", label: "Theme: Auto", group: "Theme", keywords: ["theme", "auto"], perform: () => setTheme("auto") },
      { id: "density-cozy", label: "Density: Cozy", group: "Theme", keywords: ["density", "cozy", "spacing"], perform: () => setDensity("cozy") },
      { id: "density-compact", label: "Density: Compact", group: "Theme", keywords: ["density", "compact", "spacing"], perform: () => setDensity("compact") },
      { id: "show-keymap", label: "Show keyboard shortcuts", group: "Help", perform: () => setKeymapOpen(true) }
    ];
    for (const room of rooms) {
      list.push({
        id: `room-${room.id}`,
        label: `Open room · ${room.title}`,
        group: "Rooms",
        keywords: [room.id, room.mode],
        perform: () => setActiveRoomId(room.id)
      });
    }
    return list;
  }, [rooms, openNewRoom, openSettings, leftCollapsed, rightCollapsed, setTheme, setDensity]);

  const center = activeRoom ? (
    <div className="flex h-full flex-col">
      <ChatStream
        room={activeRoom}
        selectedMessageId={selectedMessageId}
        onSelectMessage={setSelectedMessageId}
        onOpenRun={(runId) => setActiveRunId(runId)}
        onQuote={handleQuoteMessage}
        onPin={(id) => void handlePin(id)}
        onRegenerate={(id) => void handleRegenerate(id)}
        onDelete={(id) => void handleDelete(id)}
        onOpenTask={handleOpenTask}
        onOpenTasks={openTasksPanel}
        onCancelPending={(id) => void handleCancelPending(id)}
        onEditPending={handleEditPending}
        csrfFetch={csrfFetch}
        connectionStatus={projector.connectionStatus}
        connectionError={projector.connectionError}
      />
      <PendingTurnList
        turns={activeRoom.pendingTurns}
        onCancel={(id) => void handleCancelPending(id)}
        onEdit={handleEditPending}
      />
      <InputBox
        roomId={activeRoom.id}
        participants={activeRoom.participants}
        connectionStatus={projector.connectionStatus}
        pendingCount={activeRoom.pendingTurns.length}
        latestPendingMessageId={activeRoom.pendingTurns.length > 0 ? activeRoom.pendingTurns[activeRoom.pendingTurns.length - 1]!.id : undefined}
        editingTurnId={editingTurnId}
        onCancelEdit={() => setEditingTurnId(undefined)}
        onRequestEdit={handleEditPending}
        csrfFetch={csrfFetch}
        onSend={handleSendMessage}
        onEditSend={handleEditSend}
      />
    </div>
  ) : (
    <HomeView rooms={rooms} onOpenRoom={setActiveRoomId} onCreate={openNewRoom} />
  );

  return (
    <>
      <AppShell
        topBar={
          <TopBar
            connectionStatus={projector.connectionStatus}
            connectionError={projector.connectionError ?? bannerError}
            roomTitle={activeRoom?.title}
            theme={theme}
            onCycleTheme={toggleTheme}
            onOpenCommandPalette={() => setPaletteOpen(true)}
            onOpenKeymap={() => setKeymapOpen(true)}
            onToggleLeft={() => setLeftCollapsed((v) => !v)}
            onToggleRight={() => setRightCollapsed((v) => !v)}
            leftCollapsed={leftCollapsed}
            rightCollapsed={rightCollapsed}
          />
        }
        rail={<FeatureRail active={rail} onSelect={setRail} onOpenSettings={openSettings} />}
        rooms={
          <RoomList
            rooms={rooms}
            activeRoomId={activeRoomId}
            onSelect={setActiveRoomId}
            onCreate={openNewRoom}
          />
        }
        center={center}
        panel={activeRoom ? <SidePanel key={`${activeRoom.id}:${sidePanelTab}`} room={activeRoom} csrfFetch={csrfFetch} initialTab={sidePanelTab} /> : null}
        roomsCollapsed={leftCollapsed}
        panelCollapsed={rightCollapsed || !activeRoom}
      />
      <CommandPalette isOpen={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
      <KeymapModal isOpen={keymapOpen} onOpenChange={setKeymapOpen} />
      <NewRoomDialog isOpen={newRoomOpen} onOpenChange={setNewRoomOpen} onCreate={handleCreateRoom} />
      <SettingsModal isOpen={settingsOpen} selectedTab={settingsTab} onTabChange={handleSettingsTabChange} onOpenChange={handleSettingsOpenChange} />
      <RunDetailDrawer
        isOpen={!!activeRunId}
        onOpenChange={(open) => { if (!open) setActiveRunId(undefined); }}
        room={activeRoom}
        runId={activeRunId}
        onOpenRun={setActiveRunId}
        csrfFetch={csrfFetch}
      />
    </>
  );
}
