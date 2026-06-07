import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button, ScrollShadow, Skeleton } from "@heroui/react";
import type { RoomViewModel } from "../../types.ts";
import { MessageItem } from "./MessageItem.tsx";
import { BriefItem } from "./BriefItem.tsx";
import { TypingIndicator } from "./TypingIndicator.tsx";
import { ConnectionBanner } from "./ConnectionBanner.tsx";
import { RunBriefToasts } from "./RunBriefToasts.tsx";
import { MailboxFailureCard } from "../cards/MailboxFailureCard.tsx";
import { PermissionCard } from "../cards/PermissionCard.tsx";

interface ChatStreamProps {
  room: RoomViewModel;
  selectedMessageId?: string | undefined;
  onSelectMessage: (id: string | undefined) => void;
  onOpenRun: (runId: string) => void;
  onReply: (id: string) => void;
  onQuote: (id: string) => void;
  onPin: (id: string) => void;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenTask: (taskId: string) => void;
  onOpenTasks: () => void;
  onCancelPending: (pendingTurnId: string) => void;
  onStopDiscussion?: ((runId: string) => void) | undefined;
  onEditPending: (id: string) => void;
  csrfFetch: typeof fetch;
  connectionStatus: "connected" | "connecting" | "reconnecting" | "offline" | "disconnected";
  connectionError?: string | undefined;
}

type FeedItem =
  | { kind: "message"; id: string; data: ChatStreamProps["room"]["messages"][number] }
  | { kind: "brief"; id: string; data: ChatStreamProps["room"]["briefs"][number] }
  | { kind: "permission"; id: string; data: ChatStreamProps["room"]["pendingPermissions"][number] };

const taskNotificationBriefKinds = new Set<RoomViewModel["briefs"][number]["kind"]>([
  "dispatch_started",
  "dispatch_completed"
]);

export function buildChatFeedItems(room: RoomViewModel): FeedItem[] {
  return [
    ...room.messages.map((m) => ({ kind: "message" as const, id: m.id, data: m })),
    ...room.pendingPermissions
      .filter((p) => p.status === "pending")
      .map((p) => ({ kind: "permission" as const, id: p.id, data: p })),
    ...room.briefs
      .filter((b) => !taskNotificationBriefKinds.has(b.kind))
      .map((b, i) => ({ kind: "brief" as const, id: `${b.runId}-${i}`, data: b }))
  ];
}

export function activeRunIndicatorProps(room: RoomViewModel): { readonly runId: string; readonly agentName: string; readonly status: string; readonly mode?: string; readonly turnIndex?: number } | undefined {
  const activeRun = room.runs.find((r) => r.status === "running" || r.status === "starting" || r.status === "queued" || r.status === "cancelling");
  if (activeRun === undefined) return undefined;
  const sameMessageRuns = activeRun.messageId !== undefined
    ? room.runs.filter((run) => run.messageId === activeRun.messageId && run.wakeReason === activeRun.wakeReason)
    : [];
  const turnIndex = room.mode === "assisted" && sameMessageRuns.length > 0
    ? sameMessageRuns.findIndex((run) => run.id === activeRun.id) + 1
    : undefined;
  return {
    runId: activeRun.id,
    agentName: activeRun.agentName,
    status: activeRun.status,
    mode: room.mode,
    ...(turnIndex !== undefined && turnIndex > 0 ? { turnIndex } : {})
  };
}

export function pinnedMessagesForDrawer(room: RoomViewModel): RoomViewModel["messages"] {
  return room.messages
    .filter((message) => message.pinnedAt !== undefined)
    .slice()
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
}

export function latestRegenerableAgentMessageId(messages: RoomViewModel["messages"]): string | undefined {
  let latest: RoomViewModel["messages"][number] | undefined;
  for (const message of messages) {
    if (message.senderType !== "agent" || message.status !== "completed") continue;
    if (latest === undefined || message.createdAt >= latest.createdAt) latest = message;
  }
  return latest?.id;
}

export function ChatStream(props: ChatStreamProps) {
  const { room } = props;

  const items = useMemo<FeedItem[]>(() => {
    return buildChatFeedItems(room);
  }, [room.messages, room.pendingPermissions, room.briefs]);

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

  const activeIndicator = activeRunIndicatorProps(room);
  const pinnedMessages = useMemo(() => pinnedMessagesForDrawer(room), [room.messages]);
  const regenerableMessageId = useMemo(() => latestRegenerableAgentMessageId(room.messages), [room.messages]);
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
    <div className="relative flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--accent)_9%,transparent),transparent_34%),linear-gradient(180deg,var(--background),var(--background-secondary))]">
      <RunBriefToasts roomId={room.id} briefs={room.briefs} onOpenRun={props.onOpenRun} />
      {props.connectionStatus !== "connected" ? (
        <div className="px-3 pt-2">
          <ConnectionBanner status={props.connectionStatus} error={props.connectionError} />
        </div>
      ) : null}
      {pinnedMessages.length > 0 ? (
        <PinnedContextDrawer messages={pinnedMessages} onUnpin={props.onPin} />
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
      <ScrollShadow className="min-h-0 flex-1 overflow-hidden" orientation="vertical">
        <div ref={parentRef} className="h-full overflow-auto" tabIndex={0} onClick={() => props.onSelectMessage(undefined)}>
          {showFirstConnectSkeleton ? (
            <div className="mx-auto flex max-w-[920px] flex-col gap-3 p-4" aria-label="Loading messages">
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
              <p>发送一条消息来开始对话。</p>
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
                        onReply={() => props.onReply(item.id)}
                        onQuote={() => props.onQuote(item.id)}
                        onPin={() => props.onPin(item.id)}
                        onRegenerate={item.id === regenerableMessageId ? () => props.onRegenerate(item.id) : undefined}
                        onDelete={() => props.onDelete(item.id)}
                        onCancelPending={item.data.pendingTurnId ? () => props.onCancelPending(item.data.pendingTurnId!) : undefined}
                        onEditPending={() => props.onEditPending(item.id)}
                        csrfFetch={props.csrfFetch}
                      />
                    ) : item.kind === "permission" ? (
                      <div className="mx-auto my-2 w-full max-w-[760px] px-4">
                        <PermissionCard
                          card={{
                            type: "permission",
                            permissionId: item.data.id,
                            agentId: item.data.agentId,
                            resource: item.data.resource,
                            reason: item.data.reason,
                            status: item.data.status
                          }}
                          csrfFetch={props.csrfFetch}
                        />
                      </div>
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
      {activeIndicator ? (
        <TypingIndicator {...activeIndicator} onStopDiscussion={props.onStopDiscussion} />
      ) : null}
    </div>
  );
}

function PinnedContextDrawer({ messages, onUnpin }: { readonly messages: RoomViewModel["messages"]; readonly onUnpin: (id: string) => void }) {
  return (
    <details className="mx-3 mt-2 shrink-0 rounded-xl border border-border bg-overlay/85 px-3 py-2 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold">
        Pinned Context <span className="ml-2 text-xs font-medium text-muted">{messages.length} pinned</span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {messages.map((message) => (
          <div key={message.id} className="rounded-lg border border-border/70 bg-surface-secondary/70 px-3 py-2">
            <div className="grid gap-1">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 line-clamp-2 text-xs leading-5 text-muted">
                  {pinnedMessagePreview(message)}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  aria-label={`Unpin pinned message ${message.id}`}
                  onPress={() => onUnpin(message.id)}
                >
                  Unpin
                </Button>
              </div>
              {pinnedArtifactRef(message) !== undefined ? (
                <p className="text-[11px] font-medium text-warning-soft-foreground">Content compacted to avoid expanding large artifacts.</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function pinnedMessagePreview(message: RoomViewModel["messages"][number]): string {
  const text = message.text.trim();
  const artifactRef = pinnedArtifactRef(message);
  if (artifactRef !== undefined && text.length > 0) return `${artifactRef} ${truncatePinnedMessageText(text, 140)}`;
  if (artifactRef !== undefined) return artifactRef;
  if (text.length > 0) return truncatePinnedMessageText(text, 160);
  return "Pinned message";
}

function pinnedArtifactRef(message: RoomViewModel["messages"][number]): string | undefined {
  return message.parts
    .map((part) => {
      if (part.type !== "card") return undefined;
      const card = part.card as Record<string, unknown>;
      return card.type === "artifact" && typeof card.artifactId === "string" ? `@artifact:${card.artifactId}` : undefined;
    })
    .find((ref): ref is string => ref !== undefined);
}

function truncatePinnedMessageText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trimEnd()}...` : text;
}
