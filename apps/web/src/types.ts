import type { MessagePart, PermissionResource } from "@agenthub/protocol/domains";

export type ParticipantViewModel = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly presence: string;
  readonly adapterId: string;
};

export type MessageViewModel = {
  readonly id: string;
  readonly roomId: string;
  readonly senderType: "user" | "agent" | "system";
  readonly senderId: string;
  readonly senderName: string;
  readonly role: string;
  readonly status: string;
  readonly text: string;
  readonly parts: MessagePart[];
  readonly quotedMessageId?: string | undefined;
  readonly pendingTurnId?: string | undefined;
  readonly pendingTurnStatus?: "queued" | "scheduled" | "consumed" | "cancelled" | undefined;
  readonly pendingTurnPosition?: number | undefined;
  readonly runId?: string | undefined;
  readonly createdAt: number;
};

export type BriefViewModel = {
  readonly kind: "run_started" | "run_completed" | "run_failed" | "run_cancelled" | "phase_completed";
  readonly runId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly summary: string;
  readonly artifactCount?: number | undefined;
  readonly cost?: { readonly tokens: number; readonly usd?: number | undefined } | undefined;
  readonly failureReason?: string | undefined;
  readonly failureClass?: string | undefined;
};

export type InterventionViewModel = {
  readonly id: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly reason: string;
  readonly priority: "low" | "medium" | "high";
  readonly preview?: string | undefined;
  readonly status: string;
};

export type PermissionViewModel = {
  readonly id: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly resource: PermissionResource;
  readonly reason?: string | undefined;
  readonly status: "pending" | "allowed" | "denied" | "expired";
  readonly runId?: string | undefined;
};

export type ContextItemViewModel = {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly status: "draft" | "confirmed" | "deprecated" | "disputed";
  readonly scope: string;
  readonly pinned: boolean;
  readonly runId?: string | undefined;
};

export type TaskViewModel = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly assigneeAgentId?: string | undefined;
};

export type RunViewModel = {
  readonly id: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly status: string;
  readonly startedAt?: number | undefined;
  readonly endedAt?: number | undefined;
  readonly cost?: { readonly inputTokens: number; readonly outputTokens: number; readonly cachedTokens: number; readonly costUsd: number; readonly modelId: string } | undefined;
  readonly failureClass?: string | undefined;
  readonly error?: string | undefined;
};

export type RoomViewModel = {
  readonly id: string;
  readonly title: string;
  readonly mode: string;
  readonly primaryAgentId?: string | undefined;
  readonly participants: ParticipantViewModel[];
  readonly messages: MessageViewModel[];
  readonly briefs: BriefViewModel[];
  readonly unresolvedInterventions: InterventionViewModel[];
  readonly pendingPermissions: PermissionViewModel[];
  readonly contextItems: ContextItemViewModel[];
  readonly tasks: TaskViewModel[];
  readonly runs: RunViewModel[];
  readonly pendingTurns: MessageViewModel[];
  readonly cursor?: string | undefined;
  readonly unreadCount: number;
};

export type ProjectorState = {
  readonly rooms: Map<string, RoomViewModel>;
  readonly activeRoomId?: string | undefined;
  readonly activeRunId?: string | undefined;
  readonly connectionStatus: "connected" | "connecting" | "reconnecting" | "offline" | "disconnected";
  readonly connectionError?: string | undefined;
};
