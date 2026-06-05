import { useEffect, useRef, useState } from "react";
import type { EventEnvelope } from "@agenthub/protocol/events";
import { EVENT_REGISTRY } from "@agenthub/protocol/events";
import type { RoomViewModel, ProjectorState, MessageViewModel, BriefViewModel, RunViewModel, PermissionViewModel, InterventionViewModel, TaskActivityViewModel, TaskDelegationViewModel, TaskViewModel, SkillErrorViewModel, TaskFileChangeViewModel, WorktreeReviewViewModel, RoomExecutionPlanViewModel } from "../types.ts";
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

  private upsertTask(room: RoomViewModel, task: TaskViewModel): RoomViewModel {
    const existingIndex = room.tasks.findIndex((t) => t.id === task.id);
    if (existingIndex >= 0) {
      const updated = [...room.tasks];
      updated[existingIndex] = { ...updated[existingIndex]!, ...task };
      return { ...room, tasks: updated };
    }
    return { ...room, tasks: [...room.tasks, task] };
  }

  connect(view: "main" | "detail", roomId?: string, runId?: string): void {
    // When the consumer changes view target (different room or different run), the projector's
    // global `cursor` from the previous SSE session would skip historical events for the new
    // target. Reset the cursor when the (view, roomId, runId) triple changes so SSE replay
    // delivers the full history needed to render the destination.
    const targetChanged = this.view !== view || this.roomId !== roomId || this.runId !== runId;
    if (targetChanged) this.cursor = 0;
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
            break; // dedupe - projector replays may re-emit
          }
          const explicitSenderType = payload.senderType === "agent" || payload.senderType === "system" || payload.senderType === "user"
            ? payload.senderType
            : undefined;
          const senderId = event.agentId ?? (typeof payload.senderId === "string" ? payload.senderId : explicitSenderType ?? "user");
          const senderType = explicitSenderType ?? (event.agentId || this.agentName(room, senderId) ? "agent" : senderId === "system" ? "system" : "user");
          const message: MessageViewModel = {
            id: messageId,
            roomId,
            senderType,
            senderId,
            senderName: this.senderName(room, senderType, senderId),
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
      case "message.part.added": {
        if (payload && typeof payload.messageId === "string" && payload.part && typeof payload.part === "object") {
          const part = payload.part as MessageViewModel["parts"][number];
          room = {
            ...room,
            messages: room.messages.map((m) => {
              if (m.id !== payload.messageId) return m;
              if (m.parts.some((existing) => existing.seq === part.seq && existing.type === part.type)) return m;
              return { ...m, parts: [...m.parts, part].sort((a, b) => a.seq - b.seq) };
            })
          };
          this.rooms.set(roomId, room);
          changed = true;
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
      case "message.deleted": {
        if (payload && typeof payload.messageId === "string") {
          this.flushDeltaBatch(payload.messageId);
          room = {
            ...room,
            messages: room.messages.filter((m) => m.id !== payload.messageId),
            pendingTurns: room.pendingTurns.filter((m) => m.id !== payload.messageId)
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "message.brief.published": {
        if (payload) {
          const runId = typeof event.runId === "string" ? event.runId : typeof payload.runId === "string" ? payload.runId : "";
          const runStatus = room.runs.find((run) => run.id === runId)?.status;
          const inferredKind =
            runStatus === "failed" ? "run_failed" :
            runStatus === "cancelled" ? "run_cancelled" :
            "run_completed";
          const brief: BriefViewModel = {
            kind: (typeof payload.kind === "string" ? payload.kind : inferredKind) as BriefViewModel["kind"],
            runId,
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
      case "agent.run.cancelling":
      case "agent.run.cancelled": {
        if (payload && typeof payload.runId === "string") {
          const runIndex = room.runs.findIndex((r) => r.id === payload.runId);
          const statusMap: Record<string, string> = {
            "agent.run.queued": "queued",
            "agent.run.started": "starting",
            "agent.run.waiting_permission": "waiting_permission",
            "agent.run.completed": "completed",
            "agent.run.failed": "failed",
            "agent.run.cancelling": "cancelling",
            "agent.run.cancelled": "cancelled"
          };
          const existing = runIndex >= 0 ? room.runs[runIndex] : undefined;
          const run: RunViewModel = {
            ...(existing ?? { id: payload.runId, agentId: event.agentId ?? "", agentName: this.agentName(room, event.agentId ?? "") ?? "Agent", status: "unknown" }),
            id: payload.runId,
            agentId: event.agentId ?? existing?.agentId ?? "",
            agentName: this.agentName(room, event.agentId ?? existing?.agentId ?? "") ?? existing?.agentName ?? "Agent",
            status: statusMap[event.type] ?? existing?.status ?? "unknown",
            startedAt: typeof payload.startedAt === "number" ? payload.startedAt : existing?.startedAt,
            endedAt: typeof payload.endedAt === "number" ? payload.endedAt : existing?.endedAt,
            cost: typeof payload.cost === "object" && payload.cost !== null ? (payload.cost as RunViewModel["cost"]) : existing?.cost,
            failureClass: typeof payload.failureClass === "string" ? payload.failureClass : existing?.failureClass,
            error: typeof payload.error === "string" ? payload.error : existing?.error,
            wakeReason: typeof payload.wakeReason === "string" ? payload.wakeReason : existing?.wakeReason,
            messageId: typeof payload.messageId === "string" ? payload.messageId : existing?.messageId,
            taskId: typeof payload.taskId === "string" ? payload.taskId : existing?.taskId,
            parentRunId: typeof payload.parentRunId === "string" ? payload.parentRunId : existing?.parentRunId
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
          const status = normalizePermissionStatus(
            typeof payload.decision === "string" ? payload.decision : undefined,
            typeof payload.reason === "string" ? payload.reason : undefined
          );
          room = {
            ...room,
            pendingPermissions: room.pendingPermissions.map((p) =>
              p.id === payload.requestId
                ? { ...p, status }
                : p
            )
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "permission.run_summary": {
        if (payload && typeof payload.runId === "string" && Array.isArray(payload.decisions)) {
          room = {
            ...room,
            runs: room.runs.map((r) =>
              r.id === payload.runId
                ? { ...r, permissionSummary: payload.decisions as RoomViewModel["runs"][number]["permissionSummary"] }
                : r
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
      case "task.created": {
        if (payload && typeof payload.taskId === "string") {
          const task: TaskViewModel = {
            id: payload.taskId,
            title: typeof payload.title === "string" ? payload.title : "Task",
            status: typeof payload.status === "string" ? payload.status : "pending",
            description: typeof payload.description === "string" ? payload.description : undefined,
            priority: typeof payload.priority === "string" ? payload.priority : undefined,
            blockerReason: typeof payload.blockerReason === "string" ? payload.blockerReason : undefined,
            maxTurns: typeof payload.maxTurns === "number" ? payload.maxTurns : undefined,
            boardColumn: typeof payload.boardColumn === "string" ? payload.boardColumn : undefined,
            assigneeRoleId: typeof payload.assigneeRoleId === "string" ? payload.assigneeRoleId : undefined,
            assigneeBindingId: typeof payload.assigneeBindingId === "string" ? payload.assigneeBindingId : undefined,
            assigneeAgentId: typeof payload.assigneeAgentId === "string" ? payload.assigneeAgentId : undefined,
            expectsReview: typeof payload.expectsReview === "boolean" ? payload.expectsReview : undefined,
            parentTaskId: typeof payload.parentTaskId === "string" ? payload.parentTaskId : undefined,
            dependencies: parseStringArray(payload.dependencies),
            delegationChain: Array.isArray(payload.delegationChain) ? payload.delegationChain : undefined,
            sourceRunId: typeof payload.sourceRunId === "string" ? payload.sourceRunId : undefined,
            activities: Array.isArray(payload.activities)
              ? payload.activities
                  .filter((activity) => activity && typeof activity === "object" && typeof (activity as { id?: unknown }).id === "string")
                  .map((activity) => ({
                    id: (activity as { id: string }).id,
                    kind: typeof (activity as { kind?: unknown }).kind === "string" ? (activity as { kind: string }).kind : "status_change",
                    byKind: typeof (activity as { byKind?: unknown }).byKind === "string" ? (activity as { byKind: string }).byKind : "system",
                    by: typeof (activity as { by?: unknown }).by === "string" ? (activity as { by: string }).by : "system",
                    payload: (activity as { payload?: unknown }).payload,
                    createdAt: typeof (activity as { createdAt?: unknown }).createdAt === "number" ? (activity as { createdAt: number }).createdAt : undefined
                  }))
              : undefined,
            delegations: Array.isArray(payload.delegations)
              ? payload.delegations
                  .filter((delegation) => delegation && typeof delegation === "object" && typeof (delegation as { id?: unknown }).id === "string")
                  .map((delegation) => ({
                    id: (delegation as { id: string }).id,
                    status: typeof (delegation as { status?: unknown }).status === "string" ? (delegation as { status: string }).status : undefined,
                    assigneeRoleId: typeof (delegation as { assigneeRoleId?: unknown }).assigneeRoleId === "string" ? (delegation as { assigneeRoleId: string }).assigneeRoleId : undefined,
                    assigneeBindingId: typeof (delegation as { assigneeBindingId?: unknown }).assigneeBindingId === "string" ? (delegation as { assigneeBindingId: string }).assigneeBindingId : undefined,
                    assigneeAgentId: typeof (delegation as { assigneeAgentId?: unknown }).assigneeAgentId === "string" ? (delegation as { assigneeAgentId: string }).assigneeAgentId : undefined,
                    runId: typeof (delegation as { runId?: unknown }).runId === "string" ? (delegation as { runId: string }).runId : undefined,
                    roleId: typeof (delegation as { roleId?: unknown }).roleId === "string" ? (delegation as { roleId: string }).roleId : undefined,
                    completedAt: typeof (delegation as { completedAt?: unknown }).completedAt === "number" ? (delegation as { completedAt: number }).completedAt : undefined,
                    createdAt: typeof (delegation as { createdAt?: unknown }).createdAt === "number" ? (delegation as { createdAt: number }).createdAt : undefined,
                    payload: (delegation as { payload?: unknown }).payload
                  }))
              : undefined
          };
          room = this.upsertTask(room, task);
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "task.status.changed": {
        if (payload && typeof payload.taskId === "string") {
          const existing = room.tasks.find((t) => t.id === payload.taskId);
          const nextBoardColumn = payload.boardColumn === null
            ? undefined
            : typeof payload.boardColumn === "string"
              ? payload.boardColumn
              : existing?.boardColumn;
          const nextStatus = typeof payload.nextStatus === "string" ? payload.nextStatus : (typeof payload.status === "string" ? payload.status : existing?.status);
          const nextBlockerReason = typeof payload.blockerReason === "string"
            ? payload.blockerReason
            : payload.blockerReason === null || (nextStatus !== undefined && nextStatus !== "blocked" && nextStatus !== "review")
              ? undefined
              : existing?.blockerReason;
          const task = existing
            ? {
                ...existing,
                status: nextStatus ?? existing.status,
                blockerReason: nextBlockerReason,
                boardColumn: nextBoardColumn,
                maxTurns: typeof payload.maxTurns === "number" ? payload.maxTurns : existing.maxTurns,
                assigneeAgentId: typeof payload.assigneeAgentId === "string" ? payload.assigneeAgentId : existing.assigneeAgentId,
                assigneeRoleId: typeof payload.assigneeRoleId === "string" ? payload.assigneeRoleId : existing.assigneeRoleId,
                assigneeBindingId: typeof payload.assigneeBindingId === "string" ? payload.assigneeBindingId : existing.assigneeBindingId,
                expectsReview: typeof payload.expectsReview === "boolean" ? payload.expectsReview : existing.expectsReview,
                priority: typeof payload.priority === "string" ? payload.priority : existing.priority,
                parentTaskId: typeof payload.parentTaskId === "string" ? payload.parentTaskId : existing.parentTaskId,
                sourceRunId: typeof payload.sourceRunId === "string" ? payload.sourceRunId : existing.sourceRunId,
                dependencies: parseStringArray(payload.dependencies) ?? existing.dependencies
              }
            : {
                id: payload.taskId,
                title: typeof payload.title === "string" ? payload.title : "Task",
                status: typeof payload.nextStatus === "string" ? payload.nextStatus : (typeof payload.status === "string" ? payload.status : "pending"),
                description: typeof payload.description === "string" ? payload.description : undefined,
                priority: typeof payload.priority === "string" ? payload.priority : undefined,
                blockerReason: typeof payload.blockerReason === "string" ? payload.blockerReason : undefined,
                boardColumn: typeof payload.boardColumn === "string" ? payload.boardColumn : undefined,
                maxTurns: typeof payload.maxTurns === "number" ? payload.maxTurns : undefined,
                assigneeRoleId: typeof payload.assigneeRoleId === "string" ? payload.assigneeRoleId : undefined,
                assigneeBindingId: typeof payload.assigneeBindingId === "string" ? payload.assigneeBindingId : undefined,
                assigneeAgentId: typeof payload.assigneeAgentId === "string" ? payload.assigneeAgentId : undefined,
                expectsReview: typeof payload.expectsReview === "boolean" ? payload.expectsReview : undefined,
                parentTaskId: typeof payload.parentTaskId === "string" ? payload.parentTaskId : undefined,
                dependencies: parseStringArray(payload.dependencies),
                delegationChain: Array.isArray(payload.delegationChain) ? payload.delegationChain : undefined,
                sourceRunId: typeof payload.sourceRunId === "string" ? payload.sourceRunId : undefined,
                activities: undefined,
                delegations: undefined
              };
          room = this.upsertTask(room, task);
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "task.activity.added": {
        if (payload && typeof payload.taskId === "string" && typeof payload.activityId === "string") {
          const existing = room.tasks.find((t) => t.id === payload.taskId);
          if (existing) {
            const activity: TaskActivityViewModel = {
              id: payload.activityId,
              kind: typeof payload.kind === "string" ? payload.kind : "status_change",
              byKind: typeof payload.byKind === "string" ? payload.byKind : "system",
              by: typeof payload.by === "string" ? payload.by : "system",
              payload: payload.payload,
              createdAt: typeof payload.createdAt === "number" ? payload.createdAt : event.createdAt
            };
            const activities = [...(existing.activities ?? [])];
            const existingIndex = activities.findIndex((item) => item.id === activity.id);
            if (existingIndex >= 0) {
              activities[existingIndex] = activity;
            } else {
              activities.push(activity);
            }
            room = this.upsertTask(room, { ...existing, activities });
            this.rooms.set(roomId, room);
            changed = true;
          }
        }
        break;
      }
      case "task.delegation.created": {
        if (payload && typeof payload.taskId === "string" && typeof payload.delegationId === "string") {
          const existing = room.tasks.find((t) => t.id === payload.taskId);
          if (existing) {
            const delegation: TaskDelegationViewModel = {
              id: payload.delegationId,
              status: typeof payload.status === "string" ? payload.status : "created",
              assigneeRoleId: typeof payload.assigneeRoleId === "string" ? payload.assigneeRoleId : existing.assigneeRoleId,
              assigneeBindingId: typeof payload.assigneeBindingId === "string" ? payload.assigneeBindingId : existing.assigneeBindingId,
              assigneeAgentId: typeof payload.assigneeAgentId === "string" ? payload.assigneeAgentId : existing.assigneeAgentId,
              runId: typeof payload.runId === "string" ? payload.runId : undefined,
              roleId: typeof payload.roleId === "string" ? payload.roleId : undefined,
              createdAt: typeof payload.createdAt === "number" ? payload.createdAt : event.createdAt,
              payload: payload.payload
            };
            const delegations = [...(existing.delegations ?? [])];
            const existingIndex = delegations.findIndex((item) => item.id === delegation.id);
            if (existingIndex >= 0) {
              delegations[existingIndex] = delegation;
            } else {
              delegations.push(delegation);
            }
            room = this.upsertTask(room, {
              ...existing,
              status: "in_progress",
              delegations
            });
            this.rooms.set(roomId, room);
            changed = true;
          }
        }
        break;
      }
      case "task.delegation.completed": {
        if (payload && typeof payload.taskId === "string" && typeof payload.delegationId === "string") {
          const existing = room.tasks.find((t) => t.id === payload.taskId);
          if (existing) {
            const delegations = (existing.delegations ?? []).map((delegation) =>
              delegation.id === payload.delegationId
                ? { ...delegation, status: "completed", completedAt: typeof payload.completedAt === "number" ? payload.completedAt : event.createdAt }
                : delegation
            );
            room = this.upsertTask(room, {
              ...existing,
              status: existing.expectsReview ? "review" : "completed",
              delegations
            });
            this.rooms.set(roomId, room);
            changed = true;
          }
        }
        break;
      }
      case "team.dispatch.started": {
        if (payload && typeof payload.dispatchId === "string") {
          const brief: BriefViewModel = {
            kind: "dispatch_started",
            runId: typeof payload.leaderRunId === "string" ? payload.leaderRunId : payload.dispatchId,
            agentId: event.agentId ?? "",
            agentName: this.agentName(room, event.agentId ?? "") ?? "Agent",
            summary: typeof payload.summary === "string" ? payload.summary : "Dispatch started",
            dispatchId: payload.dispatchId
          };
          if (!room.briefs.some((item) => item.kind === brief.kind && item.dispatchId === brief.dispatchId)) {
            room = { ...room, briefs: [...room.briefs, brief] };
            this.rooms.set(roomId, room);
            changed = true;
          }
        }
        break;
      }
      case "team.dispatch.completed": {
        if (payload && typeof payload.dispatchId === "string") {
          const runId = typeof payload.leaderRunId === "string" ? payload.leaderRunId : payload.dispatchId;
          const brief: BriefViewModel = {
            kind: "dispatch_completed",
            runId,
            agentId: event.agentId ?? "",
            agentName: this.agentName(room, event.agentId ?? "") ?? "Agent",
            summary: typeof payload.summary === "string" ? payload.summary : "Dispatch completed",
            dispatchId: payload.dispatchId
          };
          const existingIndex = room.briefs.findIndex((item) => item.kind === brief.kind && item.dispatchId === brief.dispatchId);
          if (existingIndex >= 0) {
            const updated = [...room.briefs];
            updated[existingIndex] = brief;
            room = { ...room, briefs: updated };
          } else {
            room = { ...room, briefs: [...room.briefs, brief] };
          }
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "agent.joined": {
        if (payload && typeof payload.agentId === "string") {
          const name = typeof payload.agentName === "string" ? payload.agentName : payload.agentId;
          const nextParticipant = {
            id: payload.agentId,
            name,
            role: typeof payload.role === "string" ? payload.role : "observer",
            presence: "observing",
            adapterId: typeof payload.adapterId === "string" ? payload.adapterId : "mock",
            agentBindingId: typeof payload.agentBindingId === "string" ? payload.agentBindingId : undefined,
            roleId: typeof payload.roleId === "string" ? payload.roleId : undefined,
            capabilities: parseStringArray(payload.capabilities) ?? []
          };
          const existing = room.participants.find((p) => p.id === payload.agentId);
          if (!existing) {
            room = {
              ...room,
              participants: [...room.participants, nextParticipant]
            };
            this.rooms.set(roomId, room);
            changed = true;
          } else {
            room = {
              ...room,
              participants: room.participants.map((participant) =>
                participant.id === payload.agentId ? { ...participant, ...nextParticipant, presence: participant.presence } : participant
              )
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
      // -----------------------------------------------------------------------
      // V1.1 projector handlers (contract week stubs - full UI in feat/v11-C)
      // -----------------------------------------------------------------------
      case "task.column.moved": {
        // D11: update boardColumn on the task so Kanban renders the correct column
        if (payload && typeof payload.taskId === "string") {
          const existing = room.tasks.find((t) => t.id === payload.taskId);
          if (existing) {
            room = this.upsertTask(room, {
              ...existing,
              boardColumn: typeof payload.toColumn === "string" ? payload.toColumn : existing.boardColumn
            });
            this.rooms.set(roomId, room);
            changed = true;
          }
        }
        break;
      }
      case "task.plan.created": {
        // D8: store execution plan at room level so the Tasks panel updates from projector state.
        if (payload && typeof payload.planId === "string") {
          // Attach plan to the run's associated task if known
          const runId = typeof payload.runId === "string" ? payload.runId : undefined;
          const plan: RoomExecutionPlanViewModel = {
            planId: payload.planId,
            runId: runId ?? "",
            planJson: payload.plan ?? payload.planJson ?? null,
            ...(typeof payload.taskCount === "number" ? { taskCount: payload.taskCount } : {}),
            createdAt: typeof payload.createdAt === "number" ? payload.createdAt : event.createdAt
          };
          room = { ...room, executionPlan: plan };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "run.file_changes.recorded": {
        // D12: update file-change badge count on the associated task card
        if (payload && typeof payload.filesChangedCount === "number") {
          const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
          const runId = typeof payload.runId === "string" ? payload.runId : event.runId;
          if (taskId) {
            const existing = room.tasks.find((t) => t.id === taskId);
            if (existing) {
              const files = parseFileChanges(payload.filesChanged);
              const artifactId = typeof payload.artifactId === "string" ? payload.artifactId : undefined;
              const existingRuns = existing.fileChangeRuns ?? [];
              const fileChangeRuns = runId !== undefined
                ? [
                    ...existingRuns.filter((item) => item.runId !== runId),
                    { runId, ...(artifactId !== undefined ? { artifactId } : {}), files, createdAt: event.createdAt }
                  ]
                : existingRuns;
              room = this.upsertTask(room, {
                ...existing,
                fileChangesCount: aggregateFileChangeCount(fileChangeRuns, (existing.fileChangesCount ?? 0) + payload.filesChangedCount),
                fileChangeRuns
              });
              this.rooms.set(roomId, room);
              changed = true;
            }
          }
        }
        break;
      }
      case "worktree.diff.ready": {
        // D3: show "Ready to apply" badge on the task card
        if (payload) {
          const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
          const runId = typeof payload.runId === "string" ? payload.runId : event.runId;
          if (taskId) {
            const existing = room.tasks.find((t) => t.id === taskId);
            if (existing) {
              const review = worktreeReview(existing.worktreeReviews, {
                runId: runId ?? "",
                artifactId: typeof payload.artifactId === "string" ? payload.artifactId : existing.worktreeArtifactId,
                status: "ready_for_review",
                filesChanged: parseStringArray(payload.filesChanged),
                updatedAt: event.createdAt
              });
              const artifactId = typeof payload.artifactId === "string" ? payload.artifactId : existing.worktreeArtifactId;
              room = this.upsertTask(room, {
                ...existing,
                worktreeStatus: "ready_for_review",
                worktreeArtifactId: artifactId,
                worktreeRunId: runId ?? existing.worktreeRunId,
                worktreeReviews: review,
                fileChangeRuns: syncFileChangeRunArtifactId(existing.fileChangeRuns, runId, artifactId)
              });
              this.rooms.set(roomId, room);
              changed = true;
            }
          }
        }
        break;
      }
      case "worktree.applied": {
        // D3: clear "Ready to apply" badge after successful apply
        if (payload) {
          const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
          const runId = typeof payload.runId === "string" ? payload.runId : event.runId;
          if (taskId) {
            const existing = room.tasks.find((t) => t.id === taskId);
            if (existing) {
              room = this.upsertTask(room, {
                ...existing,
                worktreeStatus: "applied",
                worktreeRunId: runId ?? existing.worktreeRunId,
                worktreeArtifactId: typeof payload.artifactId === "string" ? payload.artifactId : existing.worktreeArtifactId,
                worktreeReviews: worktreeReview(existing.worktreeReviews, {
                  runId: runId ?? "",
                  artifactId: typeof payload.artifactId === "string" ? payload.artifactId : existing.worktreeArtifactId,
                  status: "applied",
                  updatedAt: event.createdAt
                })
              });
              this.rooms.set(roomId, room);
              changed = true;
            }
          }
        }
        break;
      }
      case "worktree.discarded": {
        // D3: clear badge after discard
        if (payload) {
          const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
          const runId = typeof payload.runId === "string" ? payload.runId : event.runId;
          if (taskId) {
            const existing = room.tasks.find((t) => t.id === taskId);
            if (existing) {
              room = this.upsertTask(room, {
                ...existing,
                worktreeStatus: "discarded",
                worktreeRunId: runId ?? existing.worktreeRunId,
                worktreeArtifactId: typeof payload.artifactId === "string" ? payload.artifactId : existing.worktreeArtifactId,
                worktreeReviews: worktreeReview(existing.worktreeReviews, {
                  runId: runId ?? "",
                  artifactId: typeof payload.artifactId === "string" ? payload.artifactId : existing.worktreeArtifactId,
                  status: "discarded",
                  updatedAt: event.createdAt
                })
              });
              this.rooms.set(roomId, room);
              changed = true;
            }
          }
        }
        break;
      }
      case "worktree.conflict_detected": {
        // D3: show "Conflict" badge on the task card
        if (payload) {
          const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
          const runId = typeof payload.runId === "string" ? payload.runId : event.runId;
          if (taskId) {
            const existing = room.tasks.find((t) => t.id === taskId);
            if (existing) {
              room = this.upsertTask(room, {
                ...existing,
                worktreeStatus: "conflict",
                blockerReason: existing.blockerReason ?? "worktree_apply_conflict",
                worktreeArtifactId: typeof payload.artifactId === "string" ? payload.artifactId : existing.worktreeArtifactId,
                worktreeRunId: runId ?? existing.worktreeRunId,
                worktreeReviews: worktreeReview(existing.worktreeReviews, {
                  runId: runId ?? "",
                  artifactId: typeof payload.artifactId === "string" ? payload.artifactId : existing.worktreeArtifactId,
                  status: "conflict",
                  conflictDiff: typeof payload.conflictDiff === "string" ? payload.conflictDiff : undefined,
                  updatedAt: event.createdAt
                })
              });
              this.rooms.set(roomId, room);
              changed = true;
            }
          }
        }
        break;
      }
      case "room.stalled": {
        // D4: show dismissible stalled banner in chat view
        if (payload) {
          room = {
            ...room,
            stalledAt: event.createdAt,
            stalledTaskIds: Array.isArray(payload.stalledTaskIds) ? (payload.stalledTaskIds as string[]) : [],
            stalledReason: typeof payload.reason === "string" ? payload.reason : undefined
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "room.unstalled": {
        // D4: dismiss stalled banner
        room = { ...room, stalledAt: undefined, stalledTaskIds: undefined, stalledReason: undefined };
        this.rooms.set(roomId, room);
        changed = true;
        break;
      }
      case "skill.materialization_failed": {
        // D9: show inline error in chat view
        if (payload && typeof payload.skillId === "string" && typeof payload.runId === "string") {
          const error: SkillErrorViewModel = {
            skillId: payload.skillId,
            ...(typeof payload.name === "string" ? { skillName: payload.name } : {}),
            runId: payload.runId,
            error: typeof payload.error === "string" ? payload.error : "Skill materialization failed",
            createdAt: event.createdAt
          };
          room = { ...room, skillErrors: [...(room.skillErrors ?? []), error] };
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

  private senderName(room: RoomViewModel, senderType: MessageViewModel["senderType"], senderId: string): string {
    if (senderType === "agent") return this.agentName(room, senderId) ?? "Agent";
    if (senderType === "system") return "System";
    return "You";
  }
}

function normalizePermissionStatus(decision: string | undefined, reason: string | undefined): PermissionViewModel["status"] {
  if (reason === "timeout" || reason === "expired_max_wait") return "expired";
  if (decision === "allowed" || decision === "allow") return "allowed";
  if (decision === "expired") return "expired";
  if (decision === "denied" || decision === "deny") return "denied";
  return "denied";
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function parseFileChanges(value: unknown): TaskFileChangeViewModel[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => ({
      path: typeof item.path === "string" ? item.path : "unknown",
      change: typeof item.change === "string" ? item.change : typeof item.status === "string" ? item.status : "modified",
      linesAdded: typeof item.linesAdded === "number" ? item.linesAdded : typeof item.additions === "number" ? item.additions : undefined,
      linesRemoved: typeof item.linesRemoved === "number" ? item.linesRemoved : typeof item.deletions === "number" ? item.deletions : undefined,
      artifactId: typeof item.artifactId === "string" ? item.artifactId : undefined
    }));
}

function aggregateFileChangeCount(runs: NonNullable<TaskViewModel["fileChangeRuns"]>, fallback: number): number {
  return runs.length > 0 ? runs.reduce((total, run) => total + run.files.length, 0) : fallback;
}

function syncFileChangeRunArtifactId(
  runs: TaskViewModel["fileChangeRuns"],
  runId: string | undefined,
  artifactId: string | undefined
): TaskViewModel["fileChangeRuns"] {
  if (!runs || !runId || !artifactId) return runs;
  return runs.map((run) => run.runId === runId && run.artifactId === undefined ? { ...run, artifactId } : run);
}

function worktreeReview(existing: TaskViewModel["worktreeReviews"], review: WorktreeReviewViewModel): WorktreeReviewViewModel[] {
  const runId = review.runId.length > 0 ? review.runId : `worktree:${review.artifactId ?? review.updatedAt}`;
  const nextReview = { ...review, runId };
  return [...(existing ?? []).filter((item) => item.runId !== runId), nextReview].sort((a, b) => b.updatedAt - a.updatedAt);
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

  // For the main timeline view we keep ONE long-lived SSE subscription that
  // streams every event, so switching the active room never tears down the
  // stream and never drops live deltas. Only the run-detail view scopes to a
  // specific (room, run). Without this, every `activeRoomId` change closed the
  // EventSource and re-opened it with a server-side roomId filter - racing with
  // any in-flight `agent.run.*` / `message.*` events for the new room.
  const sseRoomId = view === "main" ? undefined : roomId;
  const sseRunId = view === "main" ? undefined : runId;

  useEffect(() => {
    let cancelled = false;
    viewRef.current = view;
    roomIdRef.current = roomId;
    runIdRef.current = runId;
    ensureAuthSession()
      .then(() => {
        if (!cancelled) globalProjector.connect(view, sseRoomId, sseRunId);
      })
      .catch(() => {
        if (!cancelled) globalProjector.connect(view, sseRoomId, sseRunId);
      });
    return () => {
      cancelled = true;
      globalProjector.disconnect();
    };
  }, [view, sseRoomId, sseRunId]);

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
