import { useEffect, useRef, useState } from "react";
import type { EventEnvelope } from "@agenthub/protocol/events";
import { EVENT_REGISTRY } from "@agenthub/protocol/events";
import type { RoomViewModel, ProjectorState, MessageViewModel, BriefViewModel, RunViewModel, PermissionViewModel, InterventionViewModel } from "../types.ts";
import { ensureAuthSession } from "./useSdk.ts";

type ProjectorListener = (state: ProjectorState) => void;

type DeltaBatch = {
  readonly messageId: string;
  readonly deltas: string[];
  readonly rafId: number | null;
};

class Projector {
  private rooms = new Map<string, RoomViewModel>();
  private listeners = new Set<ProjectorListener>();
  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private cursor = 0;
  private view: "main" | "detail" = "main";
  private roomId: string | undefined;
  private runId: string | undefined;
  private connectionStatus: ProjectorState["connectionStatus"] = "disconnected";
  private connectionError: string | undefined;
  private deltaBatches = new Map<string, DeltaBatch>();

  connect(view: "main" | "detail", roomId?: string, runId?: string): void {
    this.disconnect();
    this.view = view;
    this.roomId = roomId;
    this.runId = runId;
    this.connectionStatus = "connecting";
    this.connectionError = undefined;
    this.reconnectAttempts = 0;
    this.notify();

    const params = new URLSearchParams();
    params.set("view", view);
    if (roomId) params.set("roomId", roomId);
    if (runId) params.set("runId", runId);
    if (this.cursor > 0) params.set("cursor", String(this.cursor));

    const url = `/event?${params.toString()}`;
    const es = new EventSource(url);
    this.eventSource = es;

    es.onopen = () => {
      this.reconnectDelay = 1000;
      this.reconnectAttempts = 0;
      this.connectionStatus = "connected";
      this.connectionError = undefined;
      this.notify();
    };

    const handleMessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string" && ev.data.startsWith("heartbeat")) return;
      try {
        const envelope = JSON.parse(ev.data as string) as EventEnvelope;
        if (typeof envelope.seq === "number") {
          this.cursor = Math.max(this.cursor, envelope.seq);
        }
        this.apply(envelope);
      } catch {
        // ignore malformed events
      }
    };

    for (const entry of EVENT_REGISTRY) {
      es.addEventListener(entry.type, handleMessage);
    }

    es.onerror = () => {
      this.reconnectAttempts++;
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.connectionStatus = "offline";
        this.connectionError = "SSE connection lost - max retries exceeded";
      } else {
        this.connectionStatus = "reconnecting";
        this.connectionError = "SSE connection lost";
      }
      this.notify();
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Flush any pending delta batches
    for (const batch of this.deltaBatches.values()) {
      if (batch.rafId !== null) {
        cancelAnimationFrame(batch.rafId);
      }
    }
    this.deltaBatches.clear();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.connectionStatus !== "offline") {
        this.connect(this.view, this.roomId, this.runId);
      }
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  subscribe(listener: ProjectorListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private getState(): ProjectorState {
    const state: ProjectorState = {
      rooms: new Map(this.rooms),
      connectionStatus: this.connectionStatus
    };
    if (this.connectionError !== undefined) {
      (state as Record<string, unknown>).connectionError = this.connectionError;
    }
    return state;
  }

  private flushDeltaBatch(messageId: string): void {
    const batch = this.deltaBatches.get(messageId);
    if (!batch || batch.deltas.length === 0) return;
    const combinedText = batch.deltas.join("");
    this.deltaBatches.delete(messageId);

    for (const room of this.rooms.values()) {
      const msgIndex = room.messages.findIndex((m) => m.id === messageId);
      if (msgIndex >= 0) {
        const updatedMessages = [...room.messages];
        updatedMessages[msgIndex] = {
          ...updatedMessages[msgIndex]!,
          text: updatedMessages[msgIndex]!.text + combinedText
        };
        const updatedRoom = { ...room, messages: updatedMessages };
        this.rooms.set(room.id, updatedRoom);
        this.notify();
        break;
      }
    }
  }

  private scheduleDeltaFlush(messageId: string): void {
    const batch = this.deltaBatches.get(messageId);
    if (!batch) return;
    if (batch.rafId !== null) {
      cancelAnimationFrame(batch.rafId);
    }
    const id = requestAnimationFrame(() => {
      const current = this.deltaBatches.get(messageId);
      if (current && current.rafId === id) {
        this.flushDeltaBatch(messageId);
      }
    });
    this.deltaBatches.set(messageId, { ...batch, rafId: id });
  }

  apply(event: EventEnvelope): void {
    const roomId = event.roomId;
    if (!roomId) return;

    const roomOrUndefined = this.rooms.get(roomId);
    let room: RoomViewModel;
    if (roomOrUndefined) {
      room = roomOrUndefined;
    } else {
      room = {
        id: roomId,
        title: roomId,
        mode: "solo",
        participants: [],
        messages: [],
        briefs: [],
        unresolvedInterventions: [],
        pendingPermissions: [],
        contextItems: [],
        tasks: [],
        runs: [],
        pendingTurns: [],
        mailboxFailures: [],
        unreadCount: 0
      };
      this.rooms.set(roomId, room);
    }

    const payload = event.payload as Record<string, unknown> | undefined;
    let changed = false;

    switch (event.type) {
      case "room.created": {
        if (payload && typeof payload.title === "string") {
          this.rooms.set(roomId, { ...room, title: payload.title, mode: typeof payload.mode === "string" ? payload.mode : room.mode });
          changed = true;
        }
        break;
      }
      case "message.created": {
        if (payload && typeof payload.messageId === "string") {
          const messageId = payload.messageId;
          if (room.messages.some((m) => m.id === messageId)) {
            break; // dedupe — projector replays may re-emit
          }
          const message: MessageViewModel = {
            id: messageId,
            roomId,
            senderType: event.agentId ? "agent" : "user",
            senderId: event.agentId ?? (typeof payload.senderId === "string" ? payload.senderId : "user"),
            senderName: event.agentId ? (this.agentName(room, event.agentId) ?? "Agent") : "You",
            role: typeof payload.role === "string" ? payload.role : "user",
            status: "streaming",
            text: typeof payload.text === "string" ? payload.text : "",
            parts: [],
            quotedMessageId: typeof payload.quotedMessageId === "string" ? payload.quotedMessageId : undefined,
            pendingTurnId: typeof payload.pendingTurnId === "string" ? payload.pendingTurnId : undefined,
            createdAt: event.createdAt
          };
          room = { ...room, messages: [...room.messages, message] };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "message.part.delta": {
        if (payload && typeof payload.messageId === "string" && typeof payload.text === "string") {
          const messageId = payload.messageId;
          const existingBatch = this.deltaBatches.get(messageId);
          if (existingBatch) {
            existingBatch.deltas.push(payload.text);
          } else {
            this.deltaBatches.set(messageId, { messageId, deltas: [payload.text], rafId: null });
          }
          this.scheduleDeltaFlush(messageId);
        }
        break;
      }
      case "message.completed": {
        if (payload && typeof payload.messageId === "string") {
          // Flush any pending deltas for this message first
          this.flushDeltaBatch(payload.messageId);
          room = {
            ...room,
            messages: room.messages.map((m) =>
              m.id === payload.messageId ? { ...m, status: "completed", text: typeof payload.text === "string" ? payload.text : m.text } : m
            )
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "message.brief.published": {
        if (payload) {
          const brief: BriefViewModel = {
            kind: (typeof payload.kind === "string" ? payload.kind : "run_completed") as BriefViewModel["kind"],
            runId: typeof event.runId === "string" ? event.runId : typeof payload.runId === "string" ? payload.runId : "",
            agentId: event.agentId ?? "",
            agentName: this.agentName(room, event.agentId ?? "") ?? "Agent",
            summary: typeof payload.text === "string" ? payload.text : typeof payload.summary === "string" ? payload.summary : "",
            artifactCount: typeof payload.artifactCount === "number" ? payload.artifactCount : undefined,
            cost: typeof payload.cost === "object" && payload.cost !== null ? (payload.cost as { tokens: number; usd?: number | undefined }) : undefined,
            failureReason: typeof payload.failureReason === "string" ? payload.failureReason : undefined,
            failureClass: typeof payload.failureClass === "string" ? payload.failureClass : undefined
          };
          room = { ...room, briefs: [...room.briefs, brief] };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "pending_turn.created": {
        if (payload && typeof payload.messageId === "string") {
          const pendingTurnId = typeof payload.pendingTurnId === "string" ? payload.pendingTurnId : payload.messageId;
          const existing = room.messages.find((m) => m.id === payload.messageId);
          if (existing) {
            const updatedMessage = {
              ...existing,
              pendingTurnId,
              pendingTurnStatus: "queued" as const,
              pendingTurnPosition: room.pendingTurns.length + 1
            };
            room = {
              ...room,
              messages: room.messages.map((m) =>
                m.id === payload.messageId
                  ? updatedMessage
                  : m
              ),
              pendingTurns: room.pendingTurns.some((m) => m.pendingTurnId === pendingTurnId)
                ? room.pendingTurns.map((m) => (m.pendingTurnId === pendingTurnId ? updatedMessage : m))
                : [...room.pendingTurns, updatedMessage]
            };
            this.rooms.set(roomId, room);
            changed = true;
          }
        }
        break;
      }
      case "pending_turn.cancelled": {
        if (payload && typeof payload.pendingTurnId === "string") {
          room = {
            ...room,
            messages: room.messages.map((m) =>
              m.pendingTurnId === payload.pendingTurnId ? { ...m, pendingTurnStatus: "cancelled" } : m
            ),
            pendingTurns: room.pendingTurns.filter((m) => m.pendingTurnId !== payload.pendingTurnId)
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "pending_turn.scheduled": {
        if (payload && typeof payload.pendingTurnId === "string") {
          room = {
            ...room,
            messages: room.messages.map((m) =>
              m.pendingTurnId === payload.pendingTurnId ? { ...m, pendingTurnStatus: "scheduled" } : m
            )
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "pending_turn.consumed": {
        if (payload && typeof payload.pendingTurnId === "string") {
          room = {
            ...room,
            messages: room.messages.map((m) =>
              m.pendingTurnId === payload.pendingTurnId ? { ...m, pendingTurnStatus: "consumed" } : m
            ),
            pendingTurns: room.pendingTurns.filter((m) => m.pendingTurnId !== payload.pendingTurnId)
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "agent.run.queued":
      case "agent.run.started":
      case "agent.run.waiting_permission":
      case "agent.run.completed":
      case "agent.run.failed":
      case "agent.run.cancelled": {
        if (payload && typeof payload.runId === "string") {
          const runIndex = room.runs.findIndex((r) => r.id === payload.runId);
          const statusMap: Record<string, string> = {
            "agent.run.queued": "queued",
            "agent.run.started": "starting",
            "agent.run.waiting_permission": "waiting_permission",
            "agent.run.completed": "completed",
            "agent.run.failed": "failed",
            "agent.run.cancelled": "cancelled"
          };
          const run: RunViewModel = {
            id: payload.runId,
            agentId: event.agentId ?? "",
            agentName: this.agentName(room, event.agentId ?? "") ?? "Agent",
            status: statusMap[event.type] ?? "unknown",
            startedAt: typeof payload.startedAt === "number" ? payload.startedAt : undefined,
            endedAt: typeof payload.endedAt === "number" ? payload.endedAt : undefined,
            cost: typeof payload.cost === "object" && payload.cost !== null ? (payload.cost as RunViewModel["cost"]) : undefined,
            failureClass: typeof payload.failureClass === "string" ? payload.failureClass : undefined,
            error: typeof payload.error === "string" ? payload.error : undefined
          };
          if (runIndex >= 0) {
            const updated = [...room.runs];
            updated[runIndex] = run;
            room = { ...room, runs: updated };
          } else {
            room = { ...room, runs: [...room.runs, run] };
          }
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "permission.requested": {
        if (payload && typeof payload.requestId === "string") {
          const resource = typeof payload.resource === "object" && payload.resource !== null ? payload.resource : { type: "tool", toolName: "unknown", input: {} };
          const perm: PermissionViewModel = {
            id: payload.requestId,
            agentId: event.agentId ?? "",
            agentName: this.agentName(room, event.agentId ?? "") ?? "Agent",
            resource: resource as PermissionViewModel["resource"],
            reason: typeof payload.reason === "string" ? payload.reason : undefined,
            status: "pending"
          };
          room = {
            ...room,
            pendingPermissions: [...room.pendingPermissions, perm]
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "permission.resolved": {
        if (payload && typeof payload.requestId === "string") {
          room = {
            ...room,
            pendingPermissions: room.pendingPermissions.map((p) =>
              p.id === payload.requestId
                ? { ...p, status: (typeof payload.decision === "string" ? payload.decision : "denied") as "pending" | "allowed" | "denied" | "expired" }
                : p
            )
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "intervention.requested": {
        if (payload && typeof payload.interventionId === "string") {
          const intervention: InterventionViewModel = {
            id: payload.interventionId,
            agentId: event.agentId ?? "",
            agentName: this.agentName(room, event.agentId ?? "") ?? "Agent",
            reason: typeof payload.reason === "string" ? payload.reason : "",
            priority: (typeof payload.priority === "string" ? payload.priority : "medium") as "low" | "medium" | "high",
            preview: typeof payload.preview === "string" ? payload.preview : undefined,
            status: "pending_user_decision"
          };
          room = {
            ...room,
            unresolvedInterventions: [...room.unresolvedInterventions, intervention]
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "intervention.approved":
      case "intervention.ignored":
      case "intervention.rejected":
      case "intervention.snoozed":
      case "intervention.resolved":
      case "intervention.closed": {
        if (payload && typeof payload.interventionId === "string") {
          room = {
            ...room,
            unresolvedInterventions: room.unresolvedInterventions.filter((i) => i.id !== payload.interventionId)
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "context.item.created":
      case "context.item.proposed":
      case "context.item.confirmed": {
        if (payload && typeof payload.contextId === "string") {
          const existingIndex = room.contextItems.findIndex((c) => c.id === payload.contextId);
          const item = {
            id: payload.contextId,
            title: typeof payload.title === "string" ? payload.title : "Context",
            content: typeof payload.content === "string" ? payload.content : "",
            status: (typeof payload.status === "string" ? payload.status : "draft") as "draft" | "confirmed" | "deprecated" | "disputed",
            scope: typeof payload.scope === "string" ? payload.scope : "conversation",
            pinned: typeof payload.pinned === "boolean" ? payload.pinned : false
          };
          if (existingIndex >= 0) {
            const updated = [...room.contextItems];
            updated[existingIndex] = item;
            room = { ...room, contextItems: updated };
          } else {
            room = { ...room, contextItems: [...room.contextItems, item] };
          }
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "task.created":
      case "task.status.changed": {
        if (payload && typeof payload.taskId === "string") {
          const existingIndex = room.tasks.findIndex((t) => t.id === payload.taskId);
          const task = {
            id: payload.taskId,
            title: typeof payload.title === "string" ? payload.title : "Task",
            status: typeof payload.status === "string" ? payload.status : "todo",
            assigneeAgentId: typeof payload.assigneeAgentId === "string" ? payload.assigneeAgentId : undefined
          };
          if (existingIndex >= 0) {
            const updated = [...room.tasks];
            updated[existingIndex] = task;
            room = { ...room, tasks: updated };
          } else {
            room = { ...room, tasks: [...room.tasks, task] };
          }
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "agent.joined": {
        if (payload && typeof payload.agentId === "string") {
          const name = typeof payload.agentName === "string" ? payload.agentName : payload.agentId;
          if (!room.participants.find((p) => p.id === payload.agentId)) {
            room = {
              ...room,
              participants: [
                ...room.participants,
                {
                  id: payload.agentId,
                  name,
                  role: typeof payload.role === "string" ? payload.role : "observer",
                  presence: "observing",
                  adapterId: typeof payload.adapterId === "string" ? payload.adapterId : "mock"
                }
              ]
            };
            this.rooms.set(roomId, room);
            changed = true;
          }
        }
        break;
      }
      case "agent.state.changed": {
        if (payload && typeof payload.agentId === "string") {
          room = {
            ...room,
            participants: room.participants.map((p) =>
              p.id === payload.agentId ? { ...p, presence: typeof payload.state === "string" ? payload.state : p.presence } : p
            )
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "mailbox.delivery.failed": {
        if (payload) {
          const reason = typeof payload.reason === "string" ? payload.reason : "unknown";
          const targetAgentId = typeof payload.targetAgentId === "string" ? payload.targetAgentId : (event.agentId ?? "");
          const failure = {
            id: `mailbox-fail-${typeof payload.mailboxMessageId === "string" ? payload.mailboxMessageId : Date.now()}-${reason}`,
            mailboxMessageId: typeof payload.mailboxMessageId === "string" ? payload.mailboxMessageId : "",
            targetAgentId,
            targetAgentName: this.agentName(room, targetAgentId),
            reason,
            attemptCount: typeof payload.attemptCount === "number" ? payload.attemptCount : 0,
            failedAt: typeof payload.failedAt === "number" ? payload.failedAt : event.createdAt
          };
          // Replace any existing failure for the same mailboxMessageId+reason; keep latest only.
          const filtered = room.mailboxFailures.filter((f) => f.id !== failure.id);
          room = { ...room, mailboxFailures: [...filtered, failure] };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "subagent.started": {
        if (payload && typeof payload.subagentId === "string") {
          // Add subagent info to runs or messages as a note
          const subagentRun: RunViewModel = {
            id: typeof payload.runId === "string" ? payload.runId : payload.subagentId,
            agentId: event.agentId ?? "",
            agentName: this.agentName(room, event.agentId ?? "") ?? "Subagent",
            status: "starting",
            startedAt: event.createdAt
          };
          const existingIndex = room.runs.findIndex((r) => r.id === subagentRun.id);
          if (existingIndex >= 0) {
            const updated = [...room.runs];
            updated[existingIndex] = { ...updated[existingIndex]!, status: "starting", startedAt: event.createdAt };
            room = { ...room, runs: updated };
          } else {
            room = { ...room, runs: [...room.runs, subagentRun] };
          }
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "subagent.completed": {
        if (payload && typeof payload.subagentId === "string") {
          const runId = typeof payload.runId === "string" ? payload.runId : payload.subagentId;
          const existingIndex = room.runs.findIndex((r) => r.id === runId);
          if (existingIndex >= 0) {
            const updated = [...room.runs];
            updated[existingIndex] = {
              ...updated[existingIndex]!,
              status: "completed",
              endedAt: event.createdAt,
              cost: typeof payload.cost === "object" && payload.cost !== null ? (payload.cost as RunViewModel["cost"]) : undefined
            };
            room = { ...room, runs: updated };
            this.rooms.set(roomId, room);
            changed = true;
          }
        }
        break;
      }
      case "artifact.diff.detected": {
        if (payload && typeof payload.artifactId === "string") {
          // Add a diff card to messages
          const diffMessage: MessageViewModel = {
            id: `artifact-${payload.artifactId}`,
            roomId,
            senderType: "system",
            senderId: "system",
            senderName: "System",
            role: "system",
            status: "completed",
            text: "Artifact diff detected",
            parts: [{
              type: "card",
              seq: 0,
              card: {
                type: "diff",
                artifactId: payload.artifactId,
                files: Array.isArray(payload.files) ? payload.files : [],
                applyStatus: "draft"
              }
            }],
            createdAt: event.createdAt
          };
          room = { ...room, messages: [...room.messages, diffMessage] };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "context.snapshot": {
        if (payload && typeof payload.contextId === "string") {
          const existingIndex = room.contextItems.findIndex((c) => c.id === payload.contextId);
          const item = {
            id: payload.contextId,
            title: typeof payload.title === "string" ? payload.title : "Context Snapshot",
            content: typeof payload.content === "string" ? payload.content : "",
            status: (typeof payload.status === "string" ? payload.status : "draft") as "draft" | "confirmed" | "deprecated" | "disputed",
            scope: typeof payload.scope === "string" ? payload.scope : "conversation",
            pinned: typeof payload.pinned === "boolean" ? payload.pinned : false,
            runId: typeof payload.runId === "string" ? payload.runId : undefined
          };
          if (existingIndex >= 0) {
            const updated = [...room.contextItems];
            updated[existingIndex] = item;
            room = { ...room, contextItems: updated };
          } else {
            room = { ...room, contextItems: [...room.contextItems, item] };
          }
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
    }

    if (changed) {
      this.notify();
    }
  }

  private agentName(room: RoomViewModel, agentId: string): string | undefined {
    return room.participants.find((p) => p.id === agentId)?.name;
  }
}

const globalProjector = new Projector();

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__PROJECTOR__ = globalProjector;
}

export function useProjector(view: "main" | "detail", roomId?: string, runId?: string): ProjectorState {
  const [state, setState] = useState<ProjectorState>({
    rooms: new Map(),
    connectionStatus: "disconnected"
  });

  const viewRef = useRef(view);
  const roomIdRef = useRef(roomId);
  const runIdRef = useRef(runId);

  useEffect(() => {
    let cancelled = false;
    viewRef.current = view;
    roomIdRef.current = roomId;
    runIdRef.current = runId;
    ensureAuthSession()
      .then(() => {
        if (!cancelled) globalProjector.connect(view, roomId, runId);
      })
      .catch(() => {
        if (!cancelled) globalProjector.connect(view, roomId, runId);
      });
    return () => {
      cancelled = true;
      globalProjector.disconnect();
    };
  }, [view, roomId, runId]);

  useEffect(() => {
    return globalProjector.subscribe(setState);
  }, []);

  // Initial fetch of rooms list so UI is populated even before SSE events arrive
  useEffect(() => {
    if (view !== "main") return;
    let cancelled = false;
    ensureAuthSession()
      .then(() => fetch("/rooms", { credentials: "same-origin" }))
      .then((res) => res.json())
      .then((data: { rooms: Array<{ id: string; title: string; mode: string }> }) => {
        if (cancelled) return;
        for (const room of data.rooms) {
          globalProjector.apply({
            id: room.id,
            type: "room.created",
            schemaVersion: 1,
            durability: "durable",
            visibility: "both",
            workspaceId: "default-workspace",
            roomId: room.id,
            payload: { roomId: room.id, title: room.title, mode: room.mode },
            createdAt: Date.now()
          });
        }
      })
      .catch(() => {
        // ignore fetch errors
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

  return state;
}

export function getProjector(): Projector {
  return globalProjector;
}
