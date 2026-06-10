import { useEffect, useRef, useState } from "react";
import { defaultAgentAvatarUrl, defaultSystemAvatarUrl, defaultUserAvatarUrl, isAvatarImageUrl } from "@agenthub/protocol/avatars";
import type { EventEnvelope } from "@agenthub/protocol/events";
import { EVENT_REGISTRY } from "@agenthub/protocol/events";
import type {
  RoomViewModel,
  ProjectorState,
  MessageViewModel,
  BriefViewModel,
  RunViewModel,
  PermissionViewModel,
  InterventionViewModel,
  TaskActivityViewModel,
  TaskDelegationViewModel,
  TaskViewModel,
  SkillErrorViewModel,
  TaskFileChangeViewModel,
  WorktreeReviewViewModel,
  RoomExecutionPlanViewModel,
  DeploymentViewModel,
  ArtifactVersionViewModel,
  WorkflowViewModel,
  WorkflowVersionViewModel,
  WorkflowRunViewModel,
  WorkflowNodeRunViewModel,
  WorkflowEdgeDeliveryViewModel
} from "../types.ts";
import { ensureAuthSession } from "./useSdk.ts";

type ProjectorListener = (state: ProjectorState) => void;

type DeltaBatch = {
  readonly messageId: string;
  readonly deltas: string[];
  readonly rafId: number | null;
};

class Projector {
  private rooms = new Map<string, RoomViewModel>();
  private roomSearchResultIds: string[] | undefined;
  private roomSearchResultQuery: string | undefined;
  private workflows: WorkflowViewModel[] = [];
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

  private upsertWorkflow(workflow: WorkflowViewModel): void {
    this.workflows = upsertById(this.workflows, workflow);
  }

  private deleteWorkflow(workflowId: string, deletedAt: number): void {
    this.workflows = this.workflows.map((workflow) =>
      workflow.id === workflowId ? { ...workflow, deletedAt } : workflow
    );
  }

  private updateWorkflow(workflowId: string, update: (workflow: WorkflowViewModel) => WorkflowViewModel): boolean {
    let updated = false;
    this.workflows = this.workflows.map((workflow) => {
      if (workflow.id !== workflowId) return workflow;
      updated = true;
      return update(workflow);
    });
    return updated;
  }

  private mirrorWorkflowToRoom(roomId: string | undefined, workflow: WorkflowViewModel): void {
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const workflows = upsertById(room.workflows ?? [], workflow);
    this.rooms.set(roomId, { ...room, workflows });
  }

  private mirrorWorkflowDeletionToRoom(roomId: string | undefined, workflowId: string, deletedAt: number): void {
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.rooms.set(roomId, {
      ...room,
      workflows: (room.workflows ?? []).map((workflow) =>
        workflow.id === workflowId ? { ...workflow, deletedAt } : workflow
      )
    });
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
      workflows: this.workflows,
      connectionStatus: this.connectionStatus
    };
    if (this.connectionError !== undefined) {
      (state as Record<string, unknown>).connectionError = this.connectionError;
    }
    if (this.roomSearchResultIds !== undefined) {
      (state as Record<string, unknown>).roomSearchResultIds = this.roomSearchResultIds;
    }
    if (this.roomSearchResultQuery !== undefined) {
      (state as Record<string, unknown>).roomSearchResultQuery = this.roomSearchResultQuery;
    }
    return state;
  }

  applyRoomSearchResults(query: string, rooms: Array<{ id: string; title: string; mode: string; pinnedAt?: number; lastActivityAt?: number; archivedAt?: number; participantContactNames?: unknown }>): void {
    this.roomSearchResultQuery = normalizedRoomSearchQuery(query);
    this.roomSearchResultIds = rooms.map((room) => room.id);
    for (const room of rooms) {
      this.applyRoomListRow(room);
    }
    this.notify();
  }

  clearRoomSearchResults(): void {
    if (this.roomSearchResultIds === undefined && this.roomSearchResultQuery === undefined) return;
    this.roomSearchResultIds = undefined;
    this.roomSearchResultQuery = undefined;
    this.notify();
  }

  applyRoomListRow(room: { id: string; title: string; mode: string; pinnedAt?: number; lastActivityAt?: number; archivedAt?: number; participantContactNames?: unknown }): void {
    this.apply({
      id: room.id,
      type: "room.created",
      schemaVersion: 1,
      durability: "durable",
      visibility: "both",
      workspaceId: "default-workspace",
      roomId: room.id,
      payload: {
        roomId: room.id,
        title: room.title,
        mode: room.mode,
        pinnedAt: room.pinnedAt,
        lastActivityAt: room.lastActivityAt,
        archivedAt: room.archivedAt,
        participantContactNames: room.participantContactNames
      },
      createdAt: Date.now()
    });
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
    const payload = event.payload as Record<string, unknown> | undefined;

    if (event.type.startsWith("workflow.")) {
      this.applyWorkflowEvent(event, payload);
      return;
    }

    if (!roomId) return;
    if (roomId.startsWith("workflow:")) return;

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
        participantContactNames: {},
        messages: [],
        briefs: [],
        unresolvedInterventions: [],
        pendingPermissions: [],
        contextItems: [],
        tasks: [],
        runs: [],
        pendingTurns: [],
        mailboxFailures: [],
        artifactVersionsById: {},
        deploymentsById: {},
        deploymentLogsById: {},
        unreadCount: 0
      };
      this.rooms.set(roomId, room);
    }

    let changed = false;

    switch (event.type) {
      case "room.created": {
        if (payload && typeof payload.title === "string") {
          this.rooms.set(roomId, {
            ...room,
            title: payload.title,
            mode: typeof payload.mode === "string" ? payload.mode : room.mode,
            pinnedAt: typeof payload.pinnedAt === "number" ? payload.pinnedAt : room.pinnedAt,
            lastActivityAt: advanceActivityAt(room, typeof payload.lastActivityAt === "number" ? payload.lastActivityAt : undefined).lastActivityAt,
            archivedAt: typeof payload.archivedAt === "number" ? payload.archivedAt : room.archivedAt,
            participantContactNames: contactNamesFromPayload(payload.participantContactNames, room.participantContactNames)
          });
          changed = true;
        }
        break;
      }
      case "room.closed": {
        room = { ...room, archivedAt: event.createdAt };
        this.rooms.set(roomId, room);
        changed = true;
        break;
      }
      case "room.opened": {
        room = { ...room, archivedAt: undefined };
        this.rooms.set(roomId, room);
        changed = true;
        break;
      }
      case "room.deleted": {
        this.rooms.delete(roomId);
        changed = true;
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
            senderAvatarUrl: this.senderAvatarUrl(room, senderType, senderId),
            role: typeof payload.role === "string" ? payload.role : "user",
            status: "streaming",
            text: typeof payload.text === "string" ? payload.text : "",
            parts: payloadParts(room, payload),
            quotedMessageId: typeof payload.quotedMessageId === "string" ? payload.quotedMessageId : undefined,
            pendingTurnId: typeof payload.pendingTurnId === "string" ? payload.pendingTurnId : undefined,
            createdAt: event.createdAt
          };
          room = advanceActivityAt({ ...room, messages: [...room.messages, message] }, event.createdAt);
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
          const part = hydrateMessagePart(room, payload.part as MessageViewModel["parts"][number]);
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
              m.id === payload.messageId
                ? {
                    ...m,
                    status: "completed",
                    text: typeof payload.text === "string" ? payload.text : m.text,
                    parts: mergeMessageParts(room, m.parts, payloadParts(room, payload))
                  }
                : m
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
      case "message.updated": {
        if (payload && typeof payload.messageId === "string") {
          const messageId = payload.messageId;
          room = {
            ...room,
            messages: room.messages.map((message) => {
              if (message.id !== messageId) return message;
              return {
                ...message,
                ...(typeof payload.text === "string" ? { text: payload.text } : {}),
                ...(typeof payload.pinnedAt === "number" ? { pinnedAt: payload.pinnedAt } : {})
              };
            })
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
          room = advanceActivityAt(room, event.createdAt);
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
          room = advanceActivityAt(this.upsertTask(room, task), event.createdAt);
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
          room = advanceActivityAt(this.upsertTask(room, task), event.createdAt);
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
            avatarUrl: isAvatarImageUrl(payload.avatarUrl) ? payload.avatarUrl : defaultAgentAvatarUrl(payload.agentId),
            agentBindingId: typeof payload.agentBindingId === "string" ? payload.agentBindingId : undefined,
            roleId: typeof payload.roleId === "string" ? payload.roleId : undefined,
            capabilities: parseStringArray(payload.capabilities) ?? []
          };
          const existing = room.participants.find((p) => p.id === payload.agentId);
          const joinedIds = new Set([
            payload.agentId,
            typeof payload.agentBindingId === "string" ? payload.agentBindingId : payload.agentId
          ]);
          const messages = room.messages.map((message) =>
            message.senderType === "agent" && joinedIds.has(message.senderId)
              ? { ...message, senderName: name, senderAvatarUrl: nextParticipant.avatarUrl }
              : message
          );
          if (!existing) {
            room = advanceActivityAt({
              ...room,
              participants: [...room.participants, nextParticipant],
              messages
            }, event.createdAt);
            this.rooms.set(roomId, room);
            changed = true;
          } else {
            room = advanceActivityAt({
              ...room,
              participants: room.participants.map((participant) =>
                participant.id === payload.agentId ? { ...participant, ...nextParticipant, presence: participant.presence } : participant
              ),
              messages
            }, event.createdAt);
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
      case "artifact.version.created": {
        if (payload && typeof payload.artifactId === "string" && typeof payload.version === "number") {
          const artifactId = payload.artifactId;
          const versions = room.artifactVersionsById[artifactId] ?? [];
          const nextVersion: ArtifactVersionViewModel = {
            id: typeof payload.artifactVersionId === "string" ? payload.artifactVersionId : `${payload.artifactId}:v${payload.version}`,
            artifactId,
            version: payload.version,
            contentEncoding: payload.contentEncoding === "binary" ? "binary" : "text",
            createdAt: event.createdAt,
            createdBy: typeof payload.createdBy === "string" ? payload.createdBy : undefined,
            message: typeof payload.message === "string" ? payload.message : undefined,
            storagePath: typeof payload.storagePath === "string" ? payload.storagePath : undefined
          };
          room = {
            ...room,
            artifactVersionsById: {
              ...room.artifactVersionsById,
              [artifactId]: [...versions.filter((item) => item.version !== nextVersion.version), nextVersion]
                .sort((a, b) => a.version - b.version)
            },
            messages: room.messages.map((message) => ({
              ...message,
              parts: message.parts.map((part) => hydrateMessagePart({
                ...room,
                artifactVersionsById: {
                  ...room.artifactVersionsById,
                  [artifactId]: [...versions.filter((item) => item.version !== nextVersion.version), nextVersion]
                    .sort((a, b) => a.version - b.version)
                }
              }, part))
            }))
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "deployment.created": {
        if (
          payload &&
          typeof payload.deploymentId === "string" &&
          typeof payload.artifactId === "string" &&
          typeof payload.kind === "string" &&
          typeof payload.provider === "string" &&
          typeof payload.status === "string"
        ) {
          const existing = room.deploymentsById[payload.deploymentId];
          const deployment: DeploymentViewModel = {
            ...existing,
            id: payload.deploymentId,
            artifactId: payload.artifactId,
            roomId,
            workspaceId: typeof payload.workspaceId === "string" ? payload.workspaceId : existing?.workspaceId ?? event.workspaceId,
            kind: payload.kind as DeploymentViewModel["kind"],
            provider: payload.provider as DeploymentViewModel["provider"],
            status: payload.status as DeploymentViewModel["status"],
            createdAt: existing?.createdAt ?? event.createdAt,
            updatedAt: event.createdAt
          };
          room = setDeployment(room, deployment);
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "deployment.status.changed":
      case "deployment.ready":
      case "deployment.failed":
      case "deployment.cancelled":
      case "deployment.expired":
      case "deployment.unpublished": {
        if (payload && typeof payload.deploymentId === "string") {
          const existing = room.deploymentsById[payload.deploymentId];
          const statusByEvent: Partial<Record<string, DeploymentViewModel["status"]>> = {
            "deployment.ready": "ready",
            "deployment.failed": "failed",
            "deployment.cancelled": "cancelled",
            "deployment.expired": "expired",
            "deployment.unpublished": "unpublished"
          };
          const status = typeof payload.status === "string"
            ? payload.status as DeploymentViewModel["status"]
            : statusByEvent[event.type] ?? existing?.status ?? "queued";
          const deployment: DeploymentViewModel = {
            ...(existing ?? {
              id: payload.deploymentId,
              artifactId: typeof payload.artifactId === "string" ? payload.artifactId : "",
              roomId,
              workspaceId: event.workspaceId,
              kind: "preview-url",
              provider: "agenthub-local",
              status: "queued"
            }),
            id: payload.deploymentId,
            status,
            kind: typeof payload.kind === "string" ? payload.kind as DeploymentViewModel["kind"] : existing?.kind ?? "preview-url",
            url: typeof payload.url === "string" ? payload.url : existing?.url,
            downloadUrl: typeof payload.downloadUrl === "string" ? payload.downloadUrl : existing?.downloadUrl,
            imageTag: typeof payload.imageTag === "string" ? payload.imageTag : existing?.imageTag,
            expiresAt: typeof payload.expiresAt === "number" ? payload.expiresAt : existing?.expiresAt,
            lastError: typeof payload.error === "string" ? payload.error : existing?.lastError,
            updatedAt: event.createdAt
          };
          room = setDeployment(room, deployment);
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "deployment.log.appended": {
        if (payload && typeof payload.deploymentId === "string" && typeof payload.line === "string") {
          room = hydrateRoomMessageParts({
            ...room,
            deploymentLogsById: {
              ...room.deploymentLogsById,
              [payload.deploymentId]: [...(room.deploymentLogsById[payload.deploymentId] ?? []), payload.line]
            }
          });
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "artifact.diff.detected": {
        // Artifact events update artifact state only. Timeline cards are inserted by
        // message.part.added so replay and live projection follow the same contract.
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
      case "room.pinned": {
        if (payload && typeof payload.pinnedAt === "number") {
          room = { ...room, pinnedAt: payload.pinnedAt };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "room.unpinned": {
        room = { ...room, pinnedAt: undefined };
        this.rooms.set(roomId, room);
        changed = true;
        break;
      }
      case "message.pinned": {
        if (payload && typeof payload.messageId === "string" && typeof payload.pinnedAt === "number") {
          const messageId = payload.messageId;
          const pinnedAt = payload.pinnedAt;
          room = {
            ...room,
            messages: room.messages.map((message) =>
              message.id === messageId ? { ...message, pinnedAt } : message
            )
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "message.unpinned": {
        if (payload && typeof payload.messageId === "string") {
          const messageId = payload.messageId;
          room = {
            ...room,
            messages: room.messages.map((message) =>
              message.id === messageId ? { ...message, pinnedAt: undefined } : message
            )
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "agent.contact.updated": {
        if (payload && typeof payload.agentBindingId === "string" && typeof payload.displayName === "string") {
          const agentBindingId = payload.agentBindingId;
          const displayName = payload.displayName;
          const avatarUrl = isAvatarImageUrl(payload.avatarUrl) ? payload.avatarUrl : undefined;
          room = {
            ...room,
            participantContactNames: {
              ...room.participantContactNames,
              [agentBindingId]: displayName
            },
            participants: room.participants.map((participant) =>
              participant.agentBindingId === agentBindingId || participant.id === agentBindingId
                ? { ...participant, name: displayName, ...(avatarUrl !== undefined ? { avatarUrl } : {}) }
                : participant
            ),
            messages: room.messages.map((message) =>
              message.senderType === "agent" && message.senderId === agentBindingId
                ? { ...message, senderName: displayName, ...(avatarUrl !== undefined ? { senderAvatarUrl: avatarUrl } : {}) }
                : message
            )
          };
          this.rooms.set(roomId, room);
          changed = true;
        }
        break;
      }
      case "task.unblocked": {
        if (payload && typeof payload.taskId === "string") {
          const existing = room.tasks.find((task) => task.id === payload.taskId);
          if (existing) {
            room = this.upsertTask(room, {
              ...existing,
              status: existing.status === "blocked" ? "pending" : existing.status,
              blockerReason: undefined,
              lastUnblockedAt: event.createdAt
            });
            this.rooms.set(roomId, room);
            changed = true;
          }
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

  private applyWorkflowEvent(event: EventEnvelope, payload: Record<string, unknown> | undefined): void {
    let changed = false;

    switch (event.type) {
      case "workflow.created":
      case "workflow.version.updated": {
        const workflowId = stringField(objectField(payload, "workflow"), "id") ?? stringField(payload, "workflowId");
        const nextWorkflow = workflowFromPayload(
          workflowId ? this.workflows.find((workflow) => workflow.id === workflowId) : undefined,
          payload
        );
        if (nextWorkflow) {
          this.upsertWorkflow(nextWorkflow);
          this.mirrorWorkflowToRoom(event.roomId, nextWorkflow);
          changed = true;
        }
        break;
      }
      case "workflow.deleted": {
        if (payload && typeof payload.workflowId === "string") {
          const deletedAt = typeof payload.deletedAt === "number" ? payload.deletedAt : event.createdAt;
          this.deleteWorkflow(payload.workflowId, deletedAt);
          this.mirrorWorkflowDeletionToRoom(event.roomId, payload.workflowId, deletedAt);
          changed = true;
        }
        break;
      }
      case "workflow.run.started":
      case "workflow.run.completed":
      case "workflow.run.failed":
      case "workflow.run.cancelled": {
        if (payload && typeof payload.workflowId === "string") {
          const workflowRun = workflowRunFromPayload(payload);
          if (workflowRun && this.updateWorkflow(payload.workflowId, (workflow) => upsertWorkflowRun(workflow, workflowRun))) {
            const workflow = this.workflows.find((item) => item.id === payload.workflowId);
            if (workflow) this.mirrorWorkflowToRoom(event.roomId, workflow);
            changed = true;
          }
        }
        break;
      }
      case "workflow.node.queued":
      case "workflow.node.started":
      case "workflow.node.completed":
      case "workflow.node.failed":
      case "workflow.node.skipped":
      case "workflow.node.cancelled": {
        if (payload && typeof payload.workflowId === "string") {
          const nodeRun = workflowNodeRunFromPayload(payload);
          const workflowRunId = typeof payload.workflowRunId === "string" ? payload.workflowRunId : nodeRun?.workflowRunId;
          if (nodeRun && workflowRunId && this.updateWorkflow(payload.workflowId, (workflow) => upsertWorkflowNodeRun(workflow, workflowRunId, nodeRun))) {
            const workflow = this.workflows.find((item) => item.id === payload.workflowId);
            if (workflow) this.mirrorWorkflowToRoom(event.roomId, workflow);
            changed = true;
          }
        }
        break;
      }
      case "workflow.edge.delivery.created":
      case "workflow.edge.delivery.mailbox_created":
      case "workflow.edge.delivery.delivered":
      case "workflow.edge.delivery.cancelled":
      case "workflow.edge.delivery.failed": {
        if (payload && typeof payload.workflowId === "string") {
          const delivery = workflowEdgeDeliveryFromPayload(payload);
          const workflowRunId = typeof payload.workflowRunId === "string" ? payload.workflowRunId : delivery?.workflowRunId;
          if (delivery && workflowRunId && this.updateWorkflow(payload.workflowId, (workflow) => upsertWorkflowEdgeDelivery(workflow, workflowRunId, delivery))) {
            const workflow = this.workflows.find((item) => item.id === payload.workflowId);
            if (workflow) this.mirrorWorkflowToRoom(event.roomId, workflow);
            changed = true;
          }
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

  private agentAvatarUrl(room: RoomViewModel, agentId: string): string | undefined {
    return room.participants.find((p) => p.id === agentId)?.avatarUrl;
  }

  private senderName(room: RoomViewModel, senderType: MessageViewModel["senderType"], senderId: string): string {
    if (senderType === "agent") return this.agentName(room, senderId) ?? "Agent";
    if (senderType === "system") return "System";
    return "You";
  }

  private senderAvatarUrl(room: RoomViewModel, senderType: MessageViewModel["senderType"], senderId: string): string {
    if (senderType === "agent") return this.agentAvatarUrl(room, senderId) ?? defaultAgentAvatarUrl(senderId);
    if (senderType === "system") return defaultSystemAvatarUrl(senderId || "agenthub");
    return defaultUserAvatarUrl(senderId || "local");
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

function setDeployment(room: RoomViewModel, deployment: DeploymentViewModel): RoomViewModel {
  const deploymentsById = {
    ...room.deploymentsById,
    [deployment.id]: deployment
  };
  return hydrateRoomMessageParts({ ...room, deploymentsById });
}

function contactNamesFromPayload(value: unknown, fallback: Record<string, string>): Record<string, string> {
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0);
    if (entries.length === 0) return fallback;
    return Object.fromEntries(entries);
  }

  return fallback;
}

function advanceActivityAt(room: RoomViewModel, timestamp: number | undefined): RoomViewModel {
  if (timestamp === undefined || (room.lastActivityAt !== undefined && room.lastActivityAt >= timestamp)) return room;
  return { ...room, lastActivityAt: timestamp };
}

function hydrateRoomMessageParts(room: RoomViewModel): RoomViewModel {
  return {
    ...room,
    messages: room.messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) => hydrateMessagePart(room, part))
    }))
  };
}

function payloadParts(room: RoomViewModel, payload: Record<string, unknown>): MessageViewModel["parts"] {
  if (!Array.isArray(payload.parts)) return [];
  return payload.parts
    .filter((part): part is MessageViewModel["parts"][number] => isMessagePart(part))
    .map((part) => hydrateMessagePart(room, part))
    .sort((a, b) => a.seq - b.seq);
}

function mergeMessageParts(room: RoomViewModel, existing: MessageViewModel["parts"], incoming: MessageViewModel["parts"]): MessageViewModel["parts"] {
  const merged = [...existing];
  for (const part of incoming) {
    if (merged.some((item) => item.seq === part.seq && item.type === part.type)) continue;
    merged.push(hydrateMessagePart(room, part));
  }
  return merged.sort((a, b) => a.seq - b.seq);
}

function isMessagePart(value: unknown): value is MessageViewModel["parts"][number] {
  if (typeof value !== "object" || value === null) return false;
  const part = value as { readonly type?: unknown; readonly seq?: unknown };
  return typeof part.type === "string" && typeof part.seq === "number";
}

function hydrateMessagePart(room: RoomViewModel, part: MessageViewModel["parts"][number]): MessageViewModel["parts"][number] {
  if (part.type !== "card") return part;
  const card = part.card as Record<string, unknown>;
  if (card.type === "deployment" && typeof card.deploymentId === "string") {
    const deployment = room.deploymentsById[card.deploymentId];
    if (!deployment) return part;
    return {
      ...part,
      card: {
        ...card,
        artifactId: deployment.artifactId || card.artifactId,
        kind: deployment.kind || card.kind,
        provider: deployment.provider || card.provider,
        status: deployment.status,
        url: deployment.url ?? card.url,
        downloadUrl: deployment.downloadUrl ?? card.downloadUrl,
        imageTag: deployment.imageTag ?? card.imageTag,
        expiresAt: deployment.expiresAt ?? card.expiresAt,
        lastError: deployment.lastError ?? card.lastError,
        logs: room.deploymentLogsById[card.deploymentId] ?? card.logs
      }
    } as unknown as MessageViewModel["parts"][number];
  }
  if (card.type === "artifact" && typeof card.artifactId === "string") {
    const versions = room.artifactVersionsById[card.artifactId] ?? [];
    const latest = versions.at(-1);
    if (!latest) return part;
    return {
      ...part,
      card: {
        ...card,
        version: latest.version
      }
    } as MessageViewModel["parts"][number];
  }
  return part;
}

function workflowFromPayload(existing: WorkflowViewModel | undefined, payload: Record<string, unknown> | undefined): WorkflowViewModel | undefined {
  const workflow = objectField(payload, "workflow");
  const workflowId = stringField(workflow, "id") ?? stringField(payload, "workflowId");
  if (!workflowId) return undefined;

  const version = workflowVersionFromUnknown(objectField(payload, "version"));
  const nodes = arrayField(payload, "nodes").map(workflowNodeFromUnknown).filter((item): item is NonNullable<typeof item> => item !== undefined);
  const edges = arrayField(payload, "edges").map(workflowEdgeFromUnknown).filter((item): item is NonNullable<typeof item> => item !== undefined);
  const hasNodes = Array.isArray(payload?.nodes);
  const hasEdges = Array.isArray(payload?.edges);
  const validation = workflowValidationFromUnknown(objectField(payload, "validation"));

  return {
    id: workflowId,
    workspaceId: stringField(workflow, "workspaceId") ?? existing?.workspaceId ?? "default-workspace",
    roomId: stringField(workflow, "roomId") ?? existing?.roomId,
    name: stringField(workflow, "name") ?? existing?.name ?? "Untitled workflow",
    description: stringField(workflow, "description") ?? existing?.description,
    draftVersionId: stringField(workflow, "draftVersionId") ?? existing?.draftVersionId,
    activeVersionId: stringField(workflow, "activeVersionId") ?? existing?.activeVersionId,
    createdBy: stringField(workflow, "createdBy") ?? existing?.createdBy,
    createdAt: numberField(workflow, "createdAt") ?? existing?.createdAt ?? Date.now(),
    updatedAt: numberField(workflow, "updatedAt") ?? version?.updatedAt ?? existing?.updatedAt ?? Date.now(),
    deletedAt: numberField(workflow, "deletedAt") ?? existing?.deletedAt,
    versions: version ? upsertById(existing?.versions ?? [], version) : existing?.versions ?? [],
    nodes: hasNodes ? nodes : existing?.nodes ?? [],
    edges: hasEdges ? edges : existing?.edges ?? [],
    runs: existing?.runs ?? [],
    validation: validation ?? existing?.validation
  };
}

function workflowVersionFromUnknown(input: Record<string, unknown> | undefined): WorkflowVersionViewModel | undefined {
  const id = stringField(input, "id");
  const workflowId = stringField(input, "workflowId");
  if (!id || !workflowId) return undefined;
  return {
    id,
    workflowId,
    versionNumber: numberField(input, "versionNumber") ?? 1,
    state: stringField(input, "state") === "locked" ? "locked" : "draft",
    valid: booleanField(input, "valid") ?? false,
    validationErrors: parseWorkflowIssues(input?.validationErrors),
    viewport: recordField(input, "viewport"),
    createdFromVersionId: stringField(input, "createdFromVersionId"),
    lockedFromVersionId: stringField(input, "lockedFromVersionId"),
    lockedAt: numberField(input, "lockedAt"),
    createdAt: numberField(input, "createdAt") ?? Date.now(),
    updatedAt: numberField(input, "updatedAt") ?? Date.now()
  };
}

function workflowNodeFromUnknown(input: unknown) {
  if (!isObject(input)) return undefined;
  const id = stringField(input, "id");
  const workflowVersionId = stringField(input, "workflowVersionId");
  const nodeId = stringField(input, "nodeId");
  if (!id || !workflowVersionId || !nodeId) return undefined;
  const position = objectField(input, "position");
  const size = objectField(input, "size");
  return {
    id,
    workflowVersionId,
    nodeId,
    kind: stringField(input, "kind") === "note" ? "note" as const : "agent_context" as const,
    displayName: stringField(input, "displayName") ?? nodeId,
    agentBindingId: stringField(input, "agentBindingId"),
    roleLabel: stringField(input, "roleLabel"),
    prompt: stringField(input, "prompt") ?? "",
    position: { x: numberField(position, "x") ?? 0, y: numberField(position, "y") ?? 0 },
    size: size ? { width: numberField(size, "width") ?? 260, height: numberField(size, "height") ?? 160 } : undefined,
    enabled: booleanField(input, "enabled") ?? true,
    locked: booleanField(input, "locked") ?? false,
    config: recordField(input, "config"),
    createdAt: numberField(input, "createdAt") ?? Date.now(),
    updatedAt: numberField(input, "updatedAt") ?? Date.now()
  };
}

function workflowEdgeFromUnknown(input: unknown) {
  if (!isObject(input)) return undefined;
  const id = stringField(input, "id");
  const workflowVersionId = stringField(input, "workflowVersionId");
  const edgeId = stringField(input, "edgeId");
  const sourceNodeId = stringField(input, "sourceNodeId");
  const targetNodeId = stringField(input, "targetNodeId");
  if (!id || !workflowVersionId || !edgeId || !sourceNodeId || !targetNodeId) return undefined;
  return {
    id,
    workflowVersionId,
    edgeId,
    sourceNodeId,
    targetNodeId,
    label: stringField(input, "label"),
    enabled: booleanField(input, "enabled") ?? true,
    config: recordField(input, "config"),
    createdAt: numberField(input, "createdAt") ?? Date.now(),
    updatedAt: numberField(input, "updatedAt") ?? Date.now()
  };
}

function workflowRunFromPayload(payload: Record<string, unknown>): WorkflowRunViewModel | undefined {
  const input = objectField(payload, "run");
  const id = stringField(input, "id");
  const workflowId = stringField(input, "workflowId");
  const workflowVersionId = stringField(input, "workflowVersionId");
  const workspaceId = stringField(input, "workspaceId");
  if (!input || !id || !workflowId || !workflowVersionId || !workspaceId) return undefined;
  return {
    id,
    workflowId,
    workflowVersionId,
    workspaceId,
    roomId: stringField(input, "roomId"),
    status: workflowRunStatus(stringField(input, "status")),
    seedContext: stringField(input, "seedContext"),
    startedBy: stringField(input, "startedBy"),
    startedAt: numberField(input, "startedAt"),
    endedAt: numberField(input, "endedAt"),
    failureReason: stringField(input, "failureReason"),
    createdAt: numberField(input, "createdAt") ?? Date.now(),
    updatedAt: numberField(input, "updatedAt") ?? Date.now(),
    nodeRuns: [],
    edgeDeliveries: []
  };
}

function workflowNodeRunFromPayload(payload: Record<string, unknown>): WorkflowNodeRunViewModel | undefined {
  const input = objectField(payload, "nodeRun");
  const id = stringField(input, "id");
  const workflowRunId = stringField(input, "workflowRunId");
  const workflowNodeId = stringField(input, "workflowNodeId");
  const nodeId = stringField(input, "nodeId");
  if (!input || !id || !workflowRunId || !workflowNodeId || !nodeId) return undefined;
  return {
    id,
    workflowRunId,
    workflowNodeId,
    nodeId,
    agentRunId: stringField(input, "agentRunId"),
    agentBindingId: stringField(input, "agentBindingId"),
    status: workflowNodeRunStatus(stringField(input, "status")),
    inputContexts: arrayField(input, "inputContexts").filter(isObject),
    outputContext: objectField(input, "outputContext"),
    error: stringField(input, "error"),
    queuedAt: numberField(input, "queuedAt"),
    startedAt: numberField(input, "startedAt"),
    completedAt: numberField(input, "completedAt"),
    createdAt: numberField(input, "createdAt") ?? Date.now(),
    updatedAt: numberField(input, "updatedAt") ?? Date.now()
  };
}

function workflowEdgeDeliveryFromPayload(payload: Record<string, unknown>): WorkflowEdgeDeliveryViewModel | undefined {
  const input = objectField(payload, "delivery");
  const id = stringField(input, "id");
  const workflowRunId = stringField(input, "workflowRunId");
  const workflowEdgeId = stringField(input, "workflowEdgeId");
  const edgeId = stringField(input, "edgeId");
  const sourceNodeId = stringField(input, "sourceNodeId");
  const targetNodeId = stringField(input, "targetNodeId");
  if (!input || !id || !workflowRunId || !workflowEdgeId || !edgeId || !sourceNodeId || !targetNodeId) return undefined;
  return {
    id,
    workflowRunId,
    workflowEdgeId,
    edgeId,
    sourceNodeId,
    targetNodeId,
    sourceNodeRunId: stringField(input, "sourceNodeRunId"),
    targetNodeRunId: stringField(input, "targetNodeRunId"),
    mailboxMessageId: stringField(input, "mailboxMessageId"),
    status: workflowEdgeDeliveryStatus(stringField(input, "status")),
    context: recordField(input, "context"),
    idempotencyKey: stringField(input, "idempotencyKey"),
    attemptCount: numberField(input, "attemptCount") ?? 0,
    error: stringField(input, "error"),
    createdAt: numberField(input, "createdAt") ?? Date.now(),
    updatedAt: numberField(input, "updatedAt") ?? Date.now(),
    deliveredAt: numberField(input, "deliveredAt")
  };
}

function workflowValidationFromUnknown(input: Record<string, unknown> | undefined) {
  if (!input) return undefined;
  return {
    runnable: booleanField(input, "runnable") ?? false,
    issues: parseWorkflowIssues(input.issues),
    upstreamByNodeId: recordOfStringArray(input.upstreamByNodeId),
    downstreamByNodeId: recordOfStringArray(input.downstreamByNodeId)
  };
}

function upsertWorkflowRun(workflow: WorkflowViewModel, run: WorkflowRunViewModel): WorkflowViewModel {
  const existing = workflow.runs.find((item) => item.id === run.id);
  return {
    ...workflow,
    runs: upsertById(workflow.runs, {
      ...run,
      nodeRuns: existing?.nodeRuns ?? run.nodeRuns,
      edgeDeliveries: existing?.edgeDeliveries ?? run.edgeDeliveries
    })
  };
}

function upsertWorkflowNodeRun(workflow: WorkflowViewModel, workflowRunId: string, nodeRun: WorkflowNodeRunViewModel): WorkflowViewModel {
  return {
    ...workflow,
    runs: workflow.runs.map((run) =>
      run.id === workflowRunId
        ? { ...run, nodeRuns: upsertById(run.nodeRuns, nodeRun) }
        : run
    )
  };
}

function upsertWorkflowEdgeDelivery(workflow: WorkflowViewModel, workflowRunId: string, delivery: WorkflowEdgeDeliveryViewModel): WorkflowViewModel {
  return {
    ...workflow,
    runs: workflow.runs.map((run) =>
      run.id === workflowRunId
        ? { ...run, edgeDeliveries: upsertById(run.edgeDeliveries, delivery) }
        : run
    )
  };
}

function upsertById<T extends { readonly id: string }>(items: readonly T[], next: T): T[] {
  const existingIndex = items.findIndex((item) => item.id === next.id);
  if (existingIndex < 0) return [...items, next];
  const updated = [...items];
  updated[existingIndex] = { ...updated[existingIndex]!, ...next };
  return updated;
}

function parseWorkflowIssues(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((item) => ({
      code: stringField(item, "code") ?? "unknown",
      message: stringField(item, "message") ?? "Workflow validation issue",
      nodeId: stringField(item, "nodeId"),
      edgeId: stringField(item, "edgeId"),
      severity: stringField(item, "severity") === "warning" ? "warning" as const : "error" as const
    }));
}

function recordOfStringArray(value: unknown): Record<string, string[]> {
  if (!isObject(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) result[key] = item.filter((entry): entry is string => typeof entry === "string");
  }
  return result;
}

function workflowRunStatus(value: string | undefined): WorkflowRunViewModel["status"] {
  if (value === "queued" || value === "completed" || value === "failed" || value === "cancelled") return value;
  return "running";
}

function workflowNodeRunStatus(value: string | undefined): WorkflowNodeRunViewModel["status"] {
  if (value === "waiting" || value === "running" || value === "completed" || value === "failed" || value === "skipped" || value === "cancelled") return value;
  return "queued";
}

function workflowEdgeDeliveryStatus(value: string | undefined): WorkflowEdgeDeliveryViewModel["status"] {
  if (value === "mailbox_created" || value === "delivered" || value === "failed" || value === "skipped" || value === "cancelled") return value;
  return "queued";
}

function objectField(input: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const value = input[key];
  return isObject(value) ? value : undefined;
}

function recordField(input: Record<string, unknown> | undefined, key: string): Record<string, unknown> {
  return objectField(input, key) ?? {};
}

function arrayField(input: Record<string, unknown> | undefined, key: string): unknown[] {
  if (!input) return [];
  const value = input[key];
  return Array.isArray(value) ? value : [];
}

function stringField(input: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!input) return undefined;
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(input: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!input) return undefined;
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}

function booleanField(input: Record<string, unknown> | undefined, key: string): boolean | undefined {
  if (!input) return undefined;
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const globalProjector = new Projector();

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__PROJECTOR__ = globalProjector;
}

export function roomsListRequestPath(query: string): string {
  const trimmed = normalizedRoomSearchQuery(query);
  if (trimmed.length === 0) return "/rooms";
  const params = new URLSearchParams({ q: trimmed });
  return `/rooms?${params.toString()}`;
}

export function roomListFetchDelayMs(query: string): number {
  return normalizedRoomSearchQuery(query).length > 0 ? 200 : 0;
}

export function normalizedRoomSearchQuery(query: string): string {
  return query.trim();
}

export function useProjector(view: "main" | "detail", roomId?: string, runId?: string, roomSearchQuery = ""): ProjectorState {
  const [state, setState] = useState<ProjectorState>({
    rooms: new Map(),
    workflows: [],
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

  // Initial fetch and debounced search hydration so UI is populated even before SSE events arrive.
  useEffect(() => {
    if (view !== "main") return;
    let cancelled = false;
    const delayMs = roomListFetchDelayMs(roomSearchQuery);
    const timeoutId = globalThis.setTimeout(() => {
      ensureAuthSession()
      .then(() => fetch(roomsListRequestPath(roomSearchQuery), { credentials: "same-origin" }))
      .then((res) => res.json())
      .then((data: { rooms: Array<{ id: string; title: string; mode: string; pinnedAt?: number; lastActivityAt?: number; archivedAt?: number; participantContactNames?: unknown }> }) => {
        if (cancelled) return;
        if (normalizedRoomSearchQuery(roomSearchQuery).length > 0) {
          globalProjector.applyRoomSearchResults(roomSearchQuery, data.rooms);
          return;
        }
        globalProjector.clearRoomSearchResults();
        for (const room of data.rooms) {
          globalProjector.applyRoomListRow(room);
        }
      })
      .catch(() => {
        // ignore fetch errors
      });
    }, delayMs);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeoutId);
    };
  }, [view, roomSearchQuery]);

  return state;
}

export function getProjector(): Projector {
  return globalProjector;
}
