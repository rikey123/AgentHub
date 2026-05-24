# OpenCode bridge decision

## PF.2 — ACP bridge/client package

**Decision:** no official/current npm package was found for an OpenCode ACP bridge/client.

**Why:** OpenCode's own docs tell editors to run `opencode acp` directly, and the command itself starts an ACP-compatible subprocess over stdio JSON-RPC. The current codebase also follows that model: the ACP command spawns OpenCode and bridges stdio/NDJSON JSON-RPC rather than importing a separate bridge package.

**Use this instead:** spawn the CLI directly.
- **Install CLI:** `npm i -g opencode-ai@latest` (official OpenCode CLI install from the repo README)
- **Invoke:** `opencode acp`
- **Editor-style config:** `command: "opencode"`, `args: ["acp"]`
- **Protocol:** ACP over stdio JSON-RPC; compatible with the AgentHub `ACPAdapter` base class, which already expects a child-process bridge and NDJSON lines.

**Docs:** https://opencode.ai/docs/acp/

**Compatibility notes:**
- Supports OpenCode in ACP-compatible editors/IDEs via stdio JSON-RPC.
- OpenCode docs note that some built-in slash commands (like `/undo` and `/redo`) are unsupported over ACP.
- No official package means no package version to pin; pin the OpenCode CLI version instead if you need reproducibility.

**Fallback if you still want a package wrapper:** use a thin local wrapper that spawns `opencode acp` and forwards NDJSON/JSON-RPC unchanged. Third-party community packages exist, but none were found as an official OpenCode ACP bridge/client.

## PF.3 — Default model when no model is specified

**Decision:** `opencode/big-pickle`

**Why:** OpenCode docs say model loading falls back from `--model`/config/last-used model to an internal priority. In current source, that internal priority prefers the `opencode` provider's `big-pickle` model when available.

**Source:**
- Docs: https://opencode.ai/docs/models/
- Source: https://github.com/anomalyco/opencode/blob/b2baddcd/packages/opencode/src/acp/agent.ts

**Result for `builder-opencode.md`:** set `model: "opencode/big-pickle"` as the default fallback.
