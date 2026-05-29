# V1.1 Plan: Task Board Kanban + Collaboration Visualization

**Status**: Planning artifact — not scheduled for V1.0  
**Created**: 2026-05-29  
**Task ref**: 6.6  

---

## Context

V1.0 delivers the core task workflow: creation, delegation, status tracking, and projector replay. These features are intentionally scoped to the minimum needed for agents to coordinate work through the task board.

V1.1 builds on that foundation with richer visualization. None of the features below belong in V1.0 because they all depend on V1.0 data structures and events being stable first.

---

## Features

### 1. Kanban Board

Drag-and-drop task management across status columns.

**What it does**:
- Tasks rendered as cards in columns: `pending`, `in_progress`, `blocked`, `done`, `cancelled`
- Drag a card between columns to trigger a status update
- Bulk selection and bulk status change
- Swimlane grouping by `assigneeRoleId` (e.g., one lane per agent role)

**V1.0 dependencies**:
- `room.update_task` command (status field must be writable)
- `task_activities` table for audit trail of status changes
- `TaskViewModel` with `status`, `assigneeRoleId`, `title`, `parentTaskId`
- `task.updated` event with `visibility: "main"` so the projector can reorder cards without a refresh

**Open questions for V1.1 design**:
- Optimistic UI vs. wait-for-event before reordering? Optimistic is snappier but risks snap-back on failure.
- Should swimlane grouping be persisted per-room or per-user?

---

### 2. Timeline View

Gantt-style visualization of task duration and sequencing.

**What it does**:
- Horizontal bars representing each task's time span (`createdAt` to `dueAt` or `completedAt`)
- Dependency arrows connecting tasks linked by `parentTaskId`
- Zoom controls (day / week / month)
- Click a bar to open the task detail drawer

**V1.0 dependencies**:
- `dueAt` field on the task data model (must be populated by V1.0)
- `parentTaskId` for dependency edges
- `completedAt` timestamp on task close events
- `TaskViewModel` must carry all three fields through the projector

**Open questions for V1.1 design**:
- Tasks without `dueAt` need a fallback rendering strategy (floating bar? greyed out?)
- Deep parent chains could produce complex graphs; may need a depth cap for V1.1

---

### 3. Topology View

Visual graph of agent delegation chains and run-to-task relationships.

**What it does**:
- Force-directed graph where nodes are agents/runs and edges are delegation relationships
- Clicking a node highlights all tasks owned by that agent in the current room
- Run nodes link to the run-detail drawer
- Delegation chain depth shown as edge labels

**V1.0 dependencies**:
- `delegation_chain` field on tasks (array of agent IDs from root to current assignee)
- `task.delegation.created` and `task.delegation.completed` events with `delegationId`
- `team.dispatch.started` and `team.dispatch.completed` events with `dispatchId`
- Projector state must reconstruct the full delegation graph from replayed events (no live-only data)

**Open questions for V1.1 design**:
- Graph layout library: D3 force simulation vs. a lighter alternative like `@visx/network`
- Large rooms with many agents could produce cluttered graphs; clustering by team may be needed

---

## Technical Prerequisites from V1.0

All of the following must be stable before V1.1 work begins:

| Prerequisite | Why it's needed |
|---|---|
| `TaskViewModel` with `assigneeRoleId`, `delegationChain`, `expectsReview`, `dueAt` | Kanban swimlanes, Timeline bars, Topology nodes all read these fields |
| `useProjector.ts` V1.0 Task replay model | V1.1 views are projector consumers; the replay shape must be frozen |
| `task.delegation.created/completed` events with `delegationId` | Topology edges are built from these events |
| `team.dispatch.started/completed` events with `dispatchId` | Dispatch nodes in the Topology graph |
| `task.updated` event with `visibility: "main"` | Kanban needs live reordering without refresh |
| `room.update_task` command accepting `status` | Kanban drag-and-drop writes back through this command |

If any of these ship incomplete or with a different shape in V1.0, V1.1 will need a compatibility shim or a V1.0 patch before proceeding.

---

## Non-Goals for V1.1

These are explicitly out of scope to keep V1.1 focused:

- **Real-time collaborative editing**: Multiple users editing the same task simultaneously with conflict resolution. This requires OT or CRDT infrastructure that doesn't exist yet.
- **External project management integrations**: Syncing with Jira, Linear, Asana, or GitHub Issues. Out of scope until the internal model is proven stable.
- **Mobile-responsive Kanban**: The workbench is a desktop-first surface. Mobile layout is a separate workstream.
- **AI-assisted task scheduling**: Auto-assigning tasks or suggesting due dates based on agent load. Deferred to a later planning cycle.

---

## Estimated Effort

**M (2-3 weeks)**

Breakdown:
- Kanban Board: ~1 week (drag-and-drop, optimistic UI, swimlanes)
- Timeline View: ~0.5 week (bar rendering, dependency arrows, zoom)
- Topology View: ~1 week (graph layout, event-driven edge building, run-detail integration)
- Integration testing and polish: ~0.5 week

This estimate assumes V1.0 prerequisites are fully shipped and stable.

---

## Relationship to V1.0

V1.0 is the foundation. V1.1 is visualization on top of it.

V1.0 must not be held back waiting for V1.1 design decisions. The right sequencing is:

1. Ship V1.0 with stable events, projector model, and task commands
2. Freeze the V1.0 event/projector contract
3. Begin V1.1 design against that frozen contract

No V1.1 code, components, or event types belong in the V1.0 codebase.
