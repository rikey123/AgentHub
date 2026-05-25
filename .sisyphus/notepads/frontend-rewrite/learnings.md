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
