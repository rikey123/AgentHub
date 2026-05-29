# Task 6.4 — User Manual Acceptance Checklist

This checklist covers the full V1.0 orchestration surface. Work through each section in order. For every step, the expected result is listed inline. The key invariant throughout: **UI must update without a page refresh** whenever an event arrives via SSE.

---

## Setup

1. Start the daemon:
   ```
   pnpm.cmd --filter @agenthub/daemon dev
   ```
2. Open the browser at `http://127.0.0.1:6677`.
3. Complete the auth handshake if prompted (session cookie + CSRF token).

---

## Section 1 — Settings Modal

### 1.1 Open on Roles tab
- Click the Settings icon in the FeatureRail (gear/cog icon).
- **Expected:** Modal opens. The active tab is "Roles". The role list loads from `GET /roles`.

### 1.2 Navigate to Runtimes tab
- Click the "Runtimes" tab inside the modal.
- **Expected:** The native-default runtime row appears with status "connected". No API key field is shown for native runtimes.

### 1.3 Navigate to Models tab — add OpenAI model
- Click the "Models" tab.
- Click "Add model" (or equivalent add button).
- Select provider "OpenAI", enter a fake API key (e.g. `sk-fake-test-key-1234`), and save.
- **Expected:** The new model config row appears. The displayed value is a fingerprint (e.g. `sk-fa...1234`), not the full key. The full key is never shown.

### 1.4 Navigate to Models tab — add Ollama model
- Click "Add model" again.
- Select provider "Ollama".
- **Expected:** No API key field is shown. Only base URL (optional) is present.
- Save the Ollama config.
- **Expected:** Row appears with no key fingerprint column.

### 1.5 Close modal — URL cleanup
- Close the Settings modal (X button or backdrop click).
- **Expected:** The `?settings=` query param is removed from the URL. The workbench rail selection is unchanged.

### 1.6 Deep link to Models tab
- Navigate directly to `/?settings=models` (type in address bar or use a link).
- **Expected:** The Settings modal opens automatically with the "Models" tab active.

---

## Section 2 — Role Generation

### 2.1 Open generator dialog
- Open Settings > Roles tab.
- Click "Generate with AI" (or equivalent button).
- **Expected:** A dialog/modal opens with a description field and a model selector.

### 2.2 Start generation
- Enter a description (e.g. "A senior TypeScript code reviewer focused on correctness and security").
- Select a model config from the dropdown.
- Click "Generate".
- **Expected:** The dialog enters a polling/loading state. A spinner or progress indicator is visible.

### 2.3 Generation completes
- Wait for the generation job to complete (polling `GET /roles/generate/jobs/:jobId`).
- **Expected:** A draft preview appears with editable fields (name, description, capabilities, tags). The raw prompt/description is not shown in the preview.

### 2.4 Save generated role
- Optionally edit the draft fields.
- Click "Save".
- **Expected:** The dialog closes. The new role appears in the Roles tab list without a page refresh. The role row does not show a generation job ID or prompt text.

### 2.5 Cancel generation
- Repeat steps 2.1–2.2 to start a new generation.
- Click "Cancel" before or after the draft appears.
- **Expected:** The dialog closes. No new role is added to the list. No lingering polling activity (network tab should show no further job polling requests after cancel).

---

## Section 3 — Squad Run

### 3.1 Create a squad room
- Create a new room with `mode: squad`, a `leaderRoleId` pointing to a leader role, and at least one builder binding.
- **Expected:** Room is created. The leader agent is the primary participant.

### 3.2 Leader delegates a task
- In the squad room, trigger `room.delegate` via the leader's MCP tool (or via the chat interface if wired).
- Provide a task title and assign it to a builder binding.
- **Expected:** The delegation call returns successfully.

### 3.3 Task appears in Tasks tab without refresh
- Open the Side Panel and navigate to the Tasks tab.
- **Expected:** The delegated task appears in the "In Progress" lane **without a page refresh**. This confirms `task.delegation.created` was published and the projector handled it.

### 3.4 TaskStatusCard appears in main timeline
- Look at the main chat timeline for the squad room.
- **Expected:** A `TaskStatusCard` (or dispatch card) appears showing the delegated task title, assignee, and current status. No refresh required.

### 3.5 Teammate run completes — task status updates
- Wait for (or simulate) the teammate's delegated run completing.
- **Expected:** The task status in the Tasks tab updates to "Done" (or "Review" if `expectsReview` is set) **without a page refresh**. The `TaskStatusCard` in the main timeline also reflects the completion.

---

## Section 4 — Team Review

### 4.1 Create a team room with review
- Create a new room with `mode: team`, a `leaderRoleId`, and `expectsReview: true`.
- **Expected:** Room is created successfully.

### 4.2 Leader delegates multiple tasks
- Delegate at least two tasks to different teammate bindings.
- **Expected:** Both tasks appear in the Tasks tab in "In Progress" without refresh.

### 4.3 All teammates complete — review card appears
- Wait for (or simulate) all teammate runs completing.
- **Expected:** A "N tasks ready for review" card appears in the main chat timeline **without a page refresh**. The Tasks tab shows all tasks in "Review" status.

### 4.4 Leader approves tasks
- The leader calls `room.update_task` (via MCP or chat) to approve each task.
- **Expected:** Each approved task moves to "Done" in the Tasks tab without refresh. When all tasks are approved, the team dispatch is marked complete.

---

## Section 5 — Tasks Tab

### 5.1 Status lane grouping
- Open the Side Panel Tasks tab with at least one task in each status.
- **Expected:** Tasks are grouped into lanes: Backlog (pending), In Progress (in_progress), Blocked (blocked), Review (review), Done (completed/cancelled). Each lane header shows the count.

### 5.2 Task detail slide-over
- Click any task row in the Tasks tab.
- **Expected:** A detail slide-over (drawer) opens on the right. It shows the task title, status, assignee role/agent, priority, and an activity timeline.

### 5.3 Activity timeline content
- In the task detail slide-over, review the activity timeline.
- **Expected:** The timeline shows at least one entry: the delegation event, any comments added via `room.update_task`, and any run events linked to the task. Entries are in chronological order.

### 5.4 Live update in Tasks tab
- While the Tasks tab is open, trigger a status change on a task from another session or via the daemon API.
- **Expected:** The task moves to the correct lane **without a page refresh**. This confirms `task.status.changed` is handled by the projector and the Tasks tab re-renders from projector state.

---

## Section 6 — Run Detail Collaboration View

### 6.1 Open a delegated run's Run Detail
- Find a completed or in-progress delegated teammate run (from a squad or team room).
- Open its Run Detail drawer (click the run in the timeline or via the run list).
- **Expected:** The Run Detail drawer opens. The Tools tab is visible.

### 6.2 Tools tab — parent leader run link
- Click the "Tools" tab in the Run Detail drawer.
- **Expected:** A "Parent run" link is shown pointing to the leader run that delegated this task. Clicking it opens the correct leader run's Run Detail.

### 6.3 Tools tab — sibling runs
- In the same Tools tab, look for sibling runs (other teammate runs in the same dispatch group).
- **Expected:** Sibling run entries are listed. Each entry shows the sibling's role/agent name and status.

### 6.4 Tools tab — task tree
- In the same Tools tab, look for the task tree section.
- **Expected:** The delegated task is shown with its title, status, and a link back to the task in the Tasks tab.

### 6.5 Sibling run navigation
- Click a sibling run link in the Tools tab.
- **Expected:** The Run Detail drawer navigates to (or opens) the correct sibling run. The URL or drawer state reflects the new run ID.

---

## Key Verification: Live Updates Without Refresh

For each section above, confirm the following invariant holds:

| Section | Event that must arrive live | Expected UI reaction |
|---|---|---|
| Squad Run (3.3) | `task.delegation.created` | Task appears in Tasks tab |
| Squad Run (3.4) | `task.delegation.created` | TaskStatusCard in main timeline |
| Squad Run (3.5) | `task.status.changed` | Task moves to Done/Review lane |
| Team Review (4.3) | `team.dispatch.completed` | Review card in main timeline |
| Team Review (4.4) | `task.status.changed` | Task moves to Done lane |
| Tasks Tab (5.4) | `task.status.changed` | Task moves lanes without refresh |

If any of these require a page refresh to show the update, the SSE stream or projector handler for that event type is broken. Check:
1. The daemon published the event inside the same SQLite transaction as the mutation.
2. The event type is registered in `packages/protocol/src/events/registry.ts` with the correct `visibility` (`main`, `detail`, or `both`).
3. `apps/web/src/hooks/useProjector.ts` has a handler for the event type.

---

## Completion Criteria

This task (6.4) is complete when this checklist file exists. User execution of the checklist is not required for task completion. The checklist is a handoff artifact for browser QA.
