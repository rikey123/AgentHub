
## 2026-05-23 M3.1 Artifact primitives

- Implemented @agenthub/artifacts ArtifactService for Artifact/ArtifactFile CRUD, diff review/apply/reject/revert, file/document/terminal/preview persistence metadata, deployment not_implemented result, and SafeWritePolicy explicit glob matching with default empty whitelist.
- Diff apply prevalidates oldSha256 for every file before writes, requests an injectable permission check, emits accepted/applying/applied/failed canonical events, writes sibling temp files, renames in sorted path order, rolls back partial failures, and persists recovery_required applied_state details.
- Daemon mutating artifact routes dispatch CommandBus commands (CreateArtifact, ReviewArtifact, ApplyDiff, RejectDiff, RevertArtifact); read routes use ArtifactService queries only.
- Verification passed: pnpm.cmd --filter @agenthub/artifacts test (11 passed); affected @agenthub/daemon test (6 passed), @agenthub/sdk test (4 passed), @agenthub/cli test (3 passed); pnpm.cmd test (14 files, 104 tests); pnpm.cmd typecheck; pnpm.cmd lint; pnpm.cmd check:all; pnpm.cmd schema:check; pnpm.cmd build; openspec.cmd validate add-agenthub-mvp --strict.
- LSP diagnostics clean on modified TS files: packages/artifacts/src/index.ts, packages/artifacts/test/artifacts.test.ts, packages/bus/src/index.ts, packages/daemon/src/index.ts, packages/daemon/src/openapi.ts, packages/sdk/src/index.ts, apps/cli/src/index.ts.

