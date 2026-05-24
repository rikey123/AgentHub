import { useState, useCallback } from "react";
import { Layout } from "./components/Layout.tsx";
import { RoomList } from "./components/RoomList.tsx";
import { ChatStream } from "./components/ChatStream.tsx";
import { InputBox, type SendPayload } from "./components/InputBox.tsx";
import { SidePanel } from "./components/SidePanel.tsx";
import { RunDetail } from "./components/RunDetail.tsx";
import { PendingTurnList } from "./components/PendingTurnList.tsx";
import { useProjector } from "./hooks/useProjector.ts";
import { useCsrfFetch, useSdk } from "./hooks/useSdk.ts";

export function App() {
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>();
  const [activeRunId, setActiveRunId] = useState<string | undefined>();
  const [sidePanelTab, setSidePanelTab] = useState<"context" | "tasks" | "members" | "debug" | "cost">("context");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [editingPendingTurn, setEditingPendingTurn] = useState<{ readonly messageId: string; readonly text: string } | undefined>(undefined);
  const [editError, setEditError] = useState<string | undefined>(undefined);

  const projector = useProjector("main", activeRoomId);
  const sdk = useSdk();
  const csrfFetch = useCsrfFetch();

  const room = activeRoomId ? projector.rooms.get(activeRoomId) : undefined;

  const handleSelectRoom = useCallback((roomId: string) => {
    setActiveRoomId(roomId);
    setActiveRunId(undefined);
    setEditingPendingTurn(undefined);
  }, []);

  const handleOpenRunDetail = useCallback((runId: string) => {
    setActiveRunId(runId);
  }, []);

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
  const isReconnecting = projector.connectionStatus === "reconnecting";

  return (
    <Layout
      leftCollapsed={leftCollapsed}
      onToggleLeft={() => setLeftCollapsed((v) => !v)}
      rightCollapsed={rightCollapsed}
      onToggleRight={() => setRightCollapsed((v) => !v)}
      leftPanel={
        <RoomList
          rooms={Array.from(projector.rooms.values())}
          activeRoomId={activeRoomId}
          onSelectRoom={handleSelectRoom}
          onCreateRoom={async () => {
            try {
              const result = (await sdk.createRoom({ title: "New Room", mode: "solo", primaryAgentId: "mock-builder" })) as {
                data: { roomId: string };
              };
              setActiveRoomId(result.data.roomId);
            } catch (error) {
              // eslint-disable-next-line no-console
              console.error("create room failed", error);
            }
          }}
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
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" }}>
            Select or create a room to start
          </div>
        )
      }
      rightPanel={
        room ? (
          <SidePanel
            room={room}
            activeTab={sidePanelTab}
            onChangeTab={setSidePanelTab}
            onOpenRunDetail={handleOpenRunDetail}
            workspaceId="default-workspace"
          />
        ) : (
          <div style={{ padding: 16, color: "#888" }}>No room selected</div>
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
  );
}
