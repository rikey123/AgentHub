import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const streamTextMock = vi.hoisted(() => vi.fn());
const resolveProviderMock = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  streamText: streamTextMock,
  jsonSchema: (schema: unknown) => ({ jsonSchema: schema })
}));
vi.mock("../src/provider-registry.ts", () => ({ resolveProvider: resolveProviderMock }));

import { CommandBus, EventBus, type CommandHandler } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { createCancelRunHandler, RunLifecycleService, type RunRow } from "@agenthub/orchestrator";

import type { McpToolDefinition } from "../src/mcp-tool-converter.ts";
import { NativeAgentAdapter } from "../src/native-agent-adapter.ts";
import { PermissionEngine } from "../../permissions/src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let lifecycle: RunLifecycleService | undefined;
let permissions: PermissionEngine | undefined;
let now = 2000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-native-runtime-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase(), now: () => now });
  lifecycle = new RunLifecycleService(currentDatabase(), currentBus(), { now: () => now });
  permissions = new PermissionEngine({ database: currentDatabase(), eventBus: currentBus(), now: () => now });
  currentPermissions().seedBuiltInProfiles();
  seedSoloRoom();
  streamTextMock.mockReset();
  resolveProviderMock.mockReset();
  resolveProviderMock.mockReturnValue({ providerModel: true });
});

afterEach(() => {
  currentPermissions().close();
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  lifecycle = undefined;
  permissions = undefined;
  now = 2000;
  vi.restoreAllMocks();
});

describe("NativeAgentAdapter integration", () => {
  test("completes a Solo Run with streaming, tool events, and cost", async () => {
    const run = createStartingRun("run_native_success");
    const delivered: string[] = [];
    currentBus().subscribeAll((event) => {
      if (event.runId === run.id) delivered.push(event.type);
    });
    const tools: readonly McpToolDefinition[] = [{ name: "file.write", description: "Write a file", inputSchema: { type: "object" } }];
    streamTextMock.mockImplementation(({ tools: aiTools }: { readonly tools: Record<string, { readonly execute: (input: unknown) => Promise<unknown> }> }) => ({
      fullStream: asyncGenerator([
        { type: "text-delta", text: "Hello " },
        { type: "execute-tool", execute: () => aiTools["file.write"]!.execute({ path: "src/foo.ts", content: "hello" }) },
        { type: "text-delta", text: "world" }
      ]),
      usage: Promise.resolve({ inputTokens: 120, outputTokens: 45, inputTokenDetails: { cacheReadTokens: 12 } })
    }));

    await new NativeAgentAdapter({
      database: currentDatabase(),
      eventBus: currentBus() as unknown as import("../../bus/src/index.ts").EventBus,
      lifecycle: currentLifecycle(),
      permissions: currentPermissions(),
      modelConfig: openAiModelConfig(),
      apiKey: "test-key",
      mcpTools: tools,
      mcpToolExecutor: async (name, input) => ({ ok: true, data: { name, input, written: true } }),
      now: () => now
    }).runManaged(run);
    currentBus().flushDeltas();

    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({ model: { providerModel: true }, abortSignal: expect.any(AbortSignal), tools: expect.objectContaining({ "file.write": expect.any(Object) }) }));
    expect(eventTypesForRun(run.id)).toEqual([
      "agent.run.queued",
      "agent.run.started",
      "permission.resolved",
      "tool.call.requested",
      "tool.call.completed",
      "agent.run.completed",
      "message.brief.published",
      "permission.run_summary"
    ]);
    expect(delivered).toEqual(["permission.resolved", "tool.call.requested", "tool.call.completed", "agent.run.completed", "message.brief.published", "permission.run_summary", "message.part.delta"]);
    expect(eventPayload("tool.call.requested", run.id)).toMatchObject({ name: "file.write", input: { path: "src/foo.ts" } });
    expect(eventPayload("tool.call.completed", run.id)).toMatchObject({ ok: true, output: { written: true } });
    expect(eventPayload("agent.run.completed", run.id)).toMatchObject({ cost: { inputTokens: 120, outputTokens: 45, cachedTokens: 12, costUsd: 0.001035, modelId: "gpt-4o" } });
    expect(runCost(run.id)).toMatchObject({ input_tokens: 120, output_tokens: 45, cached_tokens: 12, cost_usd: 0.001035, model_id: "gpt-4o" });
  });

  test("allows model.api_call permission and emits a terminal run summary", async () => {
    seedPermissionRule("rule_allow_openai", "model.api_call.openai", "openai", "allow");
    const run = createStartingRun("run_native_permission_allow");
    streamTextMock.mockReturnValue({ fullStream: asyncGenerator([{ type: "text-delta", text: "allowed" }]), usage: Promise.resolve({ inputTokens: 1, outputTokens: 2 }) });

    await new NativeAgentAdapter({ database: currentDatabase(), eventBus: currentBus() as unknown as import("../../bus/src/index.ts").EventBus, lifecycle: currentLifecycle(), permissions: currentPermissions(), modelConfig: openAiModelConfig(), now: () => now }).runManaged(run);

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(currentLifecycle().read(run.id).status).toBe("completed");
    expect(eventPayload("permission.run_summary", run.id)).toMatchObject({
      runId: run.id,
      decisions: [{ decision: "allowed", modelConfigId: "model_openai", resource: { type: "model.api_call", provider: "openai" } }]
    });
  });

  test("denies model.api_call permission before creating the stream", async () => {
    seedPermissionRule("rule_deny_anthropic", "model.api_call.anthropic", "anthropic", "deny");
    const run = createStartingRun("run_native_permission_deny");

    await new NativeAgentAdapter({ database: currentDatabase(), eventBus: currentBus() as unknown as import("../../bus/src/index.ts").EventBus, lifecycle: currentLifecycle(), permissions: currentPermissions(), modelConfig: anthropicModelConfig(), now: () => now }).runManaged(run);

    expect(resolveProviderMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(currentLifecycle().read(run.id)).toMatchObject({ status: "failed", failure_class: "permission_denied", error: "model.api_call permission denied" });
    expect(eventPayload("agent.run.failed", run.id)).toMatchObject({ reason: "model_api_call_denied", failureClass: "permission_denied" });
    expect(eventPayload("permission.run_summary", run.id)).toMatchObject({ decisions: [{ decision: "denied", modelConfigId: "model_anthropic" }] });
  });

  test("CancelRun aborts the active native stream and finalizes cancellation", async () => {
    const run = createStartingRun("run_native_cancel");
    let abortSignal: AbortSignal | undefined;
    streamTextMock.mockImplementation(({ abortSignal: signal }: { readonly abortSignal: AbortSignal }) => {
      abortSignal = signal;
      return { fullStream: asyncGenerator([{ type: "text-delta", text: "working" }, { type: "wait-for-abort" }], signal), usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }) };
    });
    const adapter = new NativeAgentAdapter({ database: currentDatabase(), eventBus: currentBus() as unknown as import("../../bus/src/index.ts").EventBus, lifecycle: currentLifecycle(), permissions: currentPermissions(), modelConfig: openAiModelConfig(), now: () => now });
    const commandBus = new CommandBus({ database: currentDatabase(), handlers: { CancelRun: createCancelRunHandler({ lifecycle: currentLifecycle(), adapterManager: { cancelRun: (runId) => adapter.cancelManagedRun(runId) } }) as CommandHandler } });

    const running = adapter.runManaged(run);
    await waitFor(() => abortSignal !== undefined);
    const cancelled = await commandBus.dispatch({ type: "CancelRun", runId: run.id }, { actor: { type: "user", id: "user_1" }, traceId: "trace_cancel", origin: "http" });
    await running;

    expect(cancelled).toMatchObject({ ok: true, data: { runId: run.id, status: "cancelling" } });
    expect(abortSignal?.aborted).toBe(true);
    expect(currentLifecycle().read(run.id).status).toBe("cancelled");
    expect(eventTypesForRun(run.id)).toContain("agent.run.cancelled");
    expect(eventPayload("agent.run.cancelled", run.id)).toMatchObject({ runId: run.id });
    await adapter.cancelManagedRun(run.id);
  });
});

function currentDatabase(): AgentHubDatabase { expect(database).toBeDefined(); return database as AgentHubDatabase; }
function currentBus(): EventBus { expect(eventBus).toBeDefined(); return eventBus as EventBus; }
function currentLifecycle(): RunLifecycleService { expect(lifecycle).toBeDefined(); return lifecycle as RunLifecycleService; }
function currentPermissions(): PermissionEngine { expect(permissions).toBeDefined(); return permissions as PermissionEngine; }

function seedSoloRoom(): void {
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_1', 'ws_1', 'Native Agent', 'native', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Solo', 'solo', 'conversation', 'agent_1', NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_1', 'agent_1', 'agent', 'primary', 'native', NULL, 'active', ?)").run(now);
}

function createStartingRun(runId: string): RunRow {
  currentLifecycle().create(null, { runId, workspaceId: "ws_1", roomId: "room_1", agentId: "agent_1", wakeReason: "primary_turn", workspaceMode: "shadow_buffer", messageId: `msg_${runId}` });
  currentLifecycle().markClaimed(null, runId);
  currentLifecycle().markStarting(null, runId, 123);
  return currentLifecycle().read(runId);
}

function seedPermissionRule(id: string, resourceType: string, resourceMatch: string, action: "allow" | "deny"): void {
  currentDatabase().sqlite.prepare("INSERT INTO permission_rules (id, workspace_id, agent_id, profile_id, resource_type, resource_match, action, remember, created_at) VALUES (?, 'ws_1', 'agent_1', NULL, ?, ?, ?, 1, ?)").run(id, resourceType, resourceMatch, action, now);
}

function openAiModelConfig() { return { id: "model_openai", workspace_id: "ws_1", name: "OpenAI", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null, api_key_fingerprint: null, profile: null, created_at: now, updated_at: now }; }
function anthropicModelConfig() { return { id: "model_anthropic", workspace_id: "ws_1", name: "Anthropic", provider: "anthropic", model: "claude-sonnet", base_url: null, api_key_ref: null, api_key_fingerprint: null, profile: null, created_at: now, updated_at: now }; }

async function* asyncGenerator(parts: readonly unknown[], signal?: AbortSignal): AsyncGenerator<unknown> {
  for (const part of parts) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if ((part as { readonly type?: string }).type === "wait-for-abort") {
      await new Promise((_, reject) => { signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }); });
      return;
    }
    if ((part as { readonly type?: string }).type === "execute-tool") {
      await (part as { readonly execute: () => Promise<unknown> }).execute();
      continue;
    }
    yield part;
  }
}

function eventTypesForRun(runId: string): string[] { return currentDatabase().sqlite.prepare("SELECT type FROM events WHERE run_id = ? ORDER BY seq ASC").all(runId).map((row) => (row as { type: string }).type); }
function eventPayload(type: string, runId: string): Record<string, unknown> {
  const row = currentDatabase().sqlite.prepare("SELECT payload FROM events WHERE type = ? AND run_id = ? ORDER BY seq DESC LIMIT 1").get(type, runId) as { payload: string } | undefined;
  expect(row).toBeDefined();
  return JSON.parse((row as { payload: string }).payload) as Record<string, unknown>;
}
function runCost(runId: string) { return currentDatabase().sqlite.prepare("SELECT input_tokens, output_tokens, cached_tokens, cost_usd, model_id FROM runs WHERE id = ?").get(runId); }

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("timed out waiting for predicate");
}
