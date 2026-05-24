import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { OpenCodeACPAdapter, opencodeManifest } from "../src/index.ts";

describe("OpenCodeACPAdapter", () => {
  it("declares the required ACP manifest contract", () => {
    expect(opencodeManifest).toMatchObject({
      id: "opencode",
      runtimeKind: "acp",
      reliability: { crashRecovery: "resumable", parseFailure: "skip_event" },
      context: { injectionMode: "immediate" },
      workspace: { mode: "worktree" }
    });
    expect(opencodeManifest.capabilities.canRestoreSession).toBe(true);
    expect(opencodeManifest.capabilities.canEmitSubagentEvents).toBe(true);
  });

  it("detect returns [] instead of throwing when OpenCode is missing", () => {
    const adapter = new OpenCodeACPAdapter({ command: "agenthub-opencode-missing-for-test" });

    expect(Effect.runSync(adapter.detect())).toEqual([]);
  });

  it("attachSession restores a persisted resumable ACP session", () => {
    const adapter = new OpenCodeACPAdapter({ command: "" });

    const session = Effect.runSync(adapter.attachSession({ runId: "run", adapterSessionId: "opencode-session", workDir: ".", providerConversationId: "conv" }));

    expect(session).toMatchObject({ id: "opencode-session", runId: "run", workDir: ".", providerConversationId: "conv" });
    expect(adapter.debugSession("opencode-session")?.state).toBe("ready");
  });

  it("maps native ACP prompt/tool/permission/subagent/context/cancel/error events", () => {
    const adapter = new OpenCodeACPAdapter({ command: "" });
    const session = Effect.runSync(adapter.createSession({ runId: "run-events", roomId: "room", agentId: "agent" }));

    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "prompt_started", params: { id: "prompt" } }))).toMatchObject({ type: "prompt.started" });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "tool/pre_use", params: { id: "tool_1", tool: "Bash", arguments: { command: "pwd" } } }))).toMatchObject({ type: "tool.call.requested", payload: { toolCallId: "tool_1", name: "Bash", input: { command: "pwd" } } });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "permission/request", params: { id: "perm_1", reason: "write file" } }))).toMatchObject({ type: "permission.requested", payload: { permissionId: "perm_1" } });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "subagent_start", params: { id: "sub_1", role: "reviewer" } }))).toMatchObject({ type: "subagent.started", payload: { subRunId: "sub_1", profileRef: "reviewer" } });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "context_snapshot", params: { text: "summary" } }))).toEqual({ type: "context.snapshot", payload: { kind: "opencode_context", text: "summary", metadata: { adapterId: "opencode" } } });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "session/cancelled", params: { sessionId: session.id } }))).toMatchObject({ type: "session.ended", payload: { reason: "cancelled" } });
    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "session/error", params: { message: "boom" } }))).toMatchObject({ type: "session.crashed", payload: { error: "boom" } });
  });

  it("skips unknown provider events for parseFailure skip_event behavior", () => {
    const adapter = new OpenCodeACPAdapter({ command: "" });
    const session = Effect.runSync(adapter.createSession({ runId: "run-unknown", roomId: "room", agentId: "agent" }));

    expect(adapter.feedProviderLineForTest(session.id, JSON.stringify({ jsonrpc: "2.0", method: "opencode/unknown", params: { value: true } }))).toBeUndefined();
  });

  it("uses OPENCODE_BIN integration detection only when explicitly available", () => {
    const opencodeBin = process.env.OPENCODE_BIN;
    if (opencodeBin === undefined || opencodeBin.length === 0) {
      console.warn("Skipping OpenCode binary integration smoke: OPENCODE_BIN is not set");
      return;
    }
    const adapter = new OpenCodeACPAdapter({ command: opencodeBin });

    const detected = Effect.runSync(adapter.detect());

    expect(detected[0]).toMatchObject({ id: "opencode", executablePath: opencodeBin });
  });
});
