## 1. Data Model And Protocol

- [x] 1.1 Add SQLite migrations for workflow definitions, versions, nodes, edges, runs, node runs, and edge deliveries.
- [x] 1.2 Add indexes for workflow lookup, version lookup, node/edge lookup by version, run lookup by workflow/version, and delivery lookup by run/node/edge.
- [x] 1.3 Add protocol types for workflow definitions, nodes, edges, validation results, run state, node run state, and edge delivery state.
- [x] 1.4 Register workflow event payload schemas in `packages/protocol/src/events/registry.ts` with deliberate durability and visibility values.
- [x] 1.5 Add event registry tests that fail for unregistered workflow event literals or visibility mismatches.

## 2. Workflow Graph Service

- [x] 2.1 Implement workflow CRUD service methods that write graph rows and publish definition events in the same SQLite transaction.
- [x] 2.2 Implement draft version update operations for node add/update/remove, edge add/update/remove, viewport update, enabled/disabled toggles, and locked state.
- [x] 2.3 Implement graph validation for missing nodes, invalid edge endpoints, unsupported node kinds, cycles, duplicate edges, no start node, and disabled graph elements.
- [x] 2.4 Implement source and destination neighbor indexes for upstream/downstream lookup.
- [x] 2.5 Implement locked version snapshot creation at workflow run start.
- [ ] 2.6 Add unit tests for graph persistence, version locking, validation errors, and neighbor indexes.

## 3. Workflow Runtime

- [x] 3.1 Implement workflow run start/cancel service methods with atomic run/node-run writes and durable events.
- [x] 3.2 Implement start-node queuing with seed context.
- [x] 3.3 Implement node prompt assembly with node prompt, role/agent binding, upstream contexts, upstream neighbor list, and downstream neighbor list.
- [x] 3.4 Implement node completion handling that creates one independent edge delivery per enabled downstream edge.
- [ ] 3.5 Implement all-upstream readiness so a downstream node queues only after every enabled upstream delivery is delivered or skipped.
- [x] 3.6 Implement workflow completion/failure calculation from node run and edge delivery terminal states.
- [ ] 3.7 Add runtime tests for linear graphs, fan-out, multi-upstream waiting, disabled nodes, cancellation, and failure propagation.

## 4. Mailbox Integration

- [x] 4.1 Create edge delivery mailbox rows in the same transaction as workflow edge delivery state changes.
- [x] 4.2 Ensure workflow APIs never expose or accept direct `WakeAgent` dispatch from the web client.
- [x] 4.3 Wire daemon/orchestrator internals so mailbox-created workflow deliveries can wake target agents through internal-only commands.
- [ ] 4.4 Add idempotency keys for workflow edge delivery creation and retry.
- [ ] 4.5 Implement targeted retry for failed edge deliveries without replaying successful sibling deliveries.
- [ ] 4.6 Add tests proving mailbox rows are not created on graph save, are created on runtime delivery, and fan-out failures are isolated.

## 5. API Routes

- [x] 5.1 Add workflow list/get/create/update/delete routes scoped to workspace or room permissions.
- [ ] 5.2 Add workflow validation route returning runnable status and friendly validation errors.
- [x] 5.3 Add workflow run start/cancel routes.
- [ ] 5.4 Add edge delivery retry route.
- [ ] 5.5 Add API tests for permissions, validation failures, successful graph saves, run start, cancellation, and retry.

## 6. Projector And Web State

- [x] 6.1 Extend web view-model types for workflows, workflow versions, nodes, edges, workflow runs, node runs, and edge deliveries.
- [x] 6.2 Add projector handlers for main-visible durable workflow definition and runtime events.
- [x] 6.3 Add projector tests for replaying workflow creation, graph edits, run start, node status changes, edge delivery changes, and reconnect restoration.
- [x] 6.4 Ensure workflow state is rebuilt from durable events without UI-fabricated events.

## 7. Canvas UI

- [x] 7.1 Add a lazy-loaded workflow canvas route or room-level entry point.
- [x] 7.2 Add a React Flow-compatible dependency or local adapter after confirming bundle impact.
- [x] 7.3 Implement agent node cards with stable handles, status badges, enabled/disabled styling, locked state, and prompt/role summary.
- [x] 7.4 Implement directed edge rendering with delivery status styles and selectable edge inspector.
- [x] 7.5 Implement add-node palette, connect interaction, delete interaction, node dragging, zoom/pan, fit view, and minimap.
- [x] 7.6 Restore saved edges only after node handles are mounted.
- [x] 7.7 Implement node/edge inspector panels with upstream/downstream lists and friendly errors.
- [x] 7.8 Implement note/comment display if it fits the initial canvas structure without delaying runtime work.

## 8. Run UI

- [x] 8.1 Add workflow run controls for seed context, start, cancel, and retry failed edge delivery.
- [x] 8.2 Show workflow run status, node run status, waiting-for-upstream state, and edge delivery state on the canvas.
- [x] 8.3 Show run history and technical detail references for failed nodes/edges.
- [ ] 8.4 Add browser tests for creating a simple workflow, saving it, reloading it, starting a run, and observing status updates.
- [ ] 8.5 Add browser tests for fan-out with one failed delivery and targeted retry.

## 9. Verification And Rollout

- [ ] 9.1 Run database, protocol, daemon, orchestrator, web unit, and projector tests related to the workflow capability.
- [x] 9.2 Run event registry, visibility, and projector coverage checks for new workflow events.
- [x] 9.3 Run Playwright smoke tests for the canvas at desktop and narrow viewport sizes.
- [ ] 9.4 Verify local daemon restart and SSE replay reconstruct workflow graph/run state without manual refresh.
- [ ] 9.5 Gate the UI entry point until migrations, runtime, projector, and browser smoke tests pass.
