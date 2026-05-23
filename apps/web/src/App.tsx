import { useState, useCallback } from "react";
import { Layout } from "./components/Layout.tsx";
import { RoomList } from "./components/RoomList.tsx";
import { ChatStream } from "./components/ChatStream.tsx";
import { InputBox } from "./components/InputBox.tsx";
import { SidePanel } from "./components/SidePanel.tsx";
import { RunDetail } from "./components/RunDetail.tsx";
import { useProjector } from "./hooks/useProjector.ts";
import { useCsrfFetch, useSdk } from "./hooks/useSdk.ts";

export function App() {
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>();
  const [activeRunId, setActiveRunId] = useState<string | undefined>();
  const [sidePanelTab, setSidePanelTab] = useState<"context" | "tasks" | "members" | "runs" | "debug">("context");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const projector = useProjector("main", activeRoomId);
  const sdk = useSdk();
  const csrfFetch = useCsrfFetch();

  const room = activeRoomId ? projector.rooms.get(activeRoomId) : undefined;

  const handleSelectRoom = useCallback((roomId: string) => {
    setActiveRoomId(roomId);
    setActiveRunId(undefined);
  }, []);

  const handleOpenRunDetail = useCallback((runId: string) => {
    setActiveRunId(runId);
  }, []);

  const handleCloseRunDetail = useCallback(() => {
    setActiveRunId(undefined);
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      if (!activeRoomId) return;
      try {
        await sdk.sendMessage(activeRoomId, { text });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("send failed", error);
      }
    },
    [activeRoomId, sdk]
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
              connectionStatus={projector.connectionStatus}
            />
            <InputBox
              onSend={handleSend}
              disabled={projector.connectionStatus !== "connected"}
              room={room}
              pendingTurnCount={room.pendingTurns.length}
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
          <SidePanel room={room} activeTab={sidePanelTab} onChangeTab={setSidePanelTab} onOpenRunDetail={handleOpenRunDetail} />
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
