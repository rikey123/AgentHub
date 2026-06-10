import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button, ScrollShadow, Skeleton } from "@heroui/react";
import type { RoomViewModel } from "../../types.ts";
import { MessageItem, type QuotedMessagePreview } from "./MessageItem.tsx";
import { TypingIndicator } from "./TypingIndicator.tsx";
import { ConnectionBanner } from "./ConnectionBanner.tsx";
import { RunBriefToasts } from "./RunBriefToasts.tsx";
import { MailboxFailureCard } from "../cards/MailboxFailureCard.tsx";
import { PermissionCard } from "../cards/PermissionCard.tsx";
import type { ArtifactChatReference } from "../artifacts/ArtifactPreviewModal.tsx";
import { useChatMotion } from "./useChatMotion.ts";

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
  onReferenceArtifact?: ((reference: ArtifactChatReference) => void) | undefined;
  csrfFetch: typeof fetch;
  connectionStatus: "connected" | "connecting" | "reconnecting" | "offline" | "disconnected";
  connectionError?: string | undefined;
}

type FeedItem =
  | { kind: "message"; id: string; data: ChatStreamProps["room"]["messages"][number] }
  | { kind: "permission"; id: string; data: ChatStreamProps["room"]["pendingPermissions"][number] };

export function buildChatFeedItems(room: RoomViewModel): FeedItem[] {
  return [
    ...room.messages
      .filter(isPublicChatMessage)
      .map((m) => ({ kind: "message" as const, id: m.id, data: m })),
    ...room.pendingPermissions
      .filter((p) => p.status === "pending")
      .map((p) => ({ kind: "permission" as const, id: p.id, data: p }))
  ];
}

function isPublicChatMessage(message: RoomViewModel["messages"][number]): boolean {
  if (message.senderType === "system") return false;
  if (message.senderType === "agent" && (message.status !== "completed" || !hasMeaningfulMessageContent(message))) return false;
  return true;
}

export function activeRunIndicatorProps(room: RoomViewModel): { readonly runId: string; readonly agentName: string; readonly status: string; readonly mode?: string; readonly turnIndex?: number } | undefined {
  const activeRun = room.runs.find((r) => r.status === "running" || r.status === "starting" || r.status === "queued" || r.status === "waiting" || r.status === "cancelling");
  if (activeRun === undefined) return undefined;
  const sameMessageRuns = activeRun.messageId !== undefined
    ? room.runs.filter((run) => run.messageId === activeRun.messageId && run.wakeReason === activeRun.wakeReason)
    : [];
  const turnIndex = room.mode === "assisted" && sameMessageRuns.length > 0
    ? sameMessageRuns.findIndex((run) => run.id === activeRun.id) + 1
    : undefined;
  const status = activeRun.status === "starting" && hasActiveRunOutput(room, activeRun)
    ? "working"
    : activeRun.status;
  return {
    runId: activeRun.id,
    agentName: activeRun.agentName,
    status,
    mode: room.mode,
    ...(turnIndex !== undefined && turnIndex > 0 ? { turnIndex } : {})
  };
}

function hasActiveRunOutput(room: RoomViewModel, activeRun: RoomViewModel["runs"][number]): boolean {
  return room.messages.some((message) => {
    if (message.senderType !== "agent") return false;
    const belongsToRun = message.runId === activeRun.id || (message.runId === undefined && message.senderId === activeRun.agentId && message.status === "streaming");
    return belongsToRun && hasMeaningfulMessageContent(message);
  });
}

function hasMeaningfulMessageContent(message: RoomViewModel["messages"][number]): boolean {
  if (message.text.trim().length > 0) return true;
  return message.parts.some((part) => {
    if (part.type === "text") return part.text.trim().length > 0;
    return true;
  });
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

export function quotedMessagePreviewFor(message: RoomViewModel["messages"][number] | undefined): QuotedMessagePreview | undefined {
  if (message === undefined) return undefined;
  return {
    id: message.id,
    senderName: message.senderName,
    preview: messageSummaryText(message)
  };
}

function messageSummaryText(message: RoomViewModel["messages"][number]): string {
  const text = message.text.trim().replace(/\s+/g, " ");
  if (text.length > 0) return truncateQuotedPreview(text, 96);

  for (const part of message.parts) {
    if (part.type === "text" && part.text.trim().length > 0) return truncateQuotedPreview(part.text.trim().replace(/\s+/g, " "), 96);
    if (part.type === "code") return `${part.lang || "code"} code block`;
    if (part.type === "attachment") return part.name;
    if (part.type === "card") {
      const card = part.card as Record<string, unknown>;
      if (typeof card.title === "string" && card.title.trim().length > 0) return card.title.trim();
      if (typeof card.filename === "string" && card.filename.trim().length > 0) return card.filename.trim();
      if (typeof card.type === "string" && card.type.trim().length > 0) return `${card.type} card`;
    }
  }

  return "被引用消息";
}

function truncateQuotedPreview(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trimEnd()}...` : text;
}

export function ChatStream(props: ChatStreamProps) {
  const { room } = props;

  const items = useMemo<FeedItem[]>(() => {
    return buildChatFeedItems(room);
  }, [room.messages, room.pendingPermissions]);

  const motionRootRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 12,
    measureElement: (el) => el.getBoundingClientRect().height
  });
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;
  const observedRowElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const resizeObserverRef = useRef<ResizeObserver | undefined>(undefined);
  const pendingMeasureRowsRef = useRef<Set<HTMLElement>>(new Set());
  const measureFrameRef = useRef<number | undefined>(undefined);

  const flushVirtualRowMeasurements = useCallback(() => {
    measureFrameRef.current = undefined;
    const rows = [...pendingMeasureRowsRef.current];
    pendingMeasureRowsRef.current.clear();
    for (const row of rows) virtualizerRef.current.measureElement(row);
  }, []);

  const queueVirtualRowMeasurement = useCallback((row: HTMLElement) => {
    pendingMeasureRowsRef.current.add(row);
    if (measureFrameRef.current !== undefined) return;
    if (typeof globalThis.requestAnimationFrame === "function") {
      measureFrameRef.current = globalThis.requestAnimationFrame(flushVirtualRowMeasurements);
      return;
    }
    flushVirtualRowMeasurements();
  }, [flushVirtualRowMeasurements]);

  const measureVirtualRow = useCallback((index: number, element: HTMLDivElement | null) => {
    const previous = observedRowElementsRef.current.get(index);
    if (previous !== undefined && previous !== element) {
      resizeObserverRef.current?.unobserve(previous);
      pendingMeasureRowsRef.current.delete(previous);
      observedRowElementsRef.current.delete(index);
    }
    if (element === null) return;

    observedRowElementsRef.current.set(index, element);
    virtualizerRef.current.measureElement(element);
    if (typeof globalThis.ResizeObserver !== "function") return;

    if (resizeObserverRef.current === undefined) {
      resizeObserverRef.current = new globalThis.ResizeObserver((entries) => {
        for (const entry of entries) {
          queueVirtualRowMeasurement(entry.target as HTMLElement);
        }
      });
    }
    resizeObserverRef.current.observe(element);
  }, [queueVirtualRowMeasurement]);

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

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      if (measureFrameRef.current !== undefined && typeof globalThis.cancelAnimationFrame === "function") {
        globalThis.cancelAnimationFrame(measureFrameRef.current);
      }
      pendingMeasureRowsRef.current.clear();
      observedRowElementsRef.current.clear();
    };
  }, []);

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
  const messagesById = useMemo(() => new Map(room.messages.map((message) => [message.id, message])), [room.messages]);
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
  const activeIndicatorKey = activeIndicator
    ? `${activeIndicator.runId}:${activeIndicator.status}:${activeIndicator.turnIndex ?? 0}`
    : undefined;

  useChatMotion({
    containerRef: motionRootRef,
    items,
    selectedMessageId: props.selectedMessageId,
    activeIndicatorKey
  });

  return (
    <div ref={motionRootRef} className="relative flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--accent)_9%,transparent),transparent_34%),linear-gradient(180deg,var(--background),var(--background-secondary))]">
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
              <p>还没有消息。</p>
              <p>发送一条消息来开始对话。</p>
            </div>
          ) : (
            <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const item = items[vi.index]!;
                return (
                  <div
                    key={item.id}
                    className="ah-chat-virtual-row"
                    data-chat-virtual-row="true"
                    data-chat-feed-item-id={item.id}
                    data-chat-feed-item-kind={item.kind}
                    data-index={vi.index}
                    ref={(element) => measureVirtualRow(vi.index, element)}
                    style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}
                  >
                    {item.kind === "message" ? (
                      <MessageItem
                        message={item.data}
                        quotedMessage={quotedMessagePreviewFor(item.data.quotedMessageId ? messagesById.get(item.data.quotedMessageId) : undefined)}
                        isSelected={item.id === props.selectedMessageId}
                        onSelect={() => props.onSelectMessage(item.id)}
                        onOpenQuotedMessage={(id) => props.onSelectMessage(id)}
                        onOpenRun={(runId) => props.onOpenRun(runId)}
                        onReply={() => props.onReply(item.id)}
                        onQuote={() => props.onQuote(item.id)}
                        onPin={() => props.onPin(item.id)}
                        onRegenerate={item.id === regenerableMessageId ? () => props.onRegenerate(item.id) : undefined}
                        onDelete={() => props.onDelete(item.id)}
                        onCancelPending={item.data.pendingTurnId ? () => props.onCancelPending(item.data.pendingTurnId!) : undefined}
                        onEditPending={() => props.onEditPending(item.id)}
                        onReferenceArtifact={props.onReferenceArtifact}
                        csrfFetch={props.csrfFetch}
                      />
                    ) : (
                      <div className="mx-auto my-2 w-full max-w-[760px] px-4" data-chat-motion-target>
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
        已固定上下文 <span className="ml-2 text-xs font-medium text-muted">{messages.length} 条</span>
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
                  aria-label={`取消固定消息 ${message.id}`}
                  onPress={() => onUnpin(message.id)}
                >
                  取消固定
                </Button>
              </div>
              {pinnedArtifactRef(message) !== undefined ? (
                <p className="text-[11px] font-medium text-warning-soft-foreground">已折叠大型产物内容，避免撑开上下文。</p>
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
  return "已固定消息";
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
