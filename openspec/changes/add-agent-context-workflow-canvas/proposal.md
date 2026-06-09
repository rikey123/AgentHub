## Why

AgentHub already supports multi-agent rooms, mailbox delivery, durable events, and run tracking, but users do not have a reusable visual way to describe how agent context should move from one agent to another. A canvas-style workflow gives users a concrete way to compose agent collaboration without adding a full automation engine.

## What Changes

- Add a visual agent workflow canvas where users can create prompt-bearing agent nodes and directed context edges.
- Persist workflow definitions as first-class graph data: workflows, nodes, edges, versions, and canvas layout.
- Allow each node to see its upstream and downstream neighbors, incoming context, role/agent binding, and delivery status.
- Run workflows by delivering context along edges through the existing mailbox path, with per-node and per-edge delivery tracking.
- Add workflow run events and projector support so the UI updates from durable event replay and live SSE.
- Keep the MVP deliberately simple: no condition nodes, loop nodes, router nodes, code execution, branch expressions, or custom logic.
- Incorporate selected design ideas from ComfyUI, n8n, Activepieces, Sim, and Node-RED where they reinforce a context-passing DAG rather than a general automation engine.

## Capabilities

### New Capabilities

- `agent-context-workflow-canvas`: Visual agent context workflows, graph persistence, mailbox-backed context delivery, run tracking, and canvas UI behavior.

### Modified Capabilities

- None.

## Impact

- Web app: new workflow canvas view, node cards, edge rendering, inspector panels, run status display, and projector state.
- Daemon/API: workflow CRUD routes, workflow run command/service, validation, and mailbox delivery orchestration.
- Protocol/events: new workflow event payloads registered in the canonical event registry with correct durability and visibility.
- Database: migrations for workflow definitions, versions, runs, node runs, edge deliveries, and indexes.
- Orchestrator/mailbox: reuse `mailbox_messages`, `room.read_mailbox`, and internal `WakeAgent` dispatch without exposing internal commands to the UI.
- Tests: service, database, event registry, projector, API, and browser-level workflow canvas tests.
- Dependencies: likely add a React Flow-compatible canvas dependency such as `@xyflow/react` unless an existing canvas abstraction is introduced first.
