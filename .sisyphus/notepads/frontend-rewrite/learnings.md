## [2026-05-25] Task 2: Design System Lock

### Token naming
- All --ah-* variable names PRESERVED. Do not rename.
- Light theme upgraded to enterprise workbench palette (slate-based).
- Dark theme upgraded to OLED mission-control palette (navy/slate-dark).
- New 4-col layout tokens added: --ah-col-rooms-width, --ah-col-rail-width, --ah-col-right-width.
- Typography stack tokens added: --ah-font-heading, --ah-font-body, --ah-font-mono (no remote import).

### Selector policy
- Stable data-testid selectors: must be preserved in all component rewrites.
- Text selectors for fixture data: keep as-is.
- UI label text selectors to migrate: "Run Detail", "Queue limit reached", "queued (1)", "Cancel", "tool_call".

### visual-system.css
- New file for layout contract, icon policy, selector policy, typography policy.
- Import after tokens.css in main.tsx.
- Contains: .ah-skip-link, .ah-rail-item, .ah-workbench-panel, body/heading/code font rules.
- Rebuilt pps/web/src/components/Layout.tsx into a four-column shell: rooms/groups, feature rail, chat canvas, and right workbench.
- Preserved the App.tsx Layout contract so existing panel/data flow stays straightforward; the left/right collapse props still drive the outer columns.
- Added a skip link, ARIA landmarks, and a ole=status connection indicator so the shell is keyboard- and screen-reader-friendly.
- Replaced emoji UI icons with inline SVG glyphs to match the no-emoji policy in the visual system.
- Theme handling now treats uto as a first-class state in the header toggle without assuming it can be flipped directly to another fixed theme.
- The reserved rail items are visual placeholders only, so future feature wiring can happen without changing shell structure.
- Redesigned HomeView as a dashboard-style workbench entry with summary stats, guidance cards, and stable create-room selectors while preserving room selection flow.
- Reworked RoomList into a persistent collaboration rail using room-item data-testid hooks so room selection tests no longer depend on label text.
- Updated room-home E2E assertions to use stable selectors; one cost-tab test needed the roomId captured explicitly after room creation.
- Initial typecheck failure was environment-related (@types/node/vitest/globals missing before pnpm install), not a source issue.

- Unified live connection UX now flows through App -> Layout -> ChatStream -> InputBox using the existing projector status model only; no new statuses were introduced.
- The shell header now acts as the primary status chip, while chat adds a secondary status callout and SR-only announcement for reconnect/offline/disconnected states.
- Offline write-path disabling remains preserved by keeping the composer disabled whenever connectionStatus !== "connected".
- Added a shared SR-only utility stylesheet in src/styles/a11y.css and imported it from main.tsx so live announcements can stay visually hidden but accessible.
- The workspace required pnpm install before validation because node_modules was absent in the worktree; after install, typecheck, lint, and web build all passed.

- 2026-05-25: Redesigned SidePanel and RunDetail into denser enterprise workbench panels using existing AgentHub tokens (Fira Code/Fira Sans, semantic accent/success/warning tokens, 4px spacing). Kept all existing tab keys, data-testid selectors, and the terminal artifact path untouched so search/copy/modal behavior stayed in TerminalCard.
- 2026-05-25: Right-side overlay still uses the Layout z-index contract (overlay below modal). Build verification passed after reinstalling workspace deps in the worktree; typecheck, lint, and @agenthub/web build all succeeded.

## [2026-05-25] Task 10: Command Palette + Keymap Modal

### Command palette
- Kept the existing shortcut semantics intact: Ctrl/Cmd+K, ?, room/run actions, and theme/density actions still resolve to the same callbacks.
- Reworked the dialog into a denser mission-control layout with search summary chips, section-like result rows, and stronger selection contrast.
- Preserved virtualization with @tanstack/react-virtual for the command list and kept keyboard navigation on the list itself.
- Added focus restoration on close, plus a more explicit keyboard loop for Tab, Shift+Tab, Escape, Home, End, and Enter.

### Keymap modal
- Added focus restoration and a lightweight focus trap so Escape and Tab stay inside the modal.
- Reframed the shortcut table into card-like sections with clearer hierarchy while keeping every shortcut label and meaning unchanged.
- Kept the modal close affordance keyboard accessible with a real button and stable aria-labelledby / aria-describedby wiring.

### Verification note
- Repo-wide typecheck/lint/build initially failed because the worktree was missing installed dependencies; installing the workspace is required before those checks can pass.
