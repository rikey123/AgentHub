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
- Unified live connection UX now flows through App -> Layout -> ChatStream -> InputBox using the existing projector status model only; no new statuses were introduced.
- The shell header now acts as the primary status chip, while chat adds a secondary status callout and SR-only announcement for reconnect/offline/disconnected states.
- Offline write-path disabling remains preserved by keeping the composer disabled whenever connectionStatus !== "connected".
- Added a shared SR-only utility stylesheet in src/styles/a11y.css and imported it from main.tsx so live announcements can stay visually hidden but accessible.
- The workspace required pnpm install before validation because node_modules was absent in the worktree; after install, typecheck, lint, and web build all passed.

- T11 cleanup: reverted .sisyphus/evidence/v05-chatroom-complete/task-8-10-a11y/axe.json because Playwright axe evidence is unrelated to the bounded polish task and should not be churned by this branch. Kept token contrast adjustments only for WCAG failures found by apps/web/e2e/a11y.spec.ts.
