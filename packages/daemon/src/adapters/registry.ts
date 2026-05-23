import { ClaudeCodeACPAdapter } from "@agenthub/adapter-claude-code";
import { MockAdapterManager } from "@agenthub/adapter-mock";
import type { AgentHubDatabase } from "@agenthub/db";
import type { AdapterArtifactFSBoundary, RoomMcpServer, RunLifecycleService, RunRow } from "@agenthub/orchestrator";
import type { EventBus } from "@agenthub/bus";
import type { PermissionEngine } from "@agenthub/permissions";

export type RuntimeAdapterId = "mock" | "claude-code";

export type AdapterRegistryOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly lifecycle: RunLifecycleService;
  readonly permissionEngine?: PermissionEngine;
  readonly artifactFs?: AdapterArtifactFSBoundary;
  readonly getRoomMcpServer?: () => RoomMcpServer;
  readonly mockAdapter?: MockAdapterManager;
  readonly claudeAdapter?: ClaudeCodeACPAdapter;
  readonly now?: () => number;
};

export class AdapterRegistry {
  readonly mockAdapter: MockAdapterManager;
  private readonly runAdapters = new Map<string, RuntimeAdapterId>();
  private claudeAdapter: ClaudeCodeACPAdapter | undefined;

  constructor(private readonly options: AdapterRegistryOptions) {
    this.mockAdapter = options.mockAdapter ?? new MockAdapterManager({ database: options.database, eventBus: options.eventBus, lifecycle: options.lifecycle, ...(options.artifactFs !== undefined ? { artifactFs: options.artifactFs } : {}), ...(options.now !== undefined ? { now: options.now } : {}) });
    this.claudeAdapter = options.claudeAdapter;
  }

  async runAgent(run: RunRow): Promise<void> {
    const adapterId = this.adapterIdForRun(run);
    this.runAdapters.set(run.id, adapterId);
    if (adapterId === "claude-code") {
      await this.claude().runManaged(run);
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
    this.mockAdapter.cancelRun(runId);
  }

  getClaudeAdapterForTest(): ClaudeCodeACPAdapter | undefined {
    return this.claudeAdapter;
  }

  private claude(): ClaudeCodeACPAdapter {
    this.claudeAdapter ??= new ClaudeCodeACPAdapter({
      services: { database: this.options.database, eventBus: this.options.eventBus, ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}), ...(this.options.artifactFs !== undefined ? { artifactFs: this.options.artifactFs } : {}) },
      lifecycle: this.options.lifecycle,
      workspaceId: "default-workspace",
      ...(this.options.permissionEngine !== undefined ? { permissionEngine: this.options.permissionEngine } : {}),
      ...(this.options.getRoomMcpServer !== undefined ? { mcpServer: this.options.getRoomMcpServer() } : {}),
      ...(this.options.now !== undefined ? { now: this.options.now } : {})
    });
    return this.claudeAdapter;
  }

  private adapterIdForRun(run: RunRow): RuntimeAdapterId {
    if (run.adapter_id === "claude-code") return "claude-code";
    if (run.adapter_id === "mock") return "mock";
    return this.adapterIdForAgent(run.agent_id);
  }

  private adapterIdForPersistedRun(runId: string): RuntimeAdapterId {
    const row = this.options.database.sqlite.prepare("SELECT adapter_id, agent_id FROM runs WHERE id = ?").get(runId) as { readonly adapter_id: string | null; readonly agent_id: string } | undefined;
    if (row === undefined) return "mock";
    if (row.adapter_id === "claude-code") return "claude-code";
    if (row.adapter_id === "mock") return "mock";
    return this.adapterIdForAgent(row.agent_id);
  }

  private adapterIdForAgent(agentId: string): RuntimeAdapterId {
    const row = this.options.database.sqlite.prepare("SELECT adapter_id FROM agent_profiles WHERE id = ?").get(agentId) as { readonly adapter_id: string | null } | undefined;
    return row?.adapter_id === "claude-code" ? "claude-code" : "mock";
  }
}
