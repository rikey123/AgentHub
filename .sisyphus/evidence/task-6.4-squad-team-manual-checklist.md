# Task 6.4 — Squad and Team Manual Acceptance Checklist

This checklist focuses specifically on Squad and Team orchestration flows. It is a focused subset of the full acceptance checklist (`task-6.4-user-manual-acceptance-checklist.md`) for testers who want to verify multi-agent coordination in isolation.

---

## Setup

1. Start the daemon:
   ```
   pnpm.cmd --filter @agenthub/daemon dev
   ```
2. Open the browser at `http://127.0.0.1:6677`.
3. Ensure at least two agent bindings exist (one leader role, one or more builder/reviewer roles). Create them via Settings > Roles and Settings > Agent Bindings if needed.

---

## Part A — Squad Mode

Squad mode: the leader delegates tasks to teammates. Teammates run independently. The leader resumes when all delegated tasks complete.

### A.1 Create a squad room

- Create a new room with:
  - `mode: squad`
  - `leaderRoleId`: an existing leader role ID
  - At least one participant binding for a builder role
- **Expected:** Room created. Leader is the primary agent. Room detail shows `mode: squad`.

### A.2 Delegate a task from the leader

- In the squad room, the leader calls `room.delegate` with:
  - `title`: a short task description
  - `assigneeRoleId`: the builder role ID
- **Expected:** Delegation succeeds. A new task row is created in the database. The leader run enters a waiting state.

### A.3 Task appears in Tasks tab — no refresh

- Open the Side Panel and click the Tasks tab.
- **Expected:** The delegated task appears in the "In Progress" lane **without a page refresh**. The task shows the correct title and assignee.

### A.4 TaskStatusCard in main timeline — no refresh

- Look at the main chat timeline.
- **Expected:** A `TaskStatusCard` (dispatch card) appears showing the task title, assignee role, and "In Progress" status **without a page refresh**.

### A.5 Teammate run completes

- Wait for (or simulate) the builder's delegated run completing successfully.
- **Expected:**
  - The task status in the Tasks tab moves to "Done" **without a page refresh**.
  - The `TaskStatusCard` in the main timeline updates to show completion.
  - The leader run resumes (wakes) automatically.

### A.6 Blocked sibling behavior

- Delegate two tasks. Let one complete and one enter a blocked state (via `room.update_task` with `status: blocked`).
- **Expected:** The leader does not wake until the blocked task is resolved. The Tasks tab shows one task in "Done" and one in "Blocked".

### A.7 Three-way parallel dispatch

- Delegate three tasks simultaneously to three different builder bindings.
- **Expected:** All three tasks appear in the Tasks tab as "In Progress". Three separate delegated runs are queued. No duplicate wake events collapse them.

---

## Part B — Team Mode

Team mode: the leader delegates tasks to teammates. All teammates must complete before the leader reviews. The leader approves or rejects each task.

### B.1 Create a team room with review

- Create a new room with:
  - `mode: team`
  - `leaderRoleId`: an existing leader role ID
  - `expectsReview: true`
  - At least two participant bindings
- **Expected:** Room created. Room detail shows `mode: team` and `expectsReview: true`.

### B.2 Delegate multiple tasks

- Delegate at least two tasks to different teammate bindings.
- **Expected:** Both tasks appear in the Tasks tab as "In Progress" without refresh.

### B.3 Partial completion — leader does not wake

- Let one teammate run complete. Leave the other running.
- **Expected:** The leader does not wake. The completed task moves to "Review" in the Tasks tab. The main timeline does not show a "ready for review" card yet.

### B.4 All teammates complete — review card appears

- Let the remaining teammate run complete.
- **Expected:**
  - A "N tasks ready for review" card appears in the main chat timeline **without a page refresh**.
  - All tasks show "Review" status in the Tasks tab.
  - The leader run wakes and is ready to review.

### B.5 Leader approves a task

- The leader calls `room.update_task` with `status: completed` (or equivalent approval) for one task.
- **Expected:** That task moves to "Done" in the Tasks tab without refresh. The review card count decrements (or updates) in the main timeline.

### B.6 Leader approves all tasks

- Approve the remaining tasks.
- **Expected:** All tasks show "Done". The team dispatch is marked complete. The leader run finishes.

### B.7 Rejection / re-delegation path (if implemented)

- If the leader rejects a task (sets it back to `in_progress` or `blocked`), verify:
  - The task moves back to the correct lane in the Tasks tab without refresh.
  - The review card updates accordingly.

---

## Part C — Live Update Invariants

For every step above, the following must hold without a page refresh:

| Event | Source | Expected UI reaction |
|---|---|---|
| `task.delegation.created` | `room.delegate` MCP call | Task appears in Tasks tab In Progress lane |
| `task.delegation.created` | `room.delegate` MCP call | TaskStatusCard appears in main timeline |
| `task.status.changed` (→ review) | Teammate run terminal | Task moves to Review lane |
| `task.status.changed` (→ completed) | Leader approval | Task moves to Done lane |
| `team.dispatch.completed` | All siblings in review | "N tasks ready for review" card in main timeline |

If any update requires a refresh, check:
1. The daemon published the event in the same SQLite transaction as the mutation (`packages/daemon/src/commands.ts` pattern).
2. The event type has `visibility: "main"` or `"both"` in `packages/protocol/src/events/registry.ts`.
3. `apps/web/src/hooks/useProjector.ts` has a handler for the event type.

---

## Part D — Run Detail Collaboration (Squad/Team specific)

### D.1 Open a delegated teammate run

- Find a completed delegated run in the room timeline.
- Open its Run Detail drawer.
- **Expected:** Run Detail opens. The Tools tab is visible.

### D.2 Parent leader run link

- In the Tools tab, verify the "Parent run" link.
- **Expected:** The link points to the leader run that issued the delegation. Clicking it opens the correct Run Detail.

### D.3 Sibling runs list

- In the Tools tab, verify the sibling runs section.
- **Expected:** Other teammate runs from the same dispatch group are listed with their role names and statuses.

### D.4 Task tree

- In the Tools tab, verify the task tree section.
- **Expected:** The delegated task is shown with title, status, and a link to the task detail in the Tasks tab.

### D.5 Sibling run navigation

- Click a sibling run link.
- **Expected:** The Run Detail drawer navigates to the sibling run. The correct run ID is reflected in the drawer state or URL.

---

## Completion Criteria

This checklist is a handoff artifact. Task 6.4 is complete when this file exists. User execution is not required for task completion.
