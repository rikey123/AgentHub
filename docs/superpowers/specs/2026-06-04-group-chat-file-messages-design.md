# Group Chat File Messages Design

This document records the approved design direction for improving AgentHub's group-chat feel by keeping public chat messages short and moving long deliverables into first-class files/artifacts. It is intentionally reference-heavy so future implementation work does not drift into an invented design after context compaction.

## Decision

AgentHub should implement **first-class file messages for agent-produced long content**, following the mature pattern from Wenzagent and reusing AgentHub's existing `ArtifactService`.

The user-facing behavior should be:

- Agents speak in short, conversational public messages.
- Full reports, proposals, architecture notes, PRDs, long reviews, comparison matrices, and other long outputs are created as file artifacts.
- The chat timeline shows compact file cards that can be opened in the frontend.
- Agents can reference files produced by teammates instead of pasting the full text back into chat.

This is **not** a prompt-only change. Prompt rules are required, but the product mechanism must be a tool-backed file/artifact message path.

## Reference Sources

Implementation must consult these reference files before changing code.

### Wenzagent: Primary File-Message Reference

Primary files:

- `C:\project\refrence\wenzagent-main\lib\src\agent\tool\builtin\send_file_message_tool.dart`
- `C:\project\refrence\wenzagent-main\lib\src\agent\impl\agent_impl.dart`
- `C:\project\refrence\wenzagent-main\lib\src\shared\chat_message.dart`

Relevant mechanics:

- `send_file_message` is an agent tool, not a UI-only trick.
- The tool sends a local file as an assistant file message.
- The tool's callback is injected by the agent runtime.
- The callback validates the file, creates a `ChatMessage.file(role: assistant)`, persists it, and broadcasts a completed message event.
- `ChatMessage.file` carries file metadata including `fileId`, `fileName`, `fileSize`, `fileHash`, `filePath`, and `mimeType`.

AgentHub should mirror this **shape**, not the Dart implementation.

### AionUi: Message With File Preview Reference

Primary files:

- `C:\project\refrence\AionUi\src\renderer\pages\conversation\Messages\components\MessageText.tsx`
- `C:\project\refrence\AionUi\src\renderer\components\media\FilePreview.tsx`
- `C:\project\refrence\AionUi\src\renderer\components\media\HorizontalFileList.tsx`
- `C:\project\refrence\AionUi\src\process\team\TeamSession.ts`
- `C:\project\refrence\AionUi\src\process\team\Mailbox.ts`
- `C:\project\refrence\AionUi\src\process\team\prompts\formatHelpers.ts`

Relevant mechanics:

- `MessageText.tsx` parses an `AIONUI_FILES_MARKER` marker and separates text from file paths.
- File previews are rendered with `FilePreview` and `HorizontalFileList`.
- Team messages and mailbox entries can carry `files?: string[]`.
- Prompt formatting includes a `Files:` note so teammates can see file context.

AgentHub should borrow the **message plus file preview** user experience, but should prefer structured message parts/artifacts over parsing a magic marker.

### Golutra: Real Group Chat UI Reference

Primary files:

- `C:\project\refrence\golutra-master\src\features\chat\components\MessagesList.vue`
- `C:\project\refrence\golutra-master\src\features\chat\components\ChatInput.vue`
- `C:\project\refrence\golutra-master\src\features\chat\types.ts`
- `C:\project\refrence\golutra-master\src-tauri\src\message_service\chat_db\types.rs`

Relevant mechanics:

- The chat UI emphasizes avatars, sender names, timestamps, mention highlighting, typing indicators, day separators, and compact attachment cards.
- `MessageAttachment` is displayed as a card below the message body.
- Conversation previews show compact attachment-aware previews instead of full content.

AgentHub should borrow the **visual rhythm**: short bubbles plus separate attachment/file cards.

### AutoGen: Speaker Selection And Termination Reference

Primary files:

- `C:\project\refrence\autogen\python\packages\autogen-agentchat\src\autogen_agentchat\teams\_group_chat\_selector_group_chat.py`
- `C:\project\refrence\autogen\python\packages\autogen-agentchat\src\autogen_agentchat\messages.py`
- `C:\project\refrence\autogen\python\packages\autogen-agentchat\src\autogen_agentchat\ui\_console.py`

Relevant mechanics:

- `SelectorGroupChatManager` chooses the next speaker using selector overrides, candidate filtering, repeated-speaker guards, and retry/fallback.
- AutoGen does not solve long-message display. Its console renders `message.to_text()`.

AgentHub should continue using AutoGen as the reference for **who speaks next and when a group turn stops**, not as a reference for file-message UX.

## AgentHub Current Grounding

Existing AgentHub primitives to reuse:

- `packages/protocol/src/domains.ts`
  - `MessagePartSchema` already includes `attachment`.
  - `AgentCapabilitySchema` already includes `file.read` and `file.write`.
- `packages/artifacts/src/index.ts`
  - `ArtifactService.create()` already creates durable artifacts inside a SQLite transaction.
  - `type: "file"` publishes `artifact.file.created`.
  - `fileContent()` returns artifact file contents.
- `packages/daemon/src/index.ts`
  - `GET /artifacts/:id/files` lists artifact files.
  - `GET /artifacts/:id/files/:path` returns file content.
- `packages/orchestrator/src/mcp/room-mcp-server.ts`
  - Room MCP already exposes room/task/file tools to agents.
- `apps/web/src/components/chat/MessageItem.tsx`
  - Attachments currently render as a simple chip and need a real file card.

Known current gap:

- There is no Room MCP tool equivalent to Wenzagent's `send_file_message`.
- Attachments do not carry enough structured data to open an artifact file.
- Long agent replies are currently only collapsed in the frontend. That is a fallback, not a group-chat product mechanism.

## Product Behavior

Public group-chat messages should be short. The default expectation for agent messages in `assisted`, `squad`, and `team` rooms is:

- A concise stance or answer.
- One to four short bullets or sentences.
- Optional reference to a file/artifact.
- Optional handoff to another teammate or the user.

Agents should create a file/artifact when the output is:

- Longer than a compact chat reply.
- A structured deliverable, such as a report, design doc, PRD, review, task breakdown, architecture proposal, or comparison table.
- Something another agent is likely to cite later.

Example target behavior:

```text
Builder:
I would split the platform into control plane, execution plane, and data plane. I wrote the full architecture note as a file so PM and Reviewer can build on it.

[File] multi-agent-platform-architecture.md
```

Then:

```text
Reviewer:
I agree with Builder's control/execution/data split. The main MVP risk is starting with too much workflow machinery; I added a risk list.

[File] mvp-scope-risks.md
```

## Architecture

### New Room MCP Tool

Add a Room MCP tool modeled after Wenzagent:

- Preferred name: `room.send_file_message`
- Alias, if useful for tool discoverability: `room.create_artifact_message`

Input shape:

```ts
type SendFileMessageInput =
  | {
      title: string;
      fileName: string;
      mimeType?: string;
      content: string;
      summary?: string;
    }
  | {
      title?: string;
      path: string;
      mimeType?: string;
      summary?: string;
    };
```

Output shape:

```ts
type SendFileMessageOutput = {
  messageId: string;
  artifactId: string;
  fileName: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
};
```

Behavior:

- For `content` input, create an artifact file directly from the provided content.
- For `path` input, read the file through existing safe workspace/artifact filesystem rules and create an artifact file.
- Return the created message/artifact metadata to the agent.
- Do not paste file content into the tool result except for small diagnostic text.

### Artifact Model

Use `ArtifactService.create({ type: "file", ... })` as the durable storage mechanism.

Artifact metadata should include:

- `source: "room.send_file_message"`
- `mimeType`
- `fileName`
- `summary`
- `agentId`
- `runId`
- `messageId`

Artifact files should store:

- `path`: the display/download path, usually a sanitized file name such as `multi-agent-platform-architecture.md`.
- `newContent`: the file content.
- `newSha256`: content hash.
- `fileStatus`: `added`.

Do not use `type: "document"` for this first pass unless `artifact.document.created` and all projector/UI handling are added. `file` is already evented.

### Message Model

Extend the attachment message part so it can point at an artifact:

```ts
type ArtifactAttachmentPart = {
  type: "attachment";
  seq: number;
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  artifactId: string;
  path: string;
  previewKind?: "markdown" | "text" | "code" | "image" | "download";
};
```

Backward compatibility:

- Existing attachment parts without `artifactId` should still render as plain file chips/cards.
- The protocol schema can make `artifactId`, `path`, and `previewKind` optional initially.

### Event Bus Contract

This feature must follow the AgentHub event bus contract.

Required atomic write path:

```text
Room MCP tool call
  -> validate caller/session/input
  -> database.sqlite.transaction(...)
     -> insert or complete assistant message
     -> insert message_parts attachment row
     -> ArtifactService create/insert artifact + artifact_files
     -> publish durable event(s)
  -> projector receives event(s)
  -> frontend renders file card without refresh
```

Two implementation options are acceptable. The implementation plan must choose one explicitly.

Option 1: Add a durable `message.part.added` event.

- Register event in `packages/protocol/src/events/registry.ts`.
- Visibility should include `main`.
- Payload includes `messageId` and the full attachment part payload.
- Projector appends the part live.
- REST hydration continues reading `message_parts`.

Option 2: Reuse `message.completed` with full final parts.

- `message.completed` payload includes final `text` and `parts`.
- Projector updates both `text` and `parts`.
- REST hydration remains the replay fallback.

Do not rely on `artifact.file.created` alone to update chat messages, because artifact events do not tell the projector which message part to append unless that mapping is included and handled.

### Frontend

Replace the current attachment chip with a compact file card.

Card contents:

- File icon based on MIME type or extension.
- File name.
- Size and kind, for example `Markdown - 12 KB`.
- Optional source label, for example `Builder`.
- `Open` action.

Open behavior:

- If `artifactId` and `path` exist, call `GET /artifacts/:artifactId/files/:path`.
- Show markdown/text/code in an existing drawer/modal preview surface.
- Unknown binary files can show metadata and a download/copy fallback.

Do not render long artifact content inside the chat bubble.

The current `Long agent reply` collapse may remain as a defensive fallback for non-compliant models, but it should not be the intended path.

### Prompt Rules

Update group-chat prompts so agents understand the new contract:

- Public chat replies should be concise and conversational.
- If the answer becomes a report, proposal, review, or long structured output, call `room.send_file_message`.
- After creating a file, send only a short summary and reference the file.
- When responding to a teammate, cite the teammate's file by name instead of repeating it.
- Do not create a file for every small answer.

Example instruction:

```text
In public chat, speak like a teammate in a group chat. Keep the message short.
For long deliverables, call room.send_file_message and attach a markdown file.
After sending a file, summarize the key point in chat and invite the next useful speaker or the user.
```

## Mode Impact

### Assisted

Use this feature to make assisted mode feel like an actual group discussion:

- Selector chooses who speaks.
- The selected agent gives a short conversational reply.
- Long contributions are attached as files.
- Later agents reference previous files.

### Squad

Squad can use the same file-message tool for worker outputs:

- Worker posts short completion status.
- Detailed result becomes a file.
- The leader can synthesize from files.

### Team

Team mode should use file messages for reviewable deliverables:

- Builders produce implementation notes, reports, or review material as files.
- Reviewers cite those files.
- Final leader synthesis stays short in chat, with linked artifacts as needed.

### Solo

Solo can expose the same tool, but the primary benefit is less urgent. The fallback long-reply collapse can remain.

## Permission And Safety

This is not a broad new filesystem permission system. It should reuse existing room MCP/file/artifact permissions.

Rules:

- Content-input mode writes a new artifact file and should not require reading arbitrary workspace files.
- Path-input mode must respect existing file read permission rules and sensitive-file protections.
- Generated file names must be sanitized.
- File size limits must be enforced.
- Secret-like files and sensitive globs must not be attachable by path.
- Tool results must not expose full file content.

## Implementation Guardrails

Do not invent a parallel storage system.

Do not add a magic text marker as the primary contract.

Do not store long generated content only in message text.

Do not make `artifact.file.created` the only event if the chat message part also changes.

Do not add UI-generated fake events.

Do not let file-message creation require a page refresh to appear.

Do not port Wenzagent/AionUi/Golutra/AutoGen code wholesale. Reuse the design shape and implement it through AgentHub's existing protocols.

## Testing Requirements

Backend tests:

- `room.send_file_message` with content creates a `file` artifact.
- It inserts an attachment message part with `artifactId` and `path`.
- It emits the required durable event(s) in the same transaction.
- Path mode rejects sensitive files.
- Path mode rejects missing files.
- Size limit is enforced.
- Tool result does not include full file content.

Projector tests:

- Live event appends an attachment part without refresh.
- Durable replay reconstructs attachment parts.
- Existing attachment parts without `artifactId` still render.

Frontend tests:

- File card renders file name, size, and kind.
- Clicking a markdown artifact opens preview content.
- Long chat text fallback still works for non-compliant output.

Group-chat behavior tests:

- A long deliverable prompt causes the agent to call `room.send_file_message` when tool calling is available.
- The public message remains short.
- A later teammate can see/reference the file metadata in prompt context.

## Open Implementation Choices

These choices should be decided in the implementation plan, not ad hoc during coding:

1. Whether to add `message.part.added` or extend `message.completed` with final `parts`.
2. Whether file messages are represented as a separate assistant message or an attachment part on the current assistant message.
3. Whether the preview opens in an existing run detail drawer, a new lightweight file drawer, or a modal.

Recommended defaults:

- Add `message.part.added` for live attachment append behavior.
- Represent the file as an attachment part on the current assistant message when a message exists, otherwise create a short assistant file message.
- Use a lightweight file preview drawer/modal in the chat UI, not the run detail drawer.

## Acceptance Criteria

The feature is complete when:

- An agent can call `room.send_file_message` during a real run.
- A long markdown deliverable appears as a clickable file card in chat.
- The chat message remains short.
- The file card appears live through SSE without refresh.
- Refresh/replay reconstructs the same file card.
- The frontend can open and read the artifact content.
- Assisted group chat visibly contains short conversational turns plus file cards instead of long essay bubbles.

