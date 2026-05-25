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
