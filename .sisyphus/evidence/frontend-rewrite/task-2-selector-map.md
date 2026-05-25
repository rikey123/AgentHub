# E2E Selector Migration Map

## Policy
- STABLE (keep): [data-testid="..."], [role="..."][aria-label="..."], getByRole(...)
- MIGRATE: text= selectors for UI labels → replace with data-testid or ARIA
- KEEP AS-IS: text= selectors for fixture/test-data content (room names, message text)

## Stable Selectors (no change needed)
| Selector | File | Status |
|---|---|---|
| [data-testid="brief-card"] | a11y, main-detail, v05 | STABLE |
| [data-testid="run-detail-tab-*"] | main-detail, v05 | STABLE |
| [data-testid="run-detail-tabs"] | main-detail | STABLE |
| [data-testid="raw-stream-content"] | main-detail | STABLE |
| [data-testid="message-input"] | v05 | STABLE |
| [data-testid="mention-candidate-*"] | v05 | STABLE |
| [data-testid="pending-turn-edit-*"] | v05 | STABLE |
| [data-testid="pending-turn-cancel-*"] | v05 | STABLE |
| [data-testid="terminal-modal"] | v05 | STABLE |
| [data-testid="terminal-search"] | v05 | STABLE |
| [data-testid="terminal-copy"] | v05 | STABLE |
| [data-testid="side-panel-tab-cost"] | v05 | STABLE |
| [data-testid="cost-time-7d"] | v05 | STABLE |
| [data-testid="cost-group-agent"] | v05 | STABLE |
| [data-testid="message-menu-*"] | v05 | STABLE |
| [role='dialog'][aria-label='Command palette'] | a11y | STABLE |
| [aria-label='Close run detail'] | main-detail | STABLE |
| getByRole("button", { name: /new room/i }) | main-detail | STABLE |
| getByRole("button", { name: "Send" }) | main-detail | STABLE |

## Text Selectors — Fixture Data (keep as-is, these are test room/message names)
| Selector | File | Reason |
|---|---|---|
| text=A11y Room | a11y | fixture room name |
| text=A11y Settings Room | a11y | fixture room name |
| text=A11y Run Detail Room | a11y | fixture room name |
| text=Test Room | main-detail | fixture room name |
| text=Run Room | main-detail | fixture room name |
| text=Raw Room | main-detail | fixture room name |
| text=New Room | main-detail | fixture room name (created by test) |
| text=Limit Room | pending-turn | fixture room name |
| text=Perf Room A | perf | fixture room name |
| text=hello | main-detail | fixture message content |
| text=browser csrf hello | main-detail | fixture message content |
| text=trigger run | main-detail | fixture message content |
| text=trigger raw | main-detail | fixture message content |
| text=trigger run for a11y | a11y | fixture message content |
| text=accessibility test message | a11y | fixture message content |
| text=live raw stdout line | main-detail | fixture stream content |
| text=live raw stderr line | main-detail | fixture stream content |
| text=message 99 | perf | fixture message content |

## Text Selectors — UI Labels (MIGRATE in component rewrites)
| Current Selector | File | Replacement Target |
|---|---|---|
| text=Run Detail | main-detail | [data-testid="run-detail-panel"] or aria-label |
| text=Queue limit reached | pending-turn | [data-testid="queue-limit-banner"] |
| text=queued (1) | pending-turn | [data-testid="pending-turn-count"] |
| text=Cancel | pending-turn | [data-testid="pending-turn-cancel-*"] (already exists) |
| text=tool_call | main-detail | [data-testid="tool-call-item"] |
