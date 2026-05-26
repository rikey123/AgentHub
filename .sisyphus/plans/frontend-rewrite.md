# AgentHub Frontend Rewrite — Dual-Theme Product Workbench

## TL;DR
> **Summary**: Rewrite `apps/web` as a contract-preserving, visually new dual-theme product workbench for local multi-agent coding. Keep daemon/data behavior stable while replacing the shell, component system, visual language, and web tests.
> **Deliverables**:
> - New `apps/web` visual system based on `ui-ux-pro-max`: switchable light enterprise workbench + dark mission-control theme.
> - Four-column IA: room/group list, extensible feature rail, central chat, right-side enterprise workbench information panels.
> - Web-local UI primitives, shell layout, interaction controller, and rewritten user-facing surfaces.
> - Rebuilt Vitest controller tests and Playwright E2E selectors/flows.
> - Multi-agent worktree execution model with Oracle review and PR gate per phase.
> **Effort**: XL
> **Parallel**: YES — within each phase only; phases are sequential PR gates.
> **Critical Path**: Git/PR baseline → design-system lock → interaction controller/shell → core surfaces → secondary surfaces → Oracle + PR gates → final verification.

## Context
### Original Request
- 用户对当前前端非常不满意，要求“完全重写”。
- 用户要求先给计划。
- 用户纠正：主要使用 `ui-ux-pro-max` 前端 skill；计划必须考虑多 agent 并行分工、git worktree、阶段 Oracle 独立审查、严格 git 规范、阶段 PR 审查后 merge。

### Interview Summary
- Scope: only `apps/web` frontend.
- Visual direction: complete reskin / `彻底换皮`.
- Testing: rebuild/update tests alongside implementation.
- Workflow: no phase overlap; each phase completes through Oracle review and PR merge before the next phase starts.

### Research Summary
- `apps/web` is a Vite SPA: `index.html -> src/main.tsx -> src/App.tsx`; no router.
- `App.tsx` currently owns the hidden UI state machine: selected room/run, side-panel tab, panel collapse, command palette, keymap modal, pending-turn editing, quote handling.
- Preserve contracts: `src/hooks/useProjector.ts`, `src/hooks/useSdk.ts`, `src/hooks/useTheme.ts`, `src/types.ts`, and daemon endpoints `/event`, `/rooms`, `/messages`, `/runs`, `/context`, `/permissions`, `/interventions`, `/artifacts`, `/pending-turns`, `/auth/session`.
- Main surfaces to replace: `Layout`, `HomeView`, `RoomList`, `ChatStream`, `InputBox`, `PendingTurnList`, `SidePanel`, `RunDetail`, `CommandPalette`, `KeymapModal`.
- Existing tests are Playwright-heavy; Vitest config exists but currently has no meaningful unit tests for web controller logic.
- `perf.spec.ts` is a hard contract: room load ≤500ms, room switch ≤200ms, delta frame p95 ≤16ms.

### ui-ux-pro-max Design Direction
- Generated design system queries:
  - `local-first multi-agent coding workbench operator console mission control dark dashboard`.
  - `enterprise workbench SaaS dashboard light dark theme product workspace kanban workflow`.
- Chosen product direction: **enterprise product workbench** with two first-class themes:
  - **Light theme**: primary/default, polished enterprise workspace, clear surfaces, product-forward cards, strong readability.
  - **Dark theme**: mission-control/operator-console, OLED-friendly, high contrast, low-light coding focus.
- Palette baseline from `ui-ux-pro-max`: dark background `#020617`, navy primary `#0F172A`, slate secondary `#1E293B`, light text `#F8FAFC`, accent/success `#22C55E`; implement paired light equivalents rather than dark-only tokens.
- Layout direction: **four-column workbench**:
  1. Room/group/chat list.
  2. Feature navigation rail reserved for current and future modules: Chat, Runs, Context, Tasks, Kanban, Workflow, Artifacts, Settings.
  3. Central chat/work canvas.
  4. Right-side enterprise information workbench for context, tasks, members, debug, cost, run detail, workflow/kanban previews.
- Typography target: Fira Code headings/metadata + Fira Sans body, **without remote font imports** unless separately approved.
- UX rules to enforce: visible focus, keyboard-first flows, skip link, active nav state, transform/opacity-only motion, z-index scale, no emoji UI icons, reduced-motion support, no fixed chrome covering content.

### Oracle Review (gaps addressed)
- Treat this as a contract-preserving UI rewrite, not a backend/product rewrite.
- Avoid router/global-state introduction unless a phase explicitly proves need; current decision is **no router, no new global-state dependency**.
- Build a web-local interaction controller/reducer for `App.tsx` state and test it with Vitest.
- Use stable ARIA and `data-testid` selectors from the start; text selectors only for fixture data.
- Migrate core room/chat/run flows before secondary chrome.

### Metis Review (gaps addressed)
- Primary design authority is `ui-ux-pro-max`; generic frontend skill is secondary only.
- Each parallel stream must run in its own git worktree and branch.
- Each phase has a phase integration branch, Oracle review, then PR to trunk.
- No phase N+1 starts before phase N PR is reviewed and merged.
- `gitnexus_detect_changes(scope="compare", base_ref="main")` runs before every phase PR.
- If `git remote -v` or `gh auth status` is unavailable, stop before PR creation and ask user to configure remote/PR access.

## Work Objectives
### Core Objective
Create a new `apps/web` frontend that feels like a polished enterprise product workbench for local multi-agent collaboration, with switchable light and dark themes, while preserving all existing daemon/data behavior.

### Deliverables
- `apps/web` visual-system rewrite: tokens, global CSS, primitives, shell, surfaces.
- Four-column layout: room/group list, future-ready feature rail, central chat canvas, right-side information workbench.
- Two complete visual themes: light enterprise workbench and dark mission-control/operator console.
- Interaction controller replacing ad-hoc `App.tsx` state where safe.
- Rewritten components for core and secondary flows.
- Vitest tests for controller/reducer logic.
- Updated Playwright E2E with stable selector strategy.
- Phase-by-phase PR workflow with Oracle approval evidence.

### Definition of Done (verifiable conditions with commands)
- `pnpm.cmd typecheck` passes.
- `pnpm.cmd lint` passes.
- `pnpm.cmd --filter @agenthub/web build` passes.
- `pnpm.cmd --filter @agenthub/web test` passes after adding web unit tests.
- `pnpm.cmd test:e2e` passes, including `perf.spec.ts` thresholds.
- `gitnexus_detect_changes(scope="compare", base_ref="main")` before each phase PR shows changes restricted to expected `apps/web/**` files plus explicit test/evidence files.
- Every phase has Oracle PASS before PR creation.
- Every phase PR is reviewed and merged before the next phase starts.

### Must Have
- `apps/web` only unless a task explicitly says otherwise and user approves.
- Preserve `useProjector`, `useSdk`, `useTheme`, `types.ts` public contracts unless the plan task explicitly includes an adapter-preserving migration.
- Preserve keyboard behavior: `Ctrl/Cmd+K`, `?`, `g r`, `g d`, message navigation/actions, pending-turn edit/cancel, quote behavior.
- Preserve theme/density persistence.
- Preserve SSE mount/cleanup behavior and auth/CSRF flow.
- Use `ui-ux-pro-max` design system as the source of design decisions.
- Implement light and dark themes as first-class modes; neither theme may be a broken/incomplete afterthought.
- Preserve room/group list as the leftmost column and introduce a second feature navigation rail with reserved slots for future Kanban and workflow displays.
- Make the right side feel like an enterprise workbench information area, not just a narrow debug side panel.
- Use worktree-per-stream for parallel implementation.
- Use Oracle review after each phase.

### Must NOT Have
- No backend, daemon, protocol, SDK, CLI, or non-web package modifications.
- No new dependency without explicit user approval.
- No router introduction.
- No Tailwind/shadcn/styled-components migration.
- No emoji icons as UI controls; use inline SVG or CSS shapes.
- No remote font import unless user approves.
- No text selectors for UI labels in new E2E tests.
- No force push, hard reset, skipped hooks, or git config edits.
- No phase overlap.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed, except explicit user/PR approval gates.
- Test decision: **tests rebuilt alongside implementation**.
- Unit tests: Vitest for web-local interaction controller/reducer; UI components primarily E2E.
- E2E: Playwright for core flows, accessibility, pending turns, run detail, command palette, performance.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.sisyphus/evidence/frontend-rewrite/task-{N}-{slug}.{ext}` and phase Oracle notes.
- Performance hard contracts: preserve `perf.spec.ts` room load ≤500ms, switch ≤200ms, delta p95 ≤16ms.

## Git / Worktree / PR Protocol (MANDATORY)
### Phase Lifecycle
1. Start from clean trunk: `git status --short`; if dirty, stop and ask user whether to stash/commit/clean.
2. Verify PR capability: `git remote -v` and `gh auth status`. If absent/failing, stop before PR creation.
3. Create phase integration branch: `redesign/phase-{N}-{slug}` from trunk.
4. For parallel streams, create stream branches and worktrees from the phase branch:
   - Parent path precheck: `Test-Path -LiteralPath "C:\project"`.
   - Example: `git worktree add "C:\project\AgentHub-worktrees\phase-2-chat" -b redesign/phase-2/chat redesign/phase-2-core-shell`.
5. Each stream commits only its scoped files.
6. Stream PR/merge into phase branch; resolve conflicts in the stream worktree, never by force-push.
7. Phase branch runs full checks.
8. Oracle independently reviews the phase branch.
9. If Oracle PASS, run GitNexus compare scope check and open PR to trunk.
10. Merge PR only after review completes; delete phase branch/worktrees.
11. Start next phase only after merge.

### Branch Naming
- Phase branch: `redesign/phase-{N}-{slug}`.
- Stream branch: `redesign/phase-{N}/{stream}`.
- Commit format: `feat(web): ...`, `test(web): ...`, `refactor(web): ...`, `chore(web): ...`.

### Git Hygiene
- Stage only intended files.
- Do not commit local skill installs such as `.opencode/skills/**` or `.claude/skills/**` unless user explicitly requests.
- Do not commit `.sisyphus/drafts/**`.
- Do not amend after PR publication unless user explicitly requests.
- Do not push/merge directly to trunk.
- Before each commit: `git status --short` and inspect staged diff.
- Before each PR: `git diff --stat main...HEAD`, `gitnexus_detect_changes(scope="compare", base_ref="main")`, full verification commands.

## Execution Strategy
### Parallel Execution Waves
> Target: within each phase, parallel streams must not touch overlapping files. Shared contracts/primitives are serial before streams fork. Phases are sequential PR gates.

Wave 0 — Workflow Baseline (serial): Task 1
Wave 1 — Design Foundation (serial): Tasks 2-3
Wave 2 — Core Architecture (limited parallel): Tasks 4-5
Wave 3 — Core Surfaces (parallel worktrees): Tasks 6-8
Wave 4 — Secondary Surfaces (parallel worktrees): Tasks 9-11
Wave 5 — Integration + PR Gates (serial per phase): Tasks 12-14

### Dependency Matrix
| Task | Depends On | Blocks |
|---|---|---|
| 1 | none | all tasks |
| 2 | 1 | 3-14 |
| 3 | 2 | 4-14 |
| 4 | 3 | 6-11 |
| 5 | 3 | 6-11 |
| 6 | 4,5 | 12 |
| 7 | 4,5 | 12 |
| 8 | 4,5 | 12 |
| 9 | 6-8 | 13 |
| 10 | 6-8 | 13 |
| 11 | 6-8 | 13 |
| 12 | 6-8 | 14 |
| 13 | 9-11 | 14 |
| 14 | 12,13 | Final Verification |

### Agent Dispatch Summary
| Wave | Task Count | Categories | Skills |
|---|---:|---|---|
| 0 | 1 | `quick` / git orchestration | `git-master`, `gitnexus-impact-analysis` |
| 1 | 2 | `visual-engineering`, `deep` | `ui-ux-pro-max`, `git-master` |
| 2 | 2 | `deep`, `visual-engineering` | `ui-ux-pro-max`, `gitnexus-impact-analysis` |
| 3 | 3 | `visual-engineering` parallel streams | `ui-ux-pro-max`, `playwright` |
| 4 | 3 | `visual-engineering` parallel streams | `ui-ux-pro-max`, `playwright` |
| 5 | 3 | `unspecified-high`, `oracle` review gates | `git-master`, `playwright`, `gitnexus-impact-analysis` |

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Establish clean git, PR, and worktree baseline

  **What to do**: Verify trunk branch, remote/PR capability, current dirty state, and safe worktree root. Document exact target trunk branch (`main` unless repo says otherwise). If `git remote -v` or `gh auth status` fails, stop before implementation and ask user to configure PR access. Create `.sisyphus/evidence/frontend-rewrite/git-baseline.md` with branch/remotes/status/worktree root.
  **Must NOT do**: Do not change git config. Do not clean/stash/commit unrelated files without user approval. Do not start UI implementation.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: deterministic git/protocol setup.
  - Skills: `git-master`, `gitnexus-impact-analysis` - Git safety and compare-scope planning.
  - Omitted: `ui-ux-pro-max` - no design decision in this task.

  **Parallelization**: Can Parallel: NO | Wave 0 | Blocks: all tasks | Blocked By: none

  **References**:
  - Repo root: `C:\project\AgentHub` - current working tree.
  - Existing branch observed: `task/agenthub-mvp-git-remediation`.
  - Git policy: user requires worktree parallelism + phase PR + review + merge.

  **Acceptance Criteria**:
  - [ ] `git status --short` captured in evidence.
  - [ ] `git remote -v` captured; if empty, task stops with explicit user action required.
  - [ ] `gh auth status` captured or documented unavailable.
  - [ ] Worktree parent path verified with `Test-Path -LiteralPath "C:\project"`.

  **QA Scenarios**:
  ```
  Scenario: PR-ready repo
    Tool: Bash
    Steps: Run `git status --short`, `git branch --show-current`, `git remote -v`, `gh auth status`.
    Expected: Commands succeed or produce a documented blocking reason; no files modified except evidence.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-1-git-baseline.md

  Scenario: Missing remote/gh
    Tool: Bash
    Steps: If remote or gh auth is missing, record exact output and stop before creating branches.
    Expected: No implementation branch/worktree created; user-facing blocker recorded.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-1-pr-blocker.md
  ```

  **Commit**: NO | Message: N/A | Files: evidence only if project policy tracks `.sisyphus/evidence/**`

- [x] 2. Lock the ui-ux-pro-max dual-theme design system, four-column IA, and selector contract

  **What to do**: On phase branch `redesign/phase-1-foundation`, use `ui-ux-pro-max` as the sole design authority. Convert the selected **dual-theme enterprise workbench** into a web-local source of truth in `apps/web/src/styles/tokens.css` and, if needed, a new `apps/web/src/styles/visual-system.css`. Define paired light/dark palettes, spacing, elevation, z-index, motion, focus, typography stack, icon policy, selector policy, and four-column IA contract. Pin Vite `build.target` if not already explicit. Create a selector migration table for existing E2E selectors.
  **Must NOT do**: Do not import remote fonts. Do not add dependencies. Do not edit backend/non-web files. Do not start component rewrites before design rules are committed.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: visual-system decisions and CSS architecture.
  - Skills: `ui-ux-pro-max`, `git-master` - Primary design guidance plus branch hygiene.
  - Omitted: `playwright` - only baseline selector review, no UI flows yet.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 3-14 | Blocked By: 1

  **References**:
  - Token file: `apps/web/src/styles/tokens.css:1` - existing `--ah-*` contract.
  - Theme hook: `apps/web/src/hooks/useTheme.ts` - preserve `html[data-theme]` and `html[data-density]` semantics.
  - ui-ux-pro-max output: OLED palette `#020617`, `#0F172A`, `#1E293B`, `#F8FAFC`, `#22C55E`; enterprise workbench guidance for active nav, skip links, keyboard order, and light-mode contrast.
  - Tests: `apps/web/e2e/*.spec.ts` - classify selectors.

  **Acceptance Criteria**:
  - [ ] New design system is encoded in CSS variables, not prose only.
  - [ ] Light and dark themes each define complete background/surface/text/border/accent/elevation tokens.
  - [ ] Four-column IA is documented with target widths, collapse behavior, and future feature slots.
  - [ ] `prefers-reduced-motion` remains supported.
  - [ ] Z-index scale documented and used; no arbitrary `9999` values.
  - [ ] Selector policy says ARIA/data-testid for UI controls; text selectors only fixture data.
  - [ ] `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd --filter @agenthub/web build` pass.

  **QA Scenarios**:
  ```
  Scenario: Design tokens compile
    Tool: Bash
    Steps: Run `pnpm.cmd --filter @agenthub/web build` after CSS/token updates.
    Expected: Build succeeds without CSS/import errors and no new dependency install.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-2-build.log

  Scenario: Selector policy catches brittle labels
    Tool: Bash
    Steps: Inspect selector map and grep E2E files for UI-label text selectors listed as migrated.
    Expected: Every brittle UI-label text selector has an assigned replacement selector.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-2-selector-map.md
  ```

  **Commit**: YES | Message: `feat(web): establish dual-theme workbench design system` | Files: `apps/web/src/styles/**`, `apps/web/vite.config.ts` if target pinned, selector evidence

- [ ] 3. Phase 1 Oracle review and PR gate

  **What to do**: After Task 2, run full checks, GitNexus compare, and Oracle review for phase 1. Oracle must verify scope, design consistency with `ui-ux-pro-max`, no backend changes, no new dependency, and selector policy completeness. If PASS, open PR for `redesign/phase-1-foundation` to trunk. Merge only after review completes.
  **Must NOT do**: Do not begin phase 2 before PR merge. Do not merge without Oracle PASS.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: gate orchestration and review evidence.
  - Skills: `git-master`, `gitnexus-impact-analysis` - PR hygiene and blast-radius confirmation.
  - Omitted: `ui-ux-pro-max` - Oracle checks design consistency independently.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 4-14 | Blocked By: 2

  **References**:
  - Phase branch: `redesign/phase-1-foundation`.
  - Oracle prompt must include this plan path and phase diff summary.
  - GitNexus: compare against trunk with `gitnexus_detect_changes(scope="compare", base_ref="main")`.

  **Acceptance Criteria**:
  - [ ] Oracle returns PASS or all findings are fixed and re-reviewed.
  - [ ] Phase PR exists and is merged before next phase starts.
  - [ ] No files outside `apps/web/**` and allowed evidence/plan files in phase diff.

  **QA Scenarios**:
  ```
  Scenario: Oracle phase gate
    Tool: Task/oracle + Bash
    Steps: Ask Oracle to review phase 1 branch against plan constraints, then run typecheck/lint/build.
    Expected: Oracle PASS and all commands exit 0.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-3-oracle-phase-1.md

  Scenario: PR gate blocks on scope drift
    Tool: GitNexus + Bash
    Steps: Run compare scope check before PR.
    Expected: Any backend/non-web changes cause stop/fix before PR.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-3-scope.md
  ```

  **Commit**: YES | Message: `chore(web): record phase 1 review evidence` | Files: evidence only if tracked by project policy

- [x] 4. Introduce web-local interaction controller with unit tests

  **What to do**: On `redesign/phase-2-core-shell`, run GitNexus impact for `App` before modifying `App.tsx`. Extract only shell/application state from `App.tsx` into a web-local reducer/controller (example target: `apps/web/src/state/appController.ts` and `apps/web/src/state/appController.test.ts`). Include selected room/run, side-panel tab, collapsed panels, command palette, keymap modal, and edit/error state. Keep quote/draft persistence in `InputBox` unless refactoring is explicitly necessary. Wire `App.tsx` to the controller without changing hook contracts.
  **Must NOT do**: Do not move `useProjector`, `useSdk`, or `useTheme` behavior. Do not introduce Zustand/Redux/router. Do not alter daemon endpoint payloads.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: state-machine extraction with regression risk.
  - Skills: `gitnexus-impact-analysis`, `git-master` - Required impact analysis and safe branch work.
  - Omitted: `ui-ux-pro-max` - behavior/state task, not visual design.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 6-11 | Blocked By: 3 | Worktree: `C:\project\AgentHub-worktrees\phase-2-controller`

  **References**:
  - `apps/web/src/App.tsx:17` - current central controller.
  - `apps/web/src/App.tsx:35` - room selection clears run detail and edit state.
  - `apps/web/src/App.tsx:124` - global shortcuts.
  - `apps/web/src/App.tsx:200` - quote behavior via sessionStorage event.

  **Acceptance Criteria**:
  - [ ] `App.tsx` still composes the same hooks and surfaces.
  - [ ] Unit tests cover room select, run open/close, palette/keymap mutual exclusion, `g r`, `g d`, pending edit clear, and quote non-regression if touched.
  - [ ] `pnpm.cmd --filter @agenthub/web test` passes and no longer relies on `--passWithNoTests` only.
  - [ ] Full typecheck/lint/build pass.

  **QA Scenarios**:
  ```
  Scenario: Controller keyboard state
    Tool: Bash
    Steps: Run Vitest for `appController.test.ts`.
    Expected: Cmd/Ctrl+K toggles command palette and closes keymap; ? toggles keymap and closes palette; g d opens debug panel.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-4-controller-test.log

  Scenario: Room switch clears transient state
    Tool: Bash
    Steps: Run reducer test selecting room A/run X/edit state then selecting room B.
    Expected: activeRunId and editingPendingTurn clear; selected room becomes B.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-4-room-switch.log
  ```

  **Commit**: YES | Message: `refactor(web): extract app interaction controller` | Files: `apps/web/src/App.tsx`, `apps/web/src/state/**`, web test config only if needed

- [x] 5. Rewrite shell primitives and four-column Layout without changing data flow

  **What to do**: In a separate phase-2 worktree, create reusable UI primitives and shell components for the dual-theme enterprise workbench (buttons, panels, badges, tabs, status indicators, empty states, feature rail items, focus/skip link). Rewrite `Layout.tsx` from the old three-zone shell into a four-column shell while preserving data flow through props/adapters: left room/group list, feature rail, central chat canvas, right information workbench, plus overlay layer. Add skip-to-main and stable ARIA landmarks.
  **Must NOT do**: Do not touch `App.tsx` controller files owned by Task 4 except through merge coordination. Do not change data hooks. Do not add dependency/icon package; use inline SVG/CSS.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: shell/UI primitives and visual quality.
  - Skills: `ui-ux-pro-max`, `playwright`, `git-master` - Design authority plus hands-on shell QA.
  - Omitted: `gitnexus-refactoring` - no symbol rename intended.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 6-11 | Blocked By: 3 | Worktree: `C:\project\AgentHub-worktrees\phase-2-shell`

  **References**:
  - `apps/web/src/components/Layout.tsx` - persistent chrome boundary; expand from left/center/right/overlay to room list + feature rail + center + right workbench + overlay.
  - `apps/web/src/styles/tokens.css:104` - existing z-index scale.
  - ui-ux-pro-max UX: focus states, skip link, z-index, transform/opacity motion.

  **Acceptance Criteria**:
  - [ ] Layout exposes a clear four-column contract while keeping `App.tsx` integration straightforward.
  - [ ] Feature rail has reserved non-functional slots for Kanban and Workflow marked disabled/coming-soon without implying backend support.
  - [ ] Light/dark theme switch visibly affects all four columns correctly.
  - [ ] Main content has semantic landmark and skip link.
  - [ ] Collapsed panels remain keyboard-operable.
  - [ ] No emoji icons.
  - [ ] `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd --filter @agenthub/web build` pass.

  **QA Scenarios**:
  ```
  Scenario: Shell keyboard access
    Tool: Playwright
    Steps: Load app, Tab from top, activate skip link, toggle left/right collapse controls by keyboard.
    Expected: Focus visible; skip link moves to main; collapse state changes without console errors.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-5-shell-keyboard.png

  Scenario: Reduced motion shell
    Tool: Playwright
    Steps: Emulate `prefers-reduced-motion: reduce`, load app, toggle panels.
    Expected: No long decorative animation; layout remains usable.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-5-reduced-motion.png
  ```

  **Commit**: YES | Message: `feat(web): rebuild dual-theme four-column shell` | Files: `apps/web/src/components/Layout.tsx`, `apps/web/src/components/ui/**`, `apps/web/src/styles/**`

- [x] 6. Rewrite HomeView and RoomList stream

  **What to do**: In `phase-3-room-home` worktree, rewrite `HomeView.tsx` and `RoomList.tsx` for the new product workbench IA: room/group list as the leftmost column, operational overview, recent rooms, active runs, unread/pending status, create-room CTA, and room search/filter if implemented without backend changes. Preserve `onCreateRoom`, `onSelectRoom`, room view model contract, and existing unread/pending semantics. Update E2E selectors for home/room list.
  **Must NOT do**: Do not modify `ChatStream`, `InputBox`, or side/run detail files in this stream. Do not introduce new room modes or backend features.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: user-facing dashboard/list redesign.
  - Skills: `ui-ux-pro-max`, `playwright`, `git-master` - Design, E2E, worktree hygiene.
  - Omitted: `gitnexus-refactoring` - no rename planned.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 12 | Blocked By: 4,5 | Worktree: `C:\project\AgentHub-worktrees\phase-3-room-home`

  **References**:
  - `apps/web/src/components/HomeView.tsx` - current dashboard.
  - `apps/web/src/components/RoomList.tsx` - current room selector.
  - `apps/web/src/types.ts` - `RoomViewModel` contract.
  - E2E: `apps/web/e2e/main-detail-projection.spec.ts`, `apps/web/e2e/v05-chatroom-features.spec.ts`.

  **Acceptance Criteria**:
  - [ ] Empty/no-room state is a real product workbench dashboard, not a placeholder.
  - [ ] Room/group list visually reads as the persistent leftmost collaboration list.
  - [ ] Create-room button remains available and selector-stable.
  - [ ] Selecting a room still clears run detail through controller.
  - [ ] Room load perf ≤500ms remains passing.
  - [ ] Updated Playwright tests avoid UI-label text selectors.

  **QA Scenarios**:
  ```
  Scenario: Create and select room
    Tool: Playwright
    Steps: Load app, activate New Room, wait for created room, select it from RoomList.
    Expected: Chat surface opens for selected room; no run detail overlay remains open.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-6-create-room.png

  Scenario: Room status indicators
    Tool: Playwright
    Steps: Seed room with active run/unread/pending data via existing test harness and load room list.
    Expected: Status indicators render using stable data-testid/ARIA labels and no emoji UI icons.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-6-room-status.png
  ```

  **Commit**: YES | Message: `feat(web): redesign home and room navigation` | Files: `apps/web/src/components/HomeView.tsx`, `apps/web/src/components/RoomList.tsx`, related E2E

- [ ] 7. Rewrite ChatStream, InputBox, PendingTurnList stream

  **What to do**: In `phase-3-chat-composer` worktree, rewrite central chat experience and composer as the main work canvas in the four-column workbench. Preserve virtualized message rendering, run brief entry, quote behavior, attachment payload mapping, mentions popover, pending-turn edit/cancel, disabled/offline states, and draft persistence. Update E2E for mention, pending turn, quote, send, offline/error states.
  **Must NOT do**: Do not alter backend message payload shape or `useSdk`. Do not remove virtualization. Do not touch RoomList/HomeView stream files.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: highest-value user-facing flow.
  - Skills: `ui-ux-pro-max`, `playwright`, `gitnexus-impact-analysis` - Design, E2E, behavior impact.
  - Omitted: `gitnexus-refactoring` - no broad rename planned.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 12 | Blocked By: 4,5 | Worktree: `C:\project\AgentHub-worktrees\phase-3-chat-composer`

  **References**:
  - `apps/web/src/components/ChatStream.tsx` - virtualized timeline and run detail entry.
  - `apps/web/src/components/InputBox.tsx` - composer, mentions, attachments, draft persistence.
  - `apps/web/src/components/PendingTurnList.tsx` - pending queue controls.
  - `apps/web/src/App.tsx:61` - send/PATCH behavior.
  - `apps/web/e2e/v05-chatroom-features.spec.ts:31` - mention flow.
  - `apps/web/e2e/v05-chatroom-features.spec.ts:93` - pending turn flow.

  **Acceptance Criteria**:
  - [ ] Sending a normal message still calls existing SDK path.
  - [ ] Editing pending turn still PATCHes `/messages/{id}` and handles 409 with same user-facing meaning.
  - [ ] Quote insertion still persists through sessionStorage event behavior or an equivalent contract-preserving adapter.
  - [ ] Delta frame p95 ≤16ms remains passing.
  - [ ] Dynamic run/message updates include appropriate ARIA live region where useful.

  **QA Scenarios**:
  ```
  Scenario: Mention and send
    Tool: Playwright
    Steps: Seed participant, type @sec, choose candidate, send message.
    Expected: Mention chip/text appears, send succeeds, message renders in timeline.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-7-mention-send.png

  Scenario: Pending edit conflict
    Tool: Playwright
    Steps: Seed pending turn, click edit, simulate/trigger 409 on PATCH if harness supports it.
    Expected: Composer shows clear conflict error and remains usable; no stale pending edit after cancel.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-7-pending-conflict.png
  ```

  **Commit**: YES | Message: `feat(web): redesign chat stream and composer` | Files: `apps/web/src/components/ChatStream.tsx`, `InputBox.tsx`, `PendingTurnList.tsx`, related tests

- [x] 8. Rewrite live data status and error/offline UX stream

  **What to do**: In `phase-3-live-status` worktree, create cohesive connected/reconnecting/offline/error UI for SSE and write actions across shell/chat/composer. Preserve `useProjector` connection statuses and existing offline disable semantics. Add ARIA live announcements for connection status changes. Update E2E or unit tests for disconnected/offline visual behavior.
  **Must NOT do**: Do not alter `Projector.connect/disconnect/apply` behavior unless a defect is proven and impact-reviewed. Do not change reconnect retry constants.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: cross-surface UX state design.
  - Skills: `ui-ux-pro-max`, `playwright`, `gitnexus-impact-analysis` - Design, E2E, SSE risk review.
  - Omitted: `gitnexus-refactoring` - no symbol move planned.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 12 | Blocked By: 4,5 | Worktree: `C:\project\AgentHub-worktrees\phase-3-live-status`

  **References**:
  - `apps/web/src/hooks/useProjector.ts:28` - connection status model.
  - `apps/web/src/hooks/useProjector.ts:77` - reconnect/offline transition.
  - `apps/web/src/App.tsx:122` - offline disabled state.
  - `apps/web/src/components/Layout.tsx` - shell connection display.

  **Acceptance Criteria**:
  - [ ] Connected/reconnecting/offline states are visible, accessible, and consistent.
  - [ ] Offline composer disabled state remains enforced.
  - [ ] Screen reader announcement exists for status changes.
  - [ ] No EventSource lifecycle changes unless separately impact-reviewed.

  **QA Scenarios**:
  ```
  Scenario: Offline disables write path
    Tool: Playwright
    Steps: Simulate projector offline state through existing harness or controlled network failure; focus composer.
    Expected: Composer is disabled and status UI announces offline/reconnecting state.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-8-offline.png

  Scenario: Reconnect visual state
    Tool: Playwright
    Steps: Interrupt/recover event stream if harness supports it.
    Expected: UI transitions from reconnecting to connected without duplicate banners or console errors.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-8-reconnect.png
  ```

  **Commit**: YES | Message: `feat(web): unify live connection status ux` | Files: expected shared UI/status components and related tests only

- [x] 9. Rewrite SidePanel and RunDetail stream

  **What to do**: In `phase-4-detail-panels` worktree, rewrite `SidePanel.tsx`, `RunDetail.tsx`, and run detail cards into the right-side enterprise workbench information architecture. The right column should feel like a productized workspace: contextual panels, task/workflow previews, run intelligence, cost/debug observability, and future Kanban/workflow placeholders where appropriate. Preserve all existing tabs/data: context, tasks, members, debug, cost; run transcript, tools, context, permissions, artifacts, raw, cost. Preserve terminal modal/search/copy behavior. Document overlay z-index order.
  **Must NOT do**: Do not alter artifact or permission endpoint contracts. Do not remove any existing tab capability. Do not touch CommandPalette stream files.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: dense information display redesign.
  - Skills: `ui-ux-pro-max`, `playwright`, `gitnexus-impact-analysis` - Design, E2E, route/contract safety.
  - Omitted: none.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 13 | Blocked By: 6-8 | Worktree: `C:\project\AgentHub-worktrees\phase-4-detail-panels`

  **References**:
  - `apps/web/src/components/SidePanel.tsx` - contextual right panel.
  - `apps/web/src/components/RunDetail.tsx` - run overlay and tabs.
  - `apps/web/src/components/cards/TerminalCard.tsx` - modal/search/copy behavior.
  - `apps/web/e2e/v05-chatroom-features.spec.ts:179` - terminal modal flow.

  **Acceptance Criteria**:
  - [ ] Every existing tab remains reachable by keyboard and pointer.
  - [ ] Right side reads as an enterprise workbench panel area, not a temporary debug drawer.
  - [ ] Future Kanban/workflow affordances are visual placeholders only and do not call non-existent APIs.
  - [ ] Run detail opens from brief card and closes without losing selected room.
  - [ ] Terminal modal search/copy still works.
  - [ ] Overlay stack order documented and implemented with tokenized z-index.

  **QA Scenarios**:
  ```
  Scenario: Run detail tabs
    Tool: Playwright
    Steps: Seed run data, open run detail, navigate every tab by keyboard.
    Expected: Correct tab panels show; focus remains inside overlay until close; room remains selected after close.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-9-run-tabs.png

  Scenario: Terminal modal
    Tool: Playwright
    Steps: Open terminal artifact, search text, copy output, close modal.
    Expected: Search highlights/filter works, copy control succeeds or reports browser-denied state gracefully, modal closes.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-9-terminal.png
  ```

  **Commit**: YES | Message: `feat(web): redesign side panel and run detail` | Files: `apps/web/src/components/SidePanel.tsx`, `RunDetail.tsx`, `components/cards/**`, related tests

- [x] 10. Rewrite CommandPalette and KeymapModal stream

  **What to do**: In `phase-4-command-keymap` worktree, rewrite `CommandPalette.tsx` and `KeymapModal.tsx` with proper focus trap, stable shortcuts, virtualized results, and mission-control command styling. Preserve `Ctrl/Cmd+K`, `?`, theme/density actions, room/run actions, and keyboard selection. Add/adjust E2E for focus trap and escape behavior.
  **Must NOT do**: Do not remove virtualization. Do not change shortcut meanings. Do not make command search depend on backend.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: keyboard-first UX and visual redesign.
  - Skills: `ui-ux-pro-max`, `playwright` - Design and hands-on keyboard QA.
  - Omitted: `gitnexus-refactoring` - no rename intended.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 13 | Blocked By: 6-8 | Worktree: `C:\project\AgentHub-worktrees\phase-4-command-keymap`

  **References**:
  - `apps/web/src/components/CommandPalette.tsx` - global actions/results.
  - `apps/web/src/components/KeymapModal.tsx` - shortcut reference.
  - `apps/web/src/App.tsx:131` - `Ctrl/Cmd+K` behavior.
  - `apps/web/src/App.tsx:140` - `?` behavior.

  **Acceptance Criteria**:
  - [ ] Palette opens/closes with keyboard and no focus leak.
  - [ ] Escape closes palette/modal and returns focus to prior element when possible.
  - [ ] Theme/density commands still call `useTheme` setters.
  - [ ] Virtualized list still handles large room/run sets.

  **QA Scenarios**:
  ```
  Scenario: Command palette keyboard loop
    Tool: Playwright
    Steps: Press Ctrl/Cmd+K, type query, ArrowDown, Enter, Escape.
    Expected: Focus stays in palette while open; selection runs expected action; Escape closes.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-10-command-keyboard.png

  Scenario: Keymap modal focus trap
    Tool: Playwright
    Steps: Press ?, Tab through modal controls, Shift+Tab backward, Escape.
    Expected: Focus remains trapped while open and returns after close.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-10-keymap-focus.png
  ```

  **Commit**: YES | Message: `feat(web): redesign command palette and keymap` | Files: `apps/web/src/components/CommandPalette.tsx`, `KeymapModal.tsx`, related tests

- [x] 11. Rewrite responsive, accessibility, and visual polish stream

  **What to do**: In `phase-4-polish-a11y` worktree, perform the bounded polish pass: responsive breakpoints 375/768/1024/1440, four-column collapse behavior, focus states, contrast in both themes, hover/cursor states, reduced motion, loading/skeletons, empty/error states, and no-horizontal-scroll checks. This task may touch CSS and shared primitives only; component-specific behavior belongs to Tasks 9-10 unless coordinated.
  **Must NOT do**: Do not add new product features. Do not rewrite business logic. Do not change endpoint/hook behavior.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: detail polish and accessibility.
  - Skills: `ui-ux-pro-max`, `playwright` - Design checklist and browser verification.
  - Omitted: `gitnexus-refactoring` - no refactor needed.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: 13 | Blocked By: 6-8 | Worktree: `C:\project\AgentHub-worktrees\phase-4-polish-a11y`

  **References**:
  - `apps/web/src/styles/tokens.css` - focus, reduced motion, scrollbars, theme/density.
  - `apps/web/e2e/a11y.spec.ts` - accessibility baseline.
  - ui-ux-pro-max checklist: no emoji icons, cursor pointer, contrast, focus, responsive.

  **Acceptance Criteria**:
  - [ ] No horizontal scroll at 375px, 768px, 1024px, 1440px.
  - [ ] Four-column layout has defined responsive collapse behavior at each breakpoint.
  - [ ] Visible focus on all interactive controls.
  - [ ] Light and dark theme contrast each meet 4.5:1 for normal text.
  - [ ] `prefers-reduced-motion` respected.
  - [ ] `apps/web/e2e/a11y.spec.ts` passes.

  **QA Scenarios**:
  ```
  Scenario: Responsive breakpoints
    Tool: Playwright
    Steps: Capture core app at 375, 768, 1024, 1440 widths.
    Expected: No horizontal scroll, controls remain reachable, no content hidden under fixed chrome.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-11-responsive.png

  Scenario: Accessibility pass
    Tool: Bash + Playwright
    Steps: Run a11y E2E and manual keyboard tab sweep on main surfaces.
    Expected: No critical violations; all controls focusable and labelled.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-11-a11y.json
  ```

  **Commit**: YES | Message: `fix(web): polish responsive and accessible states` | Files: `apps/web/src/styles/**`, `apps/web/src/components/ui/**`, related a11y tests

- [ ] 12. Phase 3 integration, Oracle review, and PR gate

  **What to do**: Merge Tasks 6-8 stream branches into `redesign/phase-3-core-surfaces`, resolve conflicts, run full checks, run performance E2E, run GitNexus compare, and request Oracle review. Open PR only after Oracle PASS; merge only after review.
  **Must NOT do**: Do not start phase 4 before phase 3 PR merge. Do not squash individual stream branches before Oracle review; preserve stream history into phase branch.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: integration, test, PR gate.
  - Skills: `git-master`, `gitnexus-impact-analysis`, `playwright` - Merge hygiene, blast-radius, E2E.
  - Omitted: `ui-ux-pro-max` - design should already be implemented; Oracle validates consistency.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: 13-14 | Blocked By: 6-8

  **References**:
  - Phase branch: `redesign/phase-3-core-surfaces`.
  - E2E: `apps/web/e2e/main-detail-projection.spec.ts`, `pending-turn.spec.ts`, `v05-chatroom-features.spec.ts`, `perf.spec.ts`.

  **Acceptance Criteria**:
  - [ ] `pnpm.cmd typecheck && pnpm.cmd lint && pnpm.cmd --filter @agenthub/web test && pnpm.cmd test:e2e` all pass.
  - [ ] `perf.spec.ts` thresholds pass.
  - [ ] Oracle PASS captured.
  - [ ] PR merged before phase 4 begins.

  **QA Scenarios**:
  ```
  Scenario: Core surface regression
    Tool: Bash
    Steps: Run full web unit/e2e suite after stream integration.
    Expected: All tests pass including pending-turn, mention, room selection, perf.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-12-core-regression.log

  Scenario: Oracle core review
    Tool: Task/oracle
    Steps: Oracle reviews phase 3 diff against contract preservation, UI direction, and tests.
    Expected: PASS or concrete fixes completed before PR.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-12-oracle.md
  ```

  **Commit**: YES | Message: `chore(web): integrate core surface redesign` | Files: integration commits/evidence

- [x] 13. Phase 4 integration, Oracle review, and PR gate

  **What to do**: Merge Tasks 9-11 stream branches into `redesign/phase-4-secondary-surfaces`, resolve conflicts, run full checks/perf/a11y, run GitNexus compare, and request Oracle review. Open PR only after Oracle PASS; merge only after review.
  **Must NOT do**: Do not start final phase before phase 4 PR merge. Do not broaden scope into backend or protocol changes.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: integration and gatekeeping.
  - Skills: `git-master`, `gitnexus-impact-analysis`, `playwright` - Safe merge and verification.
  - Omitted: none.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: 14 | Blocked By: 9-11,12

  **References**:
  - Phase branch: `redesign/phase-4-secondary-surfaces`.
  - Components: `SidePanel`, `RunDetail`, `CommandPalette`, `KeymapModal`, shared primitives.

  **Acceptance Criteria**:
  - [ ] Full verification commands pass.
  - [ ] Oracle PASS captured.
  - [ ] PR merged before Task 14 begins.
  - [ ] Worktrees for phase 4 streams removed after merge.

  **QA Scenarios**:
  ```
  Scenario: Secondary surface regression
    Tool: Bash + Playwright
    Steps: Run E2E for run detail, terminal modal, command palette, keymap, side-panel tabs.
    Expected: All pass with stable selectors and no console errors.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-13-secondary-regression.log

  Scenario: Worktree cleanup
    Tool: Bash
    Steps: Run `git worktree list` after phase merge and cleanup.
    Expected: No stale phase-4 worktrees remain.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-13-worktrees.md
  ```

  **Commit**: YES | Message: `chore(web): integrate secondary surface redesign` | Files: integration commits/evidence

- [x] 14. Final frontend rewrite hardening and release PR gate

  **What to do**: On `redesign/phase-5-final-hardening`, perform final cross-surface QA and only fix defects found by checks/reviews. Verify no backend/non-web changes, no unapproved dependencies, no text selectors for UI labels, no emoji icons, no remote font imports, no route/global-state introduction, no dark-only implementation, no broken light theme, and no performance regression. Run final Oracle review and create final PR if any hardening changes exist.
  **Must NOT do**: Do not add new features. Do not re-open aesthetic direction. Do not change design-system decisions without user approval.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: release hardening across the full rewritten web app.
  - Skills: `ui-ux-pro-max`, `git-master`, `playwright`, `gitnexus-impact-analysis` - Design checklist, git, browser QA, scope check.
  - Omitted: none.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: Final Verification | Blocked By: 13

  **References**:
  - Entire `apps/web/**` diff from trunk.
  - ui-ux-pro-max pre-delivery checklist.
  - GitNexus compare scope check.

  **Acceptance Criteria**:
  - [ ] `pnpm.cmd typecheck` passes.
  - [ ] `pnpm.cmd lint` passes.
  - [ ] `pnpm.cmd --filter @agenthub/web build` passes.
  - [ ] `pnpm.cmd --filter @agenthub/web test` passes.
  - [ ] `pnpm.cmd test:e2e` passes, including perf.
  - [ ] Oracle PASS captured.
  - [ ] Final PR merged or no-op documented if no hardening changes.

  **QA Scenarios**:
  ```
  Scenario: Full regression
    Tool: Bash
    Steps: Run typecheck, lint, web test, web build, full E2E.
    Expected: All commands exit 0; perf thresholds pass.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-14-full-regression.log

  Scenario: Scope and visual checklist
    Tool: Bash + Playwright + GitNexus
    Steps: Run scope compare, capture main surfaces in light/dark/density states, verify no emoji/remote font/new deps, verify four-column layout and right workbench.
    Expected: Scope limited to approved files; visual checklist passes.
    Evidence: .sisyphus/evidence/frontend-rewrite/task-14-release-checklist.md
  ```

  **Commit**: YES | Message: `chore(web): harden frontend rewrite release` | Files: defect fixes/evidence only

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Commit per stream with scoped messages.
- Merge streams into phase integration branch without squash for Oracle traceability.
- Phase PR to trunk after Oracle PASS.
- Prefer squash merge for phase PR unless repository policy says otherwise.
- Never force-push trunk; never skip hooks; never commit unrelated local skill installs/drafts.
- If PR infrastructure is unavailable, stop at phase gate and ask user; do not substitute direct trunk merge silently.

## Success Criteria
- The product no longer looks like the current UI: it has a coherent dual-theme enterprise workbench identity from `ui-ux-pro-max`.
- Users can switch between a polished light enterprise workspace and a dark mission-control/operator console.
- The main shell is a future-ready four-column product workspace: room/group list, feature rail, chat canvas, right information workbench.
- All existing AgentHub web capabilities remain discoverable and usable.
- The daemon contract and all critical frontend behaviors remain intact.
- Tests are stronger than before: controller unit tests exist and E2E selectors are less brittle.
- Every phase has Oracle review evidence and PR review/merge record.
- Final user-facing QA demonstrates the rewrite in browser at required breakpoints with no console errors, no a11y-critical issues, and no perf regression.
