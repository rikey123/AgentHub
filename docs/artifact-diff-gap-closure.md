# AgentHub Artifact And Diff Gap Closure Plan

Last updated: 2026-06-06

## Purpose

This document records the current gaps in AgentHub's artifact and code diff system, compares them with mature reference projects, and defines the closure target for each gap.

The goal is not to invent a new review model. The target design should be borrowed from mature references already present under `C:\project\refrence`, especially:

- OpenCode for session diff, patch application, review UI, per-file rendering, and line comments.
- multica for attachment/document preview, full-screen modal behavior, HTML sandboxing, download/open actions, and preview fallbacks.
- AionUi for compact tool/diff presentation and file preview type routing.
- wenzagent for precise old_text/new_text file patch ergonomics.
- Symphony for task-level proof-of-work and delivery evidence.
- hermes-kanban for externalized Markdown/report output patterns.

## Current AgentHub Implementation

AgentHub currently has a functional artifact foundation:

- `packages/artifacts/src/index.ts` defines `ArtifactService`, `ArtifactFS`, and `ArtifactFSRunRegistry`.
- `packages/db/migrations/0008_artifacts.sql` stores artifacts in `artifacts` and per-file data in `artifact_files`.
- `packages/orchestrator/src/adapter-bridge.ts` captures runtime `fs.writeTextFile` and `fs.deleteFile` events and turns them into run artifacts.
- `packages/orchestrator/src/mcp/room-mcp-server.ts` applies isolated worktree diffs through `room.apply_worktree`.
- `apps/web/src/components/run/tabs/ArtifactsTab.tsx` lists artifacts for a run/room.
- `apps/web/src/components/cards/DiffCard.tsx` renders a simple diff summary with Apply/Reject actions.
- `apps/web/src/components/chat/MessageItem.tsx` renders artifact-backed attachment cards.
- `apps/web/src/components/panels/TasksPanel.tsx` shows task-level changed file counts and worktree review states.

The foundation is real, but the current product experience is closer to "artifact debug list + summary cards" than a mature code review and delivery workspace.

## Reference Project Findings

### OpenCode

Primary references:

- `C:\project\refrence\opencode\packages\ui\src\components\session-review.tsx`
- `C:\project\refrence\opencode\packages\ui\src\components\session-diff.ts`
- `C:\project\refrence\opencode\packages\ui\src\components\diff-changes.tsx`
- `C:\project\refrence\opencode\packages\ui\src\components\apply-patch-file.ts`
- `C:\project\refrence\opencode\packages\app\src\pages\session\review-tab.tsx`
- `C:\project\refrence\opencode\packages\opencode\src\tool\apply_patch.ts`
- `C:\project\refrence\opencode\packages\opencode\src\cli\cmd\tui\util\revert-diff.ts`

Mature patterns to reuse:

- Session-level diff is the primary user concept.
- Diff data is normalized into per-file objects with `file`, `patch`, `additions`, `deletions`, and `status`.
- Review UI supports unified and split views.
- Files are grouped in accordions with path, icon, change type, and stats.
- Large diffs are guarded and lazy-rendered.
- Review UI supports line selection and line comments.
- Scroll position and focused comments are preserved.
- Patch application returns file metadata and diagnostics.
- The tool result contains enough diff metadata for both permission prompts and UI rendering.
- Revert logic parses diff text back into file summaries.

### multica

Primary references:

- `C:\project\refrence\multica\packages\views\editor\attachment-preview-modal.tsx`
- `C:\project\refrence\multica\packages\views\editor\html-attachment-preview.tsx`
- `C:\project\refrence\multica\packages\views\attachments\attachment-preview-page.tsx`
- `C:\project\refrence\multica\packages\views\editor\utils\preview.ts`

Mature patterns to reuse:

- Attachment preview is a first-class modal, not just a small inline card.
- Preview kind is derived from filename and content type.
- Image, PDF, video, audio, markdown, HTML, and text have distinct renderers.
- Text-backed previews are fetched through a content endpoint.
- HTML is rendered in a sandboxed iframe with `allow-scripts` but without `allow-same-origin`.
- Download and open-in-new-tab actions are always available when meaningful.
- Unsupported, too-large, loading, and failed preview states are explicit.

### AionUi

Primary references:

- `C:\project\refrence\AionUi\mobile\src\components\chat\ToolCallBlock.tsx`
- `C:\project\refrence\AionUi\mobile\src\components\files\FileContentView.tsx`
- `C:\project\refrence\AionUi\mobile\app\file-preview.tsx`

Mature patterns to reuse:

- Tool calls and diff snippets are displayed as compact expandable blocks rather than ordinary chat text.
- File preview has explicit type routing for markdown, code, HTML, diff, image, and unsupported file types.
- Preview size limits are enforced in the UI.
- File preview has loading, retry, unsupported, and too-large states.

### wenzagent

Primary reference:

- `C:\project\refrence\wenzagent-main\lib\src\agent\tool\builtin\file_patch_tool.dart`

Mature patterns to reuse:

- Precise old_text/new_text patching is easier for LLMs than raw unified patches in many cases.
- Multiple patches can be applied atomically.
- If `old_text` is missing, return a useful nearby-match hint.
- If `old_text` matches multiple locations, reject and ask for more context.

### Symphony

Primary references:

- `C:\project\refrence\symphony-main\README.md`
- `C:\project\refrence\symphony-main\SPEC.md`
- `C:\project\refrence\symphony-main\elixir\WORKFLOW.md`

Mature patterns to reuse:

- Autonomous work should produce proof of work, not just chat responses.
- Task completion evidence can include CI status, PR review feedback, complexity analysis, walkthrough videos, logs, and validation notes.
- Dashboards should expose human-readable status, validation failures, and terminal state.

### hermes-kanban

Primary references:

- `C:\project\refrence\hermes-kanban-main\docs\API.md`
- `C:\project\refrence\hermes-kanban-main\EXECUTION.md`
- `C:\project\refrence\hermes-kanban-main\skills\kanban-rituals.md`

Mature patterns to reuse:

- Task/project state and generated reports can be externalized into Markdown.
- Reports and board outputs should remain readable outside the app.
- Review and standup outputs should have stable, repeatable formats.

## Gap Register And Closure Targets

## 2026-06-06 Status Update

AgentHub has now closed the basic product loop for artifacts and diffs:

- Per-file `diff` and `worktree_diff` artifacts are rendered by `apps/web/src/components/artifacts/DiffReviewViewer.tsx`.
- `apps/web/src/components/cards/DiffCard.tsx` embeds the review viewer instead of showing only a summary.
- `ArtifactService` stores durable artifact review records and emits `artifact.review.added`, `artifact.review.updated`, `artifact.review.resolved`, and `artifact.review.deleted`.
- `apps/web/src/components/run/tabs/ArtifactsTab.tsx` is now an artifact workspace with filtering, grouped code changes, terminal outputs, other artifacts, review tools, preview actions, archive, and delete.
- `apps/web/src/components/artifacts/ArtifactPreviewModal.tsx` supports markdown, text/code, sandboxed HTML, image, PDF, audio, video, open, download, retry, too-large, and unsupported states.
- `packages/protocol/src/preview.ts` is the shared preview contract borrowed from multica's dispatch-table pattern. Web and daemon now use the same preview kind, text-previewability, language, and artifact content-type rules.
- `packages/orchestrator/src/mcp/room-mcp-server.ts` supports mature `file.edit` ergonomics borrowed from wenzagent: multi-patch atomic edits, `createIfMissing` / `create_if_missing`, nearby-match hints, multiple-match rejection, and per-patch line-number reporting.
- `file.apply_patch` returns structured per-file metadata for modified, added, and deleted files, matching the OpenCode pattern of exposing file path, status, additions, deletions, and patch data to callers.
- Task delivery reports now include file runs, worktree reviews, proof activities, artifact review decisions, unresolved comment counts, template version, and refresh instead of accumulating duplicates.
- `DiffReviewViewer` now has an OpenCode-style optional `onViewFile` action. In `ArtifactsTab`, each changed file can open the full artifact file content through `ArtifactPreviewModal`, using the same `/artifacts/:id/files/:path` and `/raw` contract as document artifacts.
- `DiffReviewViewer` now exposes stable file anchors when an artifact id is provided. Task proof links such as `#artifact:<artifactId>:<path>` can scroll to the real per-file review block instead of relying on the old summary-only fallback.
- `DiffCard` now uses the same `DiffReviewViewer` even before async file details load, so chat diff cards and the artifacts workspace share one visual review language and stable anchors.
- `ArtifactsTab` now keeps a lightweight opened-preview strip. This borrows the preview-workbench direction from AionUi and multica without changing the shared modal: users can reopen recently inspected artifact files and switch between them from the artifact workspace.
- Artifact file preview launched from `ArtifactsTab` now feeds derived MIME type and byte size into `ArtifactPreviewModal`, so the shared multica/AionUi-style preview router can display type/size and apply the existing size guard consistently.

Remaining gaps are no longer "no artifact workspace" level gaps. They are maturity gaps against OpenCode/AionUi/Symphony:

- OpenCode still has a stronger diff engine (`@pierre/diffs`), true drag/range selection, selection previews, lazy visible-window mounting, pinned/open file state, mention-aware comments, richer `readFile` media integration, and focused file/comment state.
- OpenCode `apply_patch` still has deeper patch semantics than AgentHub: patch hunk derivation, move metadata, permission prompts with full diff metadata, formatter integration, BOM preservation, file watcher events, LSP notifications, and diagnostics.
- AionUi still has a richer preview workbench beyond AgentHub's basic opened-preview strip: persistent history, snapshots, edit mode, split editor/preview, Office/PPT/Excel viewers, open-in-system, and toolbar extras.
- Symphony still has stronger proof-of-work gating: CI status, PR review feedback, complexity analysis, walkthrough media, validation checklists, and "do not move to Human Review before the completion bar passes" rules.
- Artifact lifecycle governance is still thin: no quota/retention enforcement, no object storage for large binary artifacts, and no GC policy beyond archive/delete records.

### Gap 1: Diff Display Is Only A Summary

Current state:

- Closed for the V1.1 product loop.
- `apps/web/src/components/cards/DiffCard.tsx` loads artifact files and renders `DiffReviewViewer`.
- If the full artifact file rows have not loaded yet, `DiffCard` still renders the card-provided file summary through `DiffReviewViewer`, preserving the same file accordion and artifact-file anchors.
- `DiffReviewViewer` supports per-file accordions, stable artifact-file anchors, unified/split modes, line numbers, line selection callbacks, inline comments, a large-diff guard, and optional Open file actions.

Reference target:

- OpenCode `SessionReview` renders per-file diffs with unified/split view, file accordions, lazy rendering, and line-level interactions.

Closure target:

- Add a reusable AgentHub diff review viewer.
- It must render each changed file with:
  - path and filename,
  - file status,
  - additions/deletions,
  - unified diff view,
  - split diff view when feasible,
  - expand/collapse all,
  - large-diff guard,
  - empty/binary/unsupported states.
- Replace the current summary-only `DiffCard` body with this viewer or a compact entry point into it.

Acceptance criteria:

- A normal diff artifact with two modified files shows actual line-level additions/deletions in the UI.
- A large diff does not freeze the browser and shows a "render anyway" style fallback.
- A user can switch between unified and split modes.
- Existing Apply/Reject behavior remains available.

Residual maturity gap:

- AgentHub still parses unified patches manually. OpenCode's `@pierre/diffs` renderer supports richer drag/range selection, focused comments, lazy mounting, pinned/open state, and media-aware `readFile` rendering.

### Gap 2: `worktree_diff` Is Stored As One `worktree.patch`

Current state:

- Closed for the V1.1 product loop.
- `ArtifactFSRunRegistry.buildWorktreeDiffArtifact()` parses `git diff HEAD` into per-file rows using `parseGitDiffFiles()`.
- `metadata.fullPatch` is retained for apply/recovery while `artifact_files` exposes per-file patch data for review.

Reference target:

- OpenCode normalizes diffs into per-file records with `file`, `patch`, `additions`, `deletions`, and `status`.

Closure target:

- Parse worktree patch into per-file entries at creation time.
- Store one `artifact_files` row per changed file.
- Keep a full patch copy in artifact metadata or a synthetic file only if needed for `git apply`.
- Expose per-file patch data to the review viewer.

Acceptance criteria:

- A worktree run that changes three files creates three file entries, not only `worktree.patch`.
- Task file links can open the exact changed file in the artifact viewer.
- Worktree apply still has access to the full patch for `git apply`.

Residual maturity gap:

- The parser covers normal git patches, rename/copy/mode-only/binary flags, but it is not as battle-tested as OpenCode's patch and diff stack.

### Gap 3: Ordinary Diff And Worktree Diff Have Split User Models

Current state:

- Mostly closed visually.
- Ordinary `diff` and `worktree_diff` both render through `DiffReviewViewer` in the artifacts workspace.
- Internal apply paths remain separate, which is correct: ordinary diff uses artifact apply/reject; worktree diff uses worktree apply/discard.

Reference target:

- OpenCode presents all session changes through one review surface.

Closure target:

- Introduce a frontend `ReviewableChange` view model derived from either `diff` or `worktree_diff`.
- Use the same review viewer for both ordinary diff artifacts and worktree diffs.
- Keep backend apply paths separate internally, but hide that split behind a consistent UI action model:
  - apply,
  - reject/discard,
  - revert where supported,
  - show conflict details.

Acceptance criteria:

- In the UI, ordinary diff and worktree diff share one visual review language.
- Worktree diff actions route to `room.apply_worktree` or `room.discard_worktree`.
- Ordinary diff actions route to `/artifacts/:id/apply` or `/reject`.
- The user is never asked to understand the internal apply-path difference.

Residual maturity gap:

- Worktree apply/discard actions still need a more unified user-facing action row in the review surface, plus clearer conflict/recovery copy.

### Gap 4: Review Decisions Lack Real Review Data

Current state:

- Closed for durable basics.
- `ArtifactService` stores structured review records with reviewer, decision, reason, optional file/line/side/range, status, timestamps, resolve, delete, and update.
- `ArtifactsTab` shows inline comments and review history, and now wires comment editing to the backend `PUT /artifacts/:id/reviews/:reviewId` route.

Reference target:

- OpenCode review UI supports line comments, comment focus, update, delete, and mentions.
- Symphony emphasizes review feedback as proof of work.

Closure target:

- Add artifact review records for:
  - reviewer actor,
  - decision,
  - reason/comment,
  - timestamps,
  - optional file path and line selection.
- Add a minimal line comment model before building advanced comment resolution.
- Show review decisions and comments in the artifact review UI.

Acceptance criteria:

- User can reject a diff with a reason and see that reason later.
- A review decision survives refresh.
- A line-level comment can be attached to a file diff and displayed at that location.

Residual maturity gap:

- AgentHub has a lightweight prompt-based edit flow. OpenCode still has richer comment editors, focused selection previews, mention autocomplete, and true range selection.

### Gap 5: Artifacts Tab Is A Debug List, Not A Workspace

Current state:

- Closed for the V1.1 product loop.
- `ArtifactsTab` has filters, grouped code changes, terminals, other artifacts, provenance metadata, preview, archive/delete, review tools, and review history.

Reference target:

- OpenCode has a review/files workspace.
- Symphony dashboards expose useful proof and status, not raw rows.

Closure target:

- Redesign `ArtifactsTab` into an artifact workspace with:
  - filters by type/status/agent/task/run,
  - grouped sections: code changes, files/documents, terminal outputs, previews,
  - origin metadata: agent, run, task, message, created time,
  - action buttons appropriate to artifact type,
  - detail drawer or inline preview.

Acceptance criteria:

- User can quickly find all code changes for a run.
- User can quickly find all document/file artifacts for a room.
- Artifact rows show enough origin metadata to answer "who produced this and why?"

### Gap 6: Attachment And Document Preview Is Too Limited

Current state:

- Closed for common deliverables.
- `ArtifactPreviewModal` supports markdown, text/code, sandboxed HTML, image, PDF, audio, video, download fallback, retry, and too-large states.
- `packages/protocol/src/preview.ts` now centralizes preview kind, text-previewability, language mapping, and raw artifact content type, following multica's front/back contract discipline.
- `ArtifactsTab` keeps a lightweight opened-preview strip so users can switch between recently opened artifact files without rediscovering them in the artifact list.
- `ArtifactsTab` derives `mimeType` and `sizeBytes` from the opened artifact file path/content and passes them into the modal, rather than relying only on filename fallback.

Reference target:

- multica `AttachmentPreviewModal` supports image, PDF, video, audio, markdown, HTML, and text.
- HTML preview uses a sandboxed iframe.
- AionUi has explicit file type routing and size guards.

Closure target:

- Add a shared `ArtifactPreviewModal`.
- Support preview kinds:
  - markdown,
  - code/text,
  - HTML with sandbox,
  - image,
  - PDF if browser support allows,
  - download fallback.
- Add loading, error, unsupported, and too-large states.
- Add download and open-in-new-tab actions.

Acceptance criteria:

- Markdown artifact opens as rendered markdown.
- Code/text artifact opens with readable monospace formatting.
- HTML artifact renders in a sandboxed iframe.
- Unsupported files show a clear fallback with download.
- Preview failures do not remove the user's only access to the file.

Residual maturity gap:

- AionUi still has a full preview workbench with persistent history, snapshot, edit mode, split preview, Office/PPT/Excel viewers, and open-in-system actions.

### Gap 7: Patch/Edit Tools Do Not Yet Match Mature Tool Results

Current state:

- Partially closed.
- `file.edit` now supports oldText/newText and wenzagent-style multi-patch atomic edits, `createIfMissing`, nearby-match hints, multiple-match rejection, and line-number reporting.
- `file.apply_patch` returns per-file metadata for modified, added, and deleted files and validates paths before `git apply`.

Reference target:

- OpenCode `apply_patch` parses patch hunks, validates paths, asks permission with diff metadata, applies changes, publishes watcher events, touches LSP, collects diagnostics, and returns structured file metadata.
- wenzagent `file_patch` gives old_text/new_text ergonomics with helpful mismatch errors.

Closure target:

- Ensure file edit/patch tools return structured changed-file metadata:
  - path,
  - status,
  - patch,
  - additions,
  - deletions,
  - diagnostics when available.
- Ensure every file edit creates or updates a run artifact.
- Add an old_text/new_text precise edit mode if current `file.edit` does not provide it.
- Add mismatch diagnostics for missing or ambiguous text.

Acceptance criteria:

- A tool edit appears in the run artifact list without refresh.
- The changed file opens in the diff viewer.
- Ambiguous old_text edits are rejected with a useful error.
- Permission prompts include file path and diff metadata.

Residual maturity gap:

- OpenCode `apply_patch` is still stronger: it derives patch hunks before applying, supports richer move metadata, includes full diff metadata in permission prompts, formats files, preserves BOM, emits file watcher events, notifies LSP, and returns diagnostics.

### Gap 8: Git/VCS State And Recovery Are Not Visible Enough

Current state:

- Worktree diff assumes git is available and uses `git diff HEAD` / `git apply`.
- UI does not clearly expose no-git, no-base, stale, conflict, or recovery states.
- Ordinary diff revert exists, but worktree revert/discard/recovery is incomplete from a user perspective.

Reference target:

- OpenCode exposes no-VCS/no-snapshot states and has revert-diff utilities.

Closure target:

- Add explicit VCS status to artifact/worktree review UI:
  - Git detected,
  - base commit,
  - worktree path when safe to show,
  - patch conflict,
  - stale base,
  - recovery required.
- Add user-readable conflict guidance.
- Add worktree apply rollback/revert plan or clearly mark unsupported cases.

Acceptance criteria:

- If workspace is not a Git repo, user sees a clear state instead of silent missing diff.
- If worktree apply conflicts, user sees conflict details and next actions.
- Ordinary diff stale-base failure is visible in the UI.

### Gap 9: Artifact Origin Chain Is Not Clear

Current state:

- Artifact rows store `workspaceId`, `roomId`, `taskId`, `runId`, `messageId`, and `createdBy`.
- UI barely exposes this chain.

Reference target:

- Symphony proof-of-work and OpenCode session review make session/task origin obvious.

Closure target:

- Show artifact provenance in every artifact detail:
  - agent,
  - task,
  - run,
  - message,
  - created time,
  - source mode (`shadow_buffer`, `isolated_worktree`, MCP file message, terminal tool).

Acceptance criteria:

- From an artifact detail, user can navigate to the run and task.
- From a task detail, user can navigate to the relevant artifact.
- A refresh does not lose the origin chain.

### Gap 10: Artifact Lifecycle Governance Is Thin

Current state:

- Artifact storage exists in SQLite.
- Settings mention artifact storage, attachment limits, and cleanup policy, but these are not a full lifecycle system.

Reference target:

- multica has explicit content fetching, preview limits, download paths, unsupported states, and attachment contracts.

Closure target:

- Define and enforce:
  - max preview size,
  - max upload size,
  - binary artifact storage policy,
  - content download endpoint,
  - artifact deletion policy,
  - retention/GC policy,
  - sensitive file handling.

Acceptance criteria:

- Oversized artifacts do not crash preview.
- Binary artifacts are downloadable even when not previewable.
- Artifact cleanup policy is documented and implemented.

### Gap 11: Task-Level Proof Of Work Is Incomplete

Current state:

- Tasks can show file counts, worktree status, activities, and some artifact references.
- There is no consolidated proof-of-work section.

Reference target:

- Symphony expects CI status, review feedback, complexity analysis, walkthrough videos, and validation evidence.
- hermes-kanban externalizes reports in Markdown.

Closure target:

- Add a task proof-of-work panel that aggregates:
  - code changes,
  - document artifacts,
  - terminal/test outputs,
  - review decisions,
  - validation notes,
  - generated reports.
- Allow exporting a task delivery report as Markdown artifact.

Acceptance criteria:

- A completed task displays what changed, what was validated, and what remains unresolved.
- A task can produce a Markdown delivery report artifact.

## Proposed Implementation Sequence

### Phase 1: Normalize Review Data

Purpose:

- Make ordinary diffs and worktree diffs render through the same frontend model.

Deliverables:

- Patch parser utility for per-file worktree diff entries.
- Backend change to store `worktree_diff` per changed file.
- Artifact file API returns enough patch/content metadata.
- Frontend `ReviewableChange` adapter.

Primary references:

- OpenCode `session-diff.ts`
- OpenCode `diffs.ts`
- OpenCode `revert-diff.ts`

### Phase 2: Build Review UI

Purpose:

- Replace summary-only diff display with a real review surface.

Deliverables:

- `DiffReviewViewer` component.
- Unified view first.
- Split view if feasible without importing a large dependency immediately.
- File accordion, stats, large-diff guard, empty states.
- Integrated Apply/Reject/Discard/Conflict actions.

Primary references:

- OpenCode `session-review.tsx`
- OpenCode `diff-changes.tsx`
- AionUi `ToolCallBlock.tsx`

### Phase 3: Upgrade Attachment Preview

Purpose:

- Make file/document artifacts feel like real deliverables.

Deliverables:

- `ArtifactPreviewModal`.
- Preview kind resolver.
- Markdown, code/text, HTML sandbox, image, PDF/download fallback.
- Open-in-new-tab and download actions.

Primary references:

- multica `attachment-preview-modal.tsx`
- multica `html-attachment-preview.tsx`
- AionUi `FileContentView.tsx`

### Phase 4: Strengthen Patch/Edit Tool Integration

Purpose:

- Ensure tool-produced file changes consistently become reviewable artifacts.

Deliverables:

- Structured file edit/patch result metadata.
- old_text/new_text precise edit mode if not already sufficient.
- Better mismatch errors.
- Run artifact creation for every edit path.

Primary references:

- OpenCode `apply_patch.ts`
- wenzagent `file_patch_tool.dart`

### Phase 5: Add Review Records And Proof Of Work

Purpose:

- Move from "artifact exists" to "delivery can be reviewed and trusted."

Deliverables:

- Artifact review decision records.
- Minimal line comments.
- Task proof-of-work panel.
- Markdown delivery report artifact.

Primary references:

- OpenCode line comment flow.
- Symphony proof-of-work model.
- hermes-kanban Markdown reporting model.

### Phase 6: Lifecycle Governance

Purpose:

- Make artifact storage safe and predictable.

Deliverables:

- Preview/upload/download limits.
- Binary download behavior.
- Retention/GC policy.
- Settings UI reflects real policy.
- Sensitive file handling documented and tested.

Primary references:

- multica attachment contracts and fallback states.

## Non-Goals

These are not required for the first closure pass:

- Full GitHub PR review clone.
- Multi-user real-time collaborative code review.
- Rich binary diff support.
- Full LSP integration if runtime/language support is unavailable.
- Remote artifact object storage.

## Definition Of Done

The gap closure is complete only when all of the following are true:

- Users can inspect actual code diffs before applying them.
- Ordinary diffs and worktree diffs share one UI review model.
- Worktree diffs are stored with per-file patch entries.
- Users can preview generated markdown/code/html/image artifacts.
- Unsupported artifacts are downloadable and fail gracefully.
- Tool-generated edits reliably appear as artifacts and task file changes.
- Artifact review decisions are durable and visible.
- Task detail shows proof of work, not only chat messages.
- Artifact lifecycle limits are enforced and visible.
- Tests cover backend artifact creation/apply paths and frontend render paths.

## 2026-06-06 Closure Pass

This pass implemented the first complete user-facing closure for the high-impact gaps while keeping the backend apply paths compatible:

- Gap 1 closed: `apps/web/src/components/artifacts/DiffReviewViewer.tsx` renders real unified and split diffs, file accordions, stats, empty states, and a large-diff guard. `DiffCard` now loads `/artifacts/:id/files` and uses this viewer while retaining Apply/Reject.
- Gap 2 closed: `ArtifactFSRunRegistry.buildWorktreeDiffArtifact()` now parses `git diff HEAD` into one `artifact_files` row per changed file. The full patch is preserved in `artifact.metadata.fullPatch` so `room.apply_worktree` can still use `git apply`.
- Gap 3 closed for the UI model: `DiffReviewViewer` is shared by ordinary `diff` cards and `worktree_diff` artifacts. Backend apply routes remain separate, matching the existing command contract.
- Gap 4 closed: `packages/db/migrations/0016_artifact_reviews.sql`, `0017_artifact_review_comments.sql`, and `0018_artifact_lifecycle.sql` add durable review records including `comment` decisions, optional `file_path`, selected side/range, `open/resolved/deleted` status, and timestamps. `ArtifactService.addReview()`, `updateReview()`, `resolveReview()`, and `deleteReview()` persist records and emit `artifact.review.added/updated/resolved/deleted` in the same transaction. `ArtifactsTab` can add file/line comments, focus comments, resolve/delete comments, displays the review timeline, and passes comments into the diff viewer for inline rendering.
- Gap 5 closed: `ArtifactsTab` now behaves as an artifact workspace. It groups Code changes, Terminal outputs, and Other artifacts; shows provenance metadata; renders code changes inline; and provides filters for type, status, run, task, and author so users can search the room/run artifact set instead of reading a debug list.
- Gap 6 closed for the first preview pass: `ArtifactPreviewModal` supports Markdown document rendering with `react-markdown` + GFM, text/code source views, sandboxed HTML, image/PDF/audio/video via raw URL, unsupported fallback, retryable loading/error states, Open and Download actions. This follows multica/AionUi's mature preview routing pattern while keeping HTML preview separate in its own sandboxed path.
- Gap 6 follow-up closed: `ArtifactsTab` now wires diff file-level Open file actions to `ArtifactPreviewModal`, mirroring OpenCode's `onViewFile` entry point while reusing AgentHub's existing artifact content/raw endpoints.
- Gap 7 verified rather than rewritten: `room-mcp-server.ts` already has oldText/newText `file.edit` with missing and ambiguous-text errors, and `file.apply_patch` routes through existing guarded write paths. Further diagnostic enrichment can build on this.
- Gap 7 follow-up verified: `file.apply_patch` now has explicit test coverage for structured metadata on added and deleted files, not only modified files.
- Gap 8 closed for the current worktree apply model: worktree artifacts now record `artifactFsMode`, `baseRef`, and `worktreeRoot` metadata; the workspace UI shows mode/base and conflict status; stale-base and conflict failures are persisted through artifact/worktree status plus review/proof records. Rich IDE-style conflict repair remains outside this closure pass.
- Gap 9 closed for visible provenance: artifact rows show type, status, author, run, task, mode, and base reference.
- Gap 10 closed for local artifact storage governance: preview has large-content guarding, unsupported fallbacks, sandboxed HTML, and `/artifacts/:id/files/:path/raw` for Open/Download. Following multica's split between preview and download actions, raw file responses are inline by default for image/PDF/audio/video/open-in-new-tab preview and switch to `Content-Disposition: attachment` only when `?download=1` is requested. Binary and oversized artifacts remain accessible through raw download instead of crashing preview. `ArtifactService.archive()` and `delete()` now provide local soft lifecycle operations with `artifact.archived` and `artifact.deleted` events. Retention follows the existing local daemon/worktree cleanup policy documented in Settings; remote object storage is a non-goal.
- Gap 11 closed: `TasksPanel` includes a Proof of work section with file count, worktree state, evidence counts, and validation/proof activities. `POST /rooms/:id/tasks/:taskId/report` creates or refreshes a Markdown delivery report as a durable file artifact under `.agenthub/reports/`, links it back to the task through a proof record, and makes it visible in the artifact workspace/preview path. Report metadata now carries `templateVersion`, `generatedAt`, and `evidenceCounts`, and refreshes soft-delete the previous live delivery report for the task.

Verification added:

- `packages/orchestrator/test/worktree-lifecycle.test.ts` asserts per-file worktree diff creation and full patch preservation.
- `packages/artifacts/test/artifacts.test.ts` covers patch parsing and durable review records.
- `packages/daemon/test/daemon.test.ts` covers review lifecycle REST routes, archive/delete routes, raw artifact serving, and create/update delivery report behavior.
- `apps/web/src/components/artifacts/DiffReviewViewer.test.tsx` covers diff rendering and large diff guard.
- `apps/web/src/components/artifacts/ArtifactPreviewModal.test.tsx` covers sandboxed HTML and unsupported fallback.
- `apps/web/src/components/run/RunDetailDrawer.test.ts` covers artifact workspace filtering.
- `apps/web/src/components/panels/TasksPanel.test.tsx` covers Markdown delivery report formatting.
- `packages/db/test/sqlite.test.ts` covers the new `artifact_reviews` migration/schema contract.

### Closure API And Event Additions

- `GET /artifacts/:id/reviews` returns durable review records.
- `POST /artifacts/:id/reviews` creates a review/comment record and emits `artifact.review.added` with detail visibility.
- `PATCH /artifacts/:id/reviews/:reviewId`, `POST /artifacts/:id/reviews/:reviewId/resolve`, and `DELETE /artifacts/:id/reviews/:reviewId` update, resolve, and soft-delete review comments.
- `POST /artifacts/:id/archive` and `DELETE /artifacts/:id` provide local artifact lifecycle actions.
- `POST /rooms/:id/tasks/:taskId/report` creates or refreshes a Markdown file artifact and links it through task proof-of-work activity.
- `GET /artifacts/:id/files/:path/raw` serves raw artifact content with `nosniff`, download filename, and content-type routing.

### Remaining Parity Work

The current pass intentionally keeps AgentHub's existing local artifact architecture. The following mature-reference capabilities are still partial and should remain tracked explicitly:

- OpenCode full review parity: scroll preservation, true drag multi-line range selection beyond the current side/range metadata, richer comment edit UI, mention suggestions inside review comments, pinned/focused file state, media-aware `readFile` rendering, and IDE/LSP diagnostics in patch results.
- OpenCode patch recovery parity: richer stale-base repair workflows, explicit revert/discard UX for every worktree failure mode, and no-VCS/no-snapshot empty states with guided next actions.
- multica/AionUi full preview parity: dedicated full-page preview routes, syntax highlighting for large code artifacts, preview size policy surfaced in Settings, and richer binary/media metadata.
- Symphony/hermes-kanban report parity: automated report generation on task terminal states, richer validation categories, CI/log/video evidence slots, and stable report schema version migration when future templates change.
- Governance parity: retention/GC enforcement beyond local soft delete/archive, remote object storage, and cross-device artifact replication.

### Remaining Explicit Non-Goals

The registered gaps are closed for V1.1's local product surface, but these mature-reference features are intentionally not in this pass:

- GitHub-style multi-user real-time review collaboration.
- Rich binary diff rendering.
- Full LSP diagnostics integration for every runtime.
- Remote artifact object storage and cross-device artifact replication.
