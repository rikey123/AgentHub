## Task 2.2 — NativeAgentAdapter cancellation

- Implemented active-run abort tracking via `AbortController` in `NativeAgentAdapter`.
- `cancelManagedRun(runId)` aborts the live stream and finalizes the run as cancelled through `RunLifecycleService`.
- Verified cancellation behavior in unit tests.
