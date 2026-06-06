## MODIFIED Requirements

### Requirement: Message + MessagePart 数据模型

The message part model SHALL support artifact-backed attachment parts for file messages produced by agents.

An artifact-backed attachment part SHALL include:
- `fileId`
- `name`
- `mimeType`
- `sizeBytes`
- `artifactId`
- `path`
- optional `previewKind`

Existing attachment parts without `artifactId` SHALL remain valid and render as ordinary attachment cards/chips.

#### Scenario: Artifact-backed attachment survives replay

- **WHEN** an agent sends a file message backed by artifact `artifact_1`
- **THEN** the persisted message part includes `artifactId = "artifact_1"` and the artifact file path
- **AND** reconnect/replay reconstructs the same clickable file card in the chat timeline

## ADDED Requirements

### Requirement: Agent file message tool

The system SHALL expose `room.send_file_message` as a Room MCP tool for publishing long deliverables as artifact-backed file cards.

The tool SHALL accept either inline `content` plus `fileName`, or a workspace-relative `path`, and optional `title`, `summary`, and `mimeType`. The tool SHALL:
1. validate the caller and input;
2. sanitize the file name/path;
3. enforce file read and sensitive-file rules for path mode;
4. create a `file` artifact through `ArtifactService`;
5. insert or append an attachment message part that references the artifact;
6. publish the required durable message/artifact events in the same SQLite transaction;
7. return metadata only, not full file content.

#### Scenario: Agent publishes long report as file card

- **WHEN** an agent calls `room.send_file_message { fileName: "architecture.md", content: "# Architecture\n..." }`
- **THEN** the room receives a short assistant message with a file card for `architecture.md`
- **AND** the full content is stored as a `file` artifact and opens through the artifact preview surface

#### Scenario: Path mode respects workspace safety

- **WHEN** an agent calls `room.send_file_message { path: "../../secret.env" }`
- **THEN** the tool rejects the request without reading the file

### Requirement: Live attachment part update

The system SHALL update chat file cards live without relying on page refresh. When a file message appends an attachment to an existing message, the daemon SHALL publish `message.part.added` with `visibility = both` or publish a completed message payload containing the final parts. The projector SHALL update the message parts from that durable event.

`artifact.file.created` alone SHALL NOT be used as the only chat timeline update because it does not identify which message part to append.

#### Scenario: File card appears without refresh

- **WHEN** `room.send_file_message` creates an artifact-backed attachment while the room SSE stream is connected
- **THEN** the chat timeline shows the file card without a manual refresh
