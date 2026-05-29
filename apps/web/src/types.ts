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
  readonly kind: "run_started" | "run_completed" | "run_failed" | "run_cancelled" | "phase_completed" | "dispatch_started" | "dispatch_completed";
  readonly runId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly summary: string;
  readonly dispatchId?: string | undefined;
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

export type TaskActivityViewModel = {
  readonly id: string;
  readonly kind: string;
  readonly byKind: string;
  readonly by: string;
  readonly payload?: unknown;
  readonly createdAt?: number | undefined;
};

export type TaskDelegationViewModel = {
  readonly id: string;
  readonly status?: string | undefined;
  readonly assigneeRoleId?: string | undefined;
  readonly assigneeBindingId?: string | undefined;
  readonly assigneeAgentId?: string | undefined;
  readonly runId?: string | undefined;
  readonly roleId?: string | undefined;
  readonly completedAt?: number | undefined;
  readonly createdAt?: number | undefined;
  readonly payload?: unknown;
};

export type TaskViewModel = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly description?: string | undefined;
  readonly priority?: string | undefined;
  readonly assigneeRoleId?: string | undefined;
  readonly assigneeBindingId?: string | undefined;
  readonly assigneeAgentId?: string | undefined;
  readonly expectsReview?: boolean | undefined;
  readonly parentTaskId?: string | undefined;
  readonly delegationChain?: unknown[] | undefined;
  readonly sourceRunId?: string | undefined;
  readonly activities?: TaskActivityViewModel[] | undefined;
  readonly delegations?: TaskDelegationViewModel[] | undefined;
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
  readonly permissionSummary?: readonly { readonly resource: { readonly type: string; readonly provider?: string | undefined }; readonly decision: string; readonly modelConfigId: string }[] | undefined;
};

export type MailboxFailureViewModel = {
  readonly id: string;
  readonly mailboxMessageId: string;
  readonly targetAgentId: string;
  readonly targetAgentName?: string | undefined;
  readonly reason: string;
  readonly attemptCount: number;
  readonly failedAt: number;
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
  readonly mailboxFailures: MailboxFailureViewModel[];
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
