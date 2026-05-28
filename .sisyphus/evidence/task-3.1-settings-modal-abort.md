# Task 3.1 Settings Modal Abort Evidence

## Implementation

- `SettingsModal` creates a fresh `AbortController` for each open cycle.
- The same abort signal is passed to all four bootstrap requests.
- Closing the modal or unmounting aborts the controller, clears local data, clears errors, and resets status to idle.
- Reopening starts a new REST bootstrap cycle.

## Verification

- `apps/web/src/components/settings/SettingsModal.test.ts` verifies that every pending request receives the same abort signal and that aborting rejects with `AbortError`.
- `pnpm.cmd test -- apps/web`: passed.
  - Test Files: 40 passed.
  - Tests: 310 passed, 1 skipped.

## No SSE

- The settings implementation imports no projector hooks and creates no `EventSource`.
- The REST bootstrap test installs an `EventSource` spy and confirms it is not called.
