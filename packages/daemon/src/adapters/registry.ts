import { ClaudeCodeACPAdapter } from "@agenthub/adapter-claude-code";
import { OpenCodeACPAdapter } from "@agenthub/adapter-opencode";
import { MockAdapterManager } from "@agenthub/adapter-mock";
import type { AgentHubDatabase } from "@agenthub/db";
import type { AdapterArtifactFSBoundary, RoomMcpServer, RunLifecycleService, RunRow, BriefResolver } from "@agenthub/orchestrator";
import type { CommandBus, EventBus } from "@agenthub/bus";
import type { PermissionEngine } from "@agenthub/permissions";

export type RuntimeAdapterId = "mock" | "claude-code" | "opencode";

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
  readonly claudeAdapter?: ClaudeCodeACPAdapter;
  readonly opencodeAdapter?: OpenCodeACPAdapter;
  readonly now?: () => number;
};

export class AdapterRegistry {
  readonly mockAdapter: MockAdapterManager;
  private readonly runAdapters = new Map<string, RuntimeAdapterId>();
  private claudeAdapter: ClaudeCodeACPAdapter | undefined;
  private opencodeAdapter: OpenCodeACPAdapter | undefined;

  constructor(private readonly options: AdapterRegistryOptions) {
    this.mockAdapter = options.mockAdapter ?? new MockAdapterManager({ database: options.database, eventBus: options.eventBus, lifecycle: options.lifecycle, ...(options.artifactFs !== undefined ? { artifactFs: options.artifactFs } : {}), ...(options.now !== undefined ? { now: options.now } : {}) });
    this.claudeAdapter = options.claudeAdapter;
    this.opencodeAdapter = options.opencodeAdapter;
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
    await this.mockAdapter.runAgent(run);
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
    this.mockAdapter.cancelRun(runId);
  }

  getClaudeAdapterForTest(): ClaudeCodeACPAdapter | undefined {
    return this.claudeAdapter;
  }

  private claude(): ClaudeCodeACPAdapter {
    this.claudeAdapter ??= new ClaudeCodeACPAdapter({
      services: { database: this.options.database, eventBus: this.options.eventBus, ...(this.options.getCommandBus !== undefined ? { getCommandBus: this.options.getCommandBus } : {}), ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}), ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {}), ...(this.options.briefResolver !== undefined ? { briefResolver: this.options.briefResolver } : {}) },
      lifecycle: this.options.lifecycle,
      workspaceId: "default-workspace",
      ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}),
      ...(this.options.getRoomMcpServer !== undefined ? { mcpServer: this.options.getRoomMcpServer() } : {}),
      ...(this.options.now !== undefined ? { now: this.options.now } : {})
    });
    return this.claudeAdapter;
  }

  private opencode(): OpenCodeACPAdapter {
    this.opencodeAdapter ??= new OpenCodeACPAdapter({
      services: { database: this.options.database, eventBus: this.options.eventBus, ...(this.options.getCommandBus !== undefined ? { getCommandBus: this.options.getCommandBus } : {}), ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}), ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {}), ...(this.options.briefResolver !== undefined ? { briefResolver: this.options.briefResolver } : {}) },
      lifecycle: this.options.lifecycle,
      workspaceId: "default-workspace",
      ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}),
      ...(this.options.getRoomMcpServer !== undefined ? { mcpServer: this.options.getRoomMcpServer() } : {}),
      ...(this.options.now !== undefined ? { now: this.options.now } : {})
    });
    return this.opencodeAdapter;
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
      if (adapterId === "mock" || adapterId.startsWith("mock-")) return "mock";
    }
    // Fall back to agent_profiles lookup if we were given a run.adapter_id that didn't match.
    const row = this.options.database.sqlite.prepare("SELECT adapter_id FROM agent_profiles WHERE id = ?").get(agentId) as { readonly adapter_id: string | null } | undefined;
    const profileId = row?.adapter_id;
    if (profileId !== null && profileId !== undefined) {
      if (profileId === "claude-code" || profileId.startsWith("claude-code-")) return "claude-code";
      if (profileId === "opencode" || profileId.startsWith("opencode-")) return "opencode";
    }
    return "mock";
  }
}
