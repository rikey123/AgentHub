import { beforeEach, describe, expect, it, vi } from "vitest";

const streamTextMock = vi.hoisted(() => vi.fn());
const resolveProviderMock = vi.hoisted(() => vi.fn());
const convertMcpToolsToAiSdkToolsMock = vi.hoisted(() => vi.fn());
const permissionCheckMock = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  streamText: streamTextMock
}));

vi.mock("../src/provider-registry.ts", () => ({
  resolveProvider: resolveProviderMock
}));

vi.mock("../src/mcp-tool-converter.ts", () => ({
  convertMcpToolsToAiSdkTools: convertMcpToolsToAiSdkToolsMock
}));

let NativeAgentAdapter: typeof import("../src/native-agent-adapter.ts").NativeAgentAdapter;

beforeEach(async () => {
  streamTextMock.mockReset();
  resolveProviderMock.mockReset();
  convertMcpToolsToAiSdkToolsMock.mockReset();
  permissionCheckMock.mockReset();
  const model = { id: "resolved-model" };
  resolveProviderMock.mockReturnValue(model);
  convertMcpToolsToAiSdkToolsMock.mockReturnValue({});
  ({ NativeAgentAdapter } = await import("../src/native-agent-adapter.ts"));
});

describe("NativeAgentAdapter", () => {
  it("streams text, forwards tool calls, and maps cost usage", async () => {
    const publish = vi.fn();
    const lifecycle = createLifecycle();
    permissionCheckMock.mockReturnValue({ status: "allow", reason: "default_allow" });
    const adapter = new NativeAgentAdapter({
      database: createDatabaseStub(),
      eventBus: { publish },
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-1", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null },
      apiKey: "test-key"
    });

    streamTextMock.mockReturnValue({
      fullStream: asyncGenerator([
        { type: "text-delta", text: "Hello " }
      ]),
      usage: Promise.resolve({ inputTokens: 120, outputTokens: 45, inputTokenDetails: { cacheReadTokens: 12 } })
    });

    await adapter.runManaged(runRow());

    expect(permissionCheckMock).toHaveBeenCalledTimes(1);
    expect(resolveProviderMock).toHaveBeenCalledWith({ id: "mc-1", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null }, "test-key");
    expect(convertMcpToolsToAiSdkToolsMock).toHaveBeenCalled();
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({ model: { id: "resolved-model" }, abortSignal: expect.any(AbortSignal), tools: {} }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "message.part.delta" }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "permission.run_summary" }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "permission.run_summary", payload: expect.objectContaining({ decisions: [expect.objectContaining({ modelConfigId: "mc-1" })] }) }));
    expect(lifecycle.complete).toHaveBeenCalledWith(null, "run-1", { inputTokens: 120, outputTokens: 45, cachedTokens: 12, costUsd: 0.001035, modelId: "gpt-4o" }, undefined);
  });

  it("denies before stream creation for model api calls", async () => {
    const publish = vi.fn();
    const lifecycle = createLifecycle();
    permissionCheckMock.mockReturnValue({ status: "deny", reason: "stored rule" });
    const adapter = new NativeAgentAdapter({
      database: createDatabaseStub(),
      eventBus: { publish },
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-deny", provider: "anthropic", model: "claude-sonnet", base_url: null, api_key_ref: null }
    });

    await adapter.runManaged(runRow());

    expect(permissionCheckMock).toHaveBeenCalledTimes(1);
    expect(resolveProviderMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(lifecycle.fail).toHaveBeenCalledWith(null, "run-1", "model_api_call_denied", "permission_denied", "model.api_call permission denied");
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "permission.run_summary" }));
  });

  it("caches the model permission decision per run and model config", async () => {
    const publish = vi.fn();
    const lifecycle = createLifecycle();
    permissionCheckMock.mockReturnValue({ status: "allow", reason: "default_allow" });
    streamTextMock.mockReturnValue({ fullStream: asyncGenerator([]), usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }) });
    const adapter = new NativeAgentAdapter({
      database: createDatabaseStub(),
      eventBus: { publish },
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-cache-1", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null }
    });

    await adapter.runManaged(runRow());
    adapter["options"].modelConfig.id = "mc-cache-2";
    await adapter.runManaged(runRow());

    expect(permissionCheckMock).toHaveBeenCalledTimes(2);
  });

  it("aborts the active stream and finalizes as cancelled", async () => {
    const publish = vi.fn();
    const lifecycle = createLifecycle();
    let abortSignal: AbortSignal | undefined;
    streamTextMock.mockImplementation(({ abortSignal: signal }: { readonly abortSignal: AbortSignal }) => {
      abortSignal = signal;
      return {
        fullStream: asyncGenerator([
          { type: "text-delta", text: "Hello" },
          { type: "wait-for-abort" }
        ], signal),
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 })
      };
    });

    const adapter = new NativeAgentAdapter({
      database: createDatabaseStub(),
      eventBus: { publish },
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-cancel", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null }
    });

    permissionCheckMock.mockReturnValue({ status: "allow", reason: "default_allow" });

    const run = adapter.runManaged(runRow());
    await waitFor(() => abortSignal !== undefined);
    await adapter.cancelManagedRun("run-1");
    await run;

    expect(lifecycle.markCancelling).toHaveBeenCalledWith(null, "run-1");
    expect(lifecycle.cancelFinalized).toHaveBeenCalledWith(null, "run-1", undefined);
    expect(abortSignal?.aborted).toBe(true);
  });

  it("maps cached tokens and cost fields from usage", async () => {
    const lifecycle = createLifecycle();
    streamTextMock.mockReturnValue({
      fullStream: asyncGenerator([]),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 3 } })
    });

    const adapter = new NativeAgentAdapter({
      database: createDatabaseStub(),
      eventBus: { publish: vi.fn() },
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-cost", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null }
    });

    permissionCheckMock.mockReturnValue({ status: "allow", reason: "default_allow" });

    await adapter.runManaged(runRow());

    expect(lifecycle.complete).toHaveBeenCalledWith(null, "run-1", { inputTokens: 10, outputTokens: 20, cachedTokens: 3, costUsd: 0.00033, modelId: "gpt-4o" }, undefined);
  });
});

function createLifecycle() {
  return {
    updateSessionState: vi.fn(),
    markRunning: vi.fn(),
    markCancelling: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    cancelFinalized: vi.fn()
  };
}

function createDatabaseStub() {
  return {
    sqlite: {
      prepare: vi.fn(() => ({ get: vi.fn(() => ({ seq: 1 })) }))
    }
  } as never;
}

function runRow(): import("../../orchestrator/src/index.ts").RunRow {
  return {
    id: "run-1",
    workspace_id: "workspace-1",
    task_id: null,
    room_id: "room-1",
    agent_id: "agent-1",
    adapter_id: null,
    adapter_session_id: null,
    provider_conversation_id: null,
    parent_run_id: null,
    status: "running",
    wake_reason: "primary_turn",
    waiting_reason: null,
    workspace_path: null,
    work_dir: null,
    workspace_mode: "shadow_buffer",
    context_version: null,
    target_files: "[]",
    mailbox_claim_count: 0,
    pid_at_start: null,
    claimed_at: null,
    started_at: null,
    ended_at: null,
    input_tokens: null,
    output_tokens: null,
    cached_tokens: null,
    cost_usd: null,
    model_id: null,
    failure_class: null,
    error: null,
    created_at: 1,
    updated_at: 1
  };
}

async function* asyncGenerator(parts: readonly unknown[], signal?: AbortSignal): AsyncGenerator<any> {
  for (const part of parts) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if ((part as { readonly type?: string }).type === "wait-for-abort") {
      await new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
      });
      return;
    }
    yield part;
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("timed out waiting for predicate");
}
