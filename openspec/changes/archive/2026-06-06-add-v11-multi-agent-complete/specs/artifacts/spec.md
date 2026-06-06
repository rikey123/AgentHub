## MODIFIED Requirements

### Requirement: Artifact 数据模型

The system SHALL include `worktree_diff` as a first-class artifact type and SHALL include `ready_for_review`, `conflict`, and `discarded` as valid artifact statuses for the worktree review lifecycle.

`ArtifactFile` rows for diff-like artifacts SHALL expose enough per-file metadata for review UI:
- `path`
- optional `oldPath`
- `fileStatus`
- optional `patch`
- `additions`
- `deletions`
- optional binary/no-newline flags

#### Scenario: Worktree diff stores per-file rows

- **WHEN** a worktree run changes three files and reaches `session.ended`
- **THEN** the daemon creates one `worktree_diff` artifact and three `artifact_files` rows, one per changed file
- **AND** the artifact metadata retains the full patch for apply/recovery

### Requirement: Artifact API

The system SHALL expose durable review and lifecycle routes in addition to the existing artifact routes:

```text
GET    /artifacts/:id/reviews
POST   /artifacts/:id/reviews
PATCH  /artifacts/:id/reviews/:reviewId
POST   /artifacts/:id/reviews/:reviewId/resolve
DELETE /artifacts/:id/reviews/:reviewId
POST   /artifacts/:id/archive
DELETE /artifacts/:id
GET    /artifacts/:id/files/:path/raw
POST   /rooms/:id/tasks/:taskId/report
```

Every mutating route SHALL publish its matching durable artifact/task event inside the same SQLite transaction as the database mutation.

#### Scenario: Artifact review comment is durable

- **WHEN** the user adds a line comment to `src/a.ts` on a diff artifact
- **THEN** an `artifact_reviews` row is inserted with file path, side/range metadata, status `open`, reviewer metadata, and timestamps
- **AND** `artifact.review.added` is published with `visibility = detail`

#### Scenario: Artifact review comment can be updated, resolved, and deleted

- **WHEN** the user edits, resolves, then deletes an artifact review comment
- **THEN** the system publishes `artifact.review.updated`, `artifact.review.resolved`, and `artifact.review.deleted`
- **AND** refresh/replay preserves the final review timeline state

#### Scenario: Artifact archive and delete are audit-visible

- **WHEN** the user archives or deletes an artifact
- **THEN** the artifact is soft-updated locally and the system publishes `artifact.archived` or `artifact.deleted` with `visibility = detail`

## ADDED Requirements

### Requirement: Per-file diff review surface

The system SHALL render both ordinary `diff` artifacts and `worktree_diff` artifacts through a shared per-file review surface.

The review surface SHALL support:
- file accordions with path, status, additions, and deletions
- unified diff view
- split diff view when feasible
- line numbers
- line selection/comment targets
- inline comment display
- expand/collapse all
- large-diff guard
- empty, binary, and unsupported states
- stable file anchors of the form `#artifact:<artifactId>:<path>`

#### Scenario: Chat diff card and artifact workspace share review rendering

- **WHEN** a diff card appears in chat and the same artifact appears in the artifact workspace
- **THEN** both surfaces render through the same per-file review model
- **AND** a task proof link to `#artifact:<artifactId>:src%2Fa.ts` scrolls to the real per-file review block

### Requirement: Artifact preview contract

The system SHALL provide a shared artifact preview contract that derives preview behavior from file name and content type.

Supported preview kinds SHALL include:
- markdown
- text/code
- sandboxed HTML
- image
- PDF
- audio
- video
- unsupported/download fallback

The preview UI SHALL expose loading, retry, too-large, unsupported, open-in-new-tab, and download states. HTML preview SHALL render in a sandboxed iframe without same-origin access to the daemon API.

#### Scenario: Markdown artifact opens as a document

- **WHEN** the user opens a Markdown artifact file
- **THEN** the preview modal renders formatted Markdown and still offers raw open/download actions

#### Scenario: HTML artifact is sandboxed

- **WHEN** the user opens an HTML artifact file
- **THEN** the content renders in a sandboxed iframe and cannot read the daemon API as same-origin content

### Requirement: Task proof-of-work delivery report

The system SHALL aggregate task delivery evidence into a proof-of-work section and SHALL allow creating or refreshing a Markdown delivery report artifact for a task.

Proof-of-work SHALL include, when present:
- file change runs
- worktree review states
- proof or validation task activities
- artifact review decisions
- unresolved artifact review comment counts
- generated report metadata including template version and evidence counts

`POST /rooms/:id/tasks/:taskId/report` SHALL create or refresh one live Markdown delivery report for the task, link it through task activity, and expose it through the artifact workspace and preview flow.

#### Scenario: Task delivery report refreshes instead of duplicating

- **WHEN** the user generates a delivery report for a task twice
- **THEN** the second call refreshes the live report and soft-removes the previous live copy from the task's active report set
- **AND** the report contains evidence metadata and validation notes available at generation time
