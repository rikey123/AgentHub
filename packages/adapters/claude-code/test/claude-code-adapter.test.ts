import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArtifactFSRunRegistry, ArtifactService } from "@agenthub/artifacts";
import { CommandBus, createEventBus } from "@agenthub/bus";
import { createDatabase } from "@agenthub/db";
import { RoomMcpServer, RunLifecycleService, TaskService } from "@agenthub/orchestrator";
import { PermissionEngine, seedBuiltInPermissionProfiles } from "@agenthub/permissions";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ClaudeCodeACPAdapter, claudeCodeManifest } from "../src/index.ts";

describe("ClaudeCodeACPAdapter", () => {
  it("reports explicit not_found/auth_required style absence instead of hiding detection failure", () => {
    const adapter = new ClaudeCodeACPAdapter({ command: "agenthub-claude-missing-for-test" });
    expect(() => Effect.runSync(adapter.detect())).toThrow(/not found|not_found/iu);
  });

  it("manifest is resumable and attachSession restores a persisted session", () => {
    const adapter = new ClaudeCodeACPAdapter({ command: "" });
    const session = Effect.runSync(adapter.attachSession({ runId: "run", adapterSessionId: "claude-session", workDir: ".", providerConversationId: "conv" }));
    expect(claudeCodeManifest.reliability.crashRecovery).toBe("resumable");
    expect(claudeCodeManifest.capabilities.canRestoreSession).toBe(true);
    expect(session).toMatchObject({ id: "claude-session", runId: "run", providerConversationId: "conv" });
  });

  it("maps structured file events through AdapterBridge and ArtifactFS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenthub-claude-artifactfs-"));
    const workspace = join(dir, "workspace");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "src", "a.ts"), "old", "utf8");
    const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
    database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('w', 'w', ?, 1, 1)").run(workspace);
    database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('r', 'w', 'r', 'solo', 'conversation', 'a', NULL, 1, 1)").run();
    seedBuiltInPermissionProfiles(database, 1);
    const eventBus = createEventBus({ database });
    const lifecycle = new RunLifecycleService(database, eventBus);
    const artifacts = new ArtifactService({ database, eventBus });
    const artifactFs = new ArtifactFSRunRegistry({ database, service: artifacts, eventBus });
    const permissions = new PermissionEngine({ database, eventBus });
    lifecycle.create(null, { runId: "run", workspaceId: "w", roomId: "r", agentId: "a", wakeReason: "primary_turn", workspaceMode: "shadow_buffer", messageId: "m" });
    lifecycle.markClaimed(null, "run");
    lifecycle.markStarting(null, "run", 123);
    const taskService = new TaskService({ database, eventBus });
    const mcpServer = new RoomMcpServer({ commandBus: new CommandBus({ database }), taskService });
    const adapter = new ClaudeCodeACPAdapter({ command: "", services: { database, eventBus, permissionEngine: permissions, artifactFs }, lifecycle, workspaceId: "w", permissionEngine: permissions, mcpServer });

    await adapter.runManaged(lifecycle.read("run"));
    expect(adapter.debugSession("acp-claude-code-run")?.mcpServer).toBe(mcpServer);
    adapter.mapToBridgeEvent("run", { type: "fs/write", payload: { path: "src/a.ts", content: "new" } });
    adapter.mapToBridgeEvent("run", { type: "session/end", payload: { sessionId: "acp-claude-code-run", reason: "completed" } });

    expect(readFileSync(join(workspace, "src", "a.ts"), "utf8")).toBe("old");
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE run_id = 'run'").get()).toMatchObject({ count: 1 });
    database.sqlite.close();
  });
});
