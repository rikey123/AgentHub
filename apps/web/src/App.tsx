import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@heroui/react";
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
import { ArtifactsRailContainer, ContactsRailContainer } from "./components/rail/RailViews.tsx";
import { RunDetailDrawer } from "./components/run/RunDetailDrawer.tsx";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette.tsx";
import { KeymapModal } from "./components/KeymapModal.tsx";
import { NewRoomDialog, type CreateRoomInput } from "./components/NewRoomDialog.tsx";
import { SettingsModal } from "./components/settings/index.ts";
import { getSettingsSearch, getSettingsStateFromSearch } from "./components/settings/settingsUrl.ts";
import type { SettingsTabId } from "./components/settings/SettingsModal.tsx";
import type { AgentContactViewModel } from "./types.ts";
import { normalizedRoomSearchQuery, useProjector } from "./hooks/useProjector.ts";
import { useSdk, useCsrfFetch } from "./hooks/useSdk.ts";
import { useTheme } from "./hooks/useTheme.ts";

type ChatRoomLayoutProps = {
  readonly chat: React.ReactNode;
  readonly pendingTurns: React.ReactNode;
  readonly input: React.ReactNode;
};

export function ChatRoomLayout({ chat, pendingTurns, input }: ChatRoomLayoutProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="chat-room-layout">
      <div className="min-h-0 flex-1 overflow-hidden" data-testid="chat-scroll-region">{chat}</div>
      <div className="shrink-0" data-testid="chat-pending-region">{pendingTurns}</div>
      <div className="shrink-0" data-testid="chat-input-region">{input}</div>
    </div>
  );
}

export function messagePinRequestFor(roomId: string, messageId: string, isPinned: boolean): { readonly url: string; readonly method: "POST" | "DELETE" } {
  return {
    url: `/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/pin`,
    method: isPinned ? "DELETE" : "POST"
  };
}

export function roomPinRequestFor(roomId: string, isPinned: boolean): { readonly url: string; readonly method: "POST" | "DELETE" } {
  return {
    url: `/rooms/${encodeURIComponent(roomId)}/pin`,
    method: isPinned ? "DELETE" : "POST"
  };
}

type MessageDraftState = { text?: string; quotedMessageId?: string; quotePreview?: string; quoteInsertText?: string };

export function draftWithQuotedMessage(draft: MessageDraftState, messageId: string, preview: string): MessageDraftState {
  const { quoteInsertText: _quoteInsertText, ...baseDraft } = draft;
  return {
    ...baseDraft,
    quotedMessageId: messageId,
    quotePreview: preview.slice(0, 80)
  };
}

export function draftWithQuotedText(draft: MessageDraftState, text: string): MessageDraftState {
  const { quotedMessageId: _quotedMessageId, quotePreview: _quotePreview, quoteInsertText: _quoteInsertText, ...baseDraft } = draft;
  if (text.trim().length === 0) return baseDraft;
  const quoteText = text
    .split(/\r?\n/u)
    .map((line) => `> ${line}`)
    .join("\n")
    .trimEnd();
  if (quoteText.length === 0) return baseDraft;
  return {
    ...baseDraft,
    quoteInsertText: quoteText
  };
}

export function workbenchCenterModeForRail(rail: RailItem, hasActiveRoom: boolean): "home" | "room" | "contacts" | "artifacts" {
  if (rail === "contacts") return "contacts";
  if (rail === "artifacts") return "artifacts";
  return hasActiveRoom ? "room" : "home";
}

export function workbenchNavigationForRoomOpen(roomId: string, currentRail: RailItem): { readonly activeRoomId: string; readonly rail: RailItem } {
  void currentRail;
  return { activeRoomId: roomId, rail: "chat" };
}

export function createRoomInputForContactStartChat(contact: AgentContactViewModel): CreateRoomInput & { readonly agentBindingId: string } {
  return {
    title: `Chat with ${contact.displayName}`,
    mode: "assisted",
    primaryAgentId: contact.agentBindingId,
    agentBindingId: contact.agentBindingId,
    participants: []
  };
}

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
  // 默认收起右侧工作台面板，打开房间时优先展示对话
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [sidePanelTab, setSidePanelTab] = useState<"context" | "tasks" | "members" | "debug" | "cost">("context");
  const [rail, setRail] = useState<RailItem>("chat");
  const [bannerError, setBannerError] = useState<string | undefined>();
  const [unstallPending, setUnstallPending] = useState(false);
  const [roomSearchQuery, setRoomSearchQuery] = useState("");

  const projector = useProjector("main", activeRoomId, undefined, roomSearchQuery);
  const sdk = useSdk();
  const csrfFetch = useCsrfFetch();
  const { theme, setTheme, toggleTheme, setDensity } = useTheme();
  const contactStartPendingRef = useRef<Set<string>>(new Set());
  const latestContactStartRequestRef = useRef(0);
  const latestContactStartSuccessRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextSearch = getSettingsSearch(window.location.search, settingsOpen, settingsTab);
    if (nextSearch === window.location.search) return;

    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [settingsOpen, settingsTab]);

  const activeSearchQuery = normalizedRoomSearchQuery(roomSearchQuery);
  const hasMatchingServerSearchResults = activeSearchQuery.length > 0 && projector.roomSearchResultQuery === activeSearchQuery && projector.roomSearchResultIds !== undefined;
  const rooms = useMemo(() => {
    const allRooms = Array.from(projector.rooms.values());
    if (!hasMatchingServerSearchResults || projector.roomSearchResultIds === undefined) return allRooms;
    const resultIds = new Set(projector.roomSearchResultIds);
    return allRooms.filter((room) => resultIds.has(room.id));
  }, [hasMatchingServerSearchResults, projector.roomSearchResultIds, projector.rooms]);
  const activeRoom = activeRoomId ? projector.rooms.get(activeRoomId) : undefined;

  const openRoom = useCallback((roomId: string) => {
    const next = workbenchNavigationForRoomOpen(roomId, rail);
    setActiveRoomId(next.activeRoomId);
    setRail(next.rail);
  }, [rail]);

  const handleCreateRoom = useCallback(async (input: CreateRoomInput) => {
    setBannerError(undefined);
    try {
      const res = await sdk.createRoom({
        title: input.title,
        mode: input.mode,
        primaryAgentId: input.primaryAgentId,
        ...(input.leaderRoleId !== undefined ? { leaderRoleId: input.leaderRoleId } : {}),
        ...(input.skillIds !== undefined ? { skillIds: input.skillIds } : {}),
        participants: input.participants
      }) as { data?: { roomId?: string }; id?: string; roomId?: string };
      const roomId = res?.data?.roomId ?? res?.roomId ?? res?.id;
      if (typeof roomId === "string") {
        // The daemon emits real `agent.joined` + `agent.state.changed` events for every
        // participant inside the same transaction as room.created, so SSE replay gives us the
        // member roster on first render and any future refresh — no local synthesis needed.
        openRoom(roomId);
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [openRoom, sdk]);

  const handleStartContactChat = useCallback(async (contact: AgentContactViewModel) => {
    if (contactStartPendingRef.current.has(contact.agentBindingId)) return;
    contactStartPendingRef.current.add(contact.agentBindingId);
    const requestId = latestContactStartRequestRef.current + 1;
    latestContactStartRequestRef.current = requestId;
    setBannerError(undefined);
    try {
      const res = await sdk.createRoom(createRoomInputForContactStartChat(contact)) as { data?: { roomId?: string }; id?: string; roomId?: string };
      const roomId = res?.data?.roomId ?? res?.roomId ?? res?.id;
      if (typeof roomId === "string" && requestId > latestContactStartSuccessRef.current) {
        latestContactStartSuccessRef.current = requestId;
        openRoom(roomId);
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : String(err));
    } finally {
      contactStartPendingRef.current.delete(contact.agentBindingId);
    }
  }, [openRoom, sdk]);

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
    });
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

  const handleStopDiscussion = useCallback(async () => {
    if (!activeRoomId) return;
    setBannerError(undefined);
    try {
      const response = await csrfFetch(`/rooms/${encodeURIComponent(activeRoomId)}/discussion/stop`, { method: "POST" });
      if (!response.ok) throw new Error(`Stop discussion failed with ${response.status}`);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : String(err));
    }
  }, [activeRoomId, csrfFetch]);

  const writeMessageDraft = useCallback((updater: (draft: MessageDraftState) => MessageDraftState) => {
    if (!activeRoomId) return;
    const draftKey = `agenthub.draft.${activeRoomId}`;
    try {
      const raw = sessionStorage.getItem(draftKey);
      const parsed = raw ? JSON.parse(raw) as MessageDraftState : {};
      const next = updater(parsed);
      sessionStorage.setItem(draftKey, JSON.stringify(next));
      window.dispatchEvent(new StorageEvent("storage", { key: draftKey, newValue: JSON.stringify(next) }));
    } catch {
      // ignore
    }
  }, [activeRoomId]);

  const handleReplyMessage = useCallback((id: string) => {
    const message = activeRoom?.messages.find((item) => item.id === id);
    writeMessageDraft((draft) => draftWithQuotedMessage(draft, id, message?.text ?? ""));
  }, [activeRoom, writeMessageDraft]);

  const handleQuoteMessage = useCallback((id: string) => {
    const message = activeRoom?.messages.find((item) => item.id === id);
    writeMessageDraft((draft) => draftWithQuotedText(draft, message?.text ?? ""));
  }, [activeRoom, writeMessageDraft]);

  const handlePin = useCallback(async (id: string) => {
    if (!activeRoomId) return;
    const message = activeRoom?.messages.find((item) => item.id === id);
    const request = messagePinRequestFor(activeRoomId, id, message?.pinnedAt !== undefined);
    await csrfFetch(request.url, { method: request.method });
  }, [activeRoom, activeRoomId, csrfFetch]);

  const handleToggleRoomPin = useCallback(async (roomId: string, isPinned: boolean) => {
    const request = roomPinRequestFor(roomId, isPinned);
    await csrfFetch(request.url, { method: request.method });
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

  const handleOpenArtifact = useCallback((input: { artifactId: string; runId: string; path: string }) => {
    setActiveRunId(input.runId);
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", `#artifact:${encodeURIComponent(input.artifactId)}:${encodeURIComponent(input.path)}`);
      window.dispatchEvent(new Event("hashchange"));
    }
  }, []);

  const handleUnstallRoom = useCallback(async (roomId: string) => {
    setUnstallPending(true);
    setBannerError(undefined);
    try {
      const response = await csrfFetch(`/rooms/${encodeURIComponent(roomId)}/unstall`, { method: "POST" });
      if (!response.ok) throw new Error(`Unstall failed with ${response.status}`);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnstallPending(false);
    }
  }, [csrfFetch]);

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
      { id: "new-room", label: "新建 room", group: "Rooms", perform: openNewRoom },
      { id: "open-settings", label: "打开设置", group: "设置", keywords: ["roles", "runtimes", "models", "permissions", "workspace", "mcp"], perform: openSettings },
      { id: "toggle-left", label: leftCollapsed ? "显示 rooms 面板" : "隐藏 rooms 面板", group: "视图", perform: () => setLeftCollapsed((v) => !v) },
      { id: "toggle-right", label: rightCollapsed ? "显示工作台面板" : "隐藏工作台面板", group: "视图", perform: () => setRightCollapsed((v) => !v) },
      { id: "panel-context", label: "工作台：上下文", group: "视图", perform: () => { setRightCollapsed(false); setSidePanelTab("context"); } },
      { id: "panel-tasks", label: "工作台：任务", group: "视图", perform: () => { setRightCollapsed(false); setSidePanelTab("tasks"); } },
      { id: "panel-members", label: "工作台：成员", group: "视图", perform: () => { setRightCollapsed(false); setSidePanelTab("members"); } },
      { id: "panel-debug", label: "工作台：DEBUG", group: "视图", perform: () => { setRightCollapsed(false); setSidePanelTab("debug"); } },
      { id: "panel-cost", label: "工作台：计费", group: "视图", perform: () => { setRightCollapsed(false); setSidePanelTab("cost"); } },
      { id: "theme-light", label: "主题：浅色", group: "主题", keywords: ["theme", "light"], perform: () => setTheme("light") },
      { id: "theme-dark", label: "主题：深色", group: "主题", keywords: ["theme", "dark"], perform: () => setTheme("dark") },
      { id: "theme-auto", label: "主题：自动", group: "主题", keywords: ["theme", "auto"], perform: () => setTheme("auto") },
      { id: "density-cozy", label: "密度：宽松", group: "主题", keywords: ["density", "cozy", "spacing"], perform: () => setDensity("cozy") },
      { id: "density-compact", label: "密度：紧凑", group: "主题", keywords: ["density", "compact", "spacing"], perform: () => setDensity("compact") },
      { id: "show-keymap", label: "显示键盘快捷键", group: "帮助", perform: () => setKeymapOpen(true) }
    ];
    for (const room of rooms) {
      list.push({
        id: `room-${room.id}`,
        label: `打开 room · ${room.title}`,
        group: "Rooms",
        keywords: [room.id, room.mode],
        perform: () => openRoom(room.id)
      });
    }
    return list;
  }, [rooms, openRoom, openNewRoom, openSettings, leftCollapsed, rightCollapsed, setTheme, setDensity]);

  const centerMode = workbenchCenterModeForRail(rail, activeRoom !== undefined);
  const roomCenter = activeRoom ? (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {(activeRoom.skillErrors?.length ?? 0) > 0 ? (
        <div className="shrink-0 border-b border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-900 dark:border-danger-800 dark:bg-danger-950/40 dark:text-danger-100">
          <div className="font-semibold">Skill loading errors</div>
          <div className="mt-2 space-y-2">
            {activeRoom.skillErrors!.map((skillError) => (
              <div key={`${skillError.runId}:${skillError.skillId}:${skillError.createdAt}`}>
                Skill '{skillError.skillName ?? skillError.skillId}' failed to load. The run has been stopped.
                <div className="text-xs opacity-80">{skillError.error}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {activeRoom.stalledAt ? (
        <StalledRoomBanner
          reason={activeRoom.stalledReason}
          taskIds={activeRoom.stalledTaskIds ?? []}
          tasks={activeRoom.tasks}
          pending={unstallPending}
          onDismiss={() => void handleUnstallRoom(activeRoom.id)}
        />
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatRoomLayout
          chat={
            <ChatStream
              room={activeRoom}
              selectedMessageId={selectedMessageId}
              onSelectMessage={setSelectedMessageId}
              onOpenRun={(runId) => setActiveRunId(runId)}
              onReply={handleReplyMessage}
              onQuote={handleQuoteMessage}
              onPin={(id) => void handlePin(id)}
              onRegenerate={(id) => void handleRegenerate(id)}
              onDelete={(id) => void handleDelete(id)}
              onOpenTask={handleOpenTask}
              onOpenTasks={openTasksPanel}
              onCancelPending={(id) => void handleCancelPending(id)}
              onStopDiscussion={() => void handleStopDiscussion()}
              onEditPending={handleEditPending}
              csrfFetch={csrfFetch}
              connectionStatus={projector.connectionStatus}
              connectionError={projector.connectionError}
            />
          }
          pendingTurns={
            <PendingTurnList
              turns={activeRoom.pendingTurns}
              onCancel={(id) => void handleCancelPending(id)}
              onEdit={handleEditPending}
            />
          }
          input={
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
          }
        />
      </div>
    </div>
  ) : (
    <HomeView rooms={rooms} onOpenRoom={openRoom} onCreate={openNewRoom} />
  );
  const center = centerMode === "contacts"
    ? <ContactsRailContainer fetchImpl={csrfFetch} onStartChat={handleStartContactChat} onEditContact={() => setSettingsOpen(true)} />
    : centerMode === "artifacts"
      ? <ArtifactsRailContainer fetchImpl={csrfFetch} />
      : roomCenter;

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
            onSelect={openRoom}
            onCreate={openNewRoom}
            onTogglePin={(roomId, isPinned) => void handleToggleRoomPin(roomId, isPinned)}
            onSearchQueryChange={setRoomSearchQuery}
            useServerSearchResults={hasMatchingServerSearchResults}
          />
        }
        center={center}
        panel={activeRoom ? <SidePanel key={`${activeRoom.id}:${sidePanelTab}`} room={activeRoom} csrfFetch={csrfFetch} initialTab={sidePanelTab} onOpenArtifact={handleOpenArtifact} /> : null}
        roomsCollapsed={leftCollapsed}
        panelCollapsed={rightCollapsed || !activeRoom}
      />
      <CommandPalette isOpen={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
      <KeymapModal isOpen={keymapOpen} onOpenChange={setKeymapOpen} />
      <NewRoomDialog isOpen={newRoomOpen} onOpenChange={setNewRoomOpen} onCreate={handleCreateRoom} csrfFetch={csrfFetch} />
      <SettingsModal
        isOpen={settingsOpen}
        selectedTab={settingsTab}
        onTabChange={handleSettingsTabChange}
        onOpenChange={handleSettingsOpenChange}
        fetchImpl={csrfFetch}
      />
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

function StalledRoomBanner({ reason, taskIds, tasks, pending, onDismiss }: { reason?: string | undefined; taskIds: readonly string[]; tasks: ReadonlyArray<{ readonly id: string; readonly title: string }>; pending: boolean; onDismiss: () => void }) {
  const taskById = new Map(tasks.map((task) => [task.id, task.title]));
  const labels = taskIds.map((taskId) => taskById.has(taskId) ? `${taskById.get(taskId)} (${taskId})` : taskId);

  return (
    <div className="shrink-0 border-b border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-950 dark:border-warning-800 dark:bg-warning-950/35 dark:text-warning-100" role="status">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Room stalled{reason ? `: ${reason.replace(/_/gu, " ")}` : ""}</div>
          <div className="mt-1 text-xs opacity-85">
            {labels.length > 0 ? `Tasks: ${labels.join(", ")}` : "No task ids were reported."}
          </div>
        </div>
        <Button size="sm" variant="secondary" isPending={pending} onPress={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
