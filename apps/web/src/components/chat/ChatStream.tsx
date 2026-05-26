import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollShadow, Skeleton } from "@heroui/react";
import type { RoomViewModel } from "../../types.ts";
import { MessageItem } from "./MessageItem.tsx";
import { BriefItem } from "./BriefItem.tsx";
import { TypingIndicator } from "./TypingIndicator.tsx";
import { ConnectionBanner } from "./ConnectionBanner.tsx";
import { MailboxFailureCard } from "../cards/MailboxFailureCard.tsx";

interface ChatStreamProps {
  room: RoomViewModel;
  selectedMessageId?: string | undefined;
  onSelectMessage: (id: string | undefined) => void;
  onOpenRun: (runId: string) => void;
  onQuote: (id: string) => void;
  onPin: (id: string) => void;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
  onCancelPending: (pendingTurnId: string) => void;
  onEditPending: (id: string) => void;
  csrfFetch: typeof fetch;
  connectionStatus: "connected" | "connecting" | "reconnecting" | "offline" | "disconnected";
  connectionError?: string | undefined;
}

type FeedItem =
  | { kind: "message"; id: string; data: ChatStreamProps["room"]["messages"][number] }
  | { kind: "brief"; id: string; data: ChatStreamProps["room"]["briefs"][number] };

export function ChatStream(props: ChatStreamProps) {
  const { room } = props;

  const items = useMemo<FeedItem[]>(() => {
    const merged: FeedItem[] = [
      ...room.messages.map((m) => ({ kind: "message" as const, id: m.id, data: m })),
      ...room.briefs.map((b, i) => ({ kind: "brief" as const, id: `${b.runId}-${i}`, data: b }))
    ];
    return merged;
  }, [room.messages, room.briefs]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 12,
    measureElement: (el) => el.getBoundingClientRect().height
  });

  const pinnedToBottomRef = useRef(true);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
      pinnedToBottomRef.current = distance < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (pinnedToBottomRef.current && items.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, { align: "end" });
    }
  }, [items.length, virtualizer]);

  // Auto-scroll selected message into view (j/k navigation).
  useEffect(() => {
    if (!props.selectedMessageId || items.length === 0) return;
    const idx = items.findIndex((i) => i.kind === "message" && i.id === props.selectedMessageId);
    if (idx < 0) return;
    const visible = virtualizer.getVirtualItems();
    const inRange = visible.some((v) => v.index === idx);
    if (!inRange) virtualizer.scrollToIndex(idx, { align: "center" });
  }, [props.selectedMessageId, items, virtualizer]);

  const activeRun = room.runs.find((r) => r.status === "running" || r.status === "starting");
  const [dismissedFailures, setDismissedFailures] = useState<Set<string>>(() => new Set());
  const visibleFailures = useMemo(
    () => room.mailboxFailures.filter((f) => !dismissedFailures.has(f.id)),
    [room.mailboxFailures, dismissedFailures]
  );
  const showFirstConnectSkeleton =
    items.length === 0 && props.connectionStatus === "connecting";
  const showEmptyState =
    items.length === 0 &&
    (props.connectionStatus === "connected" || props.connectionStatus === "disconnected" || props.connectionStatus === "offline" || props.connectionStatus === "reconnecting");

  return (
    <div className="flex h-full flex-col">
      {props.connectionStatus !== "connected" ? (
        <div className="px-3 pt-2">
          <ConnectionBanner status={props.connectionStatus} error={props.connectionError} />
        </div>
      ) : null}
      {visibleFailures.length > 0 ? (
        <div className="flex flex-col gap-2 px-3 pt-2">
          {visibleFailures.map((f) => (
            <MailboxFailureCard
              key={f.id}
              id={f.id}
              mailboxMessageId={f.mailboxMessageId}
              targetAgentId={f.targetAgentId}
              targetAgentName={f.targetAgentName}
              reason={f.reason}
              attemptCount={f.attemptCount}
              failedAt={f.failedAt}
              csrfFetch={props.csrfFetch}
              onDismiss={(id) => setDismissedFailures((prev) => new Set(prev).add(id))}
            />
          ))}
        </div>
      ) : null}
      <ScrollShadow className="flex-1 overflow-hidden" orientation="vertical">
        <div ref={parentRef} className="h-full overflow-auto" tabIndex={0}>
          {showFirstConnectSkeleton ? (
            <div className="flex flex-col gap-3 p-3" aria-label="Loading messages">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-24 rounded" />
                  <Skeleton className="h-4 w-3/4 rounded" />
                  <Skeleton className="h-4 w-1/2 rounded" />
                </div>
              ))}
            </div>
          ) : showEmptyState ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
              <p>No messages yet.</p>
              <p>Send a message to start the conversation.</p>
            </div>
          ) : (
            <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const item = items[vi.index]!;
                return (
                  <div
                    key={item.id}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}
                  >
                    {item.kind === "message" ? (
                      <MessageItem
                        message={item.data}
                        isSelected={item.id === props.selectedMessageId}
                        onSelect={() => props.onSelectMessage(item.id)}
                        onOpenRun={(runId) => props.onOpenRun(runId)}
                        onQuote={() => props.onQuote(item.id)}
                        onPin={() => props.onPin(item.id)}
                        onRegenerate={() => props.onRegenerate(item.id)}
                        onDelete={() => props.onDelete(item.id)}
                        onCancelPending={item.data.pendingTurnId ? () => props.onCancelPending(item.data.pendingTurnId!) : undefined}
                        onEditPending={() => props.onEditPending(item.id)}
                        csrfFetch={props.csrfFetch}
                      />
                    ) : (
                      <BriefItem brief={item.data} onOpenRun={props.onOpenRun} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollShadow>
      {activeRun ? (
        <TypingIndicator agentName={activeRun.agentName} status={activeRun.status} />
      ) : null}
    </div>
  );
}
