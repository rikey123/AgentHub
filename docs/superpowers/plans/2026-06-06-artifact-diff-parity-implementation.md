# Artifact Diff Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring AgentHub's artifact, diff review, preview, lifecycle, and proof-of-work experience closer to the mature reference projects under `C:\project\refrence`.

**Architecture:** Keep the existing AgentHub artifact/event/task architecture and add focused parity layers. OpenCode patterns drive diff review interaction; multica and AionUi patterns drive preview routing and failure states; Symphony and hermes-kanban patterns drive proof-of-work/report surfaces.

**Tech Stack:** TypeScript, React, HeroUI, SQLite migrations, AgentHub EventBus, Vitest, pnpm workspace scripts.

---

## Reference Anchors

- OpenCode:
  - `C:\project\refrence\opencode\packages\ui\src\components\session-review.tsx`
  - `C:\project\refrence\opencode\packages\ui\src\components\session-diff.ts`
  - `C:\project\refrence\opencode\packages\opencode\src\tool\apply_patch.ts`
- multica:
  - `C:\project\refrence\multica\packages\views\editor\attachment-preview-modal.tsx`
  - `C:\project\refrence\multica\packages\views\editor\utils\preview.ts`
  - `C:\project\refrence\multica\packages\views\attachments\attachment-preview-page.tsx`
- AionUi:
  - `C:\project\refrence\AionUi\mobile\src\components\files\FileContentView.tsx`
  - `C:\project\refrence\AionUi\mobile\app\file-preview.tsx`
- wenzagent:
  - `C:\project\refrence\wenzagent-main\lib\src\agent\tool\builtin\file_patch_tool.dart`
- Symphony and hermes-kanban:
  - `C:\project\refrence\symphony-main\README.md`
  - `C:\project\refrence\symphony-main\elixir\WORKFLOW.md`
  - `C:\project\refrence\hermes-kanban-main\docs\API.md`

## Files

- Modify: `docs/artifact-diff-gap-closure.md`
  - Record remaining gaps, closure status, and reference-code anchors.
- Modify: `packages/db/migrations/0017_artifact_review_comments.sql`
  - Expand `artifact_reviews` with lifecycle columns.
- Modify: `packages/db/src/schema.ts`
  - Keep schema reset in sync with migrations.
- Modify: `packages/artifacts/src/index.ts`
  - Add review comment update/delete/resolve and artifact archive/delete lifecycle.
  - Improve git diff file parsing for rename/copy/binary/mode-only/no-newline.
- Modify: `packages/protocol/src/events/registry.ts`
  - Register new durable artifact events.
- Modify: `openspec/specs/event-system/spec.md`
  - Keep event-system spec aligned with new events.
- Modify: `packages/daemon/src/index.ts`
  - Add REST routes for review comment lifecycle, artifact archive/delete, preview page metadata, and task report refresh.
- Modify: `apps/web/src/components/artifacts/DiffReviewViewer.tsx`
  - Add clickable line selection, focus support, and inline comment action hooks.
- Modify: `apps/web/src/components/artifacts/ArtifactPreviewModal.tsx`
  - Add preview dispatch table, source/preview toggle, retry support, audio/video support.
- Modify: `apps/web/src/components/run/tabs/ArtifactsTab.tsx`
  - Wire line comments and lifecycle actions into artifact workspace.
- Modify: `apps/web/src/components/cards/DiffCard.tsx`
  - Keep chat diff cards using the improved viewer.
- Modify: `apps/web/src/components/panels/TasksPanel.tsx`
  - Surface report generation/update and proof-of-work summaries.
- Tests:
  - `packages/artifacts/test/artifacts.test.ts`
  - `packages/daemon/test/daemon.test.ts`
  - `packages/db/test/sqlite.test.ts`
  - `apps/web/src/components/artifacts/DiffReviewViewer.test.tsx`
  - `apps/web/src/components/artifacts/ArtifactPreviewModal.test.tsx`
  - `apps/web/src/components/run/RunDetailDrawer.test.ts`
  - `apps/web/src/components/panels/TasksPanel.test.tsx`

## GitNexus Note

GitNexus MCP returned `Transport closed` during planning for `DiffReviewViewer` and `ArtifactPreviewModal` impact checks. Before commit, rerun `mcp__gitnexus.detect_changes` if MCP recovers. If it remains unavailable, run local impact checks with `rg` and the affected package tests.

---

### Task 1: Record Gap Parity Status

**Files:**
- Modify: `docs/artifact-diff-gap-closure.md`

- [x] Add a "Remaining Parity Work" section that lists OpenCode review, multica/AionUi preview, artifact lifecycle, and proof-of-work gaps.
- [x] Mark which gaps are closed by current implementation and which are still in progress.
- [x] Include exact reference files so future agents do not redesign from scratch.
- [x] Run `rg -n "Remaining Parity Work|OpenCode|multica|Symphony" docs/artifact-diff-gap-closure.md`.

### Task 2: Review Lifecycle Backend

**Files:**
- Modify: `packages/db/migrations/0017_artifact_review_comments.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/artifacts/src/index.ts`
- Modify: `packages/protocol/src/events/registry.ts`
- Modify: `openspec/specs/event-system/spec.md`
- Test: `packages/db/test/sqlite.test.ts`
- Test: `packages/artifacts/test/artifacts.test.ts`

- [x] Add lifecycle columns to `artifact_reviews`: `status`, `side`, `line_start`, `line_end`, `updated_at`, `resolved_at`, `deleted_at`.
- [x] Add `artifact.review.updated`, `artifact.review.resolved`, and `artifact.review.deleted` events with durable detail visibility.
- [x] Implement `updateReview`, `resolveReview`, and `deleteReview` in `ArtifactService`, publishing events in the same SQLite transaction.
- [x] Write failing tests for create/update/resolve/delete persistence and events.
- [x] Run `pnpm --filter @agenthub/db test` and `pnpm --filter @agenthub/artifacts test`.

### Task 3: Diff Parser And Review Viewer Parity

**Files:**
- Modify: `packages/artifacts/src/index.ts`
- Modify: `apps/web/src/components/artifacts/DiffReviewViewer.tsx`
- Modify: `apps/web/src/components/artifacts/DiffReviewViewer.test.tsx`

- [x] Extend `parseGitDiffFiles` to detect rename, copy, binary, mode-only, and no-newline markers and store status/metadata in file data where possible.
- [x] Add tests for renamed file, binary file, mode-only patch, and no-newline marker.
- [x] Add clickable diff rows in `DiffReviewViewer` that call `onLineSelect({ filePath, lineNumber, side })`.
- [x] Add `focusedCommentId` support and stable comment anchors.
- [x] Add inline comment actions for update/delete/resolve when handlers are provided.
- [x] Run `pnpm --filter @agenthub/web test -- DiffReviewViewer`.

### Task 4: Artifact Review REST And Workspace UI

**Files:**
- Modify: `packages/daemon/src/index.ts`
- Modify: `apps/web/src/components/run/tabs/ArtifactsTab.tsx`
- Test: `packages/daemon/test/daemon.test.ts`
- Test: `apps/web/src/components/run/RunDetailDrawer.test.ts`

- [x] Add REST routes:
  - `PATCH /artifacts/:artifactId/reviews/:reviewId`
  - `POST /artifacts/:artifactId/reviews/:reviewId/resolve`
  - `DELETE /artifacts/:artifactId/reviews/:reviewId`
- [x] Update `ArtifactReviewTools` so selecting a diff line pre-fills file/line/side.
- [x] Add edit/delete/resolve controls to the review timeline.
- [x] Add focused comment navigation from timeline to diff row.
- [x] Run daemon and web affected tests.

### Task 5: Preview Parity

**Files:**
- Modify: `apps/web/src/components/artifacts/ArtifactPreviewModal.tsx`
- Modify: `apps/web/src/components/artifacts/ArtifactPreviewModal.test.tsx`
- Modify: `apps/web/src/components/run/tabs/ArtifactsTab.tsx`
- Modify: `apps/web/src/components/chat/MessageItem.tsx`

- [x] Add a preview dispatch table inspired by multica `utils/preview.ts`.
- [x] Add video/audio preview kinds.
- [x] Add markdown/code source-preview toggle.
- [x] Add retry action for failed preview loads.
- [x] Keep HTML sandbox as `sandbox="allow-scripts"` without `allow-same-origin`.
- [x] Add tests for audio/video, retry rendering, and source-preview toggle.
- [x] Run `pnpm --filter @agenthub/web test -- ArtifactPreviewModal`.

### Task 6: Artifact Lifecycle

**Files:**
- Modify: `packages/db/migrations/0017_artifact_review_comments.sql` or add a new migration if needed.
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/artifacts/src/index.ts`
- Modify: `packages/daemon/src/index.ts`
- Modify: `packages/protocol/src/events/registry.ts`
- Modify: `apps/web/src/components/run/tabs/ArtifactsTab.tsx`
- Tests: artifact, daemon, db, web.

- [x] Add `archived_at` and `deleted_at` to `artifacts`.
- [x] Add `artifact.archived` and `artifact.deleted` events.
- [x] Add `archive` and `delete` service methods. Deletion is soft-delete by default.
- [x] Filter deleted artifacts from normal list responses.
- [x] Add Archive/Delete actions in the artifact workspace.
- [x] Run affected tests.

### Task 7: Proof-Of-Work Report Maturity

**Files:**
- Modify: `packages/daemon/src/index.ts`
- Modify: `apps/web/src/components/panels/TasksPanel.tsx`
- Modify: `apps/web/src/components/panels/TasksPanel.test.tsx`

- [x] Add report template metadata: `templateVersion`, `generatedAt`, `evidenceCounts`.
- [x] Make "generate report" behave as "create or refresh report" for a task.
- [x] Surface report status and evidence counts in `TasksPanel`.
- [x] Include review decisions and unresolved comments in report markdown.
- [x] Run panel and daemon tests.

### Task 8: Final Verification

**Files:** all changed files.

- [x] Run `pnpm --filter @agenthub/artifacts test`.
- [x] Run `pnpm --filter @agenthub/daemon test`.
- [x] Run `pnpm --filter @agenthub/web test`.
- [x] Run root `pnpm typecheck` because package-level `typecheck` scripts are not defined.
- [x] Run `pnpm check:all`.
- [x] Run `git diff --check` (no whitespace errors; Windows CRLF warnings only).
- [x] Run `mcp__gitnexus.detect_changes` if MCP is available; GitNexus MCP remained unavailable with `Transport closed`.
