import { describe, expect, it, vi } from "vitest";

import { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

import { AdapterRegistry } from "../src/adapters/registry.ts";

describe("AdapterRegistry skill materialization failures", () => {
  it("routes Tier 2 ACP runtime kinds through the generic ACP adapter instead of mock", async () => {
    const genericAdapter = {
      runManaged: vi.fn(async () => undefined),
      cancelManagedRun: vi.fn(async () => undefined),
      warmRoomAgent: vi.fn(() => "generic-warm"),
      disposeRoomWarmSessions: vi.fn(),
      disposeAllSessions: vi.fn()
    };
    const mockAdapter = { runAgent: vi.fn(), cancelRun: vi.fn() };
    const registry = new AdapterRegistry({
      database: createDatabaseStub(),
      eventBus: { publish: vi.fn() } as unknown as EventBus,
      lifecycle: lifecycleStub() as never,
      mockAdapter: mockAdapter as never,
      genericAcpAdapterFactory: vi.fn(() => genericAdapter)
    } as never);

    await registry.runAgent(runRow({ adapter_id: "codex" }));

    expect(genericAdapter.runManaged).toHaveBeenCalledWith(expect.objectContaining({ adapter_id: "codex" }));
    expect(mockAdapter.runAgent).not.toHaveBeenCalled();
  });

  it("routes Codex ACP runs with binary file attachments through native model input when a model config is bound", async () => {
    const genericAdapter = {
      runManaged: vi.fn(async () => undefined),
      cancelManagedRun: vi.fn(async () => undefined),
      warmRoomAgent: vi.fn(() => "generic-warm"),
      disposeRoomWarmSessions: vi.fn(),
      disposeAllSessions: vi.fn()
    };
    const nativeAdapter = { runManaged: vi.fn(async () => undefined), cancelManagedRun: vi.fn(async () => undefined), disposeAllRuns: vi.fn() };
    const registry = new AdapterRegistry({
      database: createDatabaseStub({ attachment: { fileName: "report.pdf", mimeType: "application/pdf" }, hasModelConfig: true }),
      eventBus: { publish: vi.fn() } as unknown as EventBus,
      lifecycle: lifecycleStub() as never,
      nativeAdapter,
      genericAcpAdapterFactory: vi.fn(() => genericAdapter)
    } as never);

    await registry.runAgent(runRow({ adapter_id: "codex" }));

    expect(nativeAdapter.runManaged).toHaveBeenCalledWith(expect.objectContaining({ adapter_id: "codex" }));
    expect(genericAdapter.runManaged).not.toHaveBeenCalled();
  });

  it("keeps Codex ACP runs with binary attachments on Codex when no model config is bound", async () => {
    const genericAdapter = {
      runManaged: vi.fn(async () => undefined),
      cancelManagedRun: vi.fn(async () => undefined),
      warmRoomAgent: vi.fn(() => "generic-warm"),
      disposeRoomWarmSessions: vi.fn(),
      disposeAllSessions: vi.fn()
    };
    const nativeAdapter = { runManaged: vi.fn(async () => undefined), cancelManagedRun: vi.fn(async () => undefined), disposeAllRuns: vi.fn() };
    const registry = new AdapterRegistry({
      database: createDatabaseStub({ attachment: { fileName: "report.pdf", mimeType: "application/pdf" } }),
      eventBus: { publish: vi.fn() } as unknown as EventBus,
      lifecycle: lifecycleStub() as never,
      nativeAdapter,
      genericAcpAdapterFactory: vi.fn(() => genericAdapter)
    } as never);

    await registry.runAgent(runRow({ adapter_id: "codex" }));

    expect(genericAdapter.runManaged).toHaveBeenCalledWith(expect.objectContaining({ adapter_id: "codex" }));
    expect(nativeAdapter.runManaged).not.toHaveBeenCalled();
  });

  it("keeps text attachments on Codex ACP", async () => {
    const genericAdapter = {
      runManaged: vi.fn(async () => undefined),
      cancelManagedRun: vi.fn(async () => undefined),
      warmRoomAgent: vi.fn(() => "generic-warm"),
      disposeRoomWarmSessions: vi.fn(),
      disposeAllSessions: vi.fn()
    };
    const nativeAdapter = { runManaged: vi.fn(async () => undefined), cancelManagedRun: vi.fn(async () => undefined), disposeAllRuns: vi.fn() };
    const registry = new AdapterRegistry({
      database: createDatabaseStub({ attachment: { fileName: "notes.md", mimeType: "text/markdown" } }),
      eventBus: { publish: vi.fn() } as unknown as EventBus,
      lifecycle: lifecycleStub() as never,
      nativeAdapter,
      genericAcpAdapterFactory: vi.fn(() => genericAdapter)
    } as never);

    await registry.runAgent(runRow({ adapter_id: "codex" }));

    expect(genericAdapter.runManaged).toHaveBeenCalledWith(expect.objectContaining({ adapter_id: "codex" }));
    expect(nativeAdapter.runManaged).not.toHaveBeenCalled();
  });

  it("emits callback for non-task runs and fails the run", async () => {
    const callback = vi.fn();
    const lifecycle = lifecycleStub();
    const database = createDatabaseStub();
    const eventBus = { publish: vi.fn() } as unknown as EventBus;
    const { SkillMaterializationError } = await import("@agenthub/skills");

    const registry = new AdapterRegistry({
      database,
      eventBus,
      lifecycle: lifecycle as never,
      onSkillMaterializationFailed: callback,
      skillRegistry: {
        materializeForRun: vi.fn(() => {
          throw new SkillMaterializationError({
            skillId: "skill-1",
            skillName: "task-planner",
            workspaceId: "ws-1",
            runId: "run-1",
            error: "disk full"
          });
        }),
        cleanupRun: vi.fn(),
        buildSkillsPromptBlock: vi.fn(() => undefined)
      } as never
    });

    await registry.runAgent(runRow({ task_id: null }));

    expect(callback).toHaveBeenCalledWith({
      skillId: "skill-1",
      skillName: "task-planner",
      workspaceId: "ws-1",
      runId: "run-1",
      error: "disk full"
    });
    expect(lifecycle.fail).toHaveBeenCalledWith(null, "run-1", "skill_materialization_failed", "fatal", "disk full", "");
  });

  it("passes structured failure details to callback for task-associated runs", async () => {
    const callback = vi.fn();
    const lifecycle = lifecycleStub();
    const database = createDatabaseStub();
    const eventBus = { publish: vi.fn() } as unknown as EventBus;

    // Use a real SkillMaterializationError-like object by importing the class dynamically.
    const { SkillMaterializationError } = await import("@agenthub/skills");
    const registry2 = new AdapterRegistry({
      database,
      eventBus,
      lifecycle: lifecycle as never,
      onSkillMaterializationFailed: callback,
      skillRegistry: {
        materializeForRun: vi.fn(() => {
          throw new SkillMaterializationError({
            skillId: "skill-1",
            skillName: "task-planner",
            workspaceId: "ws-1",
            runId: "run-1",
            error: "disk full"
          });
        }),
        cleanupRun: vi.fn(),
        buildSkillsPromptBlock: vi.fn(() => undefined)
      } as never
    });

    await registry2.runAgent(runRow({ task_id: "task-1" }));

    expect(callback).toHaveBeenCalledWith({
      taskId: "task-1",
      skillId: "skill-1",
      skillName: "task-planner",
      workspaceId: "ws-1",
      runId: "run-1",
      error: "disk full"
    });
    expect(lifecycle.fail).toHaveBeenCalledWith(null, "run-1", "skill_materialization_failed", "fatal", "disk full", "");
  });
});

function lifecycleStub() {
  return {
    fail: vi.fn(),
    markRunning: vi.fn(),
    updateSessionState: vi.fn(),
    markCancelling: vi.fn(),
    complete: vi.fn(),
    cancelFinalized: vi.fn()
  };
}

function createDatabaseStub(options: { readonly attachment?: { readonly fileName: string; readonly mimeType: string }; readonly hasModelConfig?: boolean } = {}): AgentHubDatabase {
  return {
    sqlite: {
      prepare: vi.fn((sql: string) => ({
        get: vi.fn(() => {
          if (sql.includes("SELECT payload FROM events WHERE run_id")) return options.attachment !== undefined ? { payload: JSON.stringify({ messageId: "msg-user" }) } : undefined;
          if (sql.includes("SELECT file_name AS fileName")) return options.attachment;
          if (sql.includes("ab.model_config_id IS NOT NULL")) return options.hasModelConfig === true ? { 1: 1 } : undefined;
          if (sql.includes("SELECT root_path FROM workspaces")) return { root_path: "." };
          if (sql.includes("SELECT adapter_id FROM agent_profiles")) return { adapter_id: "mock" };
          if (sql.includes("SELECT workspace_id FROM rooms")) return { workspace_id: "ws-1" };
          return undefined;
        }),
        all: vi.fn(() => {
          if (sql.includes("SELECT payload FROM message_parts")) {
            return options.attachment !== undefined
              ? [{ payload: JSON.stringify({ fileId: "file-1", name: options.attachment.fileName, mimeType: options.attachment.mimeType }) }]
              : [];
          }
          return [];
        }),
        run: vi.fn(() => ({ changes: 0 }))
      })),
      transaction: vi.fn((fn: () => unknown) => () => fn())
    }
  } as never;
}

function runRow(overrides: Partial<import("@agenthub/orchestrator").RunRow> = {}): import("@agenthub/orchestrator").RunRow {
  return {
    id: "run-1",
    workspace_id: "ws-1",
    task_id: "task-1",
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
    workspace_mode: "shared",
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
