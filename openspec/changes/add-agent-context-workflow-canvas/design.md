## Context

AgentHub already has the primitives needed for agent-to-agent context passing: durable mailbox rows, `room.read_mailbox`, internal-only `WakeAgent`, run lifecycle events, SSE replay, and a client projector. What is missing is a first-class graph definition that lets a user compose those primitives visually and reuse the topology.

The reference projects point in the same direction but solve broader problems:

- ComfyUI treats a prompt graph as executable structure: node inputs are links, validation rejects invalid prompt graphs, execution follows dependency order, and per-node progress is visible.
- n8n stores workflows as nodes plus connections and builds both source and destination indexes so each node can efficiently find children and parents.
- Activepieces separates draft and locked flow versions, carries a validity flag, shows per-step run status, and includes notes/minimap/friendly errors.
- Sim keeps React Flow-compatible blocks and edges, supports enabled/locked state, batch edit operations, and strongly typed block output metadata.
- Node-RED uses a simple flat flow JSON with node `wires`, supports disabled nodes and comments, and separates design-time flow from active runtime.

The AgentHub version should borrow the durable graph, canvas ergonomics, versioning, validation, node status, and comment/notes ideas while explicitly excluding the complex automation features: conditions, routers, loops, retries as graph logic, expressions, code nodes, and branch evaluation.

The event bus contract is a hard constraint: any workflow state mutation must publish the matching workflow event inside the same SQLite transaction. Main-visible durable workflow events must be registered and handled by the web projector.

## Goals / Non-Goals

**Goals:**

- Provide a canvas where users create agent context nodes, edit role/prompt settings, and connect nodes with directed edges.
- Persist workflows as graph data independent from mailbox runtime delivery.
- Let every node see upstream and downstream neighbor metadata in its prompt context.
- Run a workflow by passing context along directed edges through mailbox-backed agent delivery.
- Track workflow runs, node runs, and edge deliveries independently so fan-out and failures are visible.
- Support a practical MVP canvas: add node, connect, select, inspect, move, zoom/pan, fit view, minimap, and status badges.
- Keep the graph acyclic and simple enough to validate and replay from durable events.

**Non-Goals:**

- No conditional branching, loops, routers, merge expressions, code execution, cron triggers, webhooks, external integrations, or arbitrary data transformations.
- No collaborative realtime editing in the first implementation, even though the model should not block future batch operations.
- No hidden agent UI event fabrication. The web client only invokes daemon APIs and consumes daemon events.
- No direct UI dispatch of `WakeAgent`; it remains internal-only.
- No reuse of mailbox rows as the workflow definition. Mailbox remains runtime transport.

## Decisions

### 1. Persist graph definitions separately from mailbox delivery

The daemon will store workflow definitions in workflow-specific tables:

- `agent_workflows`: owner, room/workspace scope, current draft/active version, metadata.
- `agent_workflow_versions`: draft or locked version, validity, serialized viewport metadata.
- `agent_workflow_nodes`: version id, node id, kind, agent binding, role label, prompt, position, enabled, locked, config JSON.
- `agent_workflow_edges`: version id, edge id, source node id, target node id, enabled, label, context contract JSON.

Mailbox rows will only be created when a workflow run needs to deliver context over an edge. This follows n8n's first-class nodes/connections model and avoids turning transient mailbox rows into the source of truth for design-time graph state.

Alternative considered: store workflows as a single JSON blob. That is easier to save but makes validation, event payloads, edge delivery status, partial updates, and future migrations much harder.

### 2. Use explicit edges with generated upstream/downstream indexes

The backend and frontend will derive `upstreamByNodeId` and `downstreamByNodeId` indexes from `agent_workflow_edges`. The indexes are not authoritative storage; they are generated read models for validation, prompt assembly, and inspector rendering.

This borrows from n8n's source/destination connection maps and keeps each node's neighbor list cheap to show.

Alternative considered: Node-RED-style `wires` arrays on each node. That is compact, but explicit edge IDs are better for per-edge delivery status, retry, audit, and UI selection.

### 3. DAG-only execution with all-upstream readiness

The MVP workflow is a directed acyclic graph. A node with no enabled upstream edges is a start node. A non-start node becomes ready when every enabled upstream edge for the current workflow run has either delivered context or has been explicitly skipped because the upstream node is disabled.

This is intentionally not user-facing logic. It is a deterministic delivery readiness rule that keeps multi-upstream behavior understandable: a node receives a bundle of upstream contexts and runs once per workflow run.

Alternative considered: allow `any_upstream` readiness. That quickly becomes branch logic and creates ambiguous prompts for nodes with partial context, so it is deferred.

### 4. Fan-out is managed as independent edge deliveries

When a node completes and has multiple downstream edges, the workflow service creates one `agent_workflow_edge_deliveries` row per enabled edge. Each delivery has its own status: `queued`, `mailbox_created`, `delivered`, `failed`, `skipped`, or `cancelled`.

One downstream failure must not block other downstream deliveries. The source node run can be completed while individual edge deliveries continue to settle. The workflow run status becomes `failed` only when at least one required node/edge fails and no retry/cancel path remains.

Alternative considered: bundle all downstream contexts into one mailbox message. That hides which downstream failed and makes retry imprecise.

### 5. Agent prompts include topology, not graph logic

The prompt assembled for a workflow node will include:

- current workflow name and run id;
- current node id, display name, role, and node prompt;
- upstream node list and delivered contexts;
- downstream node list and instructions to use the provided mailbox-related tool path for context delivery;
- constraints that the node should pass context only to declared downstream nodes.

The orchestrator or workflow service remains responsible for authoritative delivery tracking. Agents can call mailbox tools to read incoming context, but they do not decide the graph topology.

Alternative considered: let agents freely mention or message any other agent. That already exists in rooms, but a workflow needs stricter declared edges so the canvas remains meaningful.

### 6. Workflow service owns runtime writes and event publication

All workflow write paths go through a daemon-side service. Each mutation writes SQLite rows and publishes the matching event in the same transaction:

- definition events: `workflow.created`, `workflow.version.updated`, `workflow.deleted`;
- run events: `workflow.run.started`, `workflow.run.completed`, `workflow.run.failed`, `workflow.run.cancelled`;
- node events: `workflow.node.queued`, `workflow.node.started`, `workflow.node.completed`, `workflow.node.failed`, `workflow.node.skipped`;
- edge events: `workflow.edge.delivery.created`, `workflow.edge.delivery.mailbox_created`, `workflow.edge.delivery.delivered`, `workflow.edge.delivery.failed`.

Definition and run summary events should be `durable` and `visibility=main` or `both` if they affect the workflow canvas and room-level UI. Detailed node transcript data can remain `detail` when tied to an agent run.

Alternative considered: have the web client optimistically draw workflow events. This violates the event bus contract and recreates previous refresh-loses-state bugs.

### 7. Versioning starts with draft and locked versions

Borrowing from Activepieces, users edit a draft workflow version. Starting a run locks a snapshot version so the run is reproducible even if the user continues editing the draft. A workflow can carry a `valid` flag plus validation errors.

The initial UI can expose this simply as saved draft plus runnable snapshot; it does not need a full version history browser in MVP.

Alternative considered: always run the mutable latest draft. That makes run replay and debugging unreliable.

### 8. Canvas implementation should use a React Flow-compatible library

The AgentHub web app is React-based, and both n8n and Sim show that a mature node canvas saves large amounts of interaction work. The likely dependency is `@xyflow/react` unless implementation discovery finds a strong existing local alternative.

Required MVP canvas affordances:

- node cards with stable handles;
- straight or smooth directed edges only;
- minimap, zoom/pan, fit view, selection, delete, and inspector;
- add-node palette and add-on-edge affordance;
- delayed edge restoration until node handles are mounted, matching n8n's practical VueFlow lesson;
- locked/enabled state per node, inspired by Sim and Node-RED.

Alternative considered: custom SVG/canvas editor. That would consume time on interaction basics instead of AgentHub-specific mailbox/runtime behavior.

### 9. UI borrows notes and friendly errors, not full automation palettes

The MVP should include lightweight comment/note nodes or canvas notes if cheap, because Activepieces and Node-RED show that workflow diagrams need explanation. It should also surface friendly delivery errors with technical details available in debug views.

It should not include trigger catalogs, integration credentials, code blocks, router blocks, loop containers, or branch editors.

### 10. Future-proof edit operations without building collaboration

The API can accept small patch operations such as `node.added`, `node.updated`, `edge.added`, `edge.removed`, and `viewport.updated`. It can also support a batch endpoint for multi-node moves. This borrows from Sim's batch operation model and helps undo/redo later.

MVP does not need multi-user realtime collaboration.

## Risks / Trade-offs

- [Risk] A workflow run may create many mailbox messages when a node fans out. -> Mitigation: edge delivery rows make fan-out explicit, and delivery creation can be capped per run.
- [Risk] Agents may ignore downstream delivery instructions. -> Mitigation: workflow service tracks expected edge deliveries and marks missing deliveries as failed or timed out.
- [Risk] Multiple upstream contexts can produce oversized prompts. -> Mitigation: summarize upstream contexts per edge and store full payload references for detail views.
- [Risk] Introducing a canvas dependency increases bundle size. -> Mitigation: lazy-load the workflow route and verify production bundle impact.
- [Risk] New durable events can drift from the projector. -> Mitigation: add event registry tests and projector tests for every main-visible workflow event.
- [Risk] Running mutable drafts would make debugging impossible. -> Mitigation: lock a workflow version at run start.
- [Risk] It is tempting to add condition/loop features from reference projects. -> Mitigation: validation rejects non-agent-context node kinds and cyclic graphs in MVP.

## Migration Plan

1. Add database migrations for workflow definition/version/node/edge/run/delivery tables without changing existing room or mailbox behavior.
2. Register workflow event schemas in `packages/protocol/src/events/registry.ts`.
3. Add daemon service and API routes behind the new workflow capability.
4. Add projector support and a route-level lazy-loaded canvas UI.
5. Integrate runtime delivery with mailbox and internal `WakeAgent`.
6. Add tests before exposing the feature as a visible navigation item.

Rollback is straightforward before user adoption: hide the route and leave inert tables in place. After user adoption, rollback must preserve workflow tables and disable only run execution.

## Open Questions

- Should the first UI entry point live as a room tab, side-panel tab, or top-level feature rail item?
- Should workflow runs always create a dedicated room/thread, or can they run inside the current room while the canvas acts as a controller?
- What is the exact timeout before an expected edge delivery is marked failed?
- Should start nodes require an explicit seed context per run, or default to the user's run message as seed context?
