## M0.1 Workspace bootstrap evidence

- Date: 2026-05-23
- OpenSpec refs covered: `tasks.md §0.1`, `tasks.md §0.5`, `tasks.md §0.6`
- Scope: created pnpm workspace, Turborepo root config, Bun/Node-compatible package metadata, and empty app/package scaffolds only.
- Apps scaffolded: `apps/web`, `apps/cli`
- Packages scaffolded: `packages/daemon`, `packages/protocol`, `packages/sdk`, `packages/db`, `packages/bus`, `packages/rooms`, `packages/messages`, `packages/agents`, `packages/adapters/mock`, `packages/adapters/claude-code`, `packages/adapters/opencode`, `packages/adapters/codex`, `packages/context`, `packages/orchestrator`, `packages/permissions`, `packages/interventions`, `packages/artifacts`, `packages/observability`, `packages/ui`, `packages/config`
- Notes: no product implementation code, database schema, UI scaffold, cloud/SaaS dependencies, or banned dependencies were added.

## M0.2 Tooling and CI baseline evidence

- Date: 2026-05-23
- OpenSpec refs covered: `tasks.md section 0.2`, `tasks.md section 0.3`, `tasks.md section 0.4`
- Scope: added shared TypeScript baseline, Vitest, Playwright, ESLint flat config, Prettier config, root scripts, per-workspace `tsconfig.json` inheritance, and GitHub Actions lint/typecheck/test matrix for Node 22 and Bun.
- Notes: no product source, daemon routes, UI implementation, protocol schemas, database migrations, or banned runtime dependencies were added. `pnpm test` intentionally permits no tests while product packages are empty via Vitest `passWithNoTests`.
- Verification commands run for this entry:
  - `pnpm.cmd install --lockfile-only --ignore-scripts` -> passed
  - `pnpm.cmd install --lockfile-only --ignore-scripts --frozen-lockfile` -> passed
  - `pnpm.cmd install --ignore-scripts --frozen-lockfile` -> passed (installed local tool binaries for subsequent checks)
  - `pnpm.cmd lint` -> passed
  - `pnpm.cmd typecheck` -> passed
  - `pnpm.cmd test` -> passed; intentional no-op because no `apps/**` or `packages/**` test files exist yet
  - `pnpm.cmd test:e2e` -> passed; intentional no-op because no Playwright E2E specs exist yet
  - `openspec.cmd validate add-agenthub-mvp --strict` -> passed
  - `git diff --check` -> passed
  - `lsp_diagnostics` -> no diagnostics for `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `.github/workflows/ci.yml`; JSON diagnostics for `package.json`/`tsconfig*.json` could not run because configured Biome LSP is not installed in this environment

## M0.3 Protocol schema skeleton evidence

- Date: 2026-05-23
- OpenSpec refs covered: `tasks.md §2.1`, `tasks.md §2.2`, `tasks.md §2.3`, `tasks.md §2.5`, `tasks.md §2.6`, `tasks.md §2.7`
- Scope: added Effect Schema-based protocol skeleton in `packages/protocol`, including EventEnvelope, canonical event registry metadata, domain model schemas, adapter schemas/types, v1-only EventMigrator, executable schema consistency check, and protocol tests.
- Boundaries: did not implement EventBus, CommandBus, database migrations, daemon routes, UI, StartRun command, or adapter runtime behavior.
- Verification commands run for this entry:
  - `lsp_diagnostics` on `packages/protocol/src` and `packages/protocol/test` -> no diagnostics
  - `pnpm.cmd --filter @agenthub/protocol test` -> passed; 3 files / 7 tests
  - `pnpm.cmd typecheck` -> passed
  - `pnpm.cmd lint` -> passed
  - `pnpm.cmd schema:check` -> passed; checked 92 event types
  - `openspec.cmd validate add-agenthub-mvp --strict` -> passed

## M0.4 DB package, SQLite pragmas, migrations, and CRUD/index tests evidence

- Date: 2026-05-23
- OpenSpec refs covered: `tasks.md ��1.1`, `��1.2`, `��1.3`, `��1.4`, `��1.5`, `��1.6`, `��1.7`, `��1.8`, `��1.9`, `��1.10`, `��1.11`, `��1.12`, `��1.13`, plus `��3.8` and event visibility ownership from `��20.3.1` / design D31.
- Scope: created `@agenthub/db` with better-sqlite3 + Drizzle-compatible exports, SQLite pragma application, deterministic SQL migration runner, migrations `0001_init.sql` through `0011_bus_runtime.sql`, and real SQLite Vitest coverage.
- Schema evidence: `0003_events.sql` defines `events.visibility` once with `idx_events_room_visibility`; `0011_bus_runtime.sql` defines `outbox`, `handler_cursors`, `dead_letter_events`, `run_locks`, and `command_records`; `run_locks` includes `lock_type`, `lock_key`, `workspace_id`, `run_id`, `acquired_at`, plus `idx_run_locks_runid` and `idx_run_locks_workspace`.
- Test evidence: `packages/db/test/sqlite.test.ts` applies migrations to SQLite, checks migration idempotence, PRAGMA values, table inventory, event visibility column/indexes, partial indexes, run_locks schema, and CRUD smoke for every table family.
- Drift fix evidence: the first M0.4 pass was rejected because Drizzle schema exports diverged from SQL migrations. `packages/db/src/schema.ts` is now aligned to migrations for table names, column names, and composite primary keys; `packages/db/test/sqlite.test.ts` now includes schema/migration drift tests for exported table inventory, exported columns versus `PRAGMA table_info`, and Drizzle insert/select/delete against a migrated SQLite DB.
- Boundaries: did not implement EventBus, CommandBus, repositories, services, daemon routes, UI, adapter runtime behavior, `StartRun`, or mailbox claim rollback commands.
- Verification commands run for this entry:
  - `lsp_diagnostics` on `packages/db/src/index.ts`, `packages/db/src/sqlite.ts`, `packages/db/src/schema.ts`, `packages/db/test/sqlite.test.ts` -> no diagnostics
  - `pnpm.cmd --filter @agenthub/db test` -> passed; 1 file / 18 tests
  - `pnpm.cmd typecheck` -> passed
  - `pnpm.cmd lint` -> passed
  - `pnpm.cmd schema:check` -> passed; checked 92 event types
  - `openspec.cmd validate add-agenthub-mvp --strict` -> passed

## M0.5 Custom CI guard evidence

- Date: 2026-05-23
- OpenSpec refs covered: `tasks.md ��20.4`, `event-system/events:check �� visibility:check CI У��`, `bus-runtime/Command �� Event ��ʽ����`, and M0 plan acceptance for dependency/Bun guardrails.
- Scope: added cross-platform Node check scripts under `scripts/checks/`, root scripts in `package.json`, and GitHub Actions CI steps for schema, dependency denylist, Bun API guard, and the five custom checks on both Node 22 and Bun matrix legs.
- `check:all` intentionally runs exactly the five custom ��20.4 checks: `events:check`, `visibility:check`, `subscriptions:check`, `command:check`, and `run-state-machine:check`. `schema:check` remains a separate protocol schema prerequisite and CI step.
- Negative fixture evidence:
  - `m0-5-check-deps-negative.log` shows `pnpm.cmd check:deps -- --fixture scripts/checks/fixtures/banned-dep-package.json` rejects `banned dependency: redis`.
  - `m0-5-check-bun-api-negative.log` shows `pnpm.cmd check:bun-api -- --fixture scripts/checks/fixtures/bun-api-usage.fixture` rejects `Bun-only API 'Bun.serve'`.
- Boundaries: did not implement EventBus, CommandBus runtime, RunLifecycleService runtime, daemon routes, UI, adapters, repositories, business services, `StartRun`, or `ApplyMailboxClaimRollback`.
- Evidence log files created:
  - `.sisyphus/evidence/agenthub-mvp/m0/m0-5-check-all.log`
  - `.sisyphus/evidence/agenthub-mvp/m0/m0-5-check-deps.log`
  - `.sisyphus/evidence/agenthub-mvp/m0/m0-5-check-deps-negative.log`
  - `.sisyphus/evidence/agenthub-mvp/m0/m0-5-check-bun-api.log`
  - `.sisyphus/evidence/agenthub-mvp/m0/m0-5-check-bun-api-negative.log`
