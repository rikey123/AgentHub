import type { MessagePart, PermissionResource } from "@agenthub/protocol/domains";
import type {
  WorkflowEdgeDeliveryStatus,
  WorkflowNodeKind,
  WorkflowNodeRunStatus,
  WorkflowRunStatus,
  WorkflowValidationIssue,
  WorkflowVersionState
} from "@agenthub/protocol/workflows";

export type ArtifactVersionViewModel = {
  readonly id: string;
  readonly artifactId: string;
  readonly version: number;
  readonly contentEncoding: "text" | "binary";
  readonly createdAt: number;
  readonly createdBy?: string | undefined;
  readonly message?: string | undefined;
  readonly storagePath?: string | undefined;
};

export type DeploymentProviderViewModel = {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: "caprover" | "dokploy" | "coolify";
  readonly name: string;
  readonly baseUrl: string;
  readonly credentialRef: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type DeploymentViewModel = {
  readonly id: string;
  readonly artifactId: string;
  readonly roomId?: string | undefined;
  readonly workspaceId: string;
  readonly kind: "preview-url" | "static-site" | "source-zip" | "container-export" | "container-build" | "self-hosted";
  readonly provider: "agenthub-local" | "caprover";
  readonly status: "queued" | "in_progress" | "ready" | "failed" | "cancelled" | "expired" | "unpublished";
  readonly url?: string | undefined;
  readonly downloadUrl?: string | undefined;
  readonly imageTag?: string | undefined;
  readonly expiresAt?: number | undefined;
  readonly artifactVersion?: number | undefined;
  readonly lastError?: string | undefined;
  readonly createdAt?: number | undefined;
  readonly updatedAt?: number | undefined;
};

export type AgentContactViewModel = {
  readonly agentBindingId: string;
  readonly displayName: string;
  readonly avatarUrl?: string | undefined;
  readonly roleId: string;
  readonly runtimeId?: string | undefined;
  readonly modelConfigId?: string | undefined;
  readonly roleName?: string | undefined;
  readonly runtimeKind: string;
  readonly runtimeName?: string | undefined;
  readonly modelName?: string | undefined;
  readonly capabilities: readonly string[];
  readonly skills?: readonly string[] | undefined;
  readonly status: "available" | "busy" | "offline";
  readonly description?: string | undefined;
  readonly systemPrompt?: string | undefined;
  readonly lastUsedAt?: number | undefined;
  readonly runtimeHealth?: { readonly status: "success" | "error" | "experimental"; readonly version?: string | undefined; readonly error?: string | undefined } | undefined;
};

export type ParticipantViewModel = {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl?: string | undefined;
  readonly role: string;
  readonly presence: string;
  readonly adapterId: string;
  readonly agentBindingId?: string | undefined;
  readonly roleId?: string | undefined;
  readonly capabilities?: readonly string[] | undefined;
};

export type MessageViewModel = {
  readonly id: string;
  readonly roomId: string;
  readonly senderType: "user" | "agent" | "system";
  readonly senderId: string;
  readonly senderName: string;
  readonly senderAvatarUrl?: string | undefined;
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
  readonly pinnedAt?: number | undefined;
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

export type TaskFileChangeViewModel = {
  readonly path: string;
  readonly change: string;
  readonly linesAdded?: number | undefined;
  readonly linesRemoved?: number | undefined;
  readonly artifactId?: string | undefined;
};

export type TaskFileChangeRunViewModel = {
  readonly runId: string;
  readonly artifactId?: string | undefined;
  readonly files: readonly TaskFileChangeViewModel[];
  readonly createdAt: number;
};

export type WorktreeReviewViewModel = {
  readonly runId: string;
  readonly artifactId?: string | undefined;
  readonly status: "ready_for_review" | "applied" | "discarded" | "conflict";
  readonly filesChanged?: readonly string[] | undefined;
  readonly conflictDiff?: string | undefined;
  readonly updatedAt: number;
};

export type RoomExecutionPlanViewModel = {
  readonly planId: string;
  readonly runId: string;
  readonly planJson: unknown;
  readonly taskCount?: number | undefined;
  readonly createdAt: number;
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
  readonly blockerReason?: string | undefined;
  readonly maxTurns?: number | undefined;
  readonly parentTaskId?: string | undefined;
  readonly delegationChain?: unknown[] | undefined;
  readonly sourceRunId?: string | undefined;
  readonly dependencies?: readonly string[] | undefined;
  readonly activities?: TaskActivityViewModel[] | undefined;
  readonly delegations?: TaskDelegationViewModel[] | undefined;
  // V1.1 additions
  readonly boardColumn?: string | undefined;           // user-overridden Kanban column (D11)
  readonly worktreeStatus?: "ready_for_review" | "applied" | "discarded" | "conflict" | undefined; // worktree badge (D3)
  readonly worktreeArtifactId?: string | undefined;    // artifact id for apply/discard actions
  readonly worktreeRunId?: string | undefined;
  readonly worktreeReviews?: readonly WorktreeReviewViewModel[] | undefined;
  readonly fileChangesCount?: number | undefined;      // aggregate file-change badge (D12)
  readonly fileChangeRuns?: readonly TaskFileChangeRunViewModel[] | undefined;
  readonly lastUnblockedAt?: number | undefined;
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
  readonly wakeReason?: string | undefined;
  readonly messageId?: string | undefined;
  readonly parentRunId?: string | undefined;
  readonly parentTaskId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly dispatchId?: string | undefined;
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

// V1.1 additions
export type SkillErrorViewModel = {
  readonly skillId: string;
  readonly skillName?: string | undefined;
  readonly runId: string;
  readonly error: string;
  readonly createdAt: number;
};

export type WorkflowCanvasPoint = {
  readonly x: number;
  readonly y: number;
};

export type WorkflowCanvasSize = {
  readonly width: number;
  readonly height: number;
};

export type WorkflowNodeViewModel = {
  readonly id: string;
  readonly workflowVersionId: string;
  readonly nodeId: string;
  readonly kind: WorkflowNodeKind;
  readonly displayName: string;
  readonly agentBindingId?: string | undefined;
  readonly roleLabel?: string | undefined;
  readonly prompt: string;
  readonly position: WorkflowCanvasPoint;
  readonly size?: WorkflowCanvasSize | undefined;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly config: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type WorkflowEdgeViewModel = {
  readonly id: string;
  readonly workflowVersionId: string;
  readonly edgeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly label?: string | undefined;
  readonly enabled: boolean;
  readonly config: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type WorkflowVersionViewModel = {
  readonly id: string;
  readonly workflowId: string;
  readonly versionNumber: number;
  readonly state: WorkflowVersionState;
  readonly valid: boolean;
  readonly validationErrors: readonly WorkflowValidationIssue[];
  readonly viewport: Record<string, unknown>;
  readonly createdFromVersionId?: string | undefined;
  readonly lockedFromVersionId?: string | undefined;
  readonly lockedAt?: number | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type WorkflowValidationViewModel = {
  readonly runnable: boolean;
  readonly issues: readonly WorkflowValidationIssue[];
  readonly upstreamByNodeId: Readonly<Record<string, readonly string[]>>;
  readonly downstreamByNodeId: Readonly<Record<string, readonly string[]>>;
};

export type WorkflowNodeRunViewModel = {
  readonly id: string;
  readonly workflowRunId: string;
  readonly workflowNodeId: string;
  readonly nodeId: string;
  readonly agentRunId?: string | undefined;
  readonly agentBindingId?: string | undefined;
  readonly status: WorkflowNodeRunStatus;
  readonly inputContexts: readonly Record<string, unknown>[];
  readonly outputContext?: Record<string, unknown> | undefined;
  readonly error?: string | undefined;
  readonly queuedAt?: number | undefined;
  readonly startedAt?: number | undefined;
  readonly completedAt?: number | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type WorkflowEdgeDeliveryViewModel = {
  readonly id: string;
  readonly workflowRunId: string;
  readonly workflowEdgeId: string;
  readonly edgeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly sourceNodeRunId?: string | undefined;
  readonly targetNodeRunId?: string | undefined;
  readonly mailboxMessageId?: string | undefined;
  readonly status: WorkflowEdgeDeliveryStatus;
  readonly context: Record<string, unknown>;
  readonly idempotencyKey?: string | undefined;
  readonly attemptCount: number;
  readonly error?: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deliveredAt?: number | undefined;
};

export type WorkflowRunViewModel = {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly workspaceId: string;
  readonly roomId?: string | undefined;
  readonly status: WorkflowRunStatus;
  readonly seedContext?: string | undefined;
  readonly startedBy?: string | undefined;
  readonly startedAt?: number | undefined;
  readonly endedAt?: number | undefined;
  readonly failureReason?: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly nodeRuns: readonly WorkflowNodeRunViewModel[];
  readonly edgeDeliveries: readonly WorkflowEdgeDeliveryViewModel[];
};

export type WorkflowViewModel = {
  readonly id: string;
  readonly workspaceId: string;
  readonly roomId?: string | undefined;
  readonly name: string;
  readonly description?: string | undefined;
  readonly draftVersionId?: string | undefined;
  readonly activeVersionId?: string | undefined;
  readonly createdBy?: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt?: number | undefined;
  readonly versions: readonly WorkflowVersionViewModel[];
  readonly nodes: readonly WorkflowNodeViewModel[];
  readonly edges: readonly WorkflowEdgeViewModel[];
  readonly runs: readonly WorkflowRunViewModel[];
  readonly validation?: WorkflowValidationViewModel | undefined;
};

export type RoomViewModel = {
  readonly id: string;
  readonly title: string;
  readonly mode: string;
  readonly primaryAgentId?: string | undefined;
  readonly pinnedAt?: number | undefined;
  readonly lastActivityAt?: number | undefined;
  readonly archivedAt?: number | undefined;
  readonly participants: ParticipantViewModel[];
  readonly participantContactNames: Record<string, string>;
  readonly messages: MessageViewModel[];
  readonly briefs: BriefViewModel[];
  readonly unresolvedInterventions: InterventionViewModel[];
  readonly pendingPermissions: PermissionViewModel[];
  readonly contextItems: ContextItemViewModel[];
  readonly tasks: TaskViewModel[];
  readonly runs: RunViewModel[];
  readonly pendingTurns: MessageViewModel[];
  readonly mailboxFailures: MailboxFailureViewModel[];
  readonly artifactVersionsById: Record<string, ArtifactVersionViewModel[]>;
  readonly deploymentsById: Record<string, DeploymentViewModel>;
  readonly deploymentLogsById: Record<string, string[]>;
  readonly cursor?: string | undefined;
  readonly unreadCount: number;
  // V1.1 additions
  readonly stalledAt?: number | undefined;             // set when Level-2 timeout fires (D4)
  readonly stalledTaskIds?: readonly string[] | undefined; // tasks that triggered stall
  readonly stalledReason?: string | undefined;         // "leader_unavailable" | "leader_failed"
  readonly skillErrors?: readonly SkillErrorViewModel[] | undefined; // skill.materialization_failed (D9)
  readonly executionPlan?: RoomExecutionPlanViewModel | undefined; // task.plan.created (D8)
  readonly workflows?: readonly WorkflowViewModel[] | undefined;
};

export type ProjectorState = {
  readonly rooms: Map<string, RoomViewModel>;
  readonly roomSearchResultIds?: readonly string[] | undefined;
  readonly roomSearchResultQuery?: string | undefined;
  readonly workflows: readonly WorkflowViewModel[];
  readonly activeRoomId?: string | undefined;
  readonly activeRunId?: string | undefined;
  readonly connectionStatus: "connected" | "connecting" | "reconnecting" | "offline" | "disconnected";
  readonly connectionError?: string | undefined;
};
