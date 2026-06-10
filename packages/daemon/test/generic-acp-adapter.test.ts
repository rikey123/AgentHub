import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { RunLifecycleService } from "@agenthub/orchestrator";
import type { AdapterMessage } from "@agenthub/protocol";
import { describe, expect, it, vi } from "vitest";

import { GenericACPAdapter } from "../src/adapters/generic-acp.ts";

describe("GenericACPAdapter", () => {
  it("creates managed sessions in the ArtifactFS prepared workDir", async () => {
    const fixture = createFixture();
    try {
      const preparedRoot = join("prepared", "generic-run");
      const artifactFs = {
        beginRun: vi.fn(() => ({ workDir: preparedRoot })),
        writeTextFile: vi.fn(),
        deleteFile: vi.fn(),
        buildRunArtifact: vi.fn(),
        buildWorktreeDiffArtifact: vi.fn()
      };
      const adapter = new CapturingGenericACPAdapter({
        id: "codex",
        runtimeKind: "codex",
        name: "Codex",
        command: "",
        args: [],
        services: { database: fixture.database, eventBus: fixture.eventBus },
        lifecycle: fixture.lifecycle,
        workspaceId: "ws_1",
        artifactFs
      });

      await adapter.runManaged(fixture.lifecycle.read("run_1"));

      expect(artifactFs.beginRun).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_1", messageId: "msg_run_1", terminalEnabled: false }));
      expect(adapter.debugSession("acp-codex-run_1")).toMatchObject({ workDir: preparedRoot });
    } finally {
      fixture.close();
    }
  });

  it("finalizes managed cancellation without waiting for a provider session/end event", async () => {
    const fixture = createFixture();
    try {
      const adapter = new GenericACPAdapter({
        id: "codex",
        runtimeKind: "codex",
        name: "Codex",
        command: "",
        args: [],
        services: { database: fixture.database, eventBus: fixture.eventBus },
        lifecycle: fixture.lifecycle,
        workspaceId: "ws_1"
      });

      await adapter.runManaged(fixture.lifecycle.read("run_1"));
      fixture.lifecycle.markCancelling(null, "run_1");
      await adapter.cancelManagedRun("run_1");

      expect(fixture.database.sqlite.prepare("SELECT status, failure_class FROM runs WHERE id = 'run_1'").get()).toMatchObject({
        status: "cancelled",
        failure_class: "user_cancelled"
      });
      expect(fixture.database.sqlite.prepare("SELECT type FROM events WHERE type = 'agent.run.cancelled' AND run_id = 'run_1'").get()).toMatchObject({ type: "agent.run.cancelled" });
    } finally {
      fixture.close();
    }
  });
});

class CapturingGenericACPAdapter extends GenericACPAdapter {
  capturedPrompt = "";

  protected override sendPrompt(_sessionId: string, message: AdapterMessage): string {
    this.capturedPrompt = message.content;
    return "captured";
  }
}

function createFixture(): { readonly database: AgentHubDatabase; readonly eventBus: ReturnType<typeof createEventBus>; readonly lifecycle: RunLifecycleService; close(): void } {
  const dir = mkdtempSync(join(tmpdir(), "agenthub-generic-acp-"));
  const database = createDatabase({ path: join(dir, "agenthub.sqlite"), applyMigrations: true });
  database.sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', 1, 1)").run();
  database.sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_1', 'ws_1', 'Agent One', 'codex', NULL, '', '{}', NULL, 0, NULL, 1, 1)").run();
  database.sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'solo', 'conversation', 'agent_1', NULL, 1, 1)").run();
  database.sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, default_presence, joined_at) VALUES ('room_1', 'agent_1', 'agent', 'primary', 'codex', NULL, 'active', 1)").run();
  const eventBus = createEventBus({ database });
  const lifecycle = new RunLifecycleService(database, eventBus, { now: () => 1 });
  lifecycle.create(null, { runId: "run_1", workspaceId: "ws_1", roomId: "room_1", agentId: "agent_1", wakeReason: "primary_turn" });
  lifecycle.markClaimed(null, "run_1");
  lifecycle.markStarting(null, "run_1", 123);

  return {
    database,
    eventBus,
    lifecycle,
    close: () => {
      eventBus.close();
      database.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
