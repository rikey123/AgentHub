# Group Chat File Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add first-class agent file messages so group chat stays conversational while long deliverables appear as clickable artifact-backed file cards.

**Architecture:** Reuse AgentHub's existing EventBus, `message_parts`, Room MCP, and `ArtifactService`. Add a live durable message-part event, a `room.send_file_message` tool, frontend projector support, and a file-card preview UI.

**Tech Stack:** TypeScript, Vitest, React, HeroUI, SQLite/EventBus, AgentHub Room MCP.

---

### Task 1: Protocol And Projector Contract

**Files:**
- Modify: `packages/protocol/src/domains.ts`
- Modify: `packages/protocol/src/events/registry.ts`
- Modify: `apps/web/src/hooks/useProjector.ts`
- Test: `apps/web/src/hooks/useProjector.test.ts`

- [x] Write a failing projector test for `message.part.added` appending an artifact attachment to an existing message.
- [x] Extend attachment parts with optional `artifactId`, `path`, and `previewKind`.
- [x] Register durable main-visible `message.part.added`.
- [x] Handle `message.part.added` in the projector.
- [x] Run targeted web projector tests.

### Task 2: Room MCP File Message Tool

**Files:**
- Modify: `packages/orchestrator/src/mcp/room-mcp-server.ts`
- Modify: `packages/orchestrator/src/mcp/room-mcp-tools.json`
- Test: `packages/orchestrator/test/room-mcp-file-message.test.ts`

- [x] Write failing tests for content-mode file message creation.
- [x] Write failing tests for path-mode missing/sensitive-file rejection.
- [x] Add `room.send_file_message` tool schema.
- [x] Add `ArtifactService` boundary to `RoomMcpServer`.
- [x] Implement `handleSendFileMessage` using an atomic SQLite transaction and EventBus publish.
- [x] Run targeted orchestrator tests.

### Task 3: Frontend File Card And Preview

**Files:**
- Modify: `apps/web/src/components/chat/MessageItem.tsx`
- Test: `apps/web/src/components/chat/MessageItem.test.tsx`

- [x] Write failing tests for artifact attachment file card rendering.
- [x] Write failing tests for opening markdown artifact content.
- [x] Replace attachment chip with compact file card.
- [x] Add lightweight preview modal/drawer for text/markdown/code.
- [x] Run targeted chat component tests.

### Task 4: Group-Chat Prompt Guidance

**Files:**
- Modify: `packages/orchestrator/src/prompts/run-prompt.ts`
- Modify: `packages/orchestrator/src/prompts/first-wake-prompt.ts`
- Modify: `packages/orchestrator/src/prompts/teammate-prompt.ts`
- Test: existing prompt tests under `packages/orchestrator/test/`

- [x] Write failing prompt tests requiring short public replies and file-message tool guidance.
- [x] Add shared guidance text.
- [x] Run targeted prompt tests.

### Task 5: Verification

- [x] Run `pnpm test` for targeted packages touched.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm events:check`.
- [x] Run `pnpm check:all` if the targeted checks pass.
- [x] Run `gitnexus_detect_changes`.
- [x] Commit implementation.


