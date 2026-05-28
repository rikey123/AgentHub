import { ClaudeCodeACPAdapter } from "@agenthub/adapter-claude-code";
import { OpenCodeACPAdapter } from "@agenthub/adapter-opencode";
import { MockAdapterManager } from "@agenthub/adapter-mock";
import type { AgentHubDatabase } from "@agenthub/db";
import type { AdapterArtifactFSBoundary, ReclaimAdapter, RoomMcpServer, RunLifecycleService, RunRow, BriefResolver } from "@agenthub/orchestrator";
import type { CommandBus, EventBus } from "@agenthub/bus";
import type { PermissionEngine } from "@agenthub/permissions";

export type RuntimeAdapterId = "mock" | "claude-code" | "opencode" | "native";

export type AdapterRegistryOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly lifecycle: RunLifecycleService;
  readonly permissionEngine?: PermissionEngine;
  readonly artifactFs?: AdapterArtifactFSBoundary;
  readonly briefResolver?: BriefResolver;
  readonly getRoomMcpServer?: () => RoomMcpServer;
  readonly getCommandBus?: () => CommandBus | undefined;
  readonly mockAdapter?: MockAdapterManager;
  readonly claudeAdapter?: WarmableManagedAdapter;
  readonly opencodeAdapter?: WarmableManagedAdapter;
  readonly nativeAdapter?: NativeManagedAdapter;
  readonly adapterCommands?: {
    readonly claude?: { readonly command: string; readonly args?: readonly string[]; readonly env?: NodeJS.ProcessEnv };
    readonly opencode?: { readonly command: string; readonly args?: readonly string[]; readonly env?: NodeJS.ProcessEnv };
  };
  readonly now?: () => number;
};

type WarmableManagedAdapter = Pick<ClaudeCodeACPAdapter, "runManaged" | "cancelManagedRun" | "warmRoomAgent" | "disposeRoomWarmSessions" | "disposeAllSessions"> & {
  readonly debugSession?: ClaudeCodeACPAdapter["debugSession"];
};

type NativeManagedAdapter = Pick<NativeAgentAdapter, "runManaged" | "cancelManagedRun">;
type NativeAgentAdapter = {
  readonly runManaged: (run: RunRow) => Promise<void>;
  readonly cancelManagedRun: (runId: string) => Promise<void>;
  readonly disposeAllRuns?: () => void;
};

type ModelConfigRow = {
  readonly provider: string;
  readonly model: string;
  readonly base_url?: string | null;
  readonly api_key_ref?: string | null;
};

export class AdapterRegistry {
  readonly mockAdapter: MockAdapterManager;
  private readonly runAdapters = new Map<string, RuntimeAdapterId>();
  private claudeAdapter: WarmableManagedAdapter | undefined;
  private opencodeAdapter: WarmableManagedAdapter | undefined;
  private nativeAdapter: NativeManagedAdapter | undefined;

  constructor(private readonly options: AdapterRegistryOptions) {
    this.mockAdapter = options.mockAdapter ?? new MockAdapterManager({ database: options.database, eventBus: options.eventBus, lifecycle: options.lifecycle, ...(options.artifactFs !== undefined ? { artifactFs: options.artifactFs } : {}), ...(options.now !== undefined ? { now: options.now } : {}) });
    this.claudeAdapter = options.claudeAdapter;
    this.opencodeAdapter = options.opencodeAdapter;
    this.nativeAdapter = options.nativeAdapter;
  }

  async runAgent(run: RunRow): Promise<void> {
    const adapterId = this.adapterIdForRun(run);
    this.runAdapters.set(run.id, adapterId);
    if (adapterId === "claude-code") {
      await this.claude().runManaged(run);
      return;
    }
    if (adapterId === "opencode") {
      await this.opencode().runManaged(run);
      return;
    }
    if (adapterId === "native") {
      await this.native().then((adapter) => adapter.runManaged(run));
      return;
    }
    await this.mockAdapter.runAgent(run);
  }

  prewarmRoomAgents(roomId: string): void {
    const rows = this.options.database.sqlite
      .prepare(
        `SELECT rp.participant_id AS agent_id, rp.adapter_id, w.root_path
         FROM room_participants rp
         JOIN rooms r ON r.id = rp.room_id
         LEFT JOIN workspaces w ON w.id = r.workspace_id
         WHERE rp.room_id = ? AND rp.participant_type = 'agent' AND rp.default_presence = 'active'`
      )
      .all(roomId) as { readonly agent_id: string; readonly adapter_id: string | null; readonly root_path: string | null }[];
    for (const row of rows) {
      const adapterId = this.classify(row.adapter_id, row.agent_id);
      if (adapterId === "mock") continue;
      if (adapterId === "native") continue;
      const sessionId = this.warmSessionId(adapterId, roomId, row.agent_id);
      try {
        const workDir = row.root_path ?? process.cwd();
        this.options.database.sqlite
          .prepare("UPDATE room_participants SET adapter_session_id = ? WHERE room_id = ? AND participant_id = ? AND participant_type = 'agent'")
          .run(sessionId, roomId, row.agent_id);
        const createdSessionId = adapterId === "claude-code"
          ? this.claude().warmRoomAgent({ roomId, agentId: row.agent_id, workDir })
          : this.opencode().warmRoomAgent({ roomId, agentId: row.agent_id, workDir });
        if (createdSessionId !== sessionId) {
          this.options.database.sqlite
            .prepare("UPDATE room_participants SET adapter_session_id = ? WHERE room_id = ? AND participant_id = ? AND participant_type = 'agent' AND adapter_session_id = ?")
            .run(createdSessionId, roomId, row.agent_id, sessionId);
        }
      } catch {
        this.clearWarmSession({ roomId, agentId: row.agent_id, adapterSessionId: sessionId });
        // Mirroring AionUi's warmup path: preloading is best-effort and must not
        // make room creation fail. The first real run will create a fresh session.
      }
    }
  }

  async cancelRun(runId: string): Promise<void> {
    const adapterId = this.runAdapters.get(runId) ?? this.adapterIdForPersistedRun(runId);
    if (adapterId === "claude-code") {
      await this.claude().cancelManagedRun(runId);
      return;
    }
    if (adapterId === "opencode") {
      await this.opencode().cancelManagedRun(runId);
      return;
    }
    if (adapterId === "native") {
      await this.native().then((adapter) => adapter.cancelManagedRun(runId));
      return;
    }
    this.mockAdapter.cancelRun(runId);
  }

  disposeRoomAgents(roomId: string): void {
    const rows = this.options.database.sqlite
      .prepare("SELECT adapter_session_id FROM room_participants WHERE room_id = ? AND adapter_session_id IS NOT NULL")
      .all(roomId) as { readonly adapter_session_id: string }[];
    this.claudeAdapter?.disposeRoomWarmSessions(roomId);
    this.opencodeAdapter?.disposeRoomWarmSessions(roomId);
    const roomMcpServer = this.options.getRoomMcpServer?.();
    for (const row of rows) roomMcpServer?.unregisterSession(row.adapter_session_id);
    this.options.database.sqlite.prepare("UPDATE room_participants SET adapter_session_id = NULL WHERE room_id = ?").run(roomId);
  }

  disposeAll(): void {
    this.claudeAdapter?.disposeAllSessions();
    this.opencodeAdapter?.disposeAllSessions();
    this.nativeAdapter?.disposeAllRuns?.();
    this.nativeAdapter = undefined;
    this.options.database.sqlite.prepare("UPDATE room_participants SET adapter_session_id = NULL WHERE adapter_session_id IS NOT NULL").run();
  }

  getClaudeAdapterForTest(): Pick<ClaudeCodeACPAdapter, "debugSession"> | undefined {
    return this.claudeAdapter?.debugSession !== undefined ? this.claudeAdapter as Pick<ClaudeCodeACPAdapter, "debugSession"> : undefined;
  }

  // Used by StartupRecovery to decide what to do with each in-flight run after
  // a daemon restart. ACP adapters claim `resumable` in their manifest, but
  // the actual ACP child process died with the previous daemon, so the
  // attachSession path always throws. Returning `fail_run` here makes the
  // recovery mark these runs failed cleanly (and clear `run_locks`), which
  // lets fresh runs in the same room start without waiting on dead lock owners.
  reclaimAdapterFor(run: RunRow): ReclaimAdapter {
    void run;
    return { crashRecovery: "fail_run" };
  }

  private claude(): WarmableManagedAdapter {
    this.claudeAdapter ??= new ClaudeCodeACPAdapter({
      services: { database: this.options.database, eventBus: this.options.eventBus, ...(this.options.getCommandBus !== undefined ? { getCommandBus: this.options.getCommandBus } : {}), ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}), ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {}), ...(this.options.briefResolver !== undefined ? { briefResolver: this.options.briefResolver } : {}) },
      lifecycle: this.options.lifecycle,
      workspaceId: "default-workspace",
      ...(this.options.adapterCommands?.claude !== undefined ? this.options.adapterCommands.claude : {}),
      ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}),
      ...(this.options.getRoomMcpServer !== undefined ? { mcpServer: this.options.getRoomMcpServer() } : {}),
      onWarmSessionFailed: (input) => this.clearWarmSession(input),
      ...(this.options.now !== undefined ? { now: this.options.now } : {})
    });
    return this.claudeAdapter;
  }

  private opencode(): WarmableManagedAdapter {
    this.opencodeAdapter ??= new OpenCodeACPAdapter({
      services: { database: this.options.database, eventBus: this.options.eventBus, ...(this.options.getCommandBus !== undefined ? { getCommandBus: this.options.getCommandBus } : {}), ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}), ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {}), ...(this.options.briefResolver !== undefined ? { briefResolver: this.options.briefResolver } : {}) },
      lifecycle: this.options.lifecycle,
      workspaceId: "default-workspace",
      ...(this.options.adapterCommands?.opencode !== undefined ? this.options.adapterCommands.opencode : {}),
      ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}),
      ...(this.options.getRoomMcpServer !== undefined ? { mcpServer: this.options.getRoomMcpServer() } : {}),
      onWarmSessionFailed: (input) => this.clearWarmSession(input),
      ...(this.options.now !== undefined ? { now: this.options.now } : {})
    });
    return this.opencodeAdapter;
  }

  private async native(): Promise<NativeManagedAdapter> {
    this.nativeAdapter ??= new (await import("../../../native-agent-runtime/src/native-agent-adapter.ts")).NativeAgentAdapter({
      database: this.options.database,
      eventBus: this.options.eventBus,
      lifecycle: this.options.lifecycle,
      modelConfig: this.nativeModelConfig(),
      ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {}),
      ...(this.options.now !== undefined ? { now: this.options.now } : {})
    } as never);
    return this.nativeAdapter;
  }

  private nativeModelConfig(): ModelConfigRow {
    const row = this.options.database.sqlite
      .prepare(
        `SELECT mc.provider AS provider, mc.model AS model, mc.base_url AS base_url, mc.api_key_ref AS api_key_ref
         FROM room_participants rp
         JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
         JOIN model_configs mc ON mc.id = ab.model_config_id
         WHERE rp.adapter_id = 'native' AND rp.participant_type = 'agent' AND rp.agent_binding_id IS NOT NULL
         ORDER BY rp.joined_at ASC LIMIT 1`
      )
      .get() as ModelConfigRow | undefined;
    if (row !== undefined) return row;
    return { provider: "ollama", model: "native-default", base_url: "http://localhost:11434/v1", api_key_ref: null };
  }

  private clearWarmSession(input: { readonly roomId: string; readonly agentId: string; readonly adapterSessionId: string }): void {
    this.options.database.sqlite
      .prepare("UPDATE room_participants SET adapter_session_id = NULL WHERE room_id = ? AND participant_id = ? AND participant_type = 'agent' AND adapter_session_id = ?")
      .run(input.roomId, input.agentId, input.adapterSessionId);
    this.options.getRoomMcpServer?.().unregisterSession(input.adapterSessionId);
  }

  private warmSessionId(adapterId: Exclude<RuntimeAdapterId, "mock">, roomId: string, agentId: string): string {
    return `acp-${adapterId}-warm-${roomId}-${agentId}`;
  }

  private adapterIdForRun(run: RunRow): RuntimeAdapterId {
    return this.classify(run.adapter_id, run.agent_id);
  }

  private adapterIdForPersistedRun(runId: string): RuntimeAdapterId {
    const row = this.options.database.sqlite.prepare("SELECT adapter_id, agent_id FROM runs WHERE id = ?").get(runId) as { readonly adapter_id: string | null; readonly agent_id: string } | undefined;
    if (row === undefined) return "mock";
    return this.classify(row.adapter_id, row.agent_id);
  }

  private adapterIdForAgent(agentId: string): RuntimeAdapterId {
    const row = this.options.database.sqlite.prepare("SELECT adapter_id FROM agent_profiles WHERE id = ?").get(agentId) as { readonly adapter_id: string | null } | undefined;
    return this.classify(row?.adapter_id ?? null, agentId);
  }

  private classify(adapterId: string | null, agentId: string): RuntimeAdapterId {
    if (adapterId !== null) {
      if (adapterId === "claude-code" || adapterId.startsWith("claude-code-")) return "claude-code";
      if (adapterId === "opencode" || adapterId.startsWith("opencode-")) return "opencode";
      if (adapterId === "native" || adapterId.startsWith("native-")) return "native";
      if (adapterId === "mock" || adapterId.startsWith("mock-")) return "mock";
    }
    // Fall back to agent_profiles lookup if we were given a run.adapter_id that didn't match.
    const row = this.options.database.sqlite.prepare("SELECT adapter_id FROM agent_profiles WHERE id = ?").get(agentId) as { readonly adapter_id: string | null } | undefined;
    const profileId = row?.adapter_id;
    if (profileId !== null && profileId !== undefined) {
      if (profileId === "claude-code" || profileId.startsWith("claude-code-")) return "claude-code";
      if (profileId === "opencode" || profileId.startsWith("opencode-")) return "opencode";
      if (profileId === "native" || profileId.startsWith("native-")) return "native";
    }
    return "mock";
  }
}
