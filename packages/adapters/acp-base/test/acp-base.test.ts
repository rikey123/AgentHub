import { Effect, Stream } from "effect";
import { redactAndTruncate } from "@agenthub/security";
import { describe, expect, it } from "vitest";

import { ACPAdapter, ACPAdapterError, NdjsonLineSplitter, notImplementedEffect, notImplementedStream, serializePrompt, type JsonRpcMessage } from "../src/index.ts";

class TestAcpAdapter extends ACPAdapter {
  constructor() {
    super("test-acp", "Test ACP", {
      id: "test-acp",
      name: "Test ACP",
      runtimeKind: "acp",
      provider: "custom",
      capabilities: { canStreamTokens: true, canEmitToolEvents: true, canEmitPermissionEvents: true, canEmitSubagentEvents: true, canInjectAtStart: true, canInjectNextTurn: true, canInjectRuntime: true, canCancel: true, canReadContextSnapshot: true, canRestoreSession: true, supportsMcp: true, supportsHooks: true, supportsWorkspaceIsolation: true },
      reliability: { level: "structured", eventSource: "native_event_stream", crashRecovery: "resumable", parseFailure: "fail_run", maxRestartAttempts: 1 },
      context: { startupInjection: true, runtimeInjection: true, injectionMode: "immediate", canPullExternalContext: true, canPushLedgerUpdates: true },
      workspace: { mode: "worktree" }
    });
  }

  detect() { return Effect.succeed([]); }
  protected spawnArgs() { return { command: "", args: [] as const }; }
  protected mapProviderEvent(message: JsonRpcMessage) { return message.method ? { type: message.method, payload: message.params } : undefined; }
  protected mapProviderError(error: unknown) { return new ACPAdapterError("provider_error", JSON.stringify(error)); }
}

describe("ACPAdapter base", () => {
  it("splits NDJSON lines across chunk boundaries", () => {
    const splitter = new NdjsonLineSplitter();
    expect(splitter.push('{"a":')).toEqual([]);
    expect(splitter.push('1}\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(splitter.flush()).toBe('{"c"');
  });

  it("serializes prompts with role boundary markers", () => {
    expect(serializePrompt({ role: "user", content: "hello" })).toBe('<agenthub-message role="user">\nhello\n</agenthub-message>');
  });

  it("rejects a second prompt while one is in flight", () => {
    const adapter = new TestAcpAdapter();
    const session = Effect.runSync(adapter.createSession({ runId: "run-1", roomId: "room", agentId: "agent" }));
    void Stream.runDrain(adapter.runAgent({ runId: "run-1", sessionId: session.id, message: { role: "user", content: "first" } }));
    expect(() => Effect.runSync(Stream.runDrain(adapter.runAgent({ runId: "run-1", sessionId: session.id, message: { role: "user", content: "second" } })))).toThrow(/prompt already in flight/iu);
  });

  it("cancel rejects only the inflight prompt and preserves non-prompt pending requests", () => {
    const adapter = new TestAcpAdapter();
    const session = Effect.runSync(adapter.createSession({ runId: "run-2", roomId: "room", agentId: "agent" }));
    void Stream.runDrain(adapter.runAgent({ runId: "run-2", sessionId: session.id, message: { role: "user", content: "work" } }));
    let fsRejected = false;
    adapter.addPendingForTest(session.id, { requestId: "req_fs1", method: "fs.writeTextFile", reject: () => { fsRejected = true; } });

    Effect.runSync(adapter.cancelRun("run-2"));

    const debug = adapter.debugSession(session.id);
    expect(debug?.state).toBe("cancelling");
    expect(debug?.pendingRequests.has("req_fs1")).toBe(true);
    expect(fsRejected).toBe(false);
  });

  it("stores and returns the MCP server supplied at createSession", () => {
    const adapter = new TestAcpAdapter();
    const mcpServer = { callTool: () => ({ ok: true, data: { taskId: "task_1" } }) };

    const session = Effect.runSync(adapter.createSession({ runId: "run-mcp", roomId: "room", agentId: "agent", mcpServer }));

    expect(session.mcpServer).toBe(mcpServer);
    expect(adapter.debugSession(session.id)?.mcpServer).toBe(mcpServer);
    expect((session.mcpServer as typeof mcpServer).callTool()).toEqual({ ok: true, data: { taskId: "task_1" } });
  });

  it("dispose rejects all pending requests and marks session disposed", () => {
    const adapter = new TestAcpAdapter();
    const session = Effect.runSync(adapter.createSession({ runId: "run-3", roomId: "room", agentId: "agent" }));
    let rejectedCode = "";
    adapter.addPendingForTest(session.id, { requestId: "req_fs1", method: "fs.writeTextFile", reject: (error) => { rejectedCode = error.code; } });

    Effect.runSync(adapter.dispose(session.id));

    expect(adapter.debugSession(session.id)?.state).toBe("disposed");
    expect(adapter.debugSession(session.id)?.pendingRequests.size).toBe(0);
    expect(rejectedCode).toBe("session_disposed");
  });

  it("returns deterministic 501 not implemented helpers", () => {
    expect(() => Effect.runSync(notImplementedEffect("OpenCodeAdapter", "V0.5"))).toThrow(/OpenCodeAdapter is V0.5/iu);
    expect(() => Effect.runSync(Stream.runDrain(notImplementedStream("CodexAdapter", "V1.x")))).toThrow(/CodexAdapter is V1.x/iu);
  });

  it("redacts and truncates raw output before event/log sinks", () => {
    const redacted = redactAndTruncate(`Bearer ${"a".repeat(32)} AGENTHUB_TOKEN=secret-value ${"x".repeat(9000)}`);
    expect(redacted).toContain("«REDACTED:bearer-token»");
    expect(redacted).toContain("«REDACTED:agenthub-token»");
    expect(redacted).not.toContain("x".repeat(9000));
    expect(redacted.length).toBeLessThan(8400);
  });
});
