# PF.6 mailbox attempt-count site

- File: `packages/orchestrator/src/mailbox-service.ts`
- Exact function: `MailboxService.claimUnread(tx, input)`
- Lines: 20-34

## Claim / retry path
1. `claimUnread()` selects candidate rows:
   - `SELECT id FROM mailbox_messages WHERE room_id = ? AND to_agent_id = ? AND read = 0 AND claimed_run_id IS NULL ORDER BY created_at ASC LIMIT ?`
2. It then performs the atomic claim UPDATE:
   - `UPDATE mailbox_messages SET read = 1, claimed_run_id = ?, claimed_at = ? WHERE id IN (...) AND claimed_run_id IS NULL`
3. Success is detected by `result.changes === ids.length`; otherwise the claim is treated as failed / conflicted and `[]` is returned.

## Existing retry counter?
- No. There is currently no `attempt_count` or equivalent retry/claim counter in this flow.

## Related handlers / failure-conflict sites
- `packages/orchestrator/src/commands.ts`
  - `handleWakeAgent()` lines 78-100 invokes `claimUnread()` inside the run-creation transaction.
  - Conflict / fallback behaviors:
    - existing active run path: lines 79-83 (`findActiveRun()` then `appendNextTurn()`)
    - zero-mailbox rejection: lines 97-100 (`wake_rejected_no_mailbox`)
    - active wake guard conflict: lines 69-75

## SQL to update for ¡ì4.5
- Current UPDATE site in `claimUnread()` should gain:
  - `attempt_count = attempt_count + 1`
- Exact statement to patch:
  - `UPDATE mailbox_messages SET read = 1, claimed_run_id = ?, claimed_at = ?, attempt_count = attempt_count + 1 WHERE id IN (...) AND claimed_run_id IS NULL`
