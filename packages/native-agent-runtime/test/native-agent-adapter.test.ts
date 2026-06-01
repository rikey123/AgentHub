import { beforeEach, describe, expect, it, vi } from "vitest";

const streamTextMock = vi.hoisted(() => vi.fn());
const stepCountIsMock = vi.hoisted(() => vi.fn((count: number) => ({ type: "step-count-is", count })));
const resolveProviderMock = vi.hoisted(() => vi.fn());
const convertMcpToolsToAiSdkToolsMock = vi.hoisted(() => vi.fn());
const permissionCheckMock = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  streamText: streamTextMock,
  stepCountIs: stepCountIsMock
}));

vi.mock("../src/provider-registry.ts", () => ({
  resolveProvider: resolveProviderMock
}));

vi.mock("../src/mcp-tool-converter.ts", () => ({
  convertMcpToolsToAiSdkTools: convertMcpToolsToAiSdkToolsMock
}));

let NativeAgentAdapter: typeof import("../src/native-agent-adapter.ts").NativeAgentAdapter;
type AgentPromptDelta = import("../../orchestrator/src/index.ts").AgentPromptDelta;

beforeEach(async () => {
  streamTextMock.mockReset();
  stepCountIsMock.mockClear();
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
      eventBus: { publish } as unknown as import("../../bus/src/index.ts").EventBus,
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
    expect(stepCountIsMock).toHaveBeenCalledWith(5);
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({ model: { id: "resolved-model" }, abortSignal: expect.any(AbortSignal), tools: {}, stopWhen: { type: "step-count-is", count: 5 } }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "message.part.delta" }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "permission.run_summary" }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "permission.run_summary", payload: expect.objectContaining({ decisions: [expect.objectContaining({ modelConfigId: "mc-1" })] }) }));
    expect(lifecycle.complete).toHaveBeenCalledWith(null, "run-1", { inputTokens: 120, outputTokens: 45, cachedTokens: 12, costUsd: 0.001035, modelId: "gpt-4o" }, undefined);
  });

  it("uses the orchestrator team prompt and queued run input in team rooms", async () => {
    const publish = vi.fn();
    const lifecycle = createLifecycle();
    const database = createTeamDatabaseStub();
    permissionCheckMock.mockReturnValue({ status: "allow", reason: "default_allow" });
    streamTextMock.mockReturnValue({
      fullStream: asyncGenerator([]),
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 })
    });
    const adapter = new NativeAgentAdapter({
      database,
      eventBus: { publish } as unknown as import("../../bus/src/index.ts").EventBus,
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-1", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null },
      apiKey: "test-key"
    });

    await adapter.runManaged(runRow({ agent_id: "agent-leader" }));

    const call = streamTextMock.mock.calls[0]?.[0] as { readonly system?: string; readonly messages?: readonly { readonly content: string }[] } | undefined;
    expect(call?.system).toContain("room.delegate");
    expect(call?.messages?.[0]?.content).toContain("backlog");
  });

  it("uses delegated task instructions as the user input for delegated runs", async () => {
    const publish = vi.fn();
    const lifecycle = createLifecycle();
    const database = createTeamDatabaseStub();
    permissionCheckMock.mockReturnValue({ status: "allow", reason: "default_allow" });
    streamTextMock.mockReturnValue({
      fullStream: asyncGenerator([]),
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 })
    });
    const adapter = new NativeAgentAdapter({
      database,
      eventBus: { publish } as unknown as import("../../bus/src/index.ts").EventBus,
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-1", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null },
      apiKey: "test-key"
    });

    await adapter.runManaged(runRow({ id: "run-delegated", wake_reason: "delegated_task", task_id: "task-1", agent_id: "agent-builder" }));

    const call = streamTextMock.mock.calls[0]?.[0] as { readonly system?: string; readonly messages?: readonly { readonly content: string }[] } | undefined;
    expect(call?.system).toContain("room.update_task");
    expect(call?.messages?.[0]?.content).toBe("Implement login\n\nAdd the login flow");
  });

  it("uses the planning-phase system prompt for plan wakes and keeps room.delegate out of system", async () => {
    const publish = vi.fn();
    const lifecycle = createLifecycle();
    const database = createTeamDatabaseStub();
    permissionCheckMock.mockReturnValue({ status: "allow", reason: "default_allow" });
    streamTextMock.mockReturnValue({
      fullStream: asyncGenerator([]),
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 })
    });
    const adapter = new NativeAgentAdapter({
      database,
      eventBus: { publish } as unknown as import("../../bus/src/index.ts").EventBus,
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-plan", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null },
      apiKey: "test-key",
      getSkillsBlock: () => "<active-skills>skill block</active-skills>"
    });

    await adapter.runManaged(runRow({ id: "run-plan", wake_reason: "plan", agent_id: "agent-leader" }));

    const call = streamTextMock.mock.calls[0]?.[0] as { readonly system?: string; readonly messages?: readonly { readonly content: string }[] } | undefined;
    expect(call?.system).toContain("## Planning Phase");
    expect(call?.system).toContain("Do not call any tools.");
    expect(call?.system).not.toContain("room.delegate");
    expect(call?.messages?.[0]?.content).toContain("<active-skills>skill block</active-skills>");
    expect(call?.messages?.[0]?.content).not.toContain("## Planning Phase");
  });

  it("keeps planning-phase JSON internal instead of publishing it as chat messages", async () => {
    const publish = vi.fn();
    const lifecycle = createLifecycle();
    const database = createTeamDatabaseStub();
    permissionCheckMock.mockReturnValue({ status: "allow", reason: "default_allow" });
    streamTextMock.mockReturnValue({
      fullStream: asyncGenerator([{ type: "text-delta", text: "```json\n{\"goal\":\"ship\",\"tasks\":[]}\n```" }]),
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 })
    });
    const adapter = new NativeAgentAdapter({
      database,
      eventBus: { publish } as unknown as import("../../bus/src/index.ts").EventBus,
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-plan", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null },
      apiKey: "test-key"
    });

    await adapter.runManaged(runRow({ id: "run-plan", wake_reason: "plan", agent_id: "agent-leader" }));

    const prepare = (database as { readonly sqlite: { readonly prepare: ReturnType<typeof vi.fn> } }).sqlite.prepare;
    expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO messages"));
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: "message.created" }));
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: "message.completed" }));
    expect(lifecycle.complete).toHaveBeenCalledWith(null, "run-plan", expect.any(Object), undefined);
  });

  it("denies before stream creation for model api calls", async () => {
    const publish = vi.fn();
    const lifecycle = createLifecycle();
    permissionCheckMock.mockReturnValue({ status: "deny", reason: "stored rule" });
    const adapter = new NativeAgentAdapter({
      database: createDatabaseStub(),
      eventBus: { publish } as unknown as import("../../bus/src/index.ts").EventBus,
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
      eventBus: { publish } as unknown as import("../../bus/src/index.ts").EventBus,
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
      eventBus: { publish } as unknown as import("../../bus/src/index.ts").EventBus,
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
      eventBus: { publish: vi.fn() } as unknown as import("../../bus/src/index.ts").EventBus,
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-cost", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null }
    });

    permissionCheckMock.mockReturnValue({ status: "allow", reason: "default_allow" });

    await adapter.runManaged(runRow());

    expect(lifecycle.complete).toHaveBeenCalledWith(null, "run-1", { inputTokens: 10, outputTokens: 20, cachedTokens: 3, costUsd: 0.00033, modelId: "gpt-4o" }, undefined);
  });

  it("fails with the provider stream error instead of masking it as no output", async () => {
    const lifecycle = createLifecycle();
    streamTextMock.mockReturnValue({
      fullStream: asyncGenerator([{ type: "error", error: new Error("openai_error") }]),
      usage: Promise.reject(new Error("No output generated. Check the stream for errors."))
    });

    const adapter = new NativeAgentAdapter({
      database: createDatabaseStub(),
      eventBus: { publish: vi.fn() } as unknown as import("../../bus/src/index.ts").EventBus,
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-stream-error", provider: "openai-compatible", model: "gpt-5.4-mini", base_url: "https://models.example/v1", api_key_ref: null }
    });

    permissionCheckMock.mockReturnValue({ status: "allow", reason: "default_allow" });

    await adapter.runManaged(runRow());

    expect(lifecycle.fail).toHaveBeenCalledWith(null, "run-1", "native_agent_runtime_error", "retryable_visible", "openai_error");
  });

  it("classifies provider model availability failures as configuration errors", async () => {
    const lifecycle = createLifecycle();
    streamTextMock.mockReturnValue({
      fullStream: asyncGenerator([{ type: "error", error: new Error("No available channel for model gpt-5.4-mini under group Codex 官方 (distributor)") }]),
      usage: Promise.reject(new Error("No output generated. Check the stream for errors."))
    });

    const adapter = new NativeAgentAdapter({
      database: createDatabaseStub(),
      eventBus: { publish: vi.fn() } as unknown as import("../../bus/src/index.ts").EventBus,
      lifecycle: lifecycle as never,
      permissions: { check: permissionCheckMock } as never,
      modelConfig: { id: "mc-model-missing", provider: "openai-compatible", model: "gpt-5.4-mini", base_url: "https://models.example/v1", api_key_ref: null }
    });

    permissionCheckMock.mockReturnValue({ status: "allow", reason: "default_allow" });

    await adapter.runManaged(runRow());

    expect(lifecycle.fail).toHaveBeenCalledWith(
      null,
      "run-1",
      "native_agent_runtime_error",
      "configuration",
      "No available channel for model gpt-5.4-mini under group Codex 官方 (distributor)"
    );
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
  const sqlite = {
    prepare: vi.fn((sql: string) => ({
      get: vi.fn(() => {
        if (sql.includes("SELECT COALESCE(MAX(seq)")) return { seq: 1 };
        return undefined;
      }),
      all: vi.fn(() => []),
      run: vi.fn(() => ({ changes: 0 }))
    })),
    transaction: vi.fn((fn: () => unknown) => () => fn())
  };
  return {
    sqlite
  } as never;
}

function createTeamDatabaseStub() {
  const messages = new Map<string, string>([
    ["user-message-1", "dispatch the backlog now"]
  ]);
  const queuedPayloadByRun = new Map<string, { readonly promptDelta?: AgentPromptDelta; readonly messageId?: string }>([
    ["run-1", { promptDelta: { kind: "delta_only", instructions: "dispatch the backlog now" }, messageId: "user-message-1" }],
    ["run-delegated", { promptDelta: { kind: "delta_only", instructions: "Implement login\n\nAdd the login flow" } }]
  ]);
  const task = {
    title: "Implement login",
    description: "Add the login flow"
  };
  const participants = [
    { agentId: "agent-leader", role: "primary", name: "Project Manager", adapterId: "native", presence: "active" },
    { agentId: "agent-builder", role: "teammate", name: "Builder", adapterId: "native", presence: "active" }
  ];

  const sqlite = {
    prepare: vi.fn((sql: string) => ({
        get: vi.fn((...args: unknown[]) => {
          if (sql.includes("SELECT COALESCE(MAX(seq)")) return { seq: 1 };
          if (sql.includes("SELECT mode, primary_agent_id FROM rooms")) return { mode: "squad", primary_agent_id: "agent-leader" };
          if (sql.includes("SELECT role_prompt, name FROM agent_profiles")) {
            const agentId = args[0];
            return { role_prompt: "", name: agentId === "agent-builder" ? "Builder" : "Project Manager" };
          }
          if (sql.includes("SELECT id FROM messages WHERE run_id")) return undefined;
          if (sql.includes("SELECT payload FROM events WHERE run_id")) {
            return { payload: JSON.stringify(queuedPayloadByRun.get(String(args[0])) ?? {}) };
          }
          if (sql.includes("SELECT payload FROM message_parts")) {
            const messageId = args[0];
            const text = messages.get(String(messageId));
            return text !== undefined ? { payload: JSON.stringify({ text }) } : undefined;
          }
          if (sql.includes("SELECT title, description FROM tasks")) return task;
          return undefined;
        }),
        all: vi.fn((...args: unknown[]) => {
          if (sql.includes("FROM room_participants rp")) {
            return participants.map((participant) => ({
              agentId: participant.agentId,
              role: participant.role,
              name: participant.name,
              adapterId: participant.adapterId,
              presence: participant.presence
            }));
          }
          if (sql.includes("SELECT payload FROM message_parts")) {
            const messageId = args[0];
            const text = messages.get(String(messageId));
            return text !== undefined ? [{ payload: JSON.stringify({ text }) }] : [];
          }
          return [];
        }),
        run: vi.fn(() => ({ changes: 0 }))
      })),
    transaction: vi.fn((fn: () => unknown) => () => fn())
  };
  return {
    sqlite
  } as never;
}

function runRow(overrides: Partial<import("../../orchestrator/src/index.ts").RunRow> = {}): import("../../orchestrator/src/index.ts").RunRow {
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
    updated_at: 1,
    ...overrides
  };
}

async function* asyncGenerator(parts: readonly unknown[], signal?: AbortSignal): AsyncGenerator<unknown> {
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
