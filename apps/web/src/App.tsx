import { useState, useCallback, useEffect } from "react";
import { Layout } from "./components/Layout.tsx";
import { RoomList } from "./components/RoomList.tsx";
import { ChatStream } from "./components/ChatStream.tsx";
import { InputBox, type SendPayload } from "./components/InputBox.tsx";
import { SidePanel } from "./components/SidePanel.tsx";
import { RunDetail } from "./components/RunDetail.tsx";
import { PendingTurnList } from "./components/PendingTurnList.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { KeymapModal } from "./components/KeymapModal.tsx";
import { ChatStreamSkeleton } from "./components/Skeleton.tsx";
import { HomeView } from "./components/HomeView.tsx";
import { useProjector } from "./hooks/useProjector.ts";
import { useCsrfFetch, useSdk } from "./hooks/useSdk.ts";
import { useTheme } from "./hooks/useTheme.ts";

export function App() {
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>();
  const [activeRunId, setActiveRunId] = useState<string | undefined>();
  const [sidePanelTab, setSidePanelTab] = useState<"context" | "tasks" | "members" | "debug" | "cost">("context");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [editingPendingTurn, setEditingPendingTurn] = useState<{ readonly messageId: string; readonly text: string } | undefined>(undefined);
  const [editError, setEditError] = useState<string | undefined>(undefined);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [keymapOpen, setKeymapOpen] = useState(false);

  const projector = useProjector("main", activeRoomId);
  const sdk = useSdk();
  const csrfFetch = useCsrfFetch();
  const { theme, density, setTheme, setDensity } = useTheme();

  const room = activeRoomId ? projector.rooms.get(activeRoomId) : undefined;

  const handleSelectRoom = useCallback((roomId: string) => {
    setActiveRoomId(roomId);
    setActiveRunId(undefined);
    setEditingPendingTurn(undefined);
  }, []);

  const handleOpenRunDetail = useCallback((runId: string) => {
    setActiveRunId(runId);
  }, []);

  const handleCreateRoom = useCallback(async () => {
    try {
      const result = (await sdk.createRoom({ title: "New Room", mode: "solo", primaryAgentId: "mock-builder" })) as {
        data: { roomId: string };
      };
      setActiveRoomId(result.data.roomId);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("create room failed", error);
    }
  }, [sdk]);

  const handleCloseRunDetail = useCallback(() => {
    setActiveRunId(undefined);
  }, []);

  const handleSend = useCallback(
    async (payload: SendPayload) => {
      if (!activeRoomId) return;
      try {
        const body: Record<string, unknown> = { text: payload.text };
        if (payload.mentions && payload.mentions.length > 0) {
          body.mentions = payload.mentions;
        }
        if (payload.quotedMessageId) {
          body.quotedMessageId = payload.quotedMessageId;
        }
        if (payload.attachments && payload.attachments.length > 0) {
          body.attachments = payload.attachments.map((a) => ({
            fileId: a.fileId,
            name: a.name,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes
          }));
        }
        if (editingPendingTurn) {
          const res = await csrfFetch(`/messages/${encodeURIComponent(editingPendingTurn.messageId)}`, {
            method: "PATCH",
            body: JSON.stringify(body)
          });
          if (res.status === 409) {
            setEditError("This message has already started processing and cannot be edited.");
            return;
          }
          if (!res.ok) {
            throw new Error(`PATCH failed: ${res.status}`);
          }
          setEditingPendingTurn(undefined);
          setEditError(undefined);
        } else {
          await sdk.sendMessage(activeRoomId, body as { text: string });
          setEditError(undefined);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("send failed", error);
      }
    },
    [activeRoomId, sdk, csrfFetch, editingPendingTurn]
  );

  const handleCancelPendingTurn = useCallback(
    async (pendingTurnId: string) => {
      try {
        await csrfFetch(`/pending-turns/${encodeURIComponent(pendingTurnId)}`, { method: "DELETE", body: "{}" });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("cancel failed", error);
      }
    },
    [csrfFetch]
  );

  const handleEditPendingTurn = useCallback((messageId: string, text: string) => {
    setEditingPendingTurn({ messageId, text });
  }, []);

  const isOffline = projector.connectionStatus === "offline";

  // Global keyboard shortcuts
  useEffect(() => {
    let lastKey = "";
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;

      // Cmd/Ctrl+K for command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdPaletteOpen((v) => !v);
        setKeymapOpen(false);
        return;
      }

      // ? for keymap (when not in input)
      if (e.key === "?" && !isInput) {
        e.preventDefault();
        setKeymapOpen((v) => !v);
        setCmdPaletteOpen(false);
        return;
      }

      // g r / g d sequence shortcuts
      if (!isInput && e.key === "g") {
        lastKey = "g";
        return;
      }
      if (!isInput && lastKey === "g") {
        if (e.key === "r") {
          e.preventDefault();
          setLeftCollapsed(false);
          lastKey = "";
          return;
        }
        if (e.key === "d") {
          e.preventDefault();
          setRightCollapsed(false);
          setSidePanelTab("debug");
          lastKey = "";
          return;
        }
      }
      lastKey = "";
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
    <Layout
      leftCollapsed={leftCollapsed}
      onToggleLeft={() => setLeftCollapsed((v) => !v)}
      rightCollapsed={rightCollapsed}
      onToggleRight={() => setRightCollapsed((v) => !v)}
      connectionStatus={projector.connectionStatus}
      onOpenCommandPalette={() => setCmdPaletteOpen(true)}
      theme={theme}
      onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      leftPanel={
        <RoomList
          rooms={Array.from(projector.rooms.values())}
          activeRoomId={activeRoomId}
          onSelectRoom={handleSelectRoom}
          onCreateRoom={handleCreateRoom}
        />
      }
      centerPanel={
        room ? (
          <>
            <ChatStream
              room={room}
              onOpenRunDetail={handleOpenRunDetail}
              onCancelPendingTurn={handleCancelPendingTurn}
              onEditPendingTurn={handleEditPendingTurn}
              onQuoteMessage={(messageId) => {
                const msg = room.messages.find((m) => m.id === messageId);
                if (!msg) return;
                // InputBox will pick this up via its own state or we can pass it down
                // For now, we'll use a custom event or sessionStorage approach
                const draftKey = `agenthub.draft.${room.id}`;
                const saved = sessionStorage.getItem(draftKey);
                let parsed: Record<string, unknown> = {};
                if (saved) {
                  try { parsed = JSON.parse(saved); } catch { /* ignore */ }
                }
                parsed.quotedMessageId = messageId;
                sessionStorage.setItem(draftKey, JSON.stringify(parsed));
                // Force re-render by dispatching a storage event (InputBox listens to its own draftKey effect)
                window.dispatchEvent(new StorageEvent("storage", { key: draftKey }));
              }}
              connectionStatus={projector.connectionStatus}
            />
            {room.pendingTurns.length > 0 && (
              <PendingTurnList
                pendingTurns={room.pendingTurns}
                onCancel={handleCancelPendingTurn}
                onEdit={handleEditPendingTurn}
                disabled={isOffline}
              />
            )}
            <InputBox
              onSend={handleSend}
              disabled={projector.connectionStatus !== "connected"}
              room={room}
              pendingTurnCount={room.pendingTurns.length}
              editingPendingTurn={editingPendingTurn}
              onClearEdit={() => {
                setEditingPendingTurn(undefined);
                setEditError(undefined);
              }}
              editError={editError}
            />
          </>
        ) : activeRoomId ? (
          <ChatStreamSkeleton count={5} />
        ) : (
          <HomeView rooms={Array.from(projector.rooms.values())} onSelectRoom={handleSelectRoom} onCreateRoom={handleCreateRoom} />
        )
      }
      rightPanel={
        room ? (
          <SidePanel
            room={room}
            activeTab={sidePanelTab}
            onChangeTab={setSidePanelTab}
            workspaceId="default-workspace"
          />
        ) : (
          <div style={{ padding: "var(--ah-space-4)", color: "var(--ah-text-muted)" }}>No room selected</div>
        )
      }
      overlay={
        activeRunId && activeRoomId ? (
          <RunDetail
            roomId={activeRoomId}
            runId={activeRunId}
            onClose={handleCloseRunDetail}
          />
        ) : undefined
      }
    />
    {cmdPaletteOpen && (
      <CommandPalette
        rooms={Array.from(projector.rooms.values())}
        activeRoomId={activeRoomId}
        onSelectRoom={(roomId) => {
          setActiveRoomId(roomId);
          setActiveRunId(undefined);
          setEditingPendingTurn(undefined);
          setCmdPaletteOpen(false);
        }}
        onOpenRunDetail={(runId) => {
          setActiveRunId(runId);
          setCmdPaletteOpen(false);
        }}
        onClose={() => setCmdPaletteOpen(false)}
        onSwitchTheme={setTheme}
        onSwitchDensity={setDensity}
        currentTheme={theme}
        currentDensity={density}
      />
    )}
    {keymapOpen && <KeymapModal onClose={() => setKeymapOpen(false)} />}
    </>
  );
}
