# task-2.3-mcp-tool-list-tasks

- Implemented `convertMcpToolsToAiSdkTools()` in `packages/native-agent-runtime/src/mcp-tool-converter.ts`.
- Wired `NativeAgentAdapter.runManaged()` to convert MCP tools into AI SDK tools and pass them to `streamText()`.
- Added adapter bridge emission for `tool.call.requested` and `tool.call.completed` around tool execution.
- Tool failures are surfaced as tool errors (bridge completion with `ok: false`, then thrown so AI SDK can report `tool-error`) without aborting the whole run.
- Kept the file/shell boundary intact by leaving execution behind the injected MCP executor and existing adapter boundaries.
- Verified with `pnpm.cmd test -- packages/native-agent-runtime`.
