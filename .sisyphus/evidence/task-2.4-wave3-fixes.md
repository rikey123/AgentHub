# Wave 3 Oracle Fix Evidence

## Summary
- Wired `AdapterRegistry.native()` to pass `permissionEngine` into `NativeAgentAdapter` and to include the native keychain bridge.
- Added `modelConfig.id` plumbing through native runtime model config resolution and permission summaries.
- Fixed MCP non-fatal tool failures to return error results and emit exactly one `tool.call.completed` event.

## Verification
- `pnpm.cmd test -- packages/native-agent-runtime packages/orchestrator packages/daemon` ✅
- `pnpm.cmd ai-sdk-provider:check` ✅
- `pnpm.cmd check:all` ✅

## Notes
- The Oracle watch-out about native API key wiring was addressed by passing the daemon keychain bridge through the registry.
- No plan file changes were made.
