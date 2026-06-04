import { ClaudeCodeACPAdapter } from "@agenthub/adapter-claude-code";
import { OpenCodeACPAdapter } from "@agenthub/adapter-opencode";
import { MockAdapterManager } from "@agenthub/adapter-mock";
import type { AgentHubDatabase } from "@agenthub/db";
import type { AdapterArtifactFSBoundary, ReclaimAdapter, RoomMcpServer, RunLifecycleService, RunRow, BriefResolver } from "@agenthub/orchestrator";
import type { CommandBus, EventBus } from "@agenthub/bus";
import type { PermissionEngine } from "@agenthub/permissions";
import type { KeychainBridge } from "@agenthub/security";
import { SkillMaterializationError, type SkillRegistry } from "@agenthub/skills";
import { runtimeDefinitionForKind } from "../runtime-catalog.ts";
import { GenericACPAdapter, type GenericAcpAdapterConfig } from "./generic-acp.ts";

export type RuntimeAdapterId = "mock" | "claude-code" | "opencode" | "native" | "custom-acp" | "codex" | "qwen" | "goose" | "kimi" | "cursor" | "kiro" | "hermes";

export type AdapterRegistryOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly lifecycle: RunLifecycleService;
  readonly permissionEngine?: PermissionEngine;
  readonly keychain?: KeychainBridge;
  readonly artifactFs?: AdapterArtifactFSBoundary;
  readonly fileMessageService?: NativeFileMessageService;
  readonly briefResolver?: BriefResolver;
  readonly getRoomMcpServer?: () => RoomMcpServer;
  readonly getCommandBus?: () => CommandBus | undefined;
  readonly onSessionEndedWithoutCompletion?: (taskId: string) => void | Promise<void>;
  readonly onPlanPhaseEnded?: (runId: string) => void | Promise<void>;
  readonly onSkillMaterializationFailed?: (input: { readonly taskId?: string; readonly skillId: string; readonly skillName: string; readonly workspaceId: string; readonly runId: string; readonly error: string }) => void;
  readonly skillRegistry?: SkillRegistry;
  readonly mockAdapter?: MockAdapterManager;
  readonly claudeAdapter?: WarmableManagedAdapter;
  readonly opencodeAdapter?: WarmableManagedAdapter;
  readonly nativeAdapter?: NativeManagedAdapter;
  readonly genericAcpAdapterFactory?: (config: GenericAcpAdapterConfig) => WarmableManagedAdapter;
  readonly adapterCommands?: {
    readonly claude?: { readonly command: string; readonly args?: readonly string[]; readonly env?: NodeJS.ProcessEnv };
    readonly opencode?: { readonly command: string; readonly args?: readonly string[]; readonly env?: NodeJS.ProcessEnv };
  };
  readonly now?: () => number;
};

type WarmableManagedAdapter = Pick<ClaudeCodeACPAdapter, "runManaged" | "cancelManagedRun" | "warmRoomAgent" | "disposeRoomWarmSessions" | "disposeAllSessions"> & {
  readonly debugSession?: ClaudeCodeACPAdapter["debugSession"];
};

// NativeAgentAdapter is a real V1.0 runtime adapter, not a stub.
type NativeManagedAdapter = Pick<NativeAgentAdapter, "runManaged" | "cancelManagedRun" | "disposeAllRuns">;
type NativeAgentAdapter = {
  readonly runManaged: (run: RunRow) => Promise<void>;
  readonly cancelManagedRun: (runId: string) => Promise<void>;
  readonly disposeAllRuns?: () => void;
};

type NativeFileMessageService = {
  readonly createFromContent: (input: {
    readonly workspaceId: string;
    readonly roomId: string;
    readonly runId: string;
    readonly agentId: string;
    readonly messageId: string;
    readonly title: string;
    readonly path: string;
    readonly content: string;
    readonly mimeType: string;
    readonly previewKind: "markdown" | "text" | "code";
  }) => {
    readonly artifactId: string;
    readonly path: string;
    readonly name: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly previewKind: "markdown" | "text" | "code";
  };
};

type ModelConfigRow = {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly base_url?: string | null;
  readonly api_key_ref?: string | null;
};

type RuntimeConfigRow = {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly command: string | null;
  readonly args: string | null;
  readonly env: string | null;
};

const GENERIC_ACP_RUNTIME_KINDS = new Set(["custom-acp", "codex", "qwen", "goose", "kimi", "cursor", "kiro", "hermes"]);

export class AdapterRegistry {
  readonly mockAdapter: MockAdapterManager;
  private readonly runAdapters = new Map<string, RuntimeAdapterId>();
  /** Per-run skills prompt block for shared-mode runs (spec D9 fallback injection). */
  private readonly runSkillsBlocks = new Map<string, string>();
  private claudeAdapter: WarmableManagedAdapter | undefined;
  private opencodeAdapter: WarmableManagedAdapter | undefined;
  private nativeAdapter: NativeManagedAdapter | undefined;
  private readonly genericAdapters = new Map<string, WarmableManagedAdapter>();

  constructor(private readonly options: AdapterRegistryOptions) {
    this.mockAdapter = options.mockAdapter ?? new MockAdapterManager({
      database: options.database,
      eventBus: options.eventBus,
      lifecycle: options.lifecycle,
      ...(options.artifactFs !== undefined ? { artifactFs: options.artifactFs } : {}),
      ...(options.onSessionEndedWithoutCompletion !== undefined ? { onSessionEndedWithoutCompletion: options.onSessionEndedWithoutCompletion } : {}),
      ...(options.onPlanPhaseEnded !== undefined ? { onPlanPhaseEnded: options.onPlanPhaseEnded } : {}),
      getSkillsBlock: (runId) => this.getSkillsBlock(runId),
      ...(options.now !== undefined ? { now: options.now } : {})
    });
    this.claudeAdapter = options.claudeAdapter;
    this.opencodeAdapter = options.opencodeAdapter;
    this.nativeAdapter = options.nativeAdapter;
  }

  async runAgent(run: RunRow): Promise<void> {
    const adapterId = this.adapterIdForRun(run);
    this.runAdapters.set(run.id, adapterId);
    try {
      this.options.skillRegistry?.materializeForRun(this.skillRunInput(run, adapterId));
      // For shared-mode runs, compute the skills prompt block (spec D9 fallback injection).
      // Isolated-worktree runs have skills in the worktree directory where the runtime scans.
      if (this.options.skillRegistry !== undefined && run.workspace_mode !== "isolated_worktree") {
        const block = this.options.skillRegistry.buildSkillsPromptBlock(run.room_id, run.agent_id);
        if (block !== undefined) this.runSkillsBlocks.set(run.id, block);
      }
    } catch (error) {
      if (this.options.onSkillMaterializationFailed !== undefined && error instanceof SkillMaterializationError) {
        this.options.onSkillMaterializationFailed({ ...(run.task_id !== null ? { taskId: run.task_id } : {}), ...error.details });
      }
      this.options.lifecycle.fail(null, run.id, "skill_materialization_failed", "fatal", error instanceof Error ? error.message : String(error), "");
      return;
    }
    try {
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
      if (this.isGenericAcpAdapter(adapterId)) {
        await this.generic(adapterId, this.runtimeConfigForRun(run, adapterId)).runManaged(run);
        return;
      }
      await this.mockAdapter.runAgent(run);
    } finally {
      this.options.skillRegistry?.cleanupRun(run.id);
      this.runSkillsBlocks.delete(run.id);
    }
  }

  /** Returns the pre-computed skills prompt block for a run (shared-mode only). */
  getSkillsBlock(runId: string): string | undefined {
    return this.runSkillsBlocks.get(runId);
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
          : adapterId === "opencode"
            ? this.opencode().warmRoomAgent({ roomId, agentId: row.agent_id, workDir })
            : this.generic(adapterId, this.runtimeConfigForParticipant(roomId, row.agent_id, adapterId)).warmRoomAgent({ roomId, agentId: row.agent_id, workDir });
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
    if (this.isGenericAcpAdapter(adapterId)) {
      await this.generic(adapterId, this.runtimeConfigForPersistedRun(runId, adapterId)).cancelManagedRun(runId);
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
    for (const adapter of this.genericAdapters.values()) adapter.disposeRoomWarmSessions(roomId);
    const roomMcpServer = this.options.getRoomMcpServer?.();
    for (const row of rows) roomMcpServer?.unregisterSession(row.adapter_session_id);
    this.options.database.sqlite.prepare("UPDATE room_participants SET adapter_session_id = NULL WHERE room_id = ?").run(roomId);
  }

  disposeAll(): void {
    this.claudeAdapter?.disposeAllSessions();
    this.opencodeAdapter?.disposeAllSessions();
    for (const adapter of this.genericAdapters.values()) adapter.disposeAllSessions();
    this.genericAdapters.clear();
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
      services: { database: this.options.database, eventBus: this.options.eventBus, ...(this.options.getCommandBus !== undefined ? { getCommandBus: this.options.getCommandBus } : {}), ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}), ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {}), ...(this.options.fileMessageService !== undefined ? { fileMessageService: this.options.fileMessageService } : {}), ...(this.options.briefResolver !== undefined ? { briefResolver: this.options.briefResolver } : {}) },
      lifecycle: this.options.lifecycle,
      workspaceId: "default-workspace",
      ...(this.options.onSessionEndedWithoutCompletion !== undefined ? { onSessionEndedWithoutCompletion: this.options.onSessionEndedWithoutCompletion } : {}),
      ...(this.options.onPlanPhaseEnded !== undefined ? { onPlanPhaseEnded: this.options.onPlanPhaseEnded } : {}),
      getSkillsBlock: (runId) => this.getSkillsBlock(runId),
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
      services: { database: this.options.database, eventBus: this.options.eventBus, ...(this.options.getCommandBus !== undefined ? { getCommandBus: this.options.getCommandBus } : {}), ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}), ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {}), ...(this.options.fileMessageService !== undefined ? { fileMessageService: this.options.fileMessageService } : {}), ...(this.options.briefResolver !== undefined ? { briefResolver: this.options.briefResolver } : {}) },
      lifecycle: this.options.lifecycle,
      workspaceId: "default-workspace",
      ...(this.options.onSessionEndedWithoutCompletion !== undefined ? { onSessionEndedWithoutCompletion: this.options.onSessionEndedWithoutCompletion } : {}),
      ...(this.options.onPlanPhaseEnded !== undefined ? { onPlanPhaseEnded: this.options.onPlanPhaseEnded } : {}),
      getSkillsBlock: (runId) => this.getSkillsBlock(runId),
      ...(this.options.adapterCommands?.opencode !== undefined ? this.options.adapterCommands.opencode : {}),
      ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}),
      ...(this.options.getRoomMcpServer !== undefined ? { mcpServer: this.options.getRoomMcpServer() } : {}),
      onWarmSessionFailed: (input) => this.clearWarmSession(input),
      ...(this.options.now !== undefined ? { now: this.options.now } : {})
    });
    return this.opencodeAdapter;
  }

  private generic(adapterId: RuntimeAdapterId, runtimeConfig: GenericAcpAdapterConfig): WarmableManagedAdapter {
    const key = `${runtimeConfig.id}:${runtimeConfig.command}:${runtimeConfig.args.join("\u0000")}`;
    const existing = this.genericAdapters.get(key);
    if (existing !== undefined) return existing;
    const adapter = this.options.genericAcpAdapterFactory?.(runtimeConfig) ?? new GenericACPAdapter({
      ...runtimeConfig,
      services: { database: this.options.database, eventBus: this.options.eventBus, ...(this.options.getCommandBus !== undefined ? { getCommandBus: this.options.getCommandBus } : {}), ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}), ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {}), ...(this.options.fileMessageService !== undefined ? { fileMessageService: this.options.fileMessageService } : {}), ...(this.options.briefResolver !== undefined ? { briefResolver: this.options.briefResolver } : {}) },
      lifecycle: this.options.lifecycle,
      workspaceId: "default-workspace",
      ...(this.options.onSessionEndedWithoutCompletion !== undefined ? { onSessionEndedWithoutCompletion: this.options.onSessionEndedWithoutCompletion } : {}),
      ...(this.options.onPlanPhaseEnded !== undefined ? { onPlanPhaseEnded: this.options.onPlanPhaseEnded } : {}),
      getSkillsBlock: (runId) => this.getSkillsBlock(runId),
      ...(this.options.getRoomMcpServer !== undefined ? { mcpServer: this.options.getRoomMcpServer() } : {}),
      onWarmSessionFailed: (input) => this.clearWarmSession(input),
      ...(this.options.now !== undefined ? { now: this.options.now } : {})
    });
    void adapterId;
    this.genericAdapters.set(key, adapter);
    return adapter;
  }

  private async native(): Promise<NativeManagedAdapter> {
    this.nativeAdapter ??= new (await import("../../../native-agent-runtime/src/native-agent-adapter.ts")).NativeAgentAdapter({
      database: this.options.database,
      eventBus: this.options.eventBus,
      lifecycle: this.options.lifecycle,
      ...(this.options.permissionEngine !== undefined ? { permissions: this.options.permissionEngine } : {}),
      modelConfig: this.nativeModelConfig(),
      ...(this.options.keychain !== undefined ? { apiKey: await this.nativeApiKey() } : {}),
      getModelConfigForRun: (run: RunRow) => this.resolveRunModelConfig(run),
      getApiKeyForRun: (run: RunRow) => this.resolveRunApiKey(run),
      ...(this.options.onSessionEndedWithoutCompletion !== undefined ? { onSessionEndedWithoutCompletion: this.options.onSessionEndedWithoutCompletion } : {}),
      ...(this.options.onPlanPhaseEnded !== undefined ? { onPlanPhaseEnded: this.options.onPlanPhaseEnded } : {}),
      getSkillsBlock: (runId: string) => this.getSkillsBlock(runId),
      ...(this.options.getRoomMcpServer !== undefined ? { getRoomMcpServer: this.options.getRoomMcpServer } : {}),
      ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {}),
      ...(this.options.fileMessageService !== undefined ? { fileMessageService: this.options.fileMessageService } : {}),
      ...(this.options.now !== undefined ? { now: this.options.now } : {})
    } as never);
    return this.nativeAdapter;
  }

  private resolveRunModelConfig(run: RunRow): ModelConfigRow {
    const row = run.room_id === null
      ? undefined
      : this.options.database.sqlite
          .prepare(
            `SELECT mc.id AS id, mc.provider AS provider, mc.model AS model, mc.base_url AS base_url, mc.api_key_ref AS api_key_ref
             FROM room_participants rp
             JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
             JOIN model_configs mc ON mc.id = ab.model_config_id
             WHERE rp.room_id = ? AND rp.participant_id = ? AND rp.participant_type = 'agent'
             LIMIT 1`
          )
          .get(run.room_id, run.agent_id) as ModelConfigRow | undefined;
    if (row !== undefined) return row;
    return this.nativeModelConfig();
  }

  private async resolveRunApiKey(run: RunRow): Promise<string | undefined> {
    if (this.options.keychain === undefined) return undefined;
    const modelConfig = this.resolveRunModelConfig(run);
    if (modelConfig.api_key_ref === null || modelConfig.api_key_ref === undefined) return undefined;
    const apiKey = await this.options.keychain.get(modelConfig.api_key_ref);
    return apiKey === null ? undefined : apiKey;
  }

  private nativeModelConfig(): ModelConfigRow {
    const row = this.options.database.sqlite
      .prepare(
        `SELECT mc.id AS id, mc.provider AS provider, mc.model AS model, mc.base_url AS base_url, mc.api_key_ref AS api_key_ref
          FROM room_participants rp
          JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
          JOIN model_configs mc ON mc.id = ab.model_config_id
          WHERE rp.adapter_id = 'native' AND rp.participant_type = 'agent' AND rp.agent_binding_id IS NOT NULL
          ORDER BY rp.joined_at ASC LIMIT 1`
      )
      .get() as ModelConfigRow | undefined;
    if (row !== undefined) return row;
    return { id: "native-default-model-config", provider: "ollama", model: "native-default", base_url: "http://localhost:11434/v1", api_key_ref: null };
  }

  private async nativeApiKey(): Promise<string | undefined> {
    const modelConfig = this.nativeModelConfig();
    if (modelConfig.api_key_ref === null || modelConfig.api_key_ref === undefined) return undefined;
    const apiKey = await this.options.keychain?.get(modelConfig.api_key_ref);
    return apiKey === null ? undefined : apiKey;
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

  private skillRunInput(run: RunRow, runtimeId: RuntimeAdapterId): { readonly runId: string; readonly roomId: string; readonly participantId: string; readonly workspaceRoot: string; readonly runtimeId: string; readonly taskId?: string; readonly mode: "isolated_worktree" | "shared" } {
    return {
      runId: run.id,
      roomId: run.room_id,
      participantId: run.agent_id,
      workspaceRoot: this.workspaceRootForRun(run),
      runtimeId,
      mode: run.workspace_mode === "isolated_worktree" ? "isolated_worktree" : "shared",
      ...(run.task_id !== null ? { taskId: run.task_id } : {})
    };
  }

  private workspaceRootForRun(run: RunRow): string {
    if (run.workspace_path !== null && run.workspace_path.length > 0) return run.workspace_path;
    const row = this.options.database.sqlite.prepare("SELECT root_path FROM workspaces WHERE id = ?").get(run.workspace_id) as { readonly root_path: string } | undefined;
    return row?.root_path ?? process.cwd();
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
      if (GENERIC_ACP_RUNTIME_KINDS.has(adapterId)) return adapterId as RuntimeAdapterId;
    }
    // Fall back to agent_profiles lookup if we were given a run.adapter_id that didn't match.
    const row = this.options.database.sqlite.prepare("SELECT adapter_id FROM agent_profiles WHERE id = ?").get(agentId) as { readonly adapter_id: string | null } | undefined;
    const profileId = row?.adapter_id;
    if (profileId !== null && profileId !== undefined) {
      if (profileId === "claude-code" || profileId.startsWith("claude-code-")) return "claude-code";
      if (profileId === "opencode" || profileId.startsWith("opencode-")) return "opencode";
      if (profileId === "native" || profileId.startsWith("native-")) return "native";
      if (GENERIC_ACP_RUNTIME_KINDS.has(profileId)) return profileId as RuntimeAdapterId;
    }
    return "mock";
  }

  private isGenericAcpAdapter(adapterId: RuntimeAdapterId): boolean {
    return GENERIC_ACP_RUNTIME_KINDS.has(adapterId);
  }

  private runtimeConfigForRun(run: RunRow, adapterId: RuntimeAdapterId): GenericAcpAdapterConfig {
    const row = run.room_id === null
      ? undefined
      : this.options.database.sqlite
          .prepare(
            `SELECT rt.id AS id, rt.kind AS kind, rt.name AS name, rt.command AS command, rt.args AS args, rt.env AS env
             FROM room_participants rp
             JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
             JOIN runtimes rt ON rt.id = ab.runtime_id
             WHERE rp.room_id = ? AND rp.participant_id = ? AND rp.participant_type = 'agent'
             LIMIT 1`
          )
          .get(run.room_id, run.agent_id) as RuntimeConfigRow | undefined;
    return this.genericRuntimeConfig(row, adapterId);
  }

  private runtimeConfigForPersistedRun(runId: string, adapterId: RuntimeAdapterId): GenericAcpAdapterConfig {
    const row = this.options.database.sqlite
      .prepare(
        `SELECT rt.id AS id, rt.kind AS kind, rt.name AS name, rt.command AS command, rt.args AS args, rt.env AS env
         FROM runs r
         JOIN room_participants rp ON rp.room_id = r.room_id AND rp.participant_id = r.agent_id AND rp.participant_type = 'agent'
         JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
         JOIN runtimes rt ON rt.id = ab.runtime_id
         WHERE r.id = ?
         LIMIT 1`
      )
      .get(runId) as RuntimeConfigRow | undefined;
    return this.genericRuntimeConfig(row, adapterId);
  }

  private runtimeConfigForParticipant(roomId: string, participantId: string, adapterId: RuntimeAdapterId): GenericAcpAdapterConfig {
    const row = this.options.database.sqlite
      .prepare(
        `SELECT rt.id AS id, rt.kind AS kind, rt.name AS name, rt.command AS command, rt.args AS args, rt.env AS env
         FROM room_participants rp
         JOIN agent_bindings ab ON ab.id = rp.agent_binding_id
         JOIN runtimes rt ON rt.id = ab.runtime_id
         WHERE rp.room_id = ? AND rp.participant_id = ? AND rp.participant_type = 'agent'
         LIMIT 1`
      )
      .get(roomId, participantId) as RuntimeConfigRow | undefined;
    return this.genericRuntimeConfig(row, adapterId);
  }

  private genericRuntimeConfig(row: RuntimeConfigRow | undefined, adapterId: RuntimeAdapterId): GenericAcpAdapterConfig {
    const definition = runtimeDefinitionForKind(row?.kind ?? adapterId);
    const runtimeKind = row?.kind ?? definition?.kind ?? adapterId;
    const command = row?.command ?? definition?.command ?? "";
    return {
      id: row?.id ?? `runtime-${runtimeKind}`,
      runtimeKind,
      name: row?.name ?? definition?.name ?? runtimeKind,
      command,
      args: parseStringArray(row?.args).length > 0 ? parseStringArray(row?.args) : definition?.args ?? [],
      env: parseEnv(row?.env)
    };
  }
}

function parseStringArray(value: unknown): readonly string[] {
  const parsed = typeof value === "string" ? safeJson(value, []) : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseEnv(value: unknown): NodeJS.ProcessEnv {
  const parsed = typeof value === "string" ? safeJson(value, {}) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function safeJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}
