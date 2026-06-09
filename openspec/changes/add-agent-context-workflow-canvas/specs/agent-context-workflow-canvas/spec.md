## ADDED Requirements

### Requirement: Workflow graph persistence

The system SHALL persist agent context workflows as first-class graph definitions with workflows, versions, nodes, edges, and canvas layout stored separately from mailbox runtime messages.

Each workflow node SHALL have a stable id, display name, node kind, position, enabled flag, locked flag, optional agent binding id, role label, prompt text, and config payload. Each workflow edge SHALL have a stable id, source node id, target node id, enabled flag, and optional label/config payload.

#### Scenario: Create a workflow graph

- **WHEN** the user creates a workflow with two agent context nodes and one directed edge
- **THEN** the daemon persists the workflow, draft version, two node rows, one edge row, and viewport metadata
- **AND** the daemon emits a durable workflow definition event in the same SQLite transaction

#### Scenario: Mailbox rows are not graph definition

- **WHEN** the user saves a workflow definition
- **THEN** no `mailbox_messages` rows are created
- **AND** mailbox rows are created only later when a workflow run delivers context over an edge

### Requirement: Draft and locked workflow versions

The system SHALL edit workflows through a draft version and SHALL create a locked version snapshot when a workflow run starts. A workflow run MUST reference the locked version it executed.

#### Scenario: Run locks current draft

- **WHEN** the user starts a workflow run from a valid draft
- **THEN** the daemon creates a locked workflow version snapshot
- **AND** the workflow run references that locked version id
- **AND** later draft edits do not change the running workflow topology

#### Scenario: Draft remains editable during run

- **WHEN** a workflow run is active and the user moves a node in the draft canvas
- **THEN** the draft version is updated
- **AND** the active run continues using its locked version snapshot

### Requirement: DAG validation and MVP node scope

The system SHALL validate workflow drafts before they can run. The MVP SHALL allow only agent context nodes and optional note/comment nodes. The executable graph MUST be acyclic, contain at least one enabled start node, and contain only enabled edges whose source and target nodes exist.

The MVP MUST reject condition nodes, loop nodes, router nodes, code nodes, cron/webhook triggers, external integration nodes, and arbitrary branch expressions.

#### Scenario: Valid linear graph

- **WHEN** a workflow contains enabled agent context nodes `A -> B -> C`
- **THEN** validation marks the workflow runnable
- **AND** the validation result includes upstream/downstream indexes for the executable nodes

#### Scenario: Cycle is rejected

- **WHEN** a workflow contains enabled edges `A -> B` and `B -> A`
- **THEN** validation marks the workflow invalid
- **AND** starting a run returns a validation error explaining that cycles are not supported

#### Scenario: Logic node is rejected

- **WHEN** the user tries to add a condition, loop, router, or code node to the MVP workflow
- **THEN** the daemon rejects the mutation
- **AND** the canvas displays a friendly error that the MVP supports context-passing agent nodes only

### Requirement: Canvas editing experience

The Web UI SHALL provide a visual workflow canvas where users can add agent nodes, connect nodes with directed edges, select nodes or edges, move nodes, zoom, pan, fit view, and inspect the selected item.

The canvas SHALL render stable connection handles and SHALL restore edges only after node handles are available in the DOM.

#### Scenario: Add and connect nodes

- **WHEN** the user adds two agent nodes and drags a connection from the first node to the second
- **THEN** the canvas shows a directed edge between the nodes
- **AND** the inspector for the first node lists the second node as downstream
- **AND** the inspector for the second node lists the first node as upstream

#### Scenario: Restore saved canvas

- **WHEN** the user reloads a workflow page with saved nodes and edges
- **THEN** the UI renders nodes first
- **AND** the UI restores edges after handles are mounted so saved connections do not disappear

### Requirement: Node inspector and topology awareness

The system SHALL expose each node's upstream and downstream neighbors in both the canvas inspector and the runtime prompt context. The runtime prompt context SHALL include incoming contexts grouped by upstream node and declared downstream targets.

#### Scenario: Inspector shows neighbors

- **WHEN** the user selects a node with two upstream nodes and three downstream nodes
- **THEN** the inspector lists all upstream and downstream node names
- **AND** each listed neighbor links to selecting that neighbor on the canvas

#### Scenario: Prompt includes topology

- **WHEN** the workflow runtime wakes an agent for a node
- **THEN** the prompt context includes the current node id, node prompt, upstream node list, downstream node list, and delivered upstream contexts
- **AND** the prompt instructs the agent to send context only to declared downstream nodes

### Requirement: Workflow run lifecycle

The system SHALL support starting, completing, failing, and cancelling workflow runs. Starting a workflow run SHALL create a workflow run row, node run rows for ready start nodes, and durable workflow run/node events.

#### Scenario: Start workflow with seed context

- **WHEN** the user starts a workflow with seed context `"Investigate auth flow"`
- **THEN** the daemon creates a workflow run with status `running`
- **AND** each enabled start node receives a queued node run that includes the seed context
- **AND** the daemon emits `workflow.run.started` and `workflow.node.queued` events inside the same transaction as the writes

#### Scenario: Cancel workflow run

- **WHEN** the user cancels a running workflow
- **THEN** the daemon marks the workflow run as `cancelled`
- **AND** pending node runs and edge deliveries for that workflow run are marked `cancelled`
- **AND** the daemon emits a durable `workflow.run.cancelled` event

### Requirement: Mailbox-backed edge delivery

The system SHALL deliver context across executable workflow edges through the existing mailbox transport. For each edge delivery, the daemon SHALL create an `agent_workflow_edge_deliveries` row and the corresponding mailbox row in the same SQLite transaction before waking the downstream agent through internal orchestration.

The Web UI MUST NOT dispatch `WakeAgent` directly.

#### Scenario: Upstream completion creates mailbox delivery

- **WHEN** node `A` completes with output context and has an enabled edge to node `B`
- **THEN** the daemon creates one edge delivery row for edge `A -> B`
- **AND** the daemon creates one `mailbox_messages` row for node `B`'s agent
- **AND** the daemon emits `workflow.edge.delivery.created` and `workflow.edge.delivery.mailbox_created` events in the same transaction as the writes

#### Scenario: UI cannot wake agent directly

- **WHEN** the canvas UI starts a workflow or retries an edge delivery
- **THEN** the UI calls a daemon workflow API
- **AND** only the daemon/orchestrator dispatches internal `WakeAgent` commands

### Requirement: Fan-out delivery management

When one node connects to multiple downstream nodes, the system SHALL manage each downstream edge delivery independently. A failed delivery on one edge MUST NOT prevent other downstream edge deliveries from being created, delivered, or retried.

#### Scenario: One source sends to three downstream nodes

- **WHEN** node `A` completes and has enabled edges to nodes `B`, `C`, and `D`
- **THEN** the daemon creates three separate edge delivery rows
- **AND** each delivery has its own status, timestamps, mailbox message id, and error field

#### Scenario: One downstream delivery fails

- **WHEN** delivery `A -> B` fails but deliveries `A -> C` and `A -> D` succeed
- **THEN** the workflow run shows `B`'s edge as failed
- **AND** `C` and `D` continue through the workflow
- **AND** the user can retry only the failed `A -> B` edge delivery

### Requirement: Multi-upstream readiness

For the MVP, a non-start node SHALL become ready only after all enabled upstream edges for the current workflow run have delivered context or have been skipped because the upstream node is disabled. The ready node SHALL receive a bundled context grouped by upstream node id.

#### Scenario: Node waits for all upstreams

- **WHEN** node `C` has enabled upstream edges from nodes `A` and `B`
- **AND** only node `A` has delivered context
- **THEN** node `C` remains waiting
- **AND** the canvas shows that `C` is waiting for node `B`

#### Scenario: All upstreams delivered

- **WHEN** node `C` has received delivered contexts from both `A` and `B`
- **THEN** the daemon queues node `C`
- **AND** node `C` receives a bundled input containing separate context entries for `A` and `B`

### Requirement: Workflow events and projector state

The system SHALL register all workflow event types in the canonical event registry. Durable workflow events visible to the main workflow canvas SHALL have projector handlers in the web client so the canvas can rebuild state from durable replay plus live SSE.

#### Scenario: Workflow event is registered

- **WHEN** daemon code publishes `workflow.node.completed`
- **THEN** the event type exists in `packages/protocol/src/events/registry.ts`
- **AND** the EventBus validates durability, visibility, and schema version from the registry

#### Scenario: Canvas restores from durable events

- **WHEN** the browser reconnects to SSE after a daemon restart
- **THEN** durable workflow definition and run events replay
- **AND** the projector reconstructs workflow graph state and current run statuses without requiring a manual refresh

### Requirement: Run status and friendly errors

The workflow canvas SHALL show workflow run, node run, and edge delivery statuses. Failed statuses SHALL include a user-readable message and a technical detail reference suitable for debug views.

#### Scenario: Edge delivery error display

- **WHEN** an edge delivery fails because the target agent is unavailable
- **THEN** the edge displays a failed state on the canvas
- **AND** the inspector shows a friendly explanation, target node, timestamp, and a technical error detail reference

#### Scenario: Node run status display

- **WHEN** a node run changes from `queued` to `running` to `completed`
- **THEN** the node card updates its status badge through projector events
- **AND** the run history panel records the same status transitions

### Requirement: Workflow notes and disabled nodes

The workflow canvas SHALL support non-executable notes/comments and disabled agent nodes. Notes MUST NOT participate in execution. Disabled nodes and disabled edges MUST be visible on the canvas but skipped by workflow validation and runtime delivery.

#### Scenario: Note does not execute

- **WHEN** a workflow contains a note explaining the design
- **THEN** the note is saved and displayed on the canvas
- **AND** starting the workflow does not create a node run for the note

#### Scenario: Disabled node is skipped

- **WHEN** node `B` is disabled in graph `A -> B -> C`
- **THEN** validation excludes node `B` from executable readiness
- **AND** the runtime does not create mailbox deliveries to node `B`
