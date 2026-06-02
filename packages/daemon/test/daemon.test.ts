import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHubClient } from "@agenthub/sdk";
import { createEventBus } from "@agenthub/bus";
import { createDatabase } from "@agenthub/db";
import { Effect, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdapterRegistry } from "../src/adapters/registry.ts";
import { seedBuiltinRoles } from "../src/builtin-roles.ts";
import { migrateAgentProfilesToV10 } from "../src/migrations/0014_data.ts";
import { createDaemon, finalizeFailedRoleGenerationJob, loadAgentHubConfig, type DaemonApp, type DaemonStartupPhase, type RoleDraftGenerator } from "../src/index.ts";
import { checkTaskTimeouts } from "@agenthub/orchestrator";
import { cleanExpiredRoleDrafts, startRoleDraftGC } from "../src/role-draft-gc.ts";
import { CodexAdapterStub } from "../../adapters/codex/src/index.ts";

const resolveProviderMock = vi.hoisted(() => vi.fn());
const streamTextMock = vi.hoisted(() => vi.fn());
const nativeAdapterCtorMock = vi.hoisted(() => vi.fn());
const nativeAdapterRunManagedMock = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  streamText: streamTextMock
}));

vi.mock("../../native-agent-runtime/src/provider-registry.ts", () => ({
  resolveProvider: resolveProviderMock
}));

vi.mock("../../native-agent-runtime/src/native-agent-adapter.ts", () => ({
  NativeAgentAdapter: class {
    readonly options: { readonly permissions?: { readonly check?: (input: { readonly workspaceId: string; readonly roomId?: string; readonly agentId?: string; readonly runId: string; readonly resource: { readonly type: string; readonly provider: string } }) => { readonly status: "allow" | "deny" | "expire" } } };

    constructor(options: never) {
      nativeAdapterCtorMock(options);
      this.options = options as never;
    }

    async runManaged(run: { readonly id: string; readonly workspace_id: string; readonly room_id: string | null; readonly agent_id: string | null; readonly wake_reason?: string | null; readonly status?: string }) {
      nativeAdapterRunManagedMock(run);
      const decision = this.options.permissions?.check?.({ workspaceId: run.workspace_id, ...(run.room_id !== null ? { roomId: run.room_id } : {}), ...(run.agent_id !== null ? { agentId: run.agent_id } : {}), runId: run.id, resource: { type: "model.api_call", provider: "openai" } }) ?? { status: "allow" as const };
      if (decision.status === "allow") {
        if (run.wake_reason === "plan") {
          const lifecycle = (this.options as { readonly lifecycle?: { readonly markStarting?: (tx: null, runId: string, pid: number) => void; readonly markRunning?: (tx: null, runId: string, sessionId: string) => void; readonly complete?: (tx: null, runId: string, cost: { readonly inputTokens: number; readonly outputTokens: number; readonly cachedTokens: number; readonly costUsd: number; readonly modelId: string }, briefText?: string) => void } }).lifecycle;
          if (run.status !== "starting") lifecycle?.markStarting?.(null, run.id, 1);
          lifecycle?.markRunning?.(null, run.id, `session-${run.id}`);
          lifecycle?.complete?.(null, run.id, { inputTokens: 1, outputTokens: 1, cachedTokens: 0, costUsd: 0, modelId: "test-plan" }, "plan completed");
          const options = this.options as { readonly onPlanPhaseEnded?: (runId: string, planText?: string) => Promise<void> | void };
          await options.onPlanPhaseEnded?.(run.id, "```json\n{\"goal\":\"ship\",\"tasks\":[{\"title\":\"Build\",\"description\":\"Implement it\",\"assigneeRole\":\"Builder\"}]}\n```");
          return;
        }
        if (run.wake_reason === "execute") {
          const lifecycle = (this.options as { readonly lifecycle?: { readonly markStarting?: (tx: null, runId: string, pid: number) => void; readonly markRunning?: (tx: null, runId: string, sessionId: string) => void; readonly complete?: (tx: null, runId: string, cost: { readonly inputTokens: number; readonly outputTokens: number; readonly cachedTokens: number; readonly costUsd: number; readonly modelId: string }, briefText?: string) => void } }).lifecycle;
          if (run.status !== "starting") lifecycle?.markStarting?.(null, run.id, 1);
          lifecycle?.markRunning?.(null, run.id, `session-${run.id}`);
          lifecycle?.complete?.(null, run.id, { inputTokens: 1, outputTokens: 1, cachedTokens: 0, costUsd: 0, modelId: "test-execute" }, "execute completed");
          return;
        }
        resolveProviderMock({ id: "mock-native-config", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null }, "test-key");
        streamTextMock({});
      }
    }

    async cancelManagedRun() {
      return undefined;
    }
  }
}));

let currentDaemon: DaemonApp | undefined;
type TestKeychain = {
  readonly set: ReturnType<typeof vi.fn<(account: string, secret: string) => Promise<void>>>;
  readonly get: ReturnType<typeof vi.fn<(account: string) => Promise<string | null>>>;
  readonly delete: ReturnType<typeof vi.fn<(account: string) => Promise<boolean>>>;
};
let currentModelConfigKeychain: TestKeychain | undefined;
type TestFetch = typeof fetch & ReturnType<typeof vi.fn>;

vi.mock("@agenthub/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agenthub/security")>();
  return {
    ...actual,
    createKeychain: () => {
      const secrets = new Map<string, string>();
      const bridge: TestKeychain = {
        set: vi.fn(async (account, secret) => {
          secrets.set(account, secret);
        }),
        get: vi.fn(async (account) => secrets.get(account) ?? null),
        delete: vi.fn(async (account) => secrets.delete(account))
      };
      currentModelConfigKeychain = bridge;
      return bridge;
    }
  };
});

describe("daemon M1.4 composition", () => {
  let daemon: DaemonApp;
  let baseUrl: string;
  let modelTestFetchMock: TestFetch;
  let roleDraftGeneratorMock: ReturnType<typeof vi.fn<RoleDraftGenerator>>;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-test-"));
    modelTestFetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
      if (url.includes("/v1/chat/completions")) {
        return new Response(JSON.stringify({ model: "gpt-4o", usage: { prompt_token_count: 1, completion_token_count: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/chat")) {
        return new Response(JSON.stringify({ model: "llama3.1", prompt_eval_count: 1, eval_count: 1 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401, headers: { "content-type": "application/json" } });
    }) as TestFetch;
    roleDraftGeneratorMock = vi.fn(async () => ({
      name: "Generated Reviewer",
      description: "AI generated reviewer",
      prompt: "Review frontend refactors with care.",
      capabilities: ["chat", "code.review"],
      suggestedPermissionProfileId: "perm-readonly"
    }));
    daemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0, modelTestFetch: modelTestFetchMock, roleDraftGenerator: roleDraftGeneratorMock });
    currentDaemon = daemon;
    const server = await daemon.start();
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("expected TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await daemon.close();
    currentDaemon = undefined;
    currentModelConfigKeychain = undefined;
  });

  it("serves OpenAPI and runs Mock Solo through SDK", async () => {
    const client = new AgentHubClient({ baseUrl });
    await expect(client.health()).resolves.toEqual({ ok: true });
    const openapi = await client.openApi() as { readonly openapi?: string };
    expect(openapi.openapi).toBe("3.1.0");
    const room = await client.createRoom({ title: "Golden", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    const sent = await client.sendMessage(room.data.roomId, { text: "hello", idempotencyKey: "hello-1" }) as { readonly ok: boolean };
    expect(sent.ok).toBe(true);

    const runs = daemon.database.sqlite.prepare("SELECT status FROM runs ORDER BY created_at ASC").all() as { status: string }[];
    expect(runs.map((run) => run.status)).toEqual(["completed"]);
    const messages = await client.listMessages(room.data.roomId) as { readonly messages: readonly { readonly role: string; readonly status: string }[] };
    expect(messages.messages.some((message) => message.role === "assistant" && message.status === "completed")).toBe(true);
  });

  it("rejects squad rooms without leaderRoleId", async () => {
    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Squad Room", mode: "squad", primaryAgentId: "mock-builder" })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "squad_mode_requires_leader_role_id" });
  });

  it("creates team rooms with leaderRoleId and resolves V1.0 participants", async () => {
    const workspaceId = "default-workspace";
    const now = Date.now();
    const runtimeId = `runtime-team-${now}`;
    const leaderRoleId = `role-leader-${now}`;
    const teammateRoleId = `role-teammate-${now}`;
    const leaderBindingId = `binding-leader-${now}`;
    const teammateBindingId = `binding-teammate-${now}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, '[]', NULL, NULL, 0, NULL, NULL, ?, ?)").run(leaderRoleId, workspaceId, "Project Manager", "Leader prompt", now, now);
      daemon.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, '[]', NULL, NULL, 0, NULL, NULL, ?, ?)").run(teammateRoleId, workspaceId, "Builder", "Teammate prompt", now, now);
      daemon.database.sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, ?, 'custom-acp', ?, NULL, NULL, NULL, NULL, NULL, NULL, '[]', NULL, NULL, ?, ?, ?)").run(runtimeId, workspaceId, "Team Runtime", now, now, now);
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)").run(leaderBindingId, workspaceId, leaderRoleId, runtimeId, now, now);
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)").run(teammateBindingId, workspaceId, teammateRoleId, runtimeId, now, now);
    })();

    const created = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Team Room",
        mode: "team",
        leaderRoleId,
        participants: [
          { roleId: leaderRoleId, runtimeId },
          { roleId: teammateRoleId, runtimeId }
        ]
      })
    });
    const createdBody = await created.json() as { readonly data?: { readonly roomId?: string; readonly leaderRoleId?: string } };

    expect(created.status).toBe(201);
    expect(createdBody.data).toMatchObject({ leaderRoleId });
    const roomId = createdBody.data?.roomId ?? "";
    expect(roomId).not.toBe("");
    expect(daemon.database.sqlite.prepare("SELECT mode, leader_role_id, primary_agent_id FROM rooms WHERE id = ?").get(roomId)).toMatchObject({ mode: "team", leader_role_id: leaderRoleId, primary_agent_id: leaderBindingId });
    expect(daemon.database.sqlite.prepare("SELECT participant_id, role, agent_binding_id FROM room_participants WHERE room_id = ? ORDER BY joined_at ASC").all(roomId)).toMatchObject([
      { participant_id: leaderBindingId, role: "primary", agent_binding_id: leaderBindingId },
      { participant_id: teammateBindingId, role: "teammate", agent_binding_id: teammateBindingId }
    ]);
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'room.created' AND json_extract(payload, '$.leaderRoleId') = ?").get(leaderRoleId)).toMatchObject({ count: 1 });
  });

  it("does not expose legacy agent profiles as role choices on fresh startup", async () => {
    const response = await fetch(`${baseUrl}/roles`);
    const roles = await response.json() as readonly { readonly id: string; readonly name: string }[];

    expect(response.status).toBe(200);
    expect(roles.map((role) => role.name)).toEqual([
      "Archivist",
      "Builder",
      "Generalist",
      "Project Manager",
      "Reviewer"
    ]);
    expect(roles.map((role) => role.id)).not.toEqual(expect.arrayContaining([
      "mock-builder",
      "mock-reviewer",
      "claude-code-builder",
      "claude-code-reviewer",
      "builder-opencode"
    ]));
  });

  it("keeps solo rooms compatible with primaryAgentId and participants", async () => {
    const created = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Solo Room",
        mode: "solo",
        primaryAgentId: "mock-builder",
        participants: [{ type: "agent", agentId: "mock-observer" }]
      })
    });
    const createdBody = await created.json() as { readonly data?: { readonly roomId?: string } };

    expect(created.status).toBe(201);
    const roomId = createdBody.data?.roomId ?? "";
    expect(roomId).not.toBe("");
    expect(daemon.database.sqlite.prepare("SELECT mode, leader_role_id, primary_agent_id FROM rooms WHERE id = ?").get(roomId)).toMatchObject({ mode: "solo", leader_role_id: null, primary_agent_id: "mock-builder" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM room_participants WHERE room_id = ?").get(roomId)).toMatchObject({ count: 2 });
  });

  it("backfills v1.0 role/runtime/model config bindings from agent profiles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-v10-data-"));
    const databasePath = join(dir, "agenthub.sqlite");
    const seeded = createDatabase({ path: databasePath, applyMigrations: true });
    try {
      seeded.sqlite.transaction(() => {
        seeded.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("ws_v10", "Workspace", dir, 1, 1);
        seeded.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)").run("room_v10", "ws_v10", "Room", "solo", "conversation", "agent_a", 1, 1);
        seeded.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, description, avatar, version, provider, default_presence, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?)").run("agent_a", "ws_v10", "Agent A", "First profile", "openai", "active", "claude-code", "gpt-4.1", "Prompt A", JSON.stringify(["chat", "code.edit"]), 1, 1);
        seeded.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, description, avatar, version, provider, default_presence, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?)").run("agent_b", "ws_v10", "Agent B", "Second profile", "openai", "active", "claude-code", "gpt-4.1", "Prompt B", JSON.stringify(["chat", "code.review"]), 2, 2);
        seeded.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)").run("room_v10", "agent_a", "agent", "primary", "claude-code", "active", 1);
        seeded.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)").run("room_v10", "agent_b", "agent", "teammate", "claude-code", "active", 2);
        seeded.sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, title, description, status, assignee_agent_id, source_run_id, source_message_id, dependencies, priority, delegation_chain, expects_review, due_at, created_by, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, 0, NULL, ?, ?, ?)").run("task_v10_a", "ws_v10", "room_v10", "Task A", "First task", "open", "agent_a", "[]", "system", 1, 1);
        seeded.sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, title, description, status, assignee_agent_id, source_run_id, source_message_id, dependencies, priority, delegation_chain, expects_review, due_at, created_by, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, 0, NULL, ?, ?, ?)").run("task_v10_b", "ws_v10", "room_v10", "Task B", "Second task", "open", "agent_b", "[]", "system", 2, 2);
      })();
      migrateAgentProfilesToV10(seeded, 99);

      expect(seeded.sqlite.prepare("SELECT COUNT(*) AS count FROM roles").get()).toMatchObject({ count: 2 });
      expect(seeded.sqlite.prepare("SELECT COUNT(*) AS count FROM runtimes").get()).toMatchObject({ count: 1 });
      expect(seeded.sqlite.prepare("SELECT COUNT(*) AS count FROM model_configs").get()).toMatchObject({ count: 1 });
      expect(seeded.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_bindings").get()).toMatchObject({ count: 2 });
      expect(seeded.sqlite.prepare("SELECT agent_binding_id FROM room_participants WHERE participant_id = 'agent_a'").get()).toMatchObject({ agent_binding_id: "agent_a" });
      expect(seeded.sqlite.prepare("SELECT agent_binding_id FROM room_participants WHERE participant_id = 'agent_b'").get()).toMatchObject({ agent_binding_id: "agent_b" });
      expect(seeded.sqlite.prepare("SELECT assignee_role_id, assignee_binding_id FROM tasks WHERE id = 'task_v10_a'").get()).toMatchObject({ assignee_role_id: "agent_a", assignee_binding_id: "agent_a" });
      expect(seeded.sqlite.prepare("SELECT assignee_role_id, assignee_binding_id FROM tasks WHERE id = 'task_v10_b'").get()).toMatchObject({ assignee_role_id: "agent_b", assignee_binding_id: "agent_b" });

      migrateAgentProfilesToV10(seeded, 100);
      expect(seeded.sqlite.prepare("SELECT COUNT(*) AS count FROM roles").get()).toMatchObject({ count: 2 });
      expect(seeded.sqlite.prepare("SELECT COUNT(*) AS count FROM runtimes").get()).toMatchObject({ count: 1 });
      expect(seeded.sqlite.prepare("SELECT COUNT(*) AS count FROM model_configs").get()).toMatchObject({ count: 1 });
      expect(seeded.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_bindings").get()).toMatchObject({ count: 2 });
    } finally {
      seeded.sqlite.close();
    }
  });

  it("starts and shuts down daemon phases in spec order", async () => {
    await daemon.close();
    currentDaemon = undefined;
    const phases: { readonly direction: "startup" | "shutdown"; readonly phase: DaemonStartupPhase }[] = [];
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-phases-"));
    const databasePath = join(dir, "agenthub.sqlite");
    const phasedDaemon = createDaemon({ databasePath, port: 0, modelTestFetch: modelTestFetchMock, onLifecyclePhase: (event) => phases.push(event) });

    await phasedDaemon.start();
    phasedDaemon.database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_type, participant_id, role, default_presence, adapter_id, adapter_session_id, joined_at) VALUES ('room_close', 'agent', 'agent_close', 'primary', 'active', 'claude-code', 'stale-session', 1)").run();
    await phasedDaemon.close();

    const expectedStartup: readonly DaemonStartupPhase[] = [
      "SQLite open + pragma + migrate",
      "EventStore readiness check",
      "EventBus (PubSub + per-type)",
      "Outbox Dispatcher start",
      "Durable Handler Registry (register all, catch-up, realtime)",
      "RunQueue Worker start",
      "AdapterManager detect + register",
      "CommandBus open",
      "HTTP server bind + SSE accept"
    ];
    const expectedShutdown: readonly DaemonStartupPhase[] = [
      "HTTP server bind + SSE accept",
      "CommandBus open",
      "RunQueue Worker start",
      "AdapterManager detect + register",
      "Outbox Dispatcher start",
      "Durable Handler Registry (register all, catch-up, realtime)",
      "EventBus (PubSub + per-type)",
      "EventStore readiness check",
      "SQLite open + pragma + migrate"
    ];
    expect(phases.filter((event) => event.direction === "startup").map((event) => event.phase)).toEqual(expectedStartup);
    expect(phases.filter((event) => event.direction === "shutdown").map((event) => event.phase)).toEqual(expectedShutdown);
    const reopened = createDatabase({ path: databasePath, applyMigrations: false });
    try {
      expect(reopened.sqlite.prepare("SELECT adapter_session_id FROM room_participants WHERE room_id = 'room_close' AND participant_id = 'agent_close'").get()).toMatchObject({ adapter_session_id: null });
    } finally {
      reopened.sqlite.close();
    }
  });

  it("cleans expired role drafts on startup and never emits role generation events", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-role-drafts-startup-"));
    const databasePath = join(dir, "agenthub.sqlite");
    const seeded = createDatabase({ path: databasePath, applyMigrations: true });
    try {
      seeded.sqlite.transaction(() => {
        seeded.sqlite.prepare("INSERT INTO role_drafts (job_id, description, target_work, preferred_tone, capabilities, model_config_id, draft_json, status, failure_reason, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("job-expired", "Expired draft", null, null, null, "mc_1", null, "pending", null, 100, 100, 200);
        seeded.sqlite.prepare("INSERT INTO role_drafts (job_id, description, target_work, preferred_tone, capabilities, model_config_id, draft_json, status, failure_reason, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("job-active", "Active draft", null, null, null, "mc_1", null, "pending", null, 100, 100, 10_000);
      })();
    } finally {
      seeded.sqlite.close();
    }

    const seededDaemon = createDaemon({ databasePath, port: 0, modelTestFetch: modelTestFetchMock, now: () => 500 });
    await seededDaemon.start();

    expect(seededDaemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM role_drafts WHERE job_id = 'job-expired'").get()).toMatchObject({ count: 0 });
    expect(seededDaemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM role_drafts WHERE job_id = 'job-active'").get()).toMatchObject({ count: 1 });
    expect(seededDaemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'role.generation.%'").get()).toMatchObject({ count: 0 });

    await seededDaemon.close();
  });

  it("reconciles terminal delegated task statuses on startup", async () => {
    await daemon.close();
    currentDaemon = undefined;
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-task-reconcile-"));
    const databasePath = join(dir, "agenthub.sqlite");
    const seeded = createDatabase({ path: databasePath, applyMigrations: true });
    try {
      seeded.sqlite.transaction(() => {
        seeded.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_reconcile', 'Workspace', '.', 1, 1)").run();
        seeded.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_leader_reconcile', 'ws_reconcile', 'Leader', '', '[]', 0, 1, 1)").run();
        seeded.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_builder_reconcile', 'ws_reconcile', 'Builder', '', '[]', 0, 1, 1)").run();
        seeded.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_leader_reconcile', 'ws_reconcile', 'Leader', 'mock', NULL, '', '{}', NULL, 0, NULL, 1, 1)").run();
        seeded.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_builder_reconcile', 'ws_reconcile', 'Builder', 'mock', NULL, '', '{}', NULL, 0, NULL, 1, 1)").run();
        seeded.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_leader_reconcile', 'ws_reconcile', 'role_leader_reconcile', 'runtime_1', NULL, NULL, 1, 1)").run();
        seeded.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_builder_reconcile', 'ws_reconcile', 'role_builder_reconcile', 'runtime_1', NULL, NULL, 1, 1)").run();
        seeded.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, leader_role_id, archived_at, created_at, updated_at) VALUES ('room_reconcile_startup', 'ws_reconcile', 'Team', 'team', 'conversation', 'agent_leader_reconcile', 'role_leader_reconcile', NULL, 1, 1)").run();
        seeded.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES ('room_reconcile_startup', 'agent_leader_reconcile', 'agent', 'primary', 'mock', NULL, 'binding_leader_reconcile', 'active', 1)").run();
        seeded.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES ('room_reconcile_startup', 'agent_builder_reconcile', 'agent', 'teammate', 'mock', NULL, 'binding_builder_reconcile', 'active', 1)").run();
        seeded.sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, delegation_chain, title, description, status, assignee_agent_id, assignee_role_id, assignee_binding_id, source_run_id, source_message_id, dependencies, priority, expects_review, due_at, created_by, created_at, updated_at) VALUES ('task_reconcile_a', 'ws_reconcile', 'room_reconcile_startup', NULL, NULL, 'A', NULL, 'pending', 'agent_builder_reconcile', 'role_builder_reconcile', 'binding_builder_reconcile', 'run_source_reconcile', NULL, '[]', NULL, 0, NULL, 'agent_leader_reconcile', 1, 1)").run();
        seeded.sqlite.prepare("INSERT INTO tasks (id, workspace_id, room_id, parent_task_id, delegation_chain, title, description, status, assignee_agent_id, assignee_role_id, assignee_binding_id, source_run_id, source_message_id, dependencies, priority, expects_review, due_at, created_by, created_at, updated_at) VALUES ('task_reconcile_b', 'ws_reconcile', 'room_reconcile_startup', NULL, NULL, 'B', NULL, 'pending', 'agent_builder_reconcile', 'role_builder_reconcile', 'binding_builder_reconcile', 'run_source_reconcile', NULL, '[]', NULL, 0, NULL, 'agent_leader_reconcile', 1, 1)").run();
        seeded.sqlite.prepare("INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES ('run_reconcile_a', 'ws_reconcile', 'task_reconcile_a', 'room_reconcile_startup', 'agent_builder_reconcile', 'mock', NULL, NULL, NULL, 'completed', 'delegated_task', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, 2, 3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 3)").run();
        seeded.sqlite.prepare("INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES ('run_reconcile_b', 'ws_reconcile', 'task_reconcile_b', 'room_reconcile_startup', 'agent_builder_reconcile', 'mock', NULL, NULL, NULL, 'completed', 'delegated_task', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, 2, 4, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 4)").run();
      })();
    } finally {
      seeded.sqlite.close();
    }

    const seededDaemon = createDaemon({ databasePath, port: 0, modelTestFetch: modelTestFetchMock, now: () => 500 });
    await seededDaemon.start();

    expect(seededDaemon.database.sqlite.prepare("SELECT status, expects_review FROM tasks WHERE id = 'task_reconcile_a'").get()).toMatchObject({ status: "review", expects_review: 1 });
    expect(seededDaemon.database.sqlite.prepare("SELECT status, expects_review FROM tasks WHERE id = 'task_reconcile_b'").get()).toMatchObject({ status: "review", expects_review: 1 });
    expect(seededDaemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'team.dispatch.started' AND json_extract(payload, '$.sourceRunId') = 'run_source_reconcile'").get()).toMatchObject({ count: 1 });

    await seededDaemon.close();
  });

  it("runs hourly role draft GC and stops on cleanup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-role-drafts-gc-"));
    const databasePath = join(dir, "agenthub.sqlite");
    const database = createDatabase({ path: databasePath, applyMigrations: true });
    try {
      database.sqlite.prepare("INSERT INTO role_drafts (job_id, description, target_work, preferred_tone, capabilities, model_config_id, draft_json, status, failure_reason, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("job-expired", "Expired draft", null, null, null, "mc_1", null, "pending", null, 100, 100, 200);
      database.sqlite.prepare("INSERT INTO role_drafts (job_id, description, target_work, preferred_tone, capabilities, model_config_id, draft_json, status, failure_reason, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("job-active", "Active draft", null, null, null, "mc_1", null, "pending", null, 100, 100, 10_000_000);

      vi.useFakeTimers();
      vi.setSystemTime(new Date(500));
      const onClose = vi.fn();
      const cleanup = startRoleDraftGC(database, onClose);

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM role_drafts WHERE job_id = 'job-expired'").get()).toMatchObject({ count: 0 });
      expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM role_drafts WHERE job_id = 'job-active'").get()).toMatchObject({ count: 1 });

      cleanup();
      expect(onClose).toHaveBeenCalledTimes(1);

      database.sqlite.prepare("INSERT INTO role_drafts (job_id, description, target_work, preferred_tone, capabilities, model_config_id, draft_json, status, failure_reason, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("job-expired-2", "Expired draft 2", null, null, null, "mc_1", null, "pending", null, 100, 100, 200);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM role_drafts WHERE job_id = 'job-expired-2'").get()).toMatchObject({ count: 1 });
    } finally {
      vi.useRealTimers();
      database.sqlite.close();
    }
  });

  it("registers native-default runtime on startup and exposes runtime CRUD", async () => {
    const native = daemon.database.sqlite.prepare("SELECT id, kind, name, supported_caps, manifest_json FROM runtimes WHERE id = 'native-default'").get() as { readonly id: string; readonly kind: string; readonly name: string; readonly supported_caps: string; readonly manifest_json: string } | undefined;
    expect(native).toMatchObject({ id: "native-default", kind: "native", name: "AgentHub Native" });
    expect(native?.supported_caps).toBe("[]");
    expect(JSON.parse(native?.manifest_json ?? "{}") as { readonly runtimeKind?: string }).toMatchObject({ runtimeKind: "native" });
    const seededCatalog = daemon.database.sqlite.prepare("SELECT id, kind, command, args, status, manifest_json FROM runtimes WHERE id IN ('runtime-codex', 'runtime-qwen', 'runtime-goose', 'runtime-kimi', 'runtime-kiro', 'runtime-hermes') ORDER BY id ASC").all() as Array<{ readonly id: string; readonly kind: string; readonly command: string | null; readonly args: string | null; readonly status: string | null; readonly manifest_json: string }>;
    expect(seededCatalog.map((runtime) => runtime.kind).sort()).toEqual(["codex", "goose", "hermes", "kimi", "kiro", "qwen"]);
    const seededCodex = seededCatalog.find((runtime) => runtime.id === "runtime-codex");
    expect(seededCodex).toMatchObject({
      kind: "codex",
      command: "npx",
      args: JSON.stringify(["-y", "@zed-industries/codex-acp@0.9.5"])
    });
    expect(["missing", "connected"]).toContain(seededCodex?.status);
    expect(JSON.parse(seededCodex?.manifest_json ?? "{}")).toMatchObject({ runtimeKind: "codex", detectCommand: "codex", skillDir: ".codex/skills" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'runtime.detected' AND json_extract(payload, '$.runtimeId') = 'native-default'").get()).toMatchObject({ count: 1 });
    expectDetailOnlyEvent(daemon, "runtime.detected", "runtimeId", "native-default");
  
    const created = await fetch(`${baseUrl}/runtimes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "runtime-custom-1", name: "Custom Runtime", command: "custom-acp", args: ["--one"], env: { FOO: "bar" }, supportedCaps: ["chat"], manifestJson: JSON.stringify({ runtimeKind: "custom-acp" }) })
    });
    const createdPayload = await created.json() as { readonly runtime?: { readonly id: string; readonly name: string; readonly kind: string } | null };
    expect(created.status).toBe(201);
    expect(createdPayload.runtime).toMatchObject({ id: "runtime-custom-1", name: "Custom Runtime", kind: "custom-acp" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'runtime.detected' AND json_extract(payload, '$.runtimeId') = 'runtime-custom-1'").get()).toMatchObject({ count: 1 });
    expectDetailOnlyEvent(daemon, "runtime.detected", "runtimeId", "runtime-custom-1");

    const createdKnownRuntime = await fetch(`${baseUrl}/runtimes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "runtime-codex-manual", kind: "codex", name: "Codex Manual", command: "npx", args: ["-y", "@zed-industries/codex-acp@0.9.5"], supportedCaps: ["chat"], manifestJson: JSON.stringify({ runtimeKind: "codex", detectCommand: "codex" }) })
    });
    const createdKnownPayload = await createdKnownRuntime.json() as { readonly runtime?: { readonly id: string; readonly kind: string; readonly name: string } | null };
    expect(createdKnownRuntime.status).toBe(201);
    expect(createdKnownPayload.runtime).toMatchObject({ id: "runtime-codex-manual", kind: "codex", name: "Codex Manual" });

    const patched = await fetch(`${baseUrl}/runtimes/runtime-custom-1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Custom Runtime Updated", args: ["--two"], env: { BAZ: "qux" }, status: "ready" })
    });
    const patchedPayload = await patched.json() as { readonly runtime?: { readonly name: string } | null };
    expect(patched.status).toBe(200);
    expect(patchedPayload.runtime).toMatchObject({ name: "Custom Runtime Updated" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'runtime.updated' AND json_extract(payload, '$.runtimeId') = 'runtime-custom-1'").get()).toMatchObject({ count: 1 });
    expectDetailOnlyEvent(daemon, "runtime.updated", "runtimeId", "runtime-custom-1");

    const deleted = await fetch(`${baseUrl}/runtimes/runtime-custom-1`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM runtimes WHERE id = 'runtime-custom-1'").get()).toMatchObject({ count: 0 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'runtime.removed' AND json_extract(payload, '$.runtimeId') = 'runtime-custom-1'").get()).toMatchObject({ count: 1 });
    expectDetailOnlyEvent(daemon, "runtime.removed", "runtimeId", "runtime-custom-1");
  });

  it("dispatches native runs through NativeAgentAdapter and keeps Codex stubbed", async () => {
    const runtimeId = `runtime-native-${Date.now()}`;
    const modelConfigId = `model-native-${Date.now()}`;
    const roleId = `role-native-${Date.now()}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, '[]', NULL, NULL, 0, NULL, NULL, ?, ?)").run(roleId, "default-workspace", "Native Role", "Native prompt", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, ?, 'native', ?, NULL, NULL, NULL, NULL, NULL, 'native', '[]', NULL, NULL, ?, ?, ?)").run(runtimeId, "default-workspace", "Native Runtime", JSON.stringify({ runtimeKind: "native" }), Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run(modelConfigId, "default-workspace", "Native Model", "ollama", "native-model", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)").run("binding-native-test", "default-workspace", roleId, runtimeId, modelConfigId, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?)").run("native-agent", "default-workspace", "Native Agent", "native", "native-model", "Native prompt", JSON.stringify(["chat"]), Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)").run("room-native-test", "default-workspace", "Native Room", "solo", "conversation", "native-agent", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)").run("room-native-test", "native-agent", "agent", "primary", "native", "binding-native-test", "active", Date.now());
      daemon.database.sqlite.prepare("INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, 'queued', 'primary_turn', NULL, NULL, NULL, 'shadow_buffer', NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?) ").run("run-native-test", "default-workspace", "room-native-test", "native-agent", runtimeId, Date.now(), Date.now());
    })();

    const nativeRun = daemon.database.sqlite.prepare("SELECT * FROM runs WHERE id = 'run-native-test'").get() as { readonly id: string; readonly agent_id: string; readonly adapter_id: string | null };
    const calls: string[] = [];
    const lifecycle = {
      read: () => nativeRun,
      markCancelling: vi.fn(),
      markClaimed: vi.fn(),
      markStarting: vi.fn(),
      fail: vi.fn(),
      complete: vi.fn(),
      cancelFinalized: vi.fn()
    } as never;
    const registry = new AdapterRegistry({
      database: daemon.database,
      eventBus: daemon.eventBus,
      lifecycle,
      mockAdapter: daemon.mockAdapter,
      nativeAdapter: {
      runManaged: async (run: import("../../orchestrator/src/index.ts").RunRow) => { calls.push(`run:${run.id}`); },
      cancelManagedRun: async (runId: string) => { calls.push(`cancel:${runId}`); }
      } as never
    });

    await registry.runAgent(nativeRun as never);
    await registry.cancelRun("run-native-test");

    expect(calls).toEqual(["run:run-native-test", "cancel:run-native-test"]);
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM runtimes WHERE id = 'native-default'").get()).toMatchObject({ count: 1 });
    expect(() => Effect.runSync(Stream.runDrain(new CodexAdapterStub().runAgent({ runId: "run", message: { role: "user", content: "hi" } } as never)))).toThrow(/CodexAdapter is V1\.x \(post V1\.0\)/iu);
  });

  it("routes native runs through permission gating before provider resolution", async () => {
    const runtimeId = `runtime-native-deny-${Date.now()}`;
    const modelConfigId = `model-native-deny-${Date.now()}`;
    const roleId = `role-native-deny-${Date.now()}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, '[]', NULL, NULL, 0, NULL, NULL, ?, ?)").run(roleId, "default-workspace", "Native Role Deny", "Native prompt", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, ?, 'native', ?, NULL, NULL, NULL, NULL, NULL, 'native', '[]', NULL, NULL, ?, ?, ?)").run(runtimeId, "default-workspace", "Native Runtime Deny", JSON.stringify({ runtimeKind: "native" }), Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run(modelConfigId, "default-workspace", "Native Model Deny", "openai", "native-model-deny", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)").run("binding-native-deny-test", "default-workspace", roleId, runtimeId, modelConfigId, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?)").run("native-agent-deny", "default-workspace", "Native Agent Deny", "native", "native-model-deny", "Native prompt", JSON.stringify(["chat"]), Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)").run("room-native-deny-test", "default-workspace", "Native Room Deny", "solo", "conversation", "native-agent-deny", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)").run("room-native-deny-test", "native-agent-deny", "agent", "primary", "native", "binding-native-deny-test", "active", Date.now());
      daemon.database.sqlite.prepare("INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, 'queued', 'primary_turn', NULL, NULL, NULL, 'shadow_buffer', NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?) ").run("run-native-deny-test", "default-workspace", "room-native-deny-test", "native-agent-deny", runtimeId, Date.now(), Date.now());
    })();

    const nativeRun = daemon.database.sqlite.prepare("SELECT * FROM runs WHERE id = 'run-native-deny-test'").get() as { readonly id: string; readonly agent_id: string; readonly adapter_id: string | null };
    const lifecycle = {
      read: () => nativeRun,
      markCancelling: vi.fn(),
      markClaimed: vi.fn(),
      markStarting: vi.fn(),
      fail: vi.fn(),
      complete: vi.fn(),
      cancelFinalized: vi.fn()
    } as never;
    const registry = new AdapterRegistry({
      database: daemon.database,
      eventBus: daemon.eventBus,
      lifecycle,
      permissionEngine: { check: vi.fn(() => ({ status: "deny", reason: "stored rule" })) } as never,
      mockAdapter: daemon.mockAdapter
    });

    await registry.runAgent(nativeRun as never);

    expect(nativeAdapterCtorMock).toHaveBeenCalledWith(expect.objectContaining({ permissions: expect.any(Object) }));
    expect(nativeAdapterRunManagedMock).toHaveBeenCalledWith(expect.objectContaining({ id: "run-native-deny-test" }));
    expect(resolveProviderMock).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("routes V1 team room native bindings through NativeAgentAdapter instead of MockAdapter", async () => {
    const runtimeId = "native-default";
    const modelConfigId = `model-team-native-${Date.now()}`;
    const roleId = `role-team-native-${Date.now()}`;
    const bindingId = `binding-team-native-${Date.now()}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, '[]', NULL, NULL, 0, NULL, NULL, ?, ?)").run(roleId, "default-workspace", "Native Team Leader", "Native team prompt", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run(modelConfigId, "default-workspace", "Native Team Model", "ollama", "team-native-model", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)").run(bindingId, "default-workspace", roleId, runtimeId, modelConfigId, Date.now(), Date.now());
    })();

    const created = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Native Team Room",
        mode: "team",
        leaderRoleId: roleId,
        participants: [{ roleId, runtimeId, modelConfigId }]
      })
    });
    const createdBody = await created.json() as { readonly data?: { readonly roomId?: string } };
    expect(created.status).toBe(201);
    const roomId = createdBody.data?.roomId ?? "";

    const sent = await fetch(`${baseUrl}/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello native", idempotencyKey: `native-team-${Date.now()}` })
    });
    expect(sent.ok).toBe(true);

    await waitFor(
      () => daemon.database.sqlite.prepare("SELECT adapter_id, status FROM runs WHERE room_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT 1").get(roomId, bindingId) as { readonly adapter_id: string | null; readonly status: string } | undefined,
      (run) => run !== undefined && run.adapter_id === "native"
    );
    expect(nativeAdapterRunManagedMock).toHaveBeenCalledWith(expect.objectContaining({ agent_id: bindingId, adapter_id: "native" }));
  });

  it("records plan wake output as a task plan without surfacing JSON in chat messages", async () => {
    const runId = "run-native-plan-hidden";
    const roomId = "room-native-plan-hidden";
    const agentId = "native-agent-plan-hidden";

    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES ('model-plan-hidden', 'default-workspace', 'Plan Model', 'ollama', 'plan-model', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1)").run();
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, 'default-workspace', 'project-manager', 'native-default', 'model-plan-hidden', NULL, 1, 1)").run(agentId);
      daemon.database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES (?, 'default-workspace', 'Planner', 'native', NULL, '', '[]', NULL, 0, NULL, 1, 1)").run(agentId);
      daemon.database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at, leader_role_id) VALUES (?, 'default-workspace', 'Plan Hidden', 'squad', 'conversation', ?, NULL, 1, 1, 'project-manager')").run(roomId, agentId);
      daemon.database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'primary', 'native', NULL, ?, 'active', 1)").run(roomId, agentId, agentId);
      daemon.database.sqlite.prepare("INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES (?, 'default-workspace', NULL, ?, ?, 'native', NULL, NULL, NULL, 'queued', 'plan', NULL, NULL, NULL, 'shadow_buffer', NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1)").run(runId, roomId, agentId);
    })();

    await daemon.lifecycle.markClaimed(null, runId);
    await daemon.adapterRegistry.runAgent(daemon.lifecycle.read(runId));

    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM task_plans WHERE run_id = ?").get(runId)).toMatchObject({ count: 1 });
    const latestPlan = await fetch(`${baseUrl}/rooms/${roomId}/task-plans/latest`);
    const latestPlanBody = await latestPlan.json() as { readonly plan?: { readonly roomId: string; readonly runId: string; readonly plan: { readonly goal?: string; readonly tasks?: readonly { readonly title?: string }[] } } | null };
    expect(latestPlan.status).toBe(200);
    expect(latestPlanBody.plan).toMatchObject({ roomId, runId, plan: { goal: "ship", tasks: [expect.objectContaining({ title: "Build" })] } });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE run_id = ? AND type = 'task.plan.created'").get(runId)).toMatchObject({ count: 1 });
    const planEvent = daemon.database.sqlite.prepare("SELECT payload FROM events WHERE run_id = ? AND type = 'task.plan.created' ORDER BY seq DESC LIMIT 1").get(runId) as { readonly payload: string };
    const planPayload = JSON.parse(planEvent.payload) as Record<string, unknown>;
    expect(planPayload).toMatchObject({ planId: expect.any(String), taskCount: 1 });
    expect(planPayload).not.toHaveProperty("plan");
    expect(planPayload).not.toHaveProperty("planJson");
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM messages WHERE run_id = ?").get(runId)).toMatchObject({ count: 0 });
    await waitFor(
      () => daemon.database.sqlite.prepare("SELECT id, status FROM runs WHERE room_id = ? AND wake_reason = 'execute' ORDER BY created_at DESC LIMIT 1").get(roomId) as { readonly id: string; readonly status: string } | undefined,
      (run) => run !== undefined && run.status === "completed"
    );
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id = ? AND type = 'agent.run.queued' AND json_extract(payload, '$.wakeReason') = 'execute'").get(roomId)).toMatchObject({ count: 1 });
    const messagesResponse = await fetch(`${baseUrl}/rooms/${roomId}/messages`);
    expect(messagesResponse.status).toBe(200);
    const messagesBody = await messagesResponse.json() as { readonly messages: readonly unknown[] };
    expect(messagesBody.messages).toEqual([]);
  });

  it("rejects deleting a runtime with existing bindings", async () => {
    daemon.database.sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, supported_caps, manifest_json, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', ?, ?, ?)").run("runtime-bound", "default-workspace", "custom-acp", "Bound Runtime", JSON.stringify({ runtimeKind: "custom-acp" }), 1, 1);
    daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)").run("binding-bound", "default-workspace", "role-bound", "runtime-bound", 1, 1);

    const deleted = await fetch(`${baseUrl}/runtimes/runtime-bound`, { method: "DELETE" });

    expect(deleted.status).toBe(409);
    expect(await deleted.json()).toMatchObject({ error: "runtime_has_bindings" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE json_extract(payload, '$.runtimeId') = 'runtime-bound' AND type = 'runtime.removed'").get()).toMatchObject({ count: 0 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM runtimes WHERE id = 'runtime-bound'").get()).toMatchObject({ count: 1 });
  });

  it("detects runtime binaries and emits runtime.detected only for persisted changes", async () => {
    daemon.database.sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, manifest_json, created_at, updated_at) VALUES (?, ?, 'native', ?, NULL, '[]', NULL, NULL, NULL, NULL, '[]', ?, ?, ?)").run("runtime-detect", "default-workspace", "Detect Runtime", JSON.stringify({ runtimeKind: "native" }), 1, 1);
    const before = daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'runtime.detected' AND json_extract(payload, '$.runtimeId') = 'runtime-detect'").get() as { readonly count: number };

    const detected = await fetch(`${baseUrl}/runtimes/runtime-detect/detect`, { method: "POST" });
    const detectedBody = await detected.json() as { readonly changed?: boolean; readonly runtime?: { readonly detected_path?: string | null; readonly detected_version?: string | null; readonly detected_at?: number | null } };

    expect(detected.status).toBe(200);
    expect(detectedBody.changed).toBe(true);
    expect(detectedBody.runtime).toMatchObject({ detected_path: "agenthub-native", detected_version: "native" });
    expect(typeof detectedBody.runtime?.detected_at).toBe("number");
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'runtime.detected' AND json_extract(payload, '$.runtimeId') = 'runtime-detect'").get()).toMatchObject({ count: before.count + 1 });

    const detectedAgain = await fetch(`${baseUrl}/runtimes/runtime-detect/detect`, { method: "POST" });
    const detectedAgainBody = await detectedAgain.json() as { readonly changed?: boolean };
    expect(detectedAgain.status).toBe(200);
    expect(detectedAgainBody.changed).toBe(false);
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'runtime.detected' AND json_extract(payload, '$.runtimeId') = 'runtime-detect'").get()).toMatchObject({ count: before.count + 1 });
  });

  it("returns runtime test results synchronously without emitting runtime.test.result", async () => {
    const tested = await fetch(`${baseUrl}/runtimes/native-default/test`, { method: "POST" });
    const testedBody = await tested.json() as { readonly ok?: boolean; readonly version?: string; readonly latencyMs?: number };

    expect(tested.status).toBe(200);
    expect(testedBody).toMatchObject({ ok: true, version: "native" });
    expect(typeof testedBody.latencyMs).toBe("number");
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'runtime.test.result'").get()).toMatchObject({ count: 0 });
  });

  it("creates, polls, and cancels role generation jobs through the configured model without generation events", async () => {
    const modelConfigId = `mc_role_gen_${Date.now()}`;
    daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)").run(modelConfigId, "default-workspace", "Role Generator", "openai-compatible", "role-model", "https://models.example/v1", "role-generator-key", "test...key", Date.now(), Date.now());
    await currentModelConfigKeychain?.set("role-generator-key", "real-secret-key");

    const started = await fetch(`${baseUrl}/roles/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Create a reviewer for frontend refactors", targetWork: "code-review", preferredTone: "concise", capabilities: ["chat", "code.review"], modelConfigId })
    });
    const startedBody = await started.json() as { readonly jobId?: string };

    expect(started.status).toBe(202);
    expect(startedBody.jobId).toEqual(expect.any(String));
    const jobId = startedBody.jobId ?? "";

    let completed: { readonly status: number; readonly body: { readonly status?: string; readonly draftJson?: { readonly name?: string; readonly prompt?: string } } } | undefined;
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${baseUrl}/roles/generate/jobs/${jobId}`);
      const body = await response.json() as { readonly status?: string; readonly draftJson?: { readonly name?: string; readonly prompt?: string } };
      completed = { status: response.status, body };
      if (response.status === 200 && body.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    if (completed === undefined) throw new Error("role generation job did not complete");

    expect(completed.status).toBe(200);
    expect(completed.body.draftJson).toMatchObject({ name: "Generated Reviewer", suggestedPermissionProfileId: "perm-readonly" });
    expect(roleDraftGeneratorMock).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        description: "Create a reviewer for frontend refactors",
        targetWork: "code-review",
        preferredTone: "concise",
        capabilities: ["chat", "code.review"]
      }),
      modelConfig: expect.objectContaining({
        id: modelConfigId,
        provider: "openai-compatible",
        model: "role-model",
        base_url: "https://models.example/v1",
        api_key_ref: "role-generator-key"
      }),
      apiKey: "real-secret-key"
    }));
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'role.generation.%'").get()).toMatchObject({ count: 0 });

    const deleted = await fetch(`${baseUrl}/roles/generate/jobs/${jobId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM role_drafts WHERE job_id = ?").get(jobId)).toMatchObject({ count: 0 });
    const missing = await fetch(`${baseUrl}/roles/generate/jobs/${jobId}`);
    expect(missing.status).toBe(404);
  });

  it("marks role generation jobs failed when the model response cannot be parsed as a role draft", async () => {
    roleDraftGeneratorMock.mockRejectedValueOnce(new Error("JSON parse failure: model returned malformed JSON"));
    const modelConfigId = `mc_role_gen_parse_${Date.now()}`;
    daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run(modelConfigId, "default-workspace", "Role Generator", "openai", "gpt-4o", Date.now(), Date.now());

    const started = await fetch(`${baseUrl}/roles/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Create a reviewer", modelConfigId })
    });
    const startedBody = await started.json() as { readonly jobId?: string };
    const jobId = startedBody.jobId ?? "";

    let failed: { readonly status: number; readonly body: { readonly status?: string; readonly failureReason?: string; readonly draftJson?: unknown } } | undefined;
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${baseUrl}/roles/generate/jobs/${jobId}`);
      const body = await response.json() as { readonly status?: string; readonly failureReason?: string; readonly draftJson?: unknown };
      failed = { status: response.status, body };
      if (response.status === 200 && body.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(failed?.status).toBe(200);
    expect(failed?.body).toMatchObject({ status: "failed", failureReason: "json_parse_failure" });
    expect(failed?.body).not.toHaveProperty("draftJson");
  });

  it("creates a failed role generation job when the selected model config is missing", async () => {
    const started = await fetch(`${baseUrl}/roles/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Create a reviewer", modelConfigId: "mc_missing_role_generator" })
    });
    const startedBody = await started.json() as { readonly jobId?: string };

    expect(started.status).toBe(202);
    expect(startedBody.jobId).toEqual(expect.any(String));
    const jobId = startedBody.jobId ?? "";

    let failed: { readonly status: number; readonly body: { readonly status?: string; readonly failureReason?: string } } | undefined;
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${baseUrl}/roles/generate/jobs/${jobId}`);
      const body = await response.json() as { readonly status?: string; readonly failureReason?: string };
      failed = { status: response.status, body };
      if (response.status === 200 && body.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(failed?.status).toBe(200);
    expect(failed?.body).toMatchObject({ status: "failed", failureReason: "model_config_not_found" });
    expect(roleDraftGeneratorMock).not.toHaveBeenCalled();
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'role.generation.%'").get()).toMatchObject({ count: 0 });
  });

  it("normalizes invalid API key failures for role generation jobs", async () => {
    roleDraftGeneratorMock.mockRejectedValueOnce(new Error("Provider returned 401 Unauthorized: invalid API key"));
    const modelConfigId = `mc_role_gen_auth_${Date.now()}`;
    daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)").run(modelConfigId, "default-workspace", "Role Generator", "openai", "gpt-4o", "role-generator-invalid-key", "test...bad", Date.now(), Date.now());
    await currentModelConfigKeychain?.set("role-generator-invalid-key", "bad-secret-key");

    const started = await fetch(`${baseUrl}/roles/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Create a reviewer", modelConfigId })
    });
    const startedBody = await started.json() as { readonly jobId?: string };
    const jobId = startedBody.jobId ?? "";

    let failed: { readonly status: number; readonly body: { readonly status?: string; readonly failureReason?: string } } | undefined;
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${baseUrl}/roles/generate/jobs/${jobId}`);
      const body = await response.json() as { readonly status?: string; readonly failureReason?: string };
      failed = { status: response.status, body };
      if (response.status === 200 && body.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(failed?.status).toBe(200);
    expect(failed?.body).toMatchObject({ status: "failed", failureReason: "invalid_api_key" });
  });

  it("removes failed role generation jobs from role_drafts", () => {
    const jobId = `job_role_fail_${Date.now()}`;
    const failedAt = Date.now();
    daemon.database.sqlite.prepare("INSERT INTO role_drafts (job_id, description, target_work, preferred_tone, capabilities, model_config_id, draft_json, status, failure_reason, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(jobId, "Broken draft", "code-review", "concise", JSON.stringify(["chat"]), "mc_1", null, "streaming", null, failedAt, failedAt, failedAt + 1_000);

    finalizeFailedRoleGenerationJob({ database: daemon.database } as never, jobId, "model_config_not_found", failedAt + 1);

    // Row is kept with status=failed so the UI can show the real error; GC cleans it up later
    expect(daemon.database.sqlite.prepare("SELECT status, failure_reason FROM role_drafts WHERE job_id = ?").get(jobId)).toMatchObject({ status: "failed", failure_reason: "model_config_not_found" });
  });

  it("expires generated role drafts after seven days and returns 404 after GC", async () => {
    vi.useFakeTimers();
    try {
      const createdAt = new Date("2026-05-01T00:00:00.000Z");
      vi.setSystemTime(createdAt);
      const modelConfigId = `mc_role_expiry_${Date.now()}`;
      daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run(modelConfigId, "default-workspace", "Role Expiry Generator", "openai", "gpt-4o", Date.now(), Date.now());

      const started = await fetch(`${baseUrl}/roles/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "Create a draft that should expire", modelConfigId })
      });
      const startedBody = await started.json() as { readonly jobId?: string };

      expect(started.status).toBe(202);
      const jobId = startedBody.jobId ?? "";
      expect(jobId).not.toBe("");
      expect(daemon.database.sqlite.prepare("SELECT expires_at FROM role_drafts WHERE job_id = ?").get(jobId)).toMatchObject({ expires_at: createdAt.getTime() + 7 * 24 * 60 * 60 * 1000 });

      vi.setSystemTime(new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000 + 1));
      expect(cleanExpiredRoleDrafts(daemon.database, Date.now())).toBe(1);
      expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM role_drafts WHERE job_id = ?").get(jobId)).toMatchObject({ count: 0 });

      const expired = await fetch(`${baseUrl}/roles/generate/jobs/${jobId}`);
      expect(expired.status).toBe(404);
      expect(await expired.json()).toMatchObject({ error: "role_generation_job_not_found" });
      expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type LIKE 'role.generation.%'").get()).toMatchObject({ count: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits ai_generated role.created events without prompt payload data", async () => {
    const role = await fetch(`${baseUrl}/roles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Generated Reviewer", prompt: "Review frontend refactors", generationJobId: "job_ai_generated_1", capabilities: ["chat"] })
    });
    const body = await role.json() as { readonly id?: string };

    expect(role.status).toBe(201);
    const payload = daemon.database.sqlite.prepare("SELECT payload FROM events WHERE type = 'role.created' ORDER BY seq DESC LIMIT 1").get() as { readonly payload: string };
    const eventPayload = JSON.parse(payload.payload) as { readonly roleId?: string; readonly workspaceId?: string; readonly source?: string; readonly generationJobId?: string; readonly prompt?: string; readonly description?: string };
    expect(eventPayload).toMatchObject({ roleId: body.id, workspaceId: "default-workspace", source: "ai_generated", generationJobId: "job_ai_generated_1" });
    expect(eventPayload).not.toHaveProperty("prompt");
    expect(eventPayload).not.toHaveProperty("description");
  });

  it("returns async runtime test job ids and polls terminal job status", async () => {
    daemon.database.sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, manifest_json, created_at, updated_at) VALUES (?, ?, 'native', ?, NULL, '[]', NULL, NULL, NULL, ?, '[]', ?, ?, ?)").run("runtime-test-job", "default-workspace", "Job Runtime", "native", JSON.stringify({ runtimeKind: "native" }), 1, 1);

    const started = await fetch(`${baseUrl}/runtimes/runtime-test-job/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ async: true }) });
    const startedBody = await started.json() as { readonly jobId?: string };

    expect(started.status).toBe(202);
    expect(startedBody.jobId).toEqual(expect.any(String));
    const jobId = startedBody.jobId ?? "";
    let terminal: { readonly status: number; readonly body: { readonly status?: string; readonly result?: { readonly ok?: boolean; readonly version?: string } } } | undefined;
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${baseUrl}/settings/jobs/${jobId}`);
      terminal = { status: response.status, body: await response.json() as { readonly status?: string; readonly result?: { readonly ok?: boolean; readonly version?: string } } };
      if (terminal.status === 200 && (terminal.body.status === "completed" || terminal.body.status === "failed")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(terminal).toBeDefined();
    if (terminal === undefined) throw new Error("runtime test job did not reach terminal state");
    expect(terminal.status).toBe(200);
    expect(terminal.body).toMatchObject({ status: "completed", result: { ok: true } });
    expect(terminal.body.result?.version).toBe("native");
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'runtime.test.result'").get()).toMatchObject({ count: 0 });
  });

  it("stores model config API keys in keychain and omits plaintext from responses", async () => {
    const workspaceId = `ws_model_${Date.now()}`;
    daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, workspaceId, `/tmp/${workspaceId}`, Date.now(), Date.now());

    const apiKey = "sk-ant-example-secret-key";
    const created = await fetch(`${baseUrl}/model-configs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, name: "OpenAI Config", provider: "openai", model: "gpt-4o", apiKey })
    });
    const createdBody = await created.json() as { readonly modelConfig?: { readonly id: string; readonly api_key_ref?: string | null; readonly api_key_fingerprint?: string | null } };
    expect(created.status).toBe(201);
    expect(createdBody.modelConfig).toMatchObject({ api_key_fingerprint: "sk-a...-key" });
    expect(createdBody.modelConfig).not.toHaveProperty("api_key_ref");
    expect(JSON.stringify(createdBody)).not.toContain(apiKey);
    expectNoPlaintextSecret(daemon, apiKey, [createdBody]);

    const rows = daemon.database.sqlite.prepare("SELECT api_key_ref, api_key_fingerprint FROM model_configs WHERE workspace_id = ? ORDER BY created_at ASC").all(workspaceId) as { readonly api_key_ref: string | null; readonly api_key_fingerprint: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ api_key_ref: expect.any(String), api_key_fingerprint: "sk-a...-key" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'model_config.created' AND json_extract(payload, '$.modelConfigId') = ?").get(createdBody.modelConfig?.id)).toMatchObject({ count: 1 });
    expectDetailOnlyEvent(daemon, "model_config.created", "modelConfigId", createdBody.modelConfig?.id ?? "");

    const listed = await fetch(`${baseUrl}/model-configs?workspaceId=${encodeURIComponent(workspaceId)}`);
    const listedBody = await listed.json() as ReadonlyArray<{ readonly api_key_ref?: string; readonly api_key_fingerprint?: string | null }>;
    expect(listed.status).toBe(200);
    expect(Array.isArray(listedBody)).toBe(true);
    expect(listedBody[0]).toMatchObject({ api_key_fingerprint: "sk-a...-key" });
    expect(listedBody[0]).not.toHaveProperty("api_key_ref");

    const fetched = await fetch(`${baseUrl}/model-configs/${createdBody.modelConfig?.id ?? ""}`);
    const fetchedBody = await fetched.json() as { readonly modelConfig?: { readonly api_key_ref?: string; readonly api_key_fingerprint?: string | null } };
    expect(fetched.status).toBe(200);
    expect(fetchedBody.modelConfig).toMatchObject({ api_key_fingerprint: "sk-a...-key" });
    expect(fetchedBody.modelConfig).not.toHaveProperty("api_key_ref");
    expectNoPlaintextSecret(daemon, apiKey, [createdBody, listedBody, fetchedBody]);
  });

  it("stores Ollama model configs without API key refs", async () => {
    const workspaceId = `ws_ollama_${Date.now()}`;
    daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, workspaceId, `/tmp/${workspaceId}`, Date.now(), Date.now());

    const created = await fetch(`${baseUrl}/model-configs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, name: "Local Ollama", provider: "ollama", model: "llama3.1", baseUrl: "http://localhost:11434/v1" })
    });
    const createdBody = await created.json() as { readonly modelConfig?: { readonly api_key_ref?: string | null; readonly api_key_fingerprint?: string | null; readonly provider?: string } };

    expect(created.status).toBe(201);
    expect(createdBody.modelConfig).toMatchObject({ provider: "ollama", api_key_fingerprint: null });
    expect(createdBody.modelConfig).not.toHaveProperty("api_key_ref");
    expect(daemon.database.sqlite.prepare("SELECT api_key_ref, api_key_fingerprint FROM model_configs WHERE workspace_id = ?").get(workspaceId)).toMatchObject({ api_key_ref: null, api_key_fingerprint: null });
  });

  it("tests model config calls with provider resolution and polls terminal jobs", async () => {
    const workspaceId = `ws_model_test_${Date.now()}`;
    daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, workspaceId, `/tmp/${workspaceId}`, Date.now(), Date.now());
    const created = await fetch(`${baseUrl}/model-configs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, id: "mc_test_openai", name: "OpenAI Test", provider: "openai", model: "gpt-4o", apiKey: "sk-test-openai" })
    });
    expect(created.status).toBe(201);

    const success = await fetch(`${baseUrl}/model-configs/mc_test_openai/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Say ok" })
    });
    const successBody = await success.json() as { readonly jobId: string; readonly ok: true; readonly model: string; readonly latencyMs: number; readonly inputTokens: number; readonly outputTokens: number };
    expect(success.status).toBe(200);
    expect(successBody).toMatchObject({ ok: true, model: "gpt-4o", inputTokens: 1, outputTokens: 1 });
    expect(successBody.latencyMs).toBeGreaterThanOrEqual(0);
    expect(modelTestFetchMock).toHaveBeenCalled();

    const job = await fetch(`${baseUrl}/settings/jobs/${successBody.jobId}`);
    const jobBody = await job.json() as { readonly job?: { readonly status: string; readonly result?: { readonly ok: true } } };
    expect(job.status).toBe(200);
    expect(jobBody.job).toMatchObject({ status: "completed", result: { ok: true } });
    expectNoPlaintextSecret(daemon, "sk-test-openai", [successBody, jobBody]);

    const createdInvalid = await fetch(`${baseUrl}/model-configs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, id: "mc_test_bad", name: "Bad Key", provider: "openai", model: "gpt-4o", apiKey: "sk-bad-secret" })
    });
    expect(createdInvalid.status).toBe(201);
    modelTestFetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401, headers: { "content-type": "application/json" } }));
    const invalid = await fetch(`${baseUrl}/model-configs/mc_test_bad/test`, { method: "POST", headers: { "content-type": "application/json" } });
    const invalidBody = await invalid.json() as { readonly jobId: string; readonly ok: false; readonly error: string };
    expect(invalid.status).toBe(400);
    expect(invalidBody).toMatchObject({ ok: false, error: "invalid_api_key" });
    expect(JSON.stringify(invalidBody)).not.toContain("sk-bad-secret");
    const invalidJob = await fetch(`${baseUrl}/settings/jobs/${invalidBody.jobId}`);
    expect(await invalidJob.json()).toMatchObject({ job: { status: "failed", result: { ok: false, error: "invalid_api_key" } } });

    const createdOllama = await fetch(`${baseUrl}/model-configs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, id: "mc_test_ollama", name: "Local Ollama", provider: "ollama", model: "llama3.1", baseUrl: "http://127.0.0.1:11434" })
    });
    expect(createdOllama.status).toBe(201);
    await fetch(`${baseUrl}/model-configs/mc_test_ollama/test`, { method: "POST", headers: { "content-type": "application/json" } });
    const ollamaCall = modelTestFetchMock.mock.calls.find((call) => String(call[0]).includes("/api/chat"));
    expect(ollamaCall).toBeDefined();
    expect((ollamaCall?.[1] as RequestInit | undefined)?.headers).toMatchObject({ "content-type": "application/json" });
  });

  it("rejects deleting a model config with bindings", async () => {
    const workspaceId = `ws_model_bind_${Date.now()}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, workspaceId, `/tmp/${workspaceId}`, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run("mc_bound", workspaceId, "Bound Model", "openai", "gpt-4o", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)").run("binding_model_bound", workspaceId, "role_bound", "runtime_bound", "mc_bound", Date.now(), Date.now());
    })();

    const deleted = await fetch(`${baseUrl}/model-configs/mc_bound`, { method: "DELETE" });
    const deletedBody = await deleted.json() as { readonly error?: string; readonly bindingCount?: number };

    expect(deleted.status).toBe(409);
    expect(deletedBody).toMatchObject({ error: "model_config_has_bindings", bindingCount: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM model_configs WHERE id = 'mc_bound'").get()).toMatchObject({ count: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'model_config.deleted' AND json_extract(payload, '$.modelConfigId') = 'mc_bound'").get()).toMatchObject({ count: 0 });
  });

  it("keeps the keychain secret and emits no delete event when a bound model config delete conflicts", async () => {
    const workspaceId = `ws_model_bind_secret_${Date.now()}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, workspaceId, `/tmp/${workspaceId}`, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run("mc_bound_secret", workspaceId, "Bound Secret Model", "openai", "gpt-4o", "mc_secret_ref", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)").run("binding_model_bound_secret", workspaceId, "role_bound_secret", "runtime_bound_secret", "mc_bound_secret", Date.now(), Date.now());
    })();

    const deleted = await fetch(`${baseUrl}/model-configs/mc_bound_secret`, { method: "DELETE" });
    const deletedBody = await deleted.json() as { readonly error?: string; readonly bindingCount?: number };

    expect(deleted.status).toBe(409);
    expect(deletedBody).toMatchObject({ error: "model_config_has_bindings", bindingCount: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM model_configs WHERE id = 'mc_bound_secret'").get()).toMatchObject({ count: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'model_config.deleted' AND json_extract(payload, '$.modelConfigId') = 'mc_bound_secret'").get()).toMatchObject({ count: 0 });
    expect(currentModelConfigKeychain?.delete).not.toHaveBeenCalled();
  });

  it("returns model_config_not_found for missing model configs", async () => {
    const missingGet = await fetch(`${baseUrl}/model-configs/nonexistent-id`);
    expect(missingGet.status).toBe(404);
    expect(await missingGet.json()).toMatchObject({ error: "model_config_not_found" });

    const missingPatch = await fetch(`${baseUrl}/model-configs/nonexistent-id`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Still Missing" })
    });
    expect(missingPatch.status).toBe(404);
    expect(await missingPatch.json()).toMatchObject({ error: "model_config_not_found" });

    const missingDelete = await fetch(`${baseUrl}/model-configs/nonexistent-id`, { method: "DELETE" });
    expect(missingDelete.status).toBe(404);
    expect(await missingDelete.json()).toMatchObject({ error: "model_config_not_found" });
  });

  it("starts on loopback without a token", async () => {
    await daemon.close();
    currentDaemon = undefined;
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-loopback-"));
    const loopbackDaemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0, host: "127.0.0.1", modelTestFetch: modelTestFetchMock });

    const server = await loopbackDaemon.start();
    expect(server.listening).toBe(true);

    await loopbackDaemon.close();
  });

  it("refuses remote bind without token", async () => {
    await daemon.close();
    currentDaemon = undefined;
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-remote-deny-"));
    const remoteDaemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0, host: "0.0.0.0", modelTestFetch: modelTestFetchMock });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(remoteDaemon.start()).rejects.toThrow("Remote binding requires token and allowRemote=true");
    expect(stderrSpy).toHaveBeenCalled();

    stderrSpy.mockRestore();
    await remoteDaemon.close();
  });

  it("starts on remote bind with token and allowRemote", async () => {
    await daemon.close();
    currentDaemon = undefined;
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-remote-allow-"));
    const remoteDaemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0, host: "0.0.0.0", token: "remote-token", allowRemote: true, modelTestFetch: modelTestFetchMock });

    const server = await remoteDaemon.start();
    expect(server.listening).toBe(true);

    await remoteDaemon.close();
  });

  it("returns healthz during startup and gates other routes with service_starting", async () => {
    await daemon.close();
    currentDaemon = undefined;
    const dir = mkdtempSync(join(tmpdir(), "agenthub-daemon-starting-"));
    const startingDaemon = createDaemon({ databasePath: join(dir, "agenthub.sqlite"), port: 0, modelTestFetch: modelTestFetchMock });

    const health = await invokeHandler(startingDaemon, "GET", "/healthz");
    const rooms = await invokeHandler(startingDaemon, "GET", "/rooms");

    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });
    expect(rooms.status).toBe(503);
    expect(rooms.body).toEqual({ error: "service_starting", retryAfterMs: 500 });
    await startingDaemon.close();
  });

  it("keeps board and timeline routes not found", async () => {
    const board = await fetch(`${baseUrl}/board`);
    const timeline = await fetch(`${baseUrl}/timeline`);

    expect(board.status).toBe(404);
    expect(timeline.status).toBe(404);
    expect(await board.json()).toMatchObject({ error: "not_found" });
    expect(await timeline.json()).toMatchObject({ error: "not_found" });
  });

  it("selects ClaudeCodeAdapter when the primary profile requests claude-code", async () => {
    daemon.database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('claude-agent', NULL, 'Claude Agent', 'claude-code', 'claude', 'Claude test profile', ?, NULL, 0, NULL, 1, 1)").run(JSON.stringify(["chat", "code.edit"]));
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Claude", mode: "solo", primaryAgentId: "claude-agent" }) as { readonly data: { readonly roomId: string } };

    const sent = await client.sendMessage(room.data.roomId, { text: "use claude", idempotencyKey: "claude-select-1" }) as { readonly ok: boolean };

    expect(sent.ok).toBe(true);
    expect(daemon.mockAdapter.llmCallsFor("claude-agent")).toBe(0);
    const run = daemon.database.sqlite.prepare("SELECT id, adapter_session_id FROM runs WHERE agent_id = 'claude-agent'").get() as { readonly id: string; readonly adapter_session_id: string };
    const warm = daemon.database.sqlite.prepare("SELECT adapter_session_id FROM room_participants WHERE room_id = ? AND participant_id = 'claude-agent'").get(room.data.roomId) as { readonly adapter_session_id: string };
    expect(run.adapter_session_id).toBe(warm.adapter_session_id);
    expect(daemon.adapterRegistry.getClaudeAdapterForTest()?.debugSession(run.adapter_session_id)).toMatchObject({ runId: run.id });
  });

  it("prewarms active ACP agents when a room is created without creating runs", async () => {
    daemon.database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('claude-agent', NULL, 'Claude Agent', 'claude-code', 'claude', 'Claude test profile', ?, NULL, 0, NULL, 1, 1)").run(JSON.stringify(["chat", "code.edit"]));
    daemon.database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('opencode-agent', NULL, 'OpenCode Agent', 'opencode', 'opencode', 'OpenCode test profile', ?, NULL, 0, NULL, 1, 1)").run(JSON.stringify(["chat", "code.edit"]));
    const client = new AgentHubClient({ baseUrl });

    const room = await client.createRoom({
      title: "Warm",
      mode: "assisted",
      primaryAgentId: "claude-agent",
      participants: [
        { type: "agent", agentId: "opencode-agent", role: "observer", defaultPresence: "active" },
        { type: "agent", agentId: "mock-observer", role: "observer", defaultPresence: "observing" }
      ]
    }) as { readonly data: { readonly roomId: string } };

    await waitFor(
      () => daemon.database.sqlite.prepare("SELECT participant_id, adapter_session_id FROM room_participants WHERE room_id = ? ORDER BY participant_id ASC").all(room.data.roomId) as { readonly participant_id: string; readonly adapter_session_id: string | null }[],
      (rows) => rows.some((row) => row.participant_id === "claude-agent" && row.adapter_session_id !== null)
        && rows.some((row) => row.participant_id === "opencode-agent" && row.adapter_session_id !== null)
    );

    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM runs WHERE room_id = ?").get(room.data.roomId)).toMatchObject({ count: 0 });
    expect(daemon.database.sqlite.prepare("SELECT adapter_session_id FROM room_participants WHERE room_id = ? AND participant_id = 'mock-observer'").get(room.data.roomId)).toMatchObject({ adapter_session_id: null });
    const claude = daemon.database.sqlite.prepare("SELECT adapter_session_id FROM room_participants WHERE room_id = ? AND participant_id = 'claude-agent'").get(room.data.roomId) as { readonly adapter_session_id: string };
    expect(claude.adapter_session_id).toBe(`acp-claude-code-warm-${room.data.roomId}-claude-agent`);
    expect(daemon.adapterRegistry.getClaudeAdapterForTest()?.debugSession(claude.adapter_session_id)).toBeDefined();

    const archived = await fetch(`${baseUrl}/rooms/${room.data.roomId}/archive`, { method: "POST" });
    expect(archived.status).toBe(200);
    expect(daemon.adapterRegistry.getClaudeAdapterForTest()?.debugSession(claude.adapter_session_id)?.state).toBe("disposed");
    expect(daemon.database.sqlite.prepare("SELECT adapter_session_id FROM room_participants WHERE room_id = ? AND participant_id = 'claude-agent'").get(room.data.roomId)).toMatchObject({ adapter_session_id: null });
  });

  it("resolves legacy agentProfileId room creation inputs to migrated bindings", async () => {
    daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)").run("ap_legacy", "default-workspace", "role_builder", "runtime_claude", "Legacy Binding", 1, 1);

    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Legacy Room", mode: "solo", agentProfileId: "ap_legacy" })
    });
    const payload = await response.json() as { readonly data?: { readonly roomId: string; readonly agentBindingId: string; readonly agentProfileId?: string } };

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({ agentBindingId: "ap_legacy", agentProfileId: "ap_legacy" });

    const roomId = payload.data?.roomId ?? "";
    expect(daemon.database.sqlite.prepare("SELECT agent_binding_id FROM room_participants WHERE room_id = ? AND participant_type = 'agent' AND role = 'primary'").get(roomId)).toMatchObject({ agent_binding_id: "ap_legacy" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM rooms WHERE id = ?").get(roomId)).toMatchObject({ count: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id = ? AND type = 'room.created'").get(roomId)).toMatchObject({ count: 1 });
  });

  it("rejects unknown legacy agentProfileId inputs without partial writes", async () => {
    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Missing Legacy", mode: "solo", agentProfileId: "ap_missing" })
    });
    const payload = await response.json() as { readonly error?: string };

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({ error: "agent_profile_not_found" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM rooms WHERE title = 'Missing Legacy'").get()).toMatchObject({ count: 0 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'room.created'").get()).toMatchObject({ count: 0 });
  });

  it("requires leaderRoleId for squad rooms", async () => {
    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Squad Missing Leader", mode: "squad", participants: [{ roleId: "role_missing", runtimeId: "runtime_missing" }] })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "squad_mode_requires_leader_role_id" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM rooms WHERE title = 'Squad Missing Leader'").get()).toMatchObject({ count: 0 });
  });

  it("creates team rooms with v1.0 participants and persists leader bindings", async () => {
    const roleId = `role_team_${Date.now()}`;
    const runtimeId = `runtime_team_${Date.now()}`;
    const modelConfigId = `model_team_${Date.now()}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, '[]', NULL, NULL, 0, NULL, NULL, ?, ?)").run(roleId, "default-workspace", "Team Leader", "Team prompt", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, ?, 'native', ?, NULL, NULL, NULL, NULL, NULL, 'native', '[]', NULL, NULL, ?, ?, ?)").run(runtimeId, "default-workspace", "Team Runtime", JSON.stringify({ runtimeKind: "native" }), Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)").run(modelConfigId, "default-workspace", "Team Model", "ollama", "team-model", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)").run("binding-team-leader", "default-workspace", roleId, runtimeId, modelConfigId, Date.now(), Date.now());
    })();

    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Team Room",
        mode: "team",
        leaderRoleId: roleId,
        participants: [{ roleId, runtimeId, modelConfigId }]
      })
    });
    const payload = await response.json() as { readonly data?: { readonly roomId: string; readonly leaderRoleId?: string; readonly agentBindingId?: string } };

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({ leaderRoleId: roleId, agentBindingId: "binding-team-leader" });
    const roomId = payload.data?.roomId ?? "";
    expect(daemon.database.sqlite.prepare("SELECT leader_role_id, primary_agent_id FROM rooms WHERE id = ?").get(roomId)).toMatchObject({ leader_role_id: roleId, primary_agent_id: "binding-team-leader" });
    expect(daemon.database.sqlite.prepare("SELECT agent_binding_id, role, default_presence FROM room_participants WHERE room_id = ? AND participant_type = 'agent' AND role = 'primary'").get(roomId)).toMatchObject({ agent_binding_id: "binding-team-leader", role: "primary", default_presence: "active" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id = ? AND type = 'room.created'").get(roomId)).toMatchObject({ count: 1 });
  });

  it("adds a teammate to a running room from an existing agent binding", async () => {
    const workspaceId = `ws_add_participant_${Date.now()}`;
    const leaderRoleId = `role_add_leader_${Date.now()}`;
    const teammateRoleId = `role_add_builder_${Date.now()}`;
    const runtimeId = `runtime_add_participant_${Date.now()}`;
    const leaderBindingId = `binding_add_leader_${Date.now()}`;
    const teammateBindingId = `binding_add_builder_${Date.now()}`;
    const roomId = `room_add_participant_${Date.now()}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, "Add Participant", ".", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?)").run(leaderRoleId, workspaceId, "Lead", "Lead prompt", JSON.stringify(["task.delegate"]), Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?)").run(teammateRoleId, workspaceId, "Builder", "Builder prompt", JSON.stringify(["code.edit"]), Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, ?, 'native', ?, NULL, NULL, NULL, NULL, NULL, 'native', '[]', NULL, NULL, ?, ?, ?)").run(runtimeId, workspaceId, "Native", JSON.stringify({ runtimeKind: "native" }), Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)").run(leaderBindingId, workspaceId, leaderRoleId, runtimeId, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)").run(teammateBindingId, workspaceId, teammateRoleId, runtimeId, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, leader_role_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, 'squad', 'conversation', ?, ?, NULL, ?, ?)").run(roomId, workspaceId, "Expandable Squad", leaderBindingId, leaderRoleId, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'primary', 'native', NULL, ?, 'active', ?)").run(roomId, leaderBindingId, leaderBindingId, Date.now());
      daemon.database.sqlite.prepare("INSERT OR REPLACE INTO agent_presence (room_id, agent_id, state, reason, status_line, updated_at) VALUES (?, ?, 'active', NULL, NULL, ?)").run(roomId, leaderBindingId, Date.now());
    })();

    const response = await fetch(`${baseUrl}/rooms/${roomId}/participants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentBindingId: teammateBindingId })
    });
    const payload = await response.json() as { readonly data?: { readonly participantId: string; readonly agentBindingId: string; readonly capabilities: string[] } };

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({ participantId: teammateBindingId, agentBindingId: teammateBindingId, capabilities: ["code.edit"] });
    expect(daemon.database.sqlite.prepare("SELECT participant_id, role, agent_binding_id, default_presence FROM room_participants WHERE room_id = ? AND participant_id = ?").get(roomId, teammateBindingId)).toMatchObject({ participant_id: teammateBindingId, role: "teammate", agent_binding_id: teammateBindingId, default_presence: "active" });
    expect(daemon.database.sqlite.prepare("SELECT state FROM agent_presence WHERE room_id = ? AND agent_id = ?").get(roomId, teammateBindingId)).toMatchObject({ state: "active" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id = ? AND type = 'agent.joined' AND agent_id = ?").get(roomId, teammateBindingId)).toMatchObject({ count: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id = ? AND type = 'agent.state.changed' AND agent_id = ?").get(roomId, teammateBindingId)).toMatchObject({ count: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM mailbox_messages WHERE room_id = ? AND to_agent_id = ?").get(roomId, leaderBindingId)).toMatchObject({ count: 1 });
  });

  it("assigns selected skills when creating a room", async () => {
    const skillContent = "---\nname: creation-skill\ndescription: Available on create.\n---\n\nUse this skill.";
    const createdSkill = await fetch(`${baseUrl}/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "creation-skill", description: "Available on create.", content: skillContent })
    });
    const skillPayload = await createdSkill.json() as { readonly skill: { readonly id: string } };

    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Skill Room Create", mode: "solo", primaryAgentId: "mock-builder", skillIds: [skillPayload.skill.id] })
    });
    const payload = await response.json() as { readonly data?: { readonly roomId: string } };

    expect(response.status).toBe(201);
    expect(daemon.database.sqlite.prepare("SELECT enabled FROM room_skills WHERE room_id = ? AND skill_id = ?").get(payload.data?.roomId ?? "", skillPayload.skill.id)).toMatchObject({ enabled: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id = ? AND type = 'skill.activated'").get(payload.data?.roomId ?? "")).toMatchObject({ count: 1 });
  });

  it("keeps solo rooms compatible without leaderRoleId", async () => {
    const response = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Solo Room", mode: "solo", primaryAgentId: "mock-builder" })
    });
    const payload = await response.json() as { readonly data?: { readonly roomId: string } };

    expect(response.status).toBe(201);
    const roomId = payload.data?.roomId ?? "";
    expect(daemon.database.sqlite.prepare("SELECT leader_role_id FROM rooms WHERE id = ?").get(roomId)).toMatchObject({ leader_role_id: null });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM rooms WHERE id = ?").get(roomId)).toMatchObject({ count: 1 });
  });

  it("archiving a room keeps active ACP runs lifecycle-owned instead of disposing their session", async () => {
    daemon.database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('claude-agent', NULL, 'Claude Agent', 'claude-code', 'claude', 'Claude test profile', ?, NULL, 0, NULL, 1, 1)").run(JSON.stringify(["chat", "code.edit"]));
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Active Archive", mode: "solo", primaryAgentId: "claude-agent" }) as { readonly data: { readonly roomId: string } };
    await waitFor(
      () => daemon.database.sqlite.prepare("SELECT adapter_session_id FROM room_participants WHERE room_id = ? AND participant_id = 'claude-agent'").get(room.data.roomId) as { readonly adapter_session_id: string | null },
      (row) => row.adapter_session_id !== null
    );

    await client.sendMessage(room.data.roomId, { text: "long running", idempotencyKey: "archive-active-run" });
    const run = daemon.database.sqlite.prepare("SELECT id, adapter_session_id, status FROM runs WHERE room_id = ? AND agent_id = 'claude-agent'").get(room.data.roomId) as { readonly id: string; readonly adapter_session_id: string; readonly status: string };
    expect(run.status).toBe("running");

    const archived = await fetch(`${baseUrl}/rooms/${room.data.roomId}/archive`, { method: "POST" });

    expect(archived.status).toBe(200);
    expect(daemon.adapterRegistry.getClaudeAdapterForTest()?.debugSession(run.adapter_session_id)?.state).not.toBe("disposed");
    expect(daemon.database.sqlite.prepare("SELECT status FROM runs WHERE id = ?").get(run.id)).toMatchObject({ status: "running" });
    expect(daemon.database.sqlite.prepare("SELECT adapter_session_id FROM room_participants WHERE room_id = ? AND participant_id = 'claude-agent'").get(room.data.roomId)).toMatchObject({ adapter_session_id: null });
  });

  it("clears stale warm session ids when ACP warmup fails synchronously", () => {
    daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('default-workspace', 'Default', '.', 1, 1)").run();
    daemon.database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('claude-agent', NULL, 'Claude Agent', 'claude-code', 'claude', 'Claude test profile', ?, NULL, 0, NULL, 1, 1)").run(JSON.stringify(["chat", "code.edit"]));
    daemon.database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_warm_fail', 'default-workspace', 'Warm Fail', 'solo', 'conversation', 'claude-agent', NULL, 1, 1)").run();
    daemon.database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_type, participant_id, role, default_presence, adapter_id, adapter_session_id, joined_at) VALUES ('room_warm_fail', 'agent', 'claude-agent', 'primary', 'active', 'claude-code', NULL, 1)").run();
    const failingAdapter = {
      runManaged: async () => undefined,
      cancelManagedRun: async () => undefined,
      warmRoomAgent: () => { throw new Error("warmup failed"); },
      disposeRoomWarmSessions: () => undefined,
      disposeAllSessions: () => undefined,
      debugSession: () => undefined
    };
    const registry = new AdapterRegistry({ database: daemon.database, eventBus: daemon.eventBus, lifecycle: {} as never, mockAdapter: daemon.mockAdapter, claudeAdapter: failingAdapter as never });

    expect(() => registry.prewarmRoomAgents("room_warm_fail")).not.toThrow();

    expect(daemon.database.sqlite.prepare("SELECT adapter_session_id FROM room_participants WHERE room_id = 'room_warm_fail' AND participant_id = 'claude-agent'").get()).toMatchObject({ adapter_session_id: null });
  });

  it("streams durable replay plus live events with main/detail visibility", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "SSE", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    await client.sendMessage(room.data.roomId, { text: "sse", idempotencyKey: "sse-1" });
    const replay = daemon.eventBus.replayDurableSinceSeq(0, { view: "main", roomId: room.data.roomId });
    expect(replay.every((event) => event.visibility === "main" || event.visibility === "both")).toBe(true);
    expect(replay.some((event) => event.type === "tool.call.requested")).toBe(false);
    const detail = daemon.eventBus.replayDurableSinceSeq(0, { view: "detail", roomId: room.data.roomId });
    expect(detail.some((event) => event.type === "tool.call.requested")).toBe(true);
  });

  it("supports roles CRUD with atomic detail events", async () => {
    const workspaceId = `ws_roles_${Date.now()}`;
    daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, workspaceId, `/tmp/${workspaceId}`, Date.now(), Date.now());

    const created = await fetch(`${baseUrl}/roles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, name: "Role Alpha", prompt: "System prompt", capabilities: ["chat", "code.edit"], description: "Alpha" })
    });
    const createdBody = await created.json() as { readonly id?: string; readonly workspace_id?: string; readonly name?: string; readonly prompt?: string; readonly capabilities?: string[] };
    expect(created.status).toBe(201);
    expect(createdBody).toMatchObject({ workspace_id: workspaceId, name: "Role Alpha", prompt: "System prompt" });

    const roleId = createdBody.id ?? "";
    expect(roleId).not.toBe("");
    expect(Array.isArray(createdBody.capabilities)).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM roles WHERE id = ?").get(roleId)).toMatchObject({ count: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'role.created' AND json_extract(payload, '$.roleId') = ?").get(roleId)).toMatchObject({ count: 1 });
    expectDetailOnlyEvent(daemon, "role.created", "roleId", roleId);

    const listed = await fetch(`${baseUrl}/roles?workspaceId=${encodeURIComponent(workspaceId)}`);
    const listBody = await listed.json() as ReadonlyArray<{ readonly id: string; readonly name: string }>;
    expect(listed.status).toBe(200);
    expect(listBody.map((role) => role.id)).toContain(roleId);

    const fetched = await fetch(`${baseUrl}/roles/${roleId}`);
    const fetchedBody = await fetched.json() as { readonly id?: string; readonly name?: string; readonly prompt?: string };
    expect(fetched.status).toBe(200);
    expect(fetchedBody).toMatchObject({ id: roleId, name: "Role Alpha", prompt: "System prompt" });

    const updated = await fetch(`${baseUrl}/roles/${roleId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Role Beta", prompt: "Updated prompt", capabilities: ["chat"], tags: ["tag-a"] })
    });
    const updatedBody = await updated.json() as { readonly id?: string; readonly name?: string; readonly prompt?: string };
    expect(updated.status).toBe(200);
    expect(updatedBody).toMatchObject({ id: roleId, name: "Role Beta", prompt: "Updated prompt" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'role.updated' AND json_extract(payload, '$.roleId') = ?").get(roleId)).toMatchObject({ count: 1 });
    expectDetailOnlyEvent(daemon, "role.updated", "roleId", roleId);

    const deleted = await fetch(`${baseUrl}/roles/${roleId}`, { method: "DELETE" });
    const deletedBody = await deleted.json() as { readonly ok?: boolean };
    expect(deleted.status).toBe(200);
    expect(deletedBody).toMatchObject({ ok: true });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM roles WHERE id = ?").get(roleId)).toMatchObject({ count: 0 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'role.deleted' AND json_extract(payload, '$.roleId') = ?").get(roleId)).toMatchObject({ count: 1 });
    expectDetailOnlyEvent(daemon, "role.deleted", "roleId", roleId);
  });

  it("seeds five builtin role templates and emits created events on first launch", () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-builtin-roles-"));
    const rolesDir = join(dir, "roles");
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    const eventBus = createEventBus({ database });
    try {
      seedBuiltinRoles(database, rolesDir, eventBus, 1234);

      expect(readdirSync(rolesDir).filter((file) => file.endsWith(".md")).sort()).toEqual([
        "archivist.md",
        "builder.md",
        "generalist.md",
        "project-manager.md",
        "reviewer.md"
      ]);
      expect(readFileSync(join(rolesDir, "builder.md"), "utf8")).toContain("version: 1.0.0");
      expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM roles WHERE is_builtin = 1").get()).toMatchObject({ count: 5 });
      expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'role.created' AND json_extract(payload, '$.isBuiltin') = 1").get()).toMatchObject({ count: 5 });
    } finally {
      database.sqlite.close();
    }
  });

  it("preserves existing newer builtin role files without overwriting", () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-builtin-roles-newer-"));
    const rolesDir = join(dir, "roles");
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    const eventBus = createEventBus({ database });
    const newerBuilder = "---\nname: Custom Builder\nversion: 2.0.0\ncapabilities:\n  - chat\n---\n\nUser edited builder prompt.\n";
    try {
      mkdirSync(rolesDir, { recursive: true });
      writeFileSync(join(rolesDir, "builder.md"), newerBuilder, "utf8");

      seedBuiltinRoles(database, rolesDir, eventBus, 1234);

      expect(readFileSync(join(rolesDir, "builder.md"), "utf8")).toBe(newerBuilder);
    } finally {
      database.sqlite.close();
    }
  });

  it("warns for older builtin role files without overwriting", () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-builtin-roles-older-"));
    const rolesDir = join(dir, "roles");
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    const eventBus = createEventBus({ database });
    const olderBuilder = "---\nname: Old Builder\nversion: 0.9.0\ncapabilities:\n  - chat\n---\n\nOld user edited builder prompt.\n";
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      mkdirSync(rolesDir, { recursive: true });
      writeFileSync(join(rolesDir, "builder.md"), olderBuilder, "utf8");

      seedBuiltinRoles(database, rolesDir, eventBus, 1234);

      expect(readFileSync(join(rolesDir, "builder.md"), "utf8")).toBe(olderBuilder);
      expect(stderrSpy).toHaveBeenCalledWith("Builtin role 'builder' has an update; run `agenthub roles reset --id=builder` to overwrite\n");
    } finally {
      stderrSpy.mockRestore();
      database.sqlite.close();
    }
  });

  it("rejects role deletion when agent bindings exist", async () => {
    const workspaceId = `ws_roles_block_${Date.now()}`;
    const roleId = `role_${Date.now()}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, workspaceId, `/tmp/${workspaceId}`, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, '[]', NULL, NULL, 0, NULL, NULL, ?, ?)").run(roleId, workspaceId, "Blocked Role", "Prompt", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)").run(`binding_${Date.now()}`, workspaceId, roleId, "runtime-blocked", Date.now(), Date.now());
    })();

    const deleted = await fetch(`${baseUrl}/roles/${roleId}`, { method: "DELETE" });
    const deletedBody = await deleted.json() as { readonly error?: string; readonly bindingCount?: number };

    expect(deleted.status).toBe(409);
    expect(deletedBody).toMatchObject({ error: "role_has_bindings", bindingCount: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM roles WHERE id = ?").get(roleId)).toMatchObject({ count: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'role.deleted' AND json_extract(payload, '$.roleId') = ?").get(roleId)).toMatchObject({ count: 0 });
  });

  it("supports agent binding CRUD with native model config validation", async () => {
    const workspaceId = `ws_bind_${Date.now()}`;
    const roleId = `role_bind_${Date.now()}`;
    const runtimeId = `runtime_native_${Date.now()}`;
    const modelConfigId = `model_cfg_${Date.now()}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, workspaceId, `/tmp/${workspaceId}`, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, '[]', NULL, NULL, 0, NULL, NULL, ?, ?)").run(roleId, workspaceId, "Binding Role", "Prompt", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, ?, 'native', ?, NULL, NULL, NULL, NULL, NULL, ?, '[]', NULL, NULL, ?, ?, ?)").run(runtimeId, workspaceId, "Native Runtime", "1.2.3", JSON.stringify({ runtimeKind: "native" }), Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)").run(modelConfigId, workspaceId, "Binding Model", "openai", "gpt-4.1", "fingerprint-123", Date.now(), Date.now());
    })();

    const missingModelConfig = await invokeHandler(daemon, "POST", "/agent-bindings", { workspaceId, roleId, runtimeId });
    expect(missingModelConfig.status).toBe(400);
    expect(missingModelConfig.body).toMatchObject({ error: "native_runtime_requires_model_config" });

    const created = await invokeHandler(daemon, "POST", "/agent-bindings", { workspaceId, roleId, runtimeId, modelConfigId });
    const createdBody = created.body as { readonly agentBinding?: { readonly id: string; readonly role: { readonly id: string; readonly name: string }; readonly runtime: { readonly kind: string }; readonly modelConfig?: { readonly id: string; readonly apiKeyFingerprint: string | null } } };
    expect(created.status).toBe(201);
    expect(createdBody.agentBinding).toMatchObject({ role: { id: roleId, name: "Binding Role" }, runtime: { kind: "native" }, modelConfig: { id: modelConfigId, apiKeyFingerprint: "fingerprint-123" } });

    const bindingId = createdBody.agentBinding?.id ?? "";
    expect(bindingId).not.toBe("");
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'agent_binding.created' AND json_extract(payload, '$.bindingId') = ?").get(bindingId)).toMatchObject({ count: 1 });
    expectDetailOnlyEvent(daemon, "agent_binding.created", "bindingId", bindingId);

    const listed = await fetch(`${baseUrl}/agent-bindings?workspaceId=${encodeURIComponent(workspaceId)}`);
    const listBody = await listed.json() as { readonly agentBindings: readonly { readonly id: string }[] };
    expect(listed.status).toBe(200);
    expect(listBody.agentBindings.map((binding) => binding.id)).toContain(bindingId);

    const fetched = await fetch(`${baseUrl}/agent-bindings/${bindingId}`);
    const fetchedBody = await fetched.json() as { readonly agentBinding?: { readonly id: string; readonly runtime: { readonly kind: string } } };
    expect(fetched.status).toBe(200);
    expect(fetchedBody.agentBinding).toMatchObject({ id: bindingId, runtime: { kind: "native" } });

    const updated = await fetch(`${baseUrl}/agent-bindings/${bindingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ overridePermissionProfileId: "profile-override" })
    });
    const updatedBody = await updated.json() as { readonly agentBinding?: { readonly override_permission_profile_id?: string | null } };
    expect(updated.status).toBe(200);
    expect(updatedBody.agentBinding).toMatchObject({ override_permission_profile_id: "profile-override" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'agent_binding.updated' AND json_extract(payload, '$.bindingId') = ?").get(bindingId)).toMatchObject({ count: 1 });
    expectDetailOnlyEvent(daemon, "agent_binding.updated", "bindingId", bindingId);

    const deleted = await fetch(`${baseUrl}/agent-bindings/${bindingId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ ok: true });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type = 'agent_binding.removed' AND json_extract(payload, '$.bindingId') = ?").get(bindingId)).toMatchObject({ count: 1 });
    expectDetailOnlyEvent(daemon, "agent_binding.removed", "bindingId", bindingId);
  });

  it("rejects deleting agent bindings referenced by room participants", async () => {
    const workspaceId = `ws_bind_conflict_${Date.now()}`;
    const roleId = `role_bind_conflict_${Date.now()}`;
    const runtimeId = `runtime_bind_conflict_${Date.now()}`;
    const bindingId = `binding_conflict_${Date.now()}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(workspaceId, workspaceId, `/tmp/${workspaceId}`, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, '[]', NULL, NULL, 0, NULL, NULL, ?, ?)").run(roleId, workspaceId, "Conflict Role", "Prompt", Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, ?, 'custom-acp', ?, NULL, NULL, NULL, NULL, NULL, NULL, '[]', NULL, NULL, ?, ?, ?)").run(runtimeId, workspaceId, "Conflict Runtime", JSON.stringify({ runtimeKind: "custom-acp" }), Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)").run(bindingId, workspaceId, roleId, runtimeId, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)").run(`room_${bindingId}`, workspaceId, "Conflict Room", "solo", "conversation", bindingId, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)").run(`room_${bindingId}`, bindingId, "agent", "primary", "custom-acp", bindingId, "active", Date.now());
    })();

    const deleted = await fetch(`${baseUrl}/agent-bindings/${bindingId}`, { method: "DELETE" });
    const deletedBody = await deleted.json() as { readonly error?: string; readonly participantCount?: number };

    expect(deleted.status).toBe(409);
    expect(deletedBody).toMatchObject({ error: "agent_binding_has_room_participants", participantCount: 1 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE json_extract(payload, '$.bindingId') = ? AND type LIKE 'agent_binding.%'").get(bindingId)).toMatchObject({ count: 0 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM agent_bindings WHERE id = ?").get(bindingId)).toMatchObject({ count: 1 });
  });

  it("enforces browser auth bootstrap, GET/SSE session auth, CSRF, and bearer-origin rules", async () => {
    const originHeaders = { origin: baseUrl, "content-type": "application/json" };
    const bootstrap = await fetch(`${baseUrl}/auth/session`, { method: "POST", headers: originHeaders });
    const sessionPayload = await bootstrap.json() as { readonly csrfToken: string };
    const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(bootstrap.status).toBe(200);
    expect(cookie).toContain("agenthub_session=");

    const noCsrf = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { ...originHeaders, cookie }, body: JSON.stringify({ title: "Blocked" }) });
    expect(await noCsrf.json()).toMatchObject({ error: "csrf_token_mismatch" });
    expect(noCsrf.status).toBe(403);

    const created = await fetch(`${baseUrl}/rooms`, { method: "POST", headers: { ...originHeaders, cookie, "x-agenthub-csrf": sessionPayload.csrfToken }, body: JSON.stringify({ title: "Browser", mode: "solo", primaryAgentId: "mock-builder" }) });
    expect(created.status).toBe(201);

    const sse = await fetch(`${baseUrl}/event`, { headers: { origin: baseUrl, cookie } });
    expect(sse.status).toBe(200);
    await sse.body?.cancel();

    const attacker = await fetch(`${baseUrl}/rooms`, { method: "GET", headers: { origin: "http://attacker.example.com", authorization: "Bearer bad" } });
    expect(attacker.status).toBe(403);
  });

  it("requires admin for raw SSE and streams live adapter raw events only", async () => {
    daemon.database.sqlite.prepare("INSERT INTO auth_tokens (id, fingerprint, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)").run("token_raw_admin", "raw-admin", sha256("raw-admin"), JSON.stringify(["admin"]), 1);
    const bootstrap = await fetch(`${baseUrl}/auth/session`, { method: "POST", headers: { origin: baseUrl, "content-type": "application/json" } });
    const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0] ?? "";
    const browserRaw = await fetch(`${baseUrl}/event?view=raw`, { headers: { origin: baseUrl, cookie } });
    expect(browserRaw.status).toBe(403);
    expect(await browserRaw.json()).toMatchObject({ error: "requires_admin_scope" });

    const noOriginRaw = await fetch(`${baseUrl}/event?view=raw`);
    expect(noOriginRaw.status).toBe(403);
    expect(await noOriginRaw.json()).toMatchObject({ error: "requires_admin_scope" });

    const adminRaw = await fetch(`${baseUrl}/event?view=raw&runId=run_raw`, { headers: { authorization: "Bearer raw-admin" } });
    expect(adminRaw.status).toBe(200);
    expect(daemon.eventBus.replayDurableSinceSeq(0, { view: "raw", runId: "run_raw" })).toEqual([]);

    const rawFrame = readSseEvent(adminRaw.body, "adapter.raw.stdout");
    daemon.eventBus.publish({ id: "evt_raw_stdout", type: "adapter.raw.stdout", schemaVersion: 1, workspaceId: "default-workspace", runId: "run_raw", agentId: "mock-builder", payload: { line: "AGENTHUB_TOKEN=super-secret-token", stream: "stdout" }, createdAt: 10 });
    daemon.eventBus.publish({ id: "evt_raw_other", type: "adapter.raw.stderr", schemaVersion: 1, workspaceId: "default-workspace", runId: "run_other", agentId: "mock-builder", payload: { line: "hidden" }, createdAt: 11 });

    const frame = await rawFrame;
    expect(frame).toContain("event: adapter.raw.stdout");
    expect(frame).toContain("«REDACTED:agenthub-token»");
    expect(frame).not.toContain("super-secret-token");
    expect(frame).not.toContain("evt_raw_other");
  });

  it("keeps observers passive without explicit wake", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Assisted", mode: "assisted", primaryAgentId: "mock-builder", participants: [{ type: "agent", agentId: "mock-observer", role: "observer", defaultPresence: "observing" }] }) as { readonly data: { readonly roomId: string } };
    await client.sendMessage(room.data.roomId, { text: "observer should not run", idempotencyKey: "observer-1" });
    expect(daemon.mockAdapter.llmCallsFor("mock-builder")).toBe(1);
    expect(daemon.mockAdapter.llmCallsFor("mock-observer")).toBe(0);
  });

  it("routes assisted mentions without waking primary when omitted", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Mentions", mode: "assisted", primaryAgentId: "mock-builder", participants: [{ type: "agent", agentId: "mock-observer", role: "observer", defaultPresence: "active" }] }) as { readonly data: { readonly roomId: string } };

    await client.sendMessage(room.data.roomId, { text: "@mock-observer please review", idempotencyKey: "mention-observer-1" });

    expect(daemon.mockAdapter.llmCallsFor("mock-builder")).toBe(0);
    expect(daemon.mockAdapter.llmCallsFor("mock-observer")).toBe(1);
    const idempotencyKeys = daemon.database.sqlite.prepare("SELECT idempotency_key FROM command_records WHERE command_type = 'WakeAgent' ORDER BY created_at ASC").all() as { readonly idempotency_key: string }[];
    expect(idempotencyKeys.every((row) => /^wake:.+:mock-observer$/u.test(row.idempotency_key))).toBe(true);
  });

  it("queues pending turns while primary is busy and preserves immediate wake when idle", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Pending", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    seedBusyRun(room.data.roomId, "mock-builder", "run_busy");

    const queued = await client.sendMessage(room.data.roomId, { text: "queued", idempotencyKey: "queued-1" }) as { readonly ok: boolean; readonly data: { readonly messageId: string } };

    expect(queued.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT status, user_message_id FROM pending_turns WHERE id = ?").get(queued.data.messageId)).toMatchObject({ status: "queued", user_message_id: queued.data.messageId });
    expect(daemon.database.sqlite.prepare("SELECT turn_dispatch_mode, pending_turn_id FROM messages WHERE id = ?").get(queued.data.messageId)).toMatchObject({ turn_dispatch_mode: "pending", pending_turn_id: queued.data.messageId });
    expect(messagePayload(daemon, queued.data.messageId, "message.created")).toMatchObject({ messageId: queued.data.messageId, pendingTurnId: queued.data.messageId, turnDispatchMode: "pending" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM runs WHERE wake_reason = 'primary_turn'").get()).toMatchObject({ count: 1 });

    daemon.database.sqlite.prepare("UPDATE runs SET status = 'completed', ended_at = ? WHERE id = 'run_busy'").run(Date.now());
    const immediate = await client.sendMessage(room.data.roomId, { text: "immediate", idempotencyKey: "immediate-1" }) as { readonly ok: boolean; readonly data: { readonly messageId: string } };
    expect(immediate.ok).toBe(true);
    expect(messagePayload(daemon, immediate.data.messageId, "message.created")).toMatchObject({ messageId: immediate.data.messageId, turnDispatchMode: "immediate" });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM runs WHERE wake_reason = 'primary_turn'").get()).toMatchObject({ count: 2 });
  });

  it("queues pending turns while primary run is waiting", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Waiting Pending", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    seedBusyRun(room.data.roomId, "mock-builder", "run_waiting", "waiting");

    const queued = await client.sendMessage(room.data.roomId, { text: "queued while waiting", idempotencyKey: "queued-waiting-1" }) as { readonly ok: boolean; readonly data: { readonly messageId: string } };

    expect(queued.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT turn_dispatch_mode, pending_turn_id FROM messages WHERE id = ?").get(queued.data.messageId)).toMatchObject({ turn_dispatch_mode: "pending", pending_turn_id: queued.data.messageId });
    expect(daemon.database.sqlite.prepare("SELECT status, user_message_id FROM pending_turns WHERE id = ?").get(queued.data.messageId)).toMatchObject({ status: "queued", user_message_id: queued.data.messageId });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM runs WHERE room_id = ? AND agent_id = 'mock-builder' AND wake_reason = 'primary_turn'").get(room.data.roomId)).toMatchObject({ count: 1 });
  });

  it("caps queued pending turns at 20 and returns 429 for the 21st", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Cap", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    seedBusyRun(room.data.roomId, "mock-builder", "run_cap");
    for (let index = 0; index < 20; index += 1) {
      const sent = await client.sendMessage(room.data.roomId, { text: `queued ${index}`, idempotencyKey: `cap-${index}` }) as { readonly ok: boolean };
      expect(sent.ok).toBe(true);
    }

    const rejected = await fetch(`${baseUrl}/rooms/${room.data.roomId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "too many", idempotencyKey: "cap-21" }) });
    const payload = await rejected.json() as { readonly ok: boolean; readonly error: { readonly message: string; readonly details?: unknown } };

    expect(rejected.status).toBe(429);
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toBe("pending_turn_quota_exceeded");
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM pending_turns WHERE room_id = ? AND status = 'queued'").get(room.data.roomId)).toMatchObject({ count: 20 });
  });

  it("cancels queued pending turns and rejects non-queued states", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Cancel Pending", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    seedBusyRun(room.data.roomId, "mock-builder", "run_cancel_pending");
    const sent = await client.sendMessage(room.data.roomId, { text: "cancel me", idempotencyKey: "cancel-pending-1" }) as { readonly data: { readonly messageId: string } };

    const cancelled = await fetch(`${baseUrl}/pending-turns/${sent.data.messageId}`, { method: "DELETE" });
    expect(cancelled.status).toBe(200);
    expect(daemon.database.sqlite.prepare("SELECT status FROM pending_turns WHERE id = ?").get(sent.data.messageId)).toMatchObject({ status: "cancelled" });

    const conflict = await fetch(`${baseUrl}/pending-turns/${sent.data.messageId}`, { method: "DELETE" });
    expect(conflict.status).toBe(409);
  });

  it("edits queued pending message as cancel plus new queued or immediate message", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Edit Pending", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    seedBusyRun(room.data.roomId, "mock-builder", "run_edit_pending");
    const sent = await client.sendMessage(room.data.roomId, { text: "old", idempotencyKey: "edit-pending-1" }) as { readonly data: { readonly messageId: string } };

    const editedQueued = await fetch(`${baseUrl}/messages/${sent.data.messageId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "new queued" }) });
    const queuedPayload = await editedQueued.json() as { readonly ok: boolean; readonly data: { readonly messageId: string } };
    expect(editedQueued.status).toBe(200);
    expect(queuedPayload.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT status FROM pending_turns WHERE id = ?").get(sent.data.messageId)).toMatchObject({ status: "cancelled" });
    expect(daemon.database.sqlite.prepare("SELECT turn_dispatch_mode FROM messages WHERE id = ?").get(queuedPayload.data.messageId)).toMatchObject({ turn_dispatch_mode: "pending" });
    const turnRows = daemon.database.sqlite.prepare("SELECT enqueued_at FROM pending_turns WHERE user_message_id IN (?, ?) ORDER BY enqueued_at ASC").all(sent.data.messageId, queuedPayload.data.messageId) as { readonly enqueued_at: number }[];
    expect(turnRows[1]?.enqueued_at).toBeGreaterThanOrEqual(turnRows[0]?.enqueued_at ?? 0);

    daemon.database.sqlite.prepare("UPDATE runs SET status = 'completed', ended_at = ? WHERE id = 'run_edit_pending'").run(Date.now());
    const seededMessageId = "msg_seeded_edit_immediate";
    seedPendingMessage(room.data.roomId, "mock-builder", seededMessageId, "old immediate");
    const editedImmediate = await fetch(`${baseUrl}/messages/${seededMessageId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "new immediate" }) });
    const immediatePayload = await editedImmediate.json() as { readonly ok: boolean; readonly data: { readonly messageId: string } };

    expect(editedImmediate.status).toBe(200);
    expect(immediatePayload.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT turn_dispatch_mode FROM messages WHERE id = ?").get(immediatePayload.data.messageId)).toMatchObject({ turn_dispatch_mode: "immediate" });
  });

  it("paginates messages with base64 cursors and can include deleted messages", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Pagination", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    const first = await client.sendMessage(room.data.roomId, { text: "one", idempotencyKey: "page-1" }) as { readonly data: { readonly messageId: string } };
    const second = await client.sendMessage(room.data.roomId, { text: "two", idempotencyKey: "page-2" }) as { readonly data: { readonly messageId: string } };
    await fetch(`${baseUrl}/messages/${first.data.messageId}`, { method: "DELETE" });

    const page = await fetch(`${baseUrl}/messages?roomId=${room.data.roomId}&limit=1&includeDeleted=true`);
    const payload = await page.json() as { readonly messages: readonly { readonly id: string }[]; readonly nextCursor: string | null };
    expect(payload.messages).toHaveLength(1);
    expect(payload.nextCursor).toEqual(expect.any(String));
    const next = await fetch(`${baseUrl}/messages?roomId=${room.data.roomId}&after=${payload.nextCursor}&limit=20&includeDeleted=false`);
    const nextPayload = await next.json() as { readonly messages: readonly { readonly id: string }[] };
    expect(nextPayload.messages.map((message) => message.id)).not.toContain(first.data.messageId);
    expect(nextPayload.messages.map((message) => message.id)).toContain(second.data.messageId);
  });

  it("pins messages into workspace context and regenerates assistant messages through WakeAgent", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Pin Regen", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };
    const sent = await client.sendMessage(room.data.roomId, { text: "remember this", idempotencyKey: "pin-regen-1" }) as { readonly data: { readonly messageId: string } };

    const pinned = await fetch(`${baseUrl}/messages/${sent.data.messageId}/pin`, { method: "POST" });
    expect(pinned.status).toBe(200);
    expect(daemon.database.sqlite.prepare("SELECT scope, pinned, content FROM context_items WHERE content = 'remember this'").get()).toMatchObject({ scope: "workspace", pinned: 1, content: "remember this" });

    const assistant = daemon.database.sqlite.prepare("SELECT id FROM messages WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1").get() as { readonly id: string };
    const regenerated = await fetch(`${baseUrl}/messages/${assistant.id}/regenerate`, { method: "POST" });
    const payload = await regenerated.json() as { readonly ok: boolean };
    expect(regenerated.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM command_records WHERE command_type = 'WakeAgent' AND idempotency_key LIKE ?").get(`wake:${assistant.id}:%`)).toMatchObject({ count: 1 });
  });

  it("exposes permission APIs and resolves requests through CommandBus", async () => {
    const profilesResponse = await fetch(`${baseUrl}/permissions/profiles`);
    const profiles = await profilesResponse.json() as { readonly profiles: readonly { readonly id: string }[] };
    expect(profiles.profiles.map((profile) => profile.id)).toEqual(expect.arrayContaining(["builder-strict", "builder-loose", "read-only"]));
    daemon.database.sqlite.prepare("INSERT INTO permission_requests (id, workspace_id, room_id, agent_id, resource, reason, status, remember_decision, created_at, expires_at) VALUES ('preq_api', 'default-workspace', 'room_api', 'agent_api', ?, 'test', 'pending', 0, 1, 60000)").run(JSON.stringify({ type: "shell", command: "npm install" }));

    const pendingResponse = await fetch(`${baseUrl}/permissions/requests?status=pending&roomId=room_api`);
    const pending = await pendingResponse.json() as { readonly requests: readonly { readonly id: string }[] };
    expect(pending.requests.map((request) => request.id)).toEqual(["preq_api"]);
    const resolvedResponse = await fetch(`${baseUrl}/permissions/preq_api/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "allow", remember: true, scope: "this_workspace" }) });
    const resolved = await resolvedResponse.json() as { readonly ok: boolean };
    expect(resolved.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT status, decision FROM permission_requests WHERE id = 'preq_api'").get()).toMatchObject({ status: "allowed", decision: "allow" });
    expect(daemon.database.sqlite.prepare("SELECT type FROM events WHERE type = 'permission.resolved'").get()).toMatchObject({ type: "permission.resolved" });
  });

  it("does not expose internal-only context injection over HTTP", async () => {
    const response = await fetch(`${baseUrl}/context/inject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "immediate", activeRun: true }) });
    const payload = await response.json() as { readonly error?: string; readonly message?: string };

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: "not_found" });
    expect(JSON.stringify(payload)).not.toContain("internal_command_via_http");
  });

  it("exposes intervention APIs through CommandBus and debug basics", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Interventions", mode: "assisted", primaryAgentId: "mock-builder", participants: [{ type: "agent", agentId: "mock-reviewer", role: "observer", defaultPresence: "observing" }] }) as { readonly data: { readonly roomId: string } };
    const requested = await client.requestIntervention({ workspaceId: "default-workspace", roomId: room.data.roomId, sourceAgentId: "mock-reviewer", targetRunId: "run_api", reason: "review hardcoded secret usage", preview: "use env", priority: "high" }) as { readonly ok: boolean; readonly data: { readonly interventionId: string; readonly deduplicated: boolean } };

    expect(requested.ok).toBe(true);
    expect(requested.data.deduplicated).toBe(false);
    expect(daemon.database.sqlite.prepare("SELECT state FROM agent_presence WHERE room_id = ? AND agent_id = 'mock-reviewer'").get(room.data.roomId)).toMatchObject({ state: "knocking" });

    const list = await client.listInterventions({ roomId: room.data.roomId, status: "pending_user_decision" }) as { readonly interventions: readonly { readonly id: string }[] };
    expect(list.interventions.map((item) => item.id)).toEqual([requested.data.interventionId]);
    const approved = await client.approveIntervention(requested.data.interventionId, { effectiveText: "use env var" }) as { readonly ok: boolean };
    expect(approved.ok).toBe(true);
    expect(daemon.database.sqlite.prepare("SELECT status FROM interventions WHERE id = ?").get(requested.data.interventionId)).toMatchObject({ status: "closed" });

    const debug = await client.debugEvents({ roomId: room.data.roomId, type: "intervention.approved", limit: "10" }) as { readonly events: readonly { readonly type: string }[] };
    expect(debug.events.map((event) => event.type)).toEqual(["intervention.approved"]);
    const stats = await client.debugStats() as { readonly pendingPermissionCount: number; readonly pendingInterventionCount: number; readonly activeRunCount: number; readonly roomCount: number; readonly eventsLast5min: number; readonly uptimeMs: number; readonly sseClientCount: number; readonly pubsub: readonly { readonly channel: string }[] };
    expect(stats).toMatchObject({ pendingPermissionCount: 0, pendingInterventionCount: 0, activeRunCount: 0, roomCount: 1, sseClientCount: 0 });
    expect(stats.pubsub.map((item) => item.channel)).toContain("adapter_raw");
    expect(stats.eventsLast5min).toBeGreaterThan(0);
    expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);

    // Browser session (Origin present, no admin scope) must be denied /debug/events per spec.
    const bootstrap = await fetch(`${baseUrl}/auth/session`, { method: "POST", headers: { origin: baseUrl, "content-type": "application/json" } });
    const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0] ?? "";
    const browserDebug = await fetch(`${baseUrl}/debug/events`, { headers: { origin: baseUrl, cookie } });
    expect(browserDebug.status).toBe(403);
    expect(await browserDebug.json()).toMatchObject({ error: "debug_disabled" });

    // Admin bearer must be allowed /debug/events.
    daemon.database.sqlite.prepare("INSERT INTO auth_tokens (id, fingerprint, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)").run("token_debug_admin", "debug-admin", sha256("debug-admin"), JSON.stringify(["admin"]), 1);
    const adminDebug = await fetch(`${baseUrl}/debug/events`, { headers: { authorization: "Bearer debug-admin" } });
    expect(adminDebug.status).toBe(200);
  });

  it("exposes task HTTP routes through CommandBus and returns conflicts for invalid completion", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Tasks", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };

    const created = await fetch(`${baseUrl}/rooms/${room.data.roomId}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "HTTP task", assigneeAgentId: "mock-builder", idempotencyKey: "task-http-1" }) });
    const payload = await created.json() as { readonly ok: boolean; readonly data: { readonly taskId: string; readonly task: { readonly status: string } } };
    expect(created.status).toBe(201);
    expect(payload).toMatchObject({ ok: true, data: { task: { status: "pending" } } });

    const moved = await fetch(`${baseUrl}/rooms/${room.data.roomId}/tasks/${payload.data.taskId}/column`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ column: "Review" }) });
    const movedPayload = await moved.json() as { readonly ok: boolean; readonly data?: { readonly task?: { readonly boardColumn?: string } } };
    expect(moved.status).toBe(200);
    expect(movedPayload).toMatchObject({ ok: true, data: { task: { boardColumn: "Review" } } });
    expect(daemon.database.sqlite.prepare("SELECT board_column FROM tasks WHERE id = ?").get(payload.data.taskId)).toMatchObject({ board_column: "Review" });
    expect(daemon.database.sqlite.prepare("SELECT type FROM events WHERE task_id = ? AND type = 'task.column.moved' AND json_extract(payload, '$.toColumn') = 'Review'").get(payload.data.taskId)).toMatchObject({ type: "task.column.moved" });

    const pendingConflict = await fetch(`${baseUrl}/tasks/${payload.data.taskId}/complete`, { method: "POST" });
    expect(pendingConflict.status).toBe(409);

    daemon.database.sqlite.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(payload.data.taskId);
    const completed = await fetch(`${baseUrl}/tasks/${payload.data.taskId}/complete`, { method: "POST" });
    expect(completed.status).toBe(200);
    expect(daemon.database.sqlite.prepare("SELECT status, board_column FROM tasks WHERE id = ?").get(payload.data.taskId)).toMatchObject({ status: "completed", board_column: null });
    expect(daemon.database.sqlite.prepare("SELECT type FROM events WHERE task_id = ? AND type = 'task.status.changed' AND json_type(payload, '$.boardColumn') = 'null' ORDER BY seq DESC LIMIT 1").get(payload.data.taskId)).toMatchObject({ type: "task.status.changed" });
    const doneConflict = await fetch(`${baseUrl}/tasks/${payload.data.taskId}/complete`, { method: "POST" });
    expect(doneConflict.status).toBe(409);

    const listed = await fetch(`${baseUrl}/rooms/${room.data.roomId}/tasks`);
    const listedPayload = await listed.json() as { readonly tasks: readonly { readonly id: string; readonly status: string }[] };
    expect(listedPayload.tasks).toEqual([expect.objectContaining({ id: payload.data.taskId, status: "completed" })]);
  });

  it("marks stale pending tasks blocked once and wakes the leader idempotently", () => {
    activeDaemon().database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_timeout', 'ws_timeout', '/tmp/ws_timeout', 1, 1)").run();
    activeDaemon().database.sqlite.prepare("INSERT OR IGNORE INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_timeout', 'ws_timeout', 'Timeout room', 'solo', 'conversation', 'mock-builder', NULL, 1, 1)").run();
    activeDaemon().database.sqlite.prepare("INSERT OR IGNORE INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_timeout', 'mock-builder', 'agent', 'primary', 'mock', NULL, 'active', 1)").run();
    activeDaemon().database.sqlite.prepare("INSERT OR IGNORE INTO tasks (id, workspace_id, room_id, parent_task_id, title, description, status, assignee_agent_id, source_run_id, source_message_id, dependencies, priority, due_at, created_by, created_at, updated_at) VALUES ('task_timeout_1', 'ws_timeout', 'room_timeout', NULL, 'Stale task', NULL, 'pending', 'mock-builder', NULL, NULL, '[]', NULL, NULL, 'local', ?, ?)").run(Date.now() - 31 * 60 * 1000, Date.now() - 31 * 60 * 1000);

    const first = checkTaskTimeouts(activeDaemon().database, activeDaemon().eventBus, Date.now());
    const second = checkTaskTimeouts(activeDaemon().database, activeDaemon().eventBus, Date.now());

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(activeDaemon().database.sqlite.prepare("SELECT status FROM tasks WHERE id = 'task_timeout_1'").get()).toMatchObject({ status: "blocked" });
    expect(activeDaemon().database.sqlite.prepare("SELECT COUNT(*) AS count FROM mailbox_messages WHERE room_id = 'room_timeout' AND to_agent_id = 'mock-builder' AND kind = 'task_timeout'").get()).toMatchObject({ count: 1 });
  });

  it("returns task activities over HTTP and keeps cancel on task.status.changed", async () => {
    const client = new AgentHubClient({ baseUrl });
    const room = await client.createRoom({ title: "Task activities", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data: { readonly roomId: string } };

    const created = await fetch(`${baseUrl}/rooms/${room.data.roomId}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Activity task", assigneeAgentId: "mock-builder", idempotencyKey: "task-activity-1" }) });
    const createdPayload = await created.json() as { readonly data: { readonly taskId: string } };
    expect(created.status).toBe(201);

    daemon.commandBus.dispatch({ type: "UpdateTask", taskId: createdPayload.data.taskId, status: "cancelled", reason: "user_deleted" }, { actor: { type: "user", id: "local" }, traceId: "trace_cancel", origin: "http" });

    const activities = await fetch(`${baseUrl}/tasks/${createdPayload.data.taskId}/activities`);
    const activitiesPayload = await activities.json() as { readonly activities: readonly { readonly kind: string; readonly by_kind: string; readonly by: string }[] };
    expect(activities.status).toBe(200);
    expect(activitiesPayload.activities).toEqual([]);
    expect(daemon.database.sqlite.prepare("SELECT status FROM tasks WHERE id = ?").get(createdPayload.data.taskId)).toMatchObject({ status: "cancelled" });
    expect(daemon.database.sqlite.prepare("SELECT type FROM events WHERE type = 'task.status.changed' AND json_extract(payload, '$.nextStatus') = 'cancelled'").get()).toBeDefined();
    expect(daemon.database.sqlite.prepare("SELECT type FROM events WHERE type = 'task.deleted'").get()).toBeUndefined();

    daemon.database.sqlite.prepare("INSERT INTO task_activities (id, task_id, kind, by_kind, by, payload, created_at) VALUES ('act_1', ?, 'comment', 'user', 'local', ?, 1)").run(createdPayload.data.taskId, JSON.stringify({ text: "Looks good" }));
    const activitiesAfterComment = await fetch(`${baseUrl}/tasks/${createdPayload.data.taskId}/activities`);
    const activitiesAfterCommentPayload = await activitiesAfterComment.json() as { readonly activities: readonly { readonly kind: string; readonly payload: string }[] };
    expect(activitiesAfterCommentPayload.activities[0]).toMatchObject({ kind: "comment", payload: JSON.stringify({ text: "Looks good" }) });
  });

  it("serves V1.1 skill CRUD routes and protects builtin skills", async () => {
    const listed = await fetch(`${baseUrl}/skills`);
    const listedPayload = await listed.json() as { readonly skills: readonly { readonly id: string; readonly name: string; readonly origin: string }[] };
    expect(listed.status).toBe(200);
    expect(listedPayload.skills.map((skill) => skill.name).sort()).toEqual(["skill-creator", "task-planner"]);

    const builtinId = listedPayload.skills.find((skill) => skill.name === "task-planner")?.id ?? "";
    const deleteBuiltin = await fetch(`${baseUrl}/skills/${builtinId}`, { method: "DELETE" });
    expect(deleteBuiltin.status).toBe(403);

    const content = "---\nname: review-helper\ndescription: Helps review patches.\n---\n\nReview changes carefully.";
    const created = await fetch(`${baseUrl}/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "review-helper",
        description: "Helps review patches.",
        content,
        files: [{ path: "references/checklist.md", content: "- Check behavior\n- Check tests" }]
      })
    });
    const createdPayload = await created.json() as { readonly skill: { readonly id: string; readonly name: string; readonly origin: string; readonly fileCount?: number }; readonly files?: readonly { readonly path: string; readonly content: string }[] };
    expect(created.status).toBe(201);
    expect(createdPayload.skill).toMatchObject({ name: "review-helper", origin: "workspace", fileCount: 1 });
    expect(createdPayload.files).toMatchObject([{ path: "references/checklist.md", content: "- Check behavior\n- Check tests" }]);
    expect(daemon.database.sqlite.prepare("SELECT type FROM events WHERE type = 'skill.created' AND json_extract(payload, '$.skillId') = ?").get(createdPayload.skill.id)).toBeDefined();

    const fetched = await fetch(`${baseUrl}/skills/${createdPayload.skill.id}`);
    await expect(fetched.json()).resolves.toMatchObject({ skill: { id: createdPayload.skill.id, name: "review-helper", fileCount: 1 }, files: [{ path: "references/checklist.md", content: "- Check behavior\n- Check tests" }] });

    const updatedContent = "---\nname: review-assistant\ndescription: Reviews patches with a checklist.\n---\n\nUse a concise checklist.";
    const updated = await fetch(`${baseUrl}/skills/${createdPayload.skill.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "review-assistant",
        description: "Reviews patches with a checklist.",
        content: updatedContent,
        files: [{ path: "scripts/review.sh", content: "echo review" }]
      })
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ skill: { id: createdPayload.skill.id, name: "review-assistant", fileCount: 1 }, files: [{ path: "scripts/review.sh", content: "echo review" }] });
    expect(daemon.database.sqlite.prepare("SELECT type FROM events WHERE type = 'skill.updated' AND json_extract(payload, '$.skillId') = ?").get(createdPayload.skill.id)).toBeDefined();

    const deleted = await fetch(`${baseUrl}/skills/${createdPayload.skill.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(daemon.database.sqlite.prepare("SELECT * FROM skills WHERE id = ?").get(createdPayload.skill.id)).toBeUndefined();
    expect(daemon.database.sqlite.prepare("SELECT type FROM events WHERE type = 'skill.deleted' AND json_extract(payload, '$.skillId') = ?").get(createdPayload.skill.id)).toBeDefined();
  });

  it("imports GitHub skill package trees with supporting files", async () => {
    modelTestFetchMock.mockImplementation(async (request: RequestInfo | URL) => {
      const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
      if (url === "https://api.github.com/repos/rikey123/skill-pack/contents/review-helper?ref=main") {
        return new Response(JSON.stringify([
          { type: "file", name: "SKILL.md", path: "review-helper/SKILL.md", download_url: "https://raw.githubusercontent.com/rikey123/skill-pack/main/review-helper/SKILL.md" },
          { type: "dir", name: "scripts", path: "review-helper/scripts" },
          { type: "file", name: "README.md", path: "review-helper/README.md", download_url: "https://raw.githubusercontent.com/rikey123/skill-pack/main/review-helper/README.md" }
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.github.com/repos/rikey123/skill-pack/contents/review-helper/scripts?ref=main") {
        return new Response(JSON.stringify([
          { type: "file", name: "run.sh", path: "review-helper/scripts/run.sh", download_url: "https://raw.githubusercontent.com/rikey123/skill-pack/main/review-helper/scripts/run.sh" }
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/review-helper/SKILL.md")) {
        return new Response("---\nname: review-helper\ndescription: Imported package.\n---\n\nUse the script and read the reference.", { status: 200, headers: { "content-type": "text/markdown" } });
      }
      if (url.endsWith("/review-helper/scripts/run.sh")) {
        return new Response("echo imported", { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (url.endsWith("/review-helper/README.md")) {
        return new Response("# Reference", { status: 200, headers: { "content-type": "text/markdown" } });
      }
      return new Response("not found", { status: 404 });
    });

    const imported = await fetch(`${baseUrl}/skills/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/rikey123/skill-pack/tree/main/review-helper" })
    });
    const payload = await imported.json() as { readonly skill: { readonly id: string; readonly name: string; readonly origin: string; readonly sourceUrl: string; readonly fileCount: number }; readonly files: readonly { readonly path: string; readonly content: string }[] };

    expect(imported.status).toBe(201);
    expect(payload.skill).toMatchObject({ name: "review-helper", origin: "imported", sourceUrl: "https://github.com/rikey123/skill-pack/tree/main/review-helper", fileCount: 2 });
    expect(payload.files.map((file) => file.path)).toEqual(["README.md", "scripts/run.sh"]);
    expect(payload.files.find((file) => file.path === "scripts/run.sh")?.content).toBe("echo imported");
    expect(daemon.database.sqlite.prepare("SELECT type FROM events WHERE type = 'skill.imported' AND json_extract(payload, '$.skillId') = ?").get(payload.skill.id)).toBeDefined();
  });

  it("lists and imports local runtime skill packages with supporting files", async () => {
    const originalUserProfile = process.env.USERPROFILE;
    const originalHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "agenthub-local-skills-home-"));
    const skillDir = join(home, ".config", "opencode", "skills", "release", "reporter");
    mkdirSync(join(skillDir, "references"), { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: release-reporter\ndescription: Writes release reports.\n---\n\nUse the references and scripts in this package.", "utf8");
    writeFileSync(join(skillDir, "references", "guide.md"), "# Guide\nUse concise notes.", "utf8");
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    try {
      const listed = await fetch(`${baseUrl}/runtimes/runtime-opencode/local-skills`);
      const listedPayload = await listed.json() as { readonly supported?: boolean; readonly provider?: string; readonly skills?: readonly { readonly key: string; readonly name: string; readonly fileCount?: number; readonly file_count?: number; readonly sourcePath?: string; readonly source_path?: string }[] };

      expect(listed.status).toBe(200);
      expect(listedPayload).toMatchObject({ supported: true, provider: "opencode" });
      expect(listedPayload.skills).toEqual([
        expect.objectContaining({ key: "release/reporter", name: "release-reporter", fileCount: 2 })
      ]);

      const imported = await fetch(`${baseUrl}/runtimes/runtime-opencode/local-skills/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillKey: "release/reporter", name: "release-reporter-imported", description: "Imported with local edits." })
      });
      const payload = await imported.json() as { readonly skill: { readonly id: string; readonly name: string; readonly description: string; readonly origin: string; readonly sourceUrl: string; readonly fileCount: number }; readonly files: readonly { readonly path: string; readonly content: string }[] };

      expect(imported.status).toBe(201);
      expect(payload.skill).toMatchObject({ name: "release-reporter-imported", description: "Imported with local edits.", origin: "imported", sourceUrl: "local://opencode/release/reporter", fileCount: 1 });
      expect(payload.files).toEqual([expect.objectContaining({ path: "references/guide.md", content: "# Guide\nUse concise notes." })]);
      expect(daemon.database.sqlite.prepare("SELECT content FROM skills WHERE id = ?").get(payload.skill.id)).toMatchObject({ content: expect.stringContaining("name: release-reporter-imported") });
      expect(daemon.database.sqlite.prepare("SELECT type FROM events WHERE type = 'skill.imported' AND json_extract(payload, '$.skillId') = ?").get(payload.skill.id)).toBeDefined();
    } finally {
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("assigns skills to rooms and participant overrides over REST", async () => {
    const roomId = `room_skill_assign_${Date.now()}`;
    const participantId = `agent_skill_assign_${Date.now()}`;
    daemon.database.sqlite.transaction(() => {
      daemon.database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('default-workspace', 'Default', '.', ?, ?)").run(Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES (?, 'default-workspace', 'Skill Room', 'squad', 'conversation', ?, NULL, ?, ?)").run(roomId, participantId, Date.now(), Date.now());
      daemon.database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES (?, ?, 'agent', 'primary', 'mock', NULL, ?, 'active', ?)").run(roomId, participantId, participantId, Date.now());
    })();
    const created = await fetch(`${baseUrl}/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "room-skill",
        description: "Assigned to a room.",
        content: "---\nname: room-skill\ndescription: Assigned to a room.\n---\n\nUse this in the room."
      })
    });
    const createdPayload = await created.json() as { readonly skill: { readonly id: string } };
    const skillId = createdPayload.skill.id;

    const enabled = await fetch(`${baseUrl}/rooms/${roomId}/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillId, enabled: true })
    });
    expect(enabled.status).toBe(200);
    await expect(enabled.json()).resolves.toMatchObject({ assignment: { roomId, skillId, enabled: true } });

    const roomSkills = await fetch(`${baseUrl}/rooms/${roomId}/skills`);
    await expect(roomSkills.json()).resolves.toMatchObject({ skills: [expect.objectContaining({ id: skillId, enabled: true })] });
    expect(daemon.database.sqlite.prepare("SELECT enabled FROM room_skills WHERE room_id = ? AND skill_id = ?").get(roomId, skillId)).toMatchObject({ enabled: 1 });

    const override = await fetch(`${baseUrl}/rooms/${roomId}/participants/${participantId}/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillId, mode: "restrict" })
    });
    expect(override.status).toBe(200);
    await expect(override.json()).resolves.toMatchObject({ override: { participantId, skillId, mode: "restrict" } });

    const participantSkills = await fetch(`${baseUrl}/rooms/${roomId}/participants/${participantId}/skills`);
    await expect(participantSkills.json()).resolves.toMatchObject({ skills: [expect.objectContaining({ id: skillId, mode: "restrict" })] });
    expect(daemon.database.sqlite.prepare("SELECT mode FROM agent_skills WHERE room_participant_id = ? AND skill_id = ?").get(`${roomId}:${participantId}`, skillId)).toMatchObject({ mode: "restrict" });

    const deletedOverride = await fetch(`${baseUrl}/rooms/${roomId}/participants/${participantId}/skills/${skillId}`, { method: "DELETE" });
    expect(deletedOverride.status).toBe(200);
    expect(daemon.database.sqlite.prepare("SELECT * FROM agent_skills WHERE room_participant_id = ? AND skill_id = ?").get(`${roomId}:${participantId}`, skillId)).toBeUndefined();

    const disabled = await fetch(`${baseUrl}/rooms/${roomId}/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillId, enabled: false })
    });
    expect(disabled.status).toBe(200);
    expect(daemon.database.sqlite.prepare("SELECT * FROM room_skills WHERE room_id = ? AND skill_id = ?").get(roomId, skillId)).toBeUndefined();
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id = ? AND type = 'skill.activated'").get(roomId)).toMatchObject({ count: 2 });
    expect(daemon.database.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE room_id = ? AND type = 'skill.deactivated'").get(roomId)).toMatchObject({ count: 2 });
  });

  it("aggregates workspace cost by agent, model, and day with empty totals", async () => {
    const now = Date.UTC(2026, 0, 8, 12);
    seedCostRun({ id: "cost_agent_a", workspaceId: "default-workspace", agentId: "mock-builder", endedAt: now - 1_000, inputTokens: 10, outputTokens: 20, cachedTokens: 3, costUsd: 0.5, modelId: "m1" });
    seedCostRun({ id: "cost_agent_b", workspaceId: "default-workspace", agentId: "mock-reviewer", endedAt: now - 2_000, inputTokens: 5, outputTokens: 7, cachedTokens: 1, costUsd: 0.25, modelId: "m2" });
    seedCostRun({ id: "cost_other_workspace", workspaceId: "other-workspace", agentId: "mock-builder", endedAt: now - 1_000, inputTokens: 999, outputTokens: 999, cachedTokens: 999, costUsd: 999, modelId: "m1" });

    const agent = await fetch(`${baseUrl}/workspaces/default-workspace/cost-summary?from=${now - 10_000}&to=${now}`);
    const agentPayload = await agent.json() as { readonly groupBy: string; readonly groups: readonly { readonly key: string; readonly inputTokens: number }[]; readonly total: { readonly runCount: number; readonly costUsd: number } };
    expect(agent.status).toBe(200);
    expect(agentPayload.groupBy).toBe("agent");
    expect(agentPayload.groups.map((group) => group.key)).toEqual(["mock-builder", "mock-reviewer"]);
    expect(agentPayload.total).toMatchObject({ runCount: 2, costUsd: 0.75 });

    const model = await (await fetch(`${baseUrl}/workspaces/default-workspace/cost-summary?groupBy=model&from=${now - 10_000}&to=${now}`)).json() as { readonly groups: readonly { readonly key: string }[] };
    expect(model.groups.map((group) => group.key)).toEqual(["m1", "m2"]);

    const day = await (await fetch(`${baseUrl}/workspaces/default-workspace/cost-summary?groupBy=day&from=${now - 10_000}&to=${now}`)).json() as { readonly groups: readonly { readonly key: string }[] };
    expect(day.groups).toEqual([{ key: "2026-01-08", inputTokens: 15, outputTokens: 27, cachedTokens: 4, costUsd: 0.75, runCount: 2 }]);

    const empty = await (await fetch(`${baseUrl}/workspaces/default-workspace/cost-summary?from=1&to=2`)).json() as { readonly groups: readonly unknown[]; readonly total: { readonly runCount: number; readonly costUsd: number } };
    expect(empty.groups).toEqual([]);
    expect(empty.total).toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, runCount: 0 });
  });

  it("returns workspace 404 and budget 501 for cost APIs", async () => {
    const missing = await fetch(`${baseUrl}/workspaces/missing/cost-summary`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "workspace_not_found" });

    const budget = await fetch(`${baseUrl}/workspaces/default-workspace/cost-budget`, { method: "POST" });
    expect(budget.status).toBe(501);
    expect(await budget.json()).toEqual({ error: "budget alerts are V1.5 (permission-dsl)" });
  });

  it("issues, lists without secret, and revokes auth tokens", async () => {
    const issued = await fetch(`${baseUrl}/auth/tokens`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: "ci", scopes: ["read"], expiresDays: 1 }) });
    const issuedPayload = await issued.json() as { readonly id: string; readonly token: string; readonly fingerprint: string };
    expect(issued.status).toBe(201);
    expect(issuedPayload.token).toMatch(/^ah_/u);

    const listed = await fetch(`${baseUrl}/auth/tokens`);
    const listedPayload = await listed.json() as { readonly tokens: readonly { readonly id: string; readonly fingerprint: string; readonly token?: string }[] };
    expect(listedPayload.tokens).toContainEqual(expect.objectContaining({ id: issuedPayload.id, fingerprint: issuedPayload.fingerprint }));
    expect(JSON.stringify(listedPayload)).not.toContain(issuedPayload.token);

    const revoked = await fetch(`${baseUrl}/auth/tokens/${issuedPayload.id}`, { method: "DELETE" });
    expect(revoked.status).toBe(200);
  });

  it("loads config with CLI over env over toml and enforces remote token safety", () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-config-test-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, "[server]\nbind = \"127.0.0.1\"\nport = 6800\n[auth]\ntoken = \"toml-token\"\n", "utf8");

    const config = loadAgentHubConfig({ configPath: path, port: 7000 }, { AGENTHUB_PORT: "6900", AGENTHUB_TOKEN: "env-token" });
    expect(config.server.port).toBe(7000);
    expect(config.auth.token).toBe("env-token");

    writeFileSync(path, "[server]\nbind = \"0.0.0.0\"\n", "utf8");
    expect(() => loadAgentHubConfig({ configPath: path }, {})).toThrow("Refusing to bind 0.0.0.0 without auth.token");
    writeFileSync(path, "[server]\nbind = \"0.0.0.0\"\n[auth]\ntoken = \"secret\"\n", "utf8");
    expect(() => loadAgentHubConfig({ configPath: path }, {})).toThrow("[server.remote] enabled = true");
  });

  it("force cancels in-flight runs after shutdown timeout", async () => {
    seedBusyRun("room_shutdown", "mock-builder", "run_shutdown");

    const result = await daemon.close({ forceCancelAfterMs: 1 });
    currentDaemon = undefined;

    expect(result).toEqual({ forced: true, cancelledRunIds: ["run_shutdown"] });
    expect(daemon.inFlightRunIds()).toEqual([]);
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function seedBusyRun(roomId: string, agentId: string, runId: string, status = "running"): void {
  activeDaemon().database.sqlite.prepare(
    `INSERT INTO runs (
      id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id,
      parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version,
      target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens,
      cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at
    ) VALUES (?, 'default-workspace', NULL, ?, ?, NULL, NULL, NULL, NULL, ?, 'primary_turn', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
  ).run(runId, roomId, agentId, status, Date.now(), Date.now());
}

function seedPendingMessage(roomId: string, agentId: string, messageId: string, text: string): void {
  activeDaemon().database.sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES (?, 'default-workspace', ?, 'user', 'local', NULL, 'user', 'completed', NULL, 'pending', ?, ?, ?, NULL)").run(messageId, roomId, messageId, Date.now(), Date.now());
  activeDaemon().database.sqlite.prepare("INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES (?, 1, 'text', ?, ?)").run(messageId, JSON.stringify({ text }), Date.now());
  activeDaemon().database.sqlite.prepare("INSERT INTO pending_turns (id, room_id, user_message_id, primary_agent_id, status, enqueued_at, scheduled_at, cancelled_at, notes) VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL)").run(messageId, roomId, messageId, agentId, Date.now());
}

function seedCostRun(input: { readonly id: string; readonly workspaceId: string; readonly agentId: string; readonly endedAt: number; readonly inputTokens: number; readonly outputTokens: number; readonly cachedTokens: number; readonly costUsd: number; readonly modelId: string }): void {
  activeDaemon().database.sqlite.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, 1, 1)").run(input.workspaceId, input.workspaceId, `/tmp/${input.workspaceId}`);
  activeDaemon().database.sqlite.prepare(
    `INSERT INTO runs (
      id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id,
      parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version,
      target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens,
      cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at
    ) VALUES (?, ?, NULL, 'room_cost', ?, NULL, NULL, NULL, NULL, 'completed', 'primary_turn', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
  ).run(input.id, input.workspaceId, input.agentId, input.endedAt - 100, input.endedAt, input.inputTokens, input.outputTokens, input.cachedTokens, input.costUsd, input.modelId, input.endedAt - 100, input.endedAt);
}

function activeDaemon(): DaemonApp {
  if (!currentDaemon) throw new Error("daemon is not initialized");
  return currentDaemon;
}

function messagePayload(daemon: DaemonApp, messageId: string, type: string): unknown {
  const row = daemon.database.sqlite.prepare("SELECT payload FROM events WHERE type = ? AND json_extract(payload, '$.messageId') = ? ORDER BY seq DESC LIMIT 1").get(type, messageId) as { readonly payload: string } | undefined;
  if (!row) throw new Error(`event ${type} for message ${messageId} not found`);
  return JSON.parse(row.payload) as unknown;
}

function expectDetailOnlyEvent(daemon: DaemonApp, type: string, payloadKey: string, payloadValue: string): void {
  const detailEvents = daemon.eventBus.replayDurableSinceSeq(0, { view: "detail" }).filter((event) => event.type === type && (event.payload as Record<string, unknown>)[payloadKey] === payloadValue);
  const mainEvents = daemon.eventBus.replayDurableSinceSeq(0, { view: "main" }).filter((event) => event.type === type && (event.payload as Record<string, unknown>)[payloadKey] === payloadValue);

  expect(detailEvents).toHaveLength(1);
  expect(detailEvents[0]).toMatchObject({ durability: "durable", visibility: "detail" });
  expect(mainEvents).toHaveLength(0);
}

function expectNoPlaintextSecret(daemon: DaemonApp, secret: string, responses: readonly unknown[]): void {
  const responseJson = JSON.stringify(responses);
  const eventRows = daemon.database.sqlite.prepare("SELECT payload FROM events WHERE type LIKE 'model_config.%' ORDER BY seq ASC").all() as { readonly payload: string }[];
  const configRows = daemon.database.sqlite.prepare("SELECT id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, profile FROM model_configs ORDER BY created_at ASC").all();

  expect(responseJson).not.toContain(secret);
  expect(JSON.stringify(eventRows)).not.toContain(secret);
  expect(JSON.stringify(configRows)).not.toContain(secret);
}

async function readSseEvent(body: ReadableStream<Uint8Array> | null, eventName: string): Promise<string> {
  if (body === null) throw new Error("expected SSE body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeout = Date.now() + 2_000;
  try {
    while (Date.now() < timeout) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const frame of buffer.split("\n\n")) {
        if (frame.includes(`event: ${eventName}`)) {
          await reader.cancel();
          return frame;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error(`Timed out waiting for SSE event ${eventName}: ${buffer}`);
}

async function invokeHandler(daemon: DaemonApp, method: string, url: string, body?: unknown): Promise<{ readonly status: number; readonly body: unknown }> {
  const { EventEmitter } = await import("node:events");
  const req = new EventEmitter() as Parameters<DaemonApp["handle"]>[0] & { method?: string; url?: string; headers?: Record<string, string>; [Symbol.asyncIterator]?: () => AsyncIterableIterator<Buffer> };
  req.method = method;
  req.url = url;
  req.headers = body === undefined ? {} : { "content-type": "application/json" };
  req[Symbol.asyncIterator] = async function* () {
    if (body === undefined) return;
    yield Buffer.from(JSON.stringify(body));
  };
  const chunks: Buffer[] = [];
  const res = new EventEmitter() as Parameters<DaemonApp["handle"]>[1] & { statusCode?: number; capturedHeaders?: unknown };
  res.writeHead = ((status: number, statusMessageOrHeaders?: unknown, headers?: unknown) => {
    res.statusCode = status;
    res.capturedHeaders = headers ?? statusMessageOrHeaders;
    return res;
  }) as typeof res.writeHead;
  res.write = (chunk: string | Buffer) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  };
  const ended = new Promise<void>((resolve) => {
    res.end = ((chunk?: unknown) => {
      if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      resolve();
      return res;
    }) as typeof res.end;
  });
  daemon.handle(req, res);
  await ended;
  return { status: res.statusCode ?? 200, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
}

async function waitFor<T>(read: () => T, done: (value: T) => boolean, options: { readonly timeoutMs?: number } = {}): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 2_000);
  let value = read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = read();
  }
  if (!done(value)) throw new Error(`Timed out waiting for condition: ${JSON.stringify(value)}`);
  return value;
}
