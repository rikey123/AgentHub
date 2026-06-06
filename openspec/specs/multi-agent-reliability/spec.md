# multi-agent-reliability Specification

## Purpose
TBD - created by archiving change add-v11-multi-agent-complete. Update Purpose after archive.
## Requirements
### Requirement: Worktree-per-run isolation for squad and team rooms (file-conflict-isolation)

The system SHALL default `ArtifactFS` mode to `isolated_worktree` for all runs in rooms whose `mode` is `squad` or `team`. Each run SHALL receive a dedicated git worktree at `{workspace.root_path}/.agenthub/worktrees/{runId}`.

On `session.ended`, the daemon SHALL:
1. Compute a diff between the worktree and the primary workspace HEAD.
2. Store the diff as an `artifact` of type `worktree_diff` with `status = "ready_for_review"`.
3. Publish `worktree.diff.ready { runId, taskId?, artifactId, filesChanged }` (durable, visibility: `both`).
4. Leave the worktree directory intact for the apply/discard step.

The daemon SHALL NOT merge or apply the worktree automatically. Changes SHALL only be applied after an explicit `room.apply_worktree { runId }` MCP tool call (leader-only) or user action via the UI. Discarding calls `room.discard_worktree { runId }`. Both operations publish a corresponding durable event and clean up the worktree directory.

When `room.apply_worktree` is called, the daemon SHALL attempt `git apply` of the stored diff against the current workspace HEAD. If the apply exits non-zero (conflict), the artifact SHALL be marked `status = "conflict"`, the associated task SHALL transition to `blocked` with `blocker_reason = "worktree_apply_conflict"`, and the leader SHALL be woken with `reason: "task_blocked"`. The conflict diff SHALL be stored in `task_activities` as a `blocker_set` entry.

Worktrees for runs whose artifact is in `applied` or `discarded` state SHALL be cleaned up immediately. Worktree expiry policy for long-lived unapplied worktrees is deferred to V1.2.

#### Scenario: Two agents write the same file concurrently

- **WHEN** Agent A and Agent B both write `src/utils.ts` in the same squad room during overlapping runs
- **THEN** each agent writes to its own worktree without interference; on `session.ended` for each run, a `worktree_diff` artifact is generated; applying A's diff succeeds; when the user or leader later applies B's diff, `git apply` detects a conflict, the artifact is marked `conflict`, B's task transitions to `blocked`, and the leader is woken with `reason: "task_blocked"`

#### Scenario: Solo room is unaffected

- **WHEN** a run executes in a room with `mode = "solo"` or `mode = "assisted"`
- **THEN** `ArtifactFS` uses the existing `shared` mode; no worktree is created; no `worktree_diff` artifact is generated

#### Scenario: Leader applies worktree successfully

- **WHEN** the leader calls `room.apply_worktree { runId }` and there are no conflicts with the current workspace HEAD
- **THEN** `git apply` succeeds; the artifact transitions to `applied`; `worktree.applied { runId, artifactId }` is published; the worktree directory is deleted

### Requirement: Two-level timeout escalation with room.stalled event (timeout-escalation)

The system SHALL implement a two-level escalation for stalled multi-agent rooms.

Level 1 (existing watchdog, unchanged): 90 seconds of silence on a running agent → notify leader via mailbox + `WakeAgent(reason: "agent_stalled")`.

Level 2 (new): if, within 5 minutes of a Level-1 notification, no leader run reaches `running` state OR the leader run transitions to a terminal failure state, the system SHALL:
1. Publish `room.stalled { roomId, stalledTaskIds: string[], reason: "leader_unavailable" | "leader_failed" }` (durable, visibility: `main`).
2. Set `rooms.stalled_at = now()`.
3. NOT automatically cancel any runs or tasks (user decides).

The projector SHALL surface a dismissible banner in the chat view when `room.stalled_at IS NOT NULL`. Dismissing the banner calls `POST /rooms/:id/unstall` which clears `stalled_at` and publishes `room.unstalled`.

#### Scenario: Leader fails after watchdog fires

- **WHEN** a teammate is silent for 90s (Level-1 fires), the leader is woken, but the leader run transitions to `failed` within 5 minutes
- **THEN** `room.stalled` is published, `rooms.stalled_at` is set, and the chat view shows a stalled banner with the list of affected task IDs

#### Scenario: Leader recovers in time

- **WHEN** a teammate is silent for 90s (Level-1 fires) and the leader run reaches `running` within 5 minutes
- **THEN** Level-2 does NOT fire; no `room.stalled` event is published

#### Scenario: User dismisses stalled banner

- **WHEN** the user clicks "Dismiss" on the stalled banner
- **THEN** `POST /rooms/:id/unstall` clears `rooms.stalled_at`, publishes `room.unstalled`, and the banner disappears without a page refresh

### Requirement: Mid-flight context handoff via task checkpoints (mid-flight-handoff)

When a run that is associated with a task (`runs.task_id IS NOT NULL`) transitions to a terminal failure state (`failed` or `cancelled`), the system SHALL capture a checkpoint in the `task_checkpoints` table. The checkpoint SHALL store: `id`, `task_id`, `run_id`, `progress_summary` (the last assistant message text, truncated to 2000 chars), `files_touched` (JSON array of paths written during the run), `created_at`. The checkpoint is written inside the same SQLite transaction as the run terminal event.

When the task is subsequently re-delegated (a new run is created for the same task), the run executor SHALL include the most recent checkpoint's `progress_summary` and `files_touched` in the wake prompt as a `<prior-progress>` XML block, prepended after the `<mission-brief>` and before the role system prompt. This allows the replacement agent to continue from where the previous agent left off without redoing completed work.

#### Scenario: Run fails mid-task, replacement receives checkpoint

- **WHEN** a run for Task T fails after writing 3 files and producing partial output
- **THEN** a `task_checkpoints` row is written with the last assistant text and the 3 file paths; when the leader re-delegates Task T and a new run starts, the new run's prompt includes a `<prior-progress>` block summarising what was done

#### Scenario: Task with no prior run has no checkpoint

- **WHEN** a task is delegated for the first time
- **THEN** no `<prior-progress>` block is injected; the run starts with a clean prompt

#### Scenario: Only the most recent checkpoint is used

- **WHEN** a task has been attempted 3 times and has 3 checkpoint rows
- **THEN** only the checkpoint from the most recent failed run is injected; older checkpoints are retained for audit but not injected

### Requirement: Concurrent permission request ref-counting (permission-ref-count)

The system SHALL replace the boolean `waitingPermission` state in `RunLifecycleService` with a reference counter `waitingPermissionCount: number`. `enterWaitingPermission(requestId: string)` SHALL increment the counter and record the `requestId`. `exitWaitingPermission(requestId: string)` SHALL decrement the counter. The run SHALL only resume processing when the counter reaches zero. Calling `exitWaitingPermission` with an unknown `requestId` SHALL be a no-op (idempotent). This change is backward-compatible: existing callers that call enter once and exit once are unaffected.

#### Scenario: Two parallel tool calls both request permission

- **WHEN** a run has two concurrent tool calls that both trigger permission requests
- **THEN** `waitingPermissionCount` reaches 2; the run does not resume until both permissions are resolved; after both `exitWaitingPermission` calls the counter reaches 0 and the run resumes

#### Scenario: Single permission request (existing behavior)

- **WHEN** a run has one tool call that triggers a permission request
- **THEN** `waitingPermissionCount` reaches 1, then 0 on resolution; behavior is identical to the previous boolean implementation

### Requirement: Path traversal validation on workspace and file paths (path-traversal-guard)

The system SHALL validate all user-supplied or agent-supplied file paths before any file system operation. A path SHALL be rejected if it contains `..` segments, is absolute (starts with `/` or a drive letter on Windows), or resolves outside the workspace root after normalization. Rejected paths SHALL return `{ error: "path_traversal_denied", path }` to the caller. This validation SHALL apply to: `file.read`, `file.write`, `fs.writeTextFile`, `fs.deleteFile` MCP tool calls, and workspace path configuration in daemon settings.

#### Scenario: Agent attempts path traversal

- **WHEN** an agent calls `file.write` with path `../../etc/passwd`
- **THEN** the MCP server returns `{ error: "path_traversal_denied", path: "../../etc/passwd" }` without touching the filesystem

#### Scenario: Absolute path rejected

- **WHEN** an agent calls `file.read` with path `/etc/hosts`
- **THEN** the MCP server returns `{ error: "path_traversal_denied", path: "/etc/hosts" }`

#### Scenario: Valid relative path accepted

- **WHEN** an agent calls `file.write` with path `src/utils.ts`
- **THEN** the file is written at `{workspace.root_path}/src/utils.ts` without error
