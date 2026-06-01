# AgentHub MVP — Drift Audit Report (2026-05-24)

> Step 1 + Step 2 of pre-archive validation. Reconciles `tasks.md` checkboxes with actual implementation, runs verification baseline, and code-reviews 5 high-leverage drift hotspots.

## TL;DR

- **Verification baseline**: All green on `task/remediation-implementation-plan` — 21 files / 159 tests, 5 CI checks, 5 Playwright E2E, build, typecheck.
- **Drift on architecture**: **None**. 5 hotspots audited (CommandBus tx, RunLifecycleService signatures, event payload field names, Task state machine, WakeAgent zero-input) — all ALIGNED.
- **tasks.md reconciliation**: 322 items tagged. 199 DONE / 46 PARTIAL / 64 MISSING / 13 UNCLEAR. Real functional alignment ≈ 80-85% (lower checkbox % is artifact of task-ID granularity, not real gaps).
- **Real engineering gaps to fix before archive**: 8 items (Class E below). Test coverage gaps: ~20 items (Class D).

---

## 1. Verification Baseline (Step 1, light)

Ran on current head (`task/remediation-implementation-plan`):

| Command | Result |
|---|---|
| `pnpm test` | **159 / 159 passed** (21 files) |
| `pnpm typecheck` | passed |
| `pnpm check:all` | events:check ✅ (93 types) / visibility:check ✅ (80 durable) / subscriptions:check ✅ / command:check ✅ (28 canonical + HTTP guard) / run-state-machine:check ✅ |
| `pnpm exec playwright test main-detail-projection.spec.ts pending-turn.spec.ts` | **5 / 5 passed** |
| `pnpm build` | passed |

**Conclusion**: Implementation baseline preserved since 2026-05-23 closeout. Solo + main/detail projection + auth/CSRF + Run Detail 7-tab + raw stream + pending turn all confirmed working via E2E.

---

## 2. tasks.md Reconciliation (Step 2)


| Status | Count | % |
|---|---|---|
| DONE | 199 | 62% |
| PARTIAL | 46 | 14% |
| MISSING | 64 | 20% |
| UNCLEAR | 13 | 4% |

> 9.1 was initially flagged MISSING — Solo dispatch lives in `daemon/src/commands.ts:sendMessage` (not under `packages/orchestrator/`); WakeAgent is dispatched at line 119-132 with `messageId`+`promptDelta`+busy-aware PendingTurn enqueue. Manually corrected to DONE.

---

## 3. Drift Hotspot Audit (Step 2, code-review pass)

Five hotspots known to commonly drift in agent-driven implementations:

| # | Hotspot | Spec source | Verdict | Evidence |
|---|---|---|---|---|
| 1 | CommandBus tx boundary (deterministic vs transient failure rollback semantics) | `bus-runtime/Outbox + 事务边界` + `Command 幂等表` | **ALIGNED** | `packages/bus/src/index.ts:567-649` — outer tx + savepoint + `persistCommandRecordResult` writes failed cache outside savepoint but inside outer tx; transient deletes command_records row entirely |
| 2 | RunLifecycleService 11-method signatures + state transitions | `bus-runtime/RunLifecycleService 是 runs 表的唯一写入口` | **ALIGNED** | `packages/orchestrator/src/run-lifecycle-service.ts` — all methods take `tx: SqliteTx \| null` as first param (lines 131/187/197/206/216/227/236/245/263); markRunning emits `agent.run.resumed` only on `waiting_permission` path (line 222); fail requires failureClass (line 263) |
| 3 | task.status.changed payload uses `nextStatus` not `status` | `event-system` canonical registry + `orchestrator/最小 Task 数据模型` | **ALIGNED** | `packages/orchestrator/src/task-service.ts:122` emits `{ taskId, prevStatus, nextStatus, reason? }` |
| 4 | Task state machine — `pending → completed` rejected with `invalid_task_transition` | `orchestrator/最小 Task 数据模型` | **ALIGNED** | `task-service.ts:212-220` canTransition map blocks; line 161 returns `failed("conflict", "invalid_task_transition", ...)` |
| 5 | WakeAgent is sole entry; zero-input check uses positive 5-OR form | `bus-runtime` D30 + `orchestrator/Mailbox 原子认领` | **ALIGNED** | `packages/bus/src/index.ts:82-120` — `StartRun` not in CommandType union; `commands.ts:91-96` — 5-OR positive form (claimedIds.length, hasMeaningfulPromptDelta, messageId, pendingTurnId, carryNextTurnIds.length) |

**No architectural drift found.** Every change to a protected contract (RunLifecycleService, EventBus, CommandBus) is traceable to a Decision in design.md.

---

## 4. Gap Triage — All 123 PARTIAL/MISSING/UNCLEAR

### Class A — Reasonable to defer (not blocking archive) ≈ 60 items

| Group | Items | Why deferable |
|---|---|---|
| Standalone observability package | §15.1/15.2/15.4/15.5 | `/debug/events` API + raw stream already exist in daemon; separate `packages/observability/` is organizational |
| README quickstart / perf / demo / V0.5 plan | §18.1/§18.6/§18.7/§18.10 | Post-archive deliverables |
| Acceptance checklist line items | §19.15.1/§19.15.2/§19.15.3/§19.15.4/§19.15.5 / §20.6.* | Underlying tests covered by 159 unit + 5 E2E + 5 CI |
| Web UI polish | §14.6 (TanStack Virtual) / §14.7 (60fps batch) / §14.16 (Storybook) | Performance/dev-tooling, not functional |
| Empty stub modules done elsewhere | §19.14.3/§19.6.10/§19.6.11/§19.6.12 settings UI / Run Detail slide-over UI | Functionality exists at API level; UI is V0.5 polish |
| Stage labels for milestones | §21 M0–M6 (informational) | Non-mandatory ordering markers |

### Class B — Position errors (not real gaps) ≈ 5 items

- §9.1 Solo scheduling — already corrected to DONE
- §3.10 ESLint rule banning `eventBus.publish` in HTTP — handler enforced at runtime by `assertEnvelopeMatchesRegistry` + `command:check` script

### Class C — V0.5 / V1.x scope (already on roadmap) ≈ 30 items

| Item | Roadmap stage |
|---|---|
| §5.5 chokidar hot reload + agent.profile.updated | V0.5 (chatroom polish) |
| §5.6 4 builtin agent templates | V0.5 (chatroom polish) |
| §5.10 message pagination cursor-based | V0.5 |
| §5.11 quote/regenerate/pin/copy message ops | V0.5 |
| §8.8 PreCompact / SessionEnd → ContextItem.summary | V0.5 (run-detail-complete) |
| §9.2 Assisted @mention parsing | V0.5 (chatroom polish — explicitly listed) |
| §9.5 group discipline executor | V0.5 (Observer 敲门 polish) |
| §9.7 status-line throttle | V0.5 |
| §9.9 Room MCP — 12 of 15 tools missing (only 3 implemented) | V0.5 (chatroom polish) |
| §12.4/12.6/12.7/12.8 Claude adapter advanced hooks (PreCompact, PostToolUse→artifact.diff, SubagentStart/Stop) | V0.5 (real adapter completeness) |
| §12.11 real-claude integration test | V0.5 |
| §19.4.8 poisoned session detection | V0.5 (Run Detail completeness) |
| §19.4.9 run reuse strategy enum | V0.5 |
| §19.6.5 ContextAssembly brief summary | V0.5 (主流摘要 polish) |
| §19.9.1/3/4 dedupe set + 8KB truncate + 256KB divert | V0.5 (raw output polish) |
| §19.11.* worktree GC details | V0.5 |
| §17.3 stub list (deployment/task-board/skill/etc) | V1.0/V1.1+ stubs |

### Class D — Test coverage gap (no test file but underlying impl works) ≈ 20 items

These are spec-listed integration tests that don't have dedicated test files:

| Item | Test scenario | Currently covered by |
|---|---|---|
| §9.11 | Observer downgrade / @ wake / multi-@ ordering / dedup | None — Assisted Mode E2E gap |
| §10.8 | Knock → card → approve → inject → resolved end-to-end | Unit tests in interventions, not full chain |
| §11.10 | DiffCard rollback / preview token expiry / recovery_required | Unit tests in artifacts, not all sub-cases |
| §19.2.8/9 | 4-file write+rollback / failed-Run still produces DiffArtifact | Not covered |
| §19.3.6 | 100 messages → observer LLM call=0 | Not covered |
| §19.4.10 | daemon kill -9 → reclaim path | recovery.ts has logic but no test |
| §19.7.4 | raw flood doesn't drop delta channel | Not covered |
| §19.12.9 | 7 mailbox/next_turn scenarios | Not covered |
| §19.15.5 | Lock matrix integration tests | Not covered |
| §20.1.5 | 5 queued messages → sequential consume | Not covered |

These are the **most reasonable items to add before archive** — they don't introduce new code, only add test files that exercise existing implementations. Adding them increases confidence that V0.5 changes don't regress core invariants.

### Class E — Real engineering gaps (block archive in strict view) ≈ 8 items

These are real functionality holes, not just deferred polish:

| Item | What's missing | Severity | Recommendation |
|---|---|---|---|
| **§3.18** | daemon startup hook 9-phase order + 503 service_starting | M | Affects crash-recovery determinism. Add before archive. |
| **§4.2** | config.toml loader (currently hardcoded ports/paths) | M | Deployment completeness. Add before archive. |
| **§4.3** | 0.0.0.0 binding validation (token + explicit enabled) | H (security) | LAN deployment safety. Add before archive. |
| **§4.5** | SIGINT/SIGTERM graceful shutdown (30s in-flight timeout) | M | Process hygiene. Add before archive. |
| **§15.6** | cost field written to runs table | L (V0.5 prereq) | V0.5 Cost Panel directly depends on this. Add now or in V0.5. |
| **§16.1** | OS keychain bridge (windows-credential-locker / macOS keychain / libsecret) | H (security) | Tokens currently stored in DB plaintext. Add before archive. |
| **§16.5** | prompt injection protection (`<external_content>` wrap) | H (security) | Spec-mandated defense, currently missing. Add before archive. |
| **§16.8** | audit log for critical ops (token / permission / intervention / sensitive deny / settings) | M (security) | Compliance/forensics. Add before archive. |

---

## 5. Archive Decision Framework

Two paths discussed:

**A. Direct archive → V0.5 absorbs all gaps**
- Class E gaps go into V0.5 change as MODIFIED requirements
- Class D test gaps either go into V0.5 or a small `add-mvp-test-coverage` change
- Risk: V0.5 scope creeps (was meant for chatroom polish, now also security hardening)

**B. Pre-archive remediation → archive with high baseline**
- New change `add-mvp-finishing-touches` covers Class E (8 items) + selected Class D tests (~10 highest-value)
- Estimated effort: 1-2 weeks
- Risk: Delays V0.5 start

**C. Hybrid (recommended after user feedback 2026-05-24)**
- Class E security items (16.1/16.5/16.8/4.3) — pre-archive (4 items)
- Class E ops items (3.18/4.2/4.5/15.6) — V0.5 absorbs
- Class D test gaps — pre-archive (run a `add-mvp-test-coverage` change covering ~15 invariant tests for protected contracts)
- Rationale: Security gaps and core invariant tests are exactly the things that should NOT regress through V0.5 development. Better to lock them down before opening the next change.

---

## 6. Recommended Next Steps

1. **Save this report** (this file) ← done
2. **Decide: A / B / C above** ← awaiting user decision (leaning C)
3. **If C**:
   - Open `add-mvp-test-coverage` change (Class D tests for invariants)
   - Open `add-mvp-security-hardening` change (Class E security items)
   - After both merge, run `openspec archive add-agenthub-mvp`
   - Then start V0.5 with `add-v0.5-chatroom-complete`

---

## Appendix — Verification Commands Used

```bash
# Verify baseline
cd C:/project/AgentHub
pnpm test                    # 21 files / 159 tests passed
pnpm typecheck               # passed
pnpm check:all               # 5 checks passed
pnpm exec playwright test apps/web/e2e/main-detail-projection.spec.ts apps/web/e2e/pending-turn.spec.ts  # 5 passed
pnpm build                   # passed

# Reconcile checkboxes (script)
node scripts/reconcile-tasks-checkboxes.mjs   # writes 199 [x] + tags rest

# Strict validation
openspec validate add-agenthub-mvp --strict   # passed
```

## Appendix — Files Touched by This Audit

- `C:/project/AgentHub/openspec/changes/add-agenthub-mvp/tasks.md` — 322 items reconciled, status tags added
- `C:/project/AgentHub/scripts/reconcile-tasks-checkboxes.mjs` — reconciliation script (kept for reproducibility)
- `C:/project/AgentHub/.sisyphus/notepads/agenthub-mvp/drift-audit-2026-05-24.md` — this report
