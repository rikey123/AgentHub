# Task 4.1 — room.delegate atomic failure

- Simulated WakeAgent enqueue failure returns `internal_error`.
- Task row is not persisted after the failure.
- Delegate-owned task events are not persisted after the failure.
