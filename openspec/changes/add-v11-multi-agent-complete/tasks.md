## 1. Contract Week — Schema, Events, Command Stubs (all devs, merge to main before branching)

- [ ] 1.1 Write `packages/db/migrations/0015_v11.sql`: new tables (`task_checkpoints`, `task_plans`, `run_file_changes`, `skills`, `skill_files`, `room_skills`, `agent_skills`) and new columns (`tasks.blocker_reason`, `tasks.max_turns`, `tasks.board_column`, `rooms.stalled_at`)
- [ ] 1.2 Add `"skill"` and `"worktree"` to `EventCategory` union in `packages/protocol/src/events/registry.ts`
- [ ] 1.3 Register all 16 V1.1 new event types in `registry.ts` per the Event Registry Contract table in `design.md`
- [ ] 1.4 Add new `WakeReason` values (`"plan"`, `"execute"`, `"agent_stalled"`) to the enum in `packages/orchestrator/src/commands.ts`
- [ ] 1.5 Add `room.complete_task` and `room.add_participant` and `room.apply_worktree` and `room.discard_worktree` command type stubs in `packages/orchestrator/src/commands.ts`
- [ ] 1.6 Add REST endpoint type stubs in `packages/daemon/src/routes/`: `POST /rooms/:id/participants`, `POST /rooms/:id/tasks/:taskId/column`, `POST /rooms/:id/worktrees/:runId/apply`, `POST /rooms/:id/worktrees/:runId/discard`, `GET/POST/PUT/DELETE /skills`
- [ ] 1.7 Add `TEAMMATE_ONLY_TOOLS` set alongside `LEADER_ONLY_TOOLS` in `packages/orchestrator/src/mcp/room-mcp-server.ts` (stubs only)
- [ ] 1.8 Verify `pnpm check:all` passes on main with schema + event stubs before branching

## 2. Dev A Track — Multi-Agent Reliability (packages/orchestrator, packages/artifacts, packages/daemon)

- [x] 2.1 Implement worktree-per-run isolation: default `ArtifactFS` to `isolated_worktree` for squad/team rooms; create worktree at `{workspace}/.agenthub/worktrees/{runId}`
- [x] 2.2 On `session.ended`: compute diff, store `worktree_diff` artifact with `status = "ready_for_review"`, publish `worktree.diff.ready`
- [x] 2.3 Implement `room.apply_worktree`: run `git apply`, on success publish `worktree.applied`, on conflict mark artifact `conflict`, transition task to `blocked(worktree_apply_conflict)`, wake leader
- [x] 2.4 Implement `room.discard_worktree`: delete worktree directory, publish `worktree.discarded`
- [x] 2.5 Implement two-level timeout escalation: Level-2 fires if no leader run reaches `running` within 5 minutes of Level-1; publish `room.stalled`, set `rooms.stalled_at`
- [x] 2.6 Implement `POST /rooms/:id/unstall`: clear `rooms.stalled_at`, publish `room.unstalled`
- [x] 2.7 Implement per-task turn limit: increment counter on each LLM response; when `max_turns` reached, cancel session, transition task to `blocked(turn_limit_exceeded)`, wake leader
- [x] 2.8 Implement mid-flight context handoff: on run terminal failure, write `task_checkpoints` row; inject `<prior-progress>` block on next wake for same task
- [x] 2.9 Implement `waitingPermissionCount` ref-counting in `RunLifecycleService` (replace boolean with counter)
- [x] 2.10 Implement path traversal validation on all file paths in MCP tool handlers (`file.read`, `file.write`, `fs.writeTextFile`, `fs.deleteFile`)
- [x] 2.11 Write unit tests for worktree lifecycle, timeout escalation, turn limit, checkpoint capture
- [x] 2.12 Write unit tests for permission ref-counting and path traversal guard

## 3. Dev B Track — Multi-Agent Intelligence + Skill System (packages/orchestrator, packages/skills)

- [x] 3.1 Implement `room.complete_task` MCP tool: teammate-only enforcement, `expects_review` gate, state machine per spec, publish `task.status.changed` + `task.delegation.completed`
- [ ] 3.2 Implement `assembleMissionBrief(roomId, agentId, taskId?)`: query live room state, build `MissionBrief` struct, inject as `<mission-brief>` XML block
- [ ] 3.3 Implement Room Memory: query confirmed `context_items` with `scope='conversation'` for `roomMemory` field in MissionBrief
- [ ] 3.4 Implement planning phase: `reason: "plan"` wake → leader produces PlanDocument → store in `task_plans` → publish `task.plan.created` → immediately trigger `reason: "execute"` wake; handle parse failure gracefully (write `task.activity.added { kind: "plan_parse_failed" }`, continue to execute)
- [ ] 3.5 Implement `roles.capabilities` validation: validate against well-known token set on role create/update; return 400 for unknown tokens
- [ ] 3.6 Update `room.list_members` to return `capabilities: string[]` per member
- [ ] 3.7 Update leader prompt to include teammate capabilities summary
- [x] 3.8 Implement sub-agent tool isolation: enforce `LEADER_ONLY_TOOLS` and `TEAMMATE_ONLY_TOOLS` at MCP dispatch; add `spawnDepth` check to prevent recursive spawn
- [ ] 3.9 Create `packages/skills` package: `SkillRegistry` with parse/validate SKILL.md, store skill + skill_files, resolve active skill set per (room, agent)
- [ ] 3.10 Implement skill materialization: write selected skills to runtime skill directory before run start; block run on materialization failure; publish `skill.materialization_failed`; cleanup in run terminal hook
- [ ] 3.11 Implement skill lifecycle events: publish `skill.created/updated/deleted/imported/activated/deactivated` on corresponding CRUD operations
- [ ] 3.12 Seed builtin skills (`task-planner`, `skill-creator`) on workspace first launch
- [ ] 3.13 Write unit tests for complete_task state machine (squad vs team mode), MissionBrief assembly, planning phase, skill materialization

## 4. Dev C Track — Frontend: Kanban, Team Expansion, Skill Settings (apps/web, packages/daemon routes)

- [ ] 4.1 Implement Kanban board component: columns, card anatomy (title, assignee, priority badge, blocker indicator, file-change badge, dependency indicator, turn count), drag-to-drop using `@dnd-kit`
- [ ] 4.2 Wire Kanban to projector: handle `task.column.moved`, `task.status.changed`, `task.created`, `task.activity.added`, `run.file_changes.recorded` events; update board without page refresh
- [ ] 4.3 Implement dependency arrows: SVG lines between cards with `dependencies` links; "Waiting on N tasks" indicator
- [ ] 4.4 Implement task detail drawer enhancements: file changes section (per-run list), worktree apply/discard controls, "Execution Plan" card (from `task.plan.created`)
- [ ] 4.5 Implement worktree UI: "Ready to apply" / "Conflict" badges on Kanban card; apply/discard buttons in task detail drawer; call `POST /rooms/:id/worktrees/:runId/apply|discard`
- [ ] 4.6 Implement room stalled banner: projector handles `room.stalled` → show dismissible banner; dismiss calls `POST /rooms/:id/unstall`
- [ ] 4.7 Implement `POST /rooms/:id/participants` daemon route (backend for add-participant)
- [ ] 4.8 Implement `POST /rooms/:id/tasks/:taskId/column` daemon route (backend for drag-to-move)
- [ ] 4.9 Implement `POST /rooms/:id/worktrees/:runId/apply|discard` daemon routes
- [ ] 4.10 Implement Members panel enhancements: "+ Add teammate" button, add-participant modal (searchable binding dropdown), capability badges, real-time presence via `agent.state.changed`
- [ ] 4.11 Implement skill CRUD daemon routes: `GET/POST/PUT/DELETE /skills`, `POST /skills/import`
- [ ] 4.12 Implement Settings → Skills tab: skill list (name, description, origin badge), New Skill editor, Import from URL, Edit/Delete/View actions
- [ ] 4.13 Implement room skill assignment UI: room creation dialog "Skills" section, room settings skill pool management
- [ ] 4.14 Implement Members panel skill overrides: per-agent skill expand section showing effective skill set
- [ ] 4.15 Write E2E tests for Kanban drag-to-move, add-participant flow, skill assignment

## 5. Integration Week — End-to-End Verification

- [ ] 5.1 Run full test suite (`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm check:all`) — all green
- [ ] 5.2 Manual E2E: create squad room with 3 agents, 5 tasks, verify Kanban board, drag-to-move, file-change badges
- [ ] 5.3 Manual E2E: team mode — verify `expects_review=1` tasks enter `review` (not `completed`) after `room.complete_task`
- [ ] 5.4 Manual E2E: worktree isolation — two agents write same file, apply first succeeds, apply second shows conflict badge
- [ ] 5.5 Manual E2E: turn limit — set `max_turns=3`, verify task transitions to `blocked(turn_limit_exceeded)` after 3 turns
- [ ] 5.6 Manual E2E: skill system — create workspace skill, assign to room, verify materialized in `.claude/skills/` before run, cleaned up after run
- [ ] 5.7 Manual E2E: add participant — add agent to running room, verify appears in Members panel without refresh, leader receives mailbox notification
- [ ] 5.8 Manual E2E: planning phase — first message in squad room shows "Execution Plan" card in side panel
- [ ] 5.9 Manual E2E: room stalled — simulate leader failure after watchdog fires, verify stalled banner appears
- [ ] 5.10 Manual E2E: MissionBrief — confirm teammate prompt contains `<mission-brief>` with goal, sibling tasks, room memory
- [ ] 5.11 Verify all 16 new event types are registered in `registry.ts` and consumed by projector where `visibility` includes `main`
- [ ] 5.12 Run `openspec validate add-v11-multi-agent-complete --strict` — valid
