import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve as resolvePath } from "node:path";
import { URL } from "node:url";

import { createCommandBus, createDurableHandlerRegistry, createEventBus, createOutboxDispatcher, type CommandBus, type CommandHandler, type CommandType, type DurableHandlerRegistry, type EventBus, type EventBusSubscriber, type OutboxDispatcher, type PublishInput, type ReplayView } from "@agenthub/bus";
import { bootstrapBuiltInAgents, watchAgentProfiles, type AgentProfileWatcher } from "@agenthub/agents";
import { ArtifactFSRunRegistry, ArtifactService, createArtifactCommandHandlers } from "@agenthub/artifacts";
import { ContextLedger, createContextCommandHandlers, HeuristicBriefGenerator } from "@agenthub/context";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { MockAdapterManager } from "@agenthub/adapter-mock";
import { createInterventionCommandHandlers, InterventionEngine } from "@agenthub/interventions";
import { ActiveWakesRegistry, checkTaskTimeouts, createCancelRunHandler, createCompleteTaskHandler, createConsumePendingTurnHandler, createCreateTaskHandler, createUpdateTaskHandler, createWakeAgentHandler, handleTeamDispatchReviewTerminal, MailboxService, maybePublishTeamDispatchCompleted, PendingTurnService, ReclaimStaleClaimedRun, reconcileTerminalDelegatedTaskRuns, RoomMcpServer, RunLifecycleService, RunQueue, StartupRecovery, TaskService, WELL_KNOWN_CAPABILITY_TOKENS, type BriefResolver } from "@agenthub/orchestrator";
import { createPermissionCommandHandlers, PermissionEngine, seedBuiltInPermissionProfiles } from "@agenthub/permissions";
import type { EventEnvelope } from "@agenthub/protocol/events";
import { SkillRegistry } from "@agenthub/skills";
import { attachmentMaxBytes, authenticateBrowserRequest, createKeychain, createKeychainAccount, issueBrowserSession, redactAndTruncate, storeAttachment, type BrowserAuthResult, type KeychainBridge } from "@agenthub/security";
import { Effect } from "effect";
import { generateRoleDraftWithModelConfig, type ModelConfigRow, type RoleDraft, type RoleDraftGenerationInput } from "@agenthub/native-agent-runtime";

import { AdapterRegistry } from "./adapters/registry.ts";
import { defaultBuiltinRolesDir, seedBuiltinRoles } from "./builtin-roles.ts";
import { normalizeRoomCreateCompat } from "./compat/agent-profile-compat.ts";
import { migrateAgentProfilesToV10 } from "./migrations/0014_data.ts";
import { cleanExpiredRoleDrafts, startRoleDraftGC } from "./role-draft-gc.ts";
import { createDaemonCommandHandlers, seedDefaultData } from "./commands.ts";
export { daemonPidPath, defaultConfigPath, ensureAgentHubHome, ensureParentDirectory, loadAgentHubConfig, redactConfig, type AgentHubConfig, type ConfigOverrides } from "./config.ts";
import { openApiDocument } from "./openapi.ts";

type PlanDocument = {
  readonly goal: string;
  readonly tasks: ReadonlyArray<{ readonly title: string; readonly description: string; readonly assigneeRole: string; readonly dependsOn?: readonly string[]; readonly maxTurns?: number }>;
};

function parsePlanDocument(text: string): PlanDocument | undefined {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/iu);
  if (match === null) return undefined;
  try {
    const jsonText = match[1];
    if (jsonText === undefined) return undefined;
    const parsed = JSON.parse(jsonText) as Partial<PlanDocument>;
    if (typeof parsed.goal !== "string") return undefined;
    if (!Array.isArray(parsed.tasks)) return undefined;
    const tasks = parsed.tasks.map((task: unknown) => {
      if (typeof task !== "object" || task === null) return undefined;
      const record = task as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title : undefined;
      const description = typeof record.description === "string" ? record.description : undefined;
      const assigneeRole = typeof record.assigneeRole === "string" ? record.assigneeRole : undefined;
      if (title === undefined || description === undefined || assigneeRole === undefined) return undefined;
      const dependsOn = Array.isArray(record.dependsOn) ? record.dependsOn.filter((value: unknown): value is string => typeof value === "string") : undefined;
      const maxTurns = typeof record.maxTurns === "number" && Number.isFinite(record.maxTurns) ? record.maxTurns : undefined;
      return { title, description, assigneeRole, ...(dependsOn !== undefined ? { dependsOn } : {}), ...(maxTurns !== undefined ? { maxTurns } : {}) };
    }).filter((task): task is NonNullable<typeof task> => task !== undefined);
    return { goal: parsed.goal, tasks };
  } catch {
    return undefined;
  }
}

function recordPlanParseFailure(database: AgentHubDatabase, eventBus: EventBus, roomId: string, runId: string, now: number): void {
  database.sqlite.transaction(() => {
    const room = database.sqlite.prepare("SELECT workspace_id FROM rooms WHERE id = ?").get(roomId) as { readonly workspace_id: string } | undefined;
    if (room === undefined) return;
    eventBus.publish({ id: randomUUID(), type: "task.activity.added", schemaVersion: 1, workspaceId: room.workspace_id, roomId, runId, payload: { kind: "plan_parse_failed", runId }, createdAt: now });
  })();
}

function messageText(database: AgentHubDatabase, messageId: string): string {
  const rows = database.sqlite.prepare("SELECT payload FROM message_parts WHERE message_id = ? ORDER BY seq ASC").all(messageId) as { readonly payload: string }[];
  return rows.map((row) => {
    try {
      const parsed = JSON.parse(row.payload) as { readonly text?: unknown };
      return typeof parsed.text === "string" ? parsed.text : "";
    } catch {
      return "";
    }
  }).filter((text) => text.length > 0).join("\n");
}

export type DaemonStartupPhase =
  | "SQLite open + pragma + migrate"
  | "EventStore readiness check"
  | "EventBus (PubSub + per-type)"
  | "Outbox Dispatcher start"
  | "Durable Handler Registry (register all, catch-up, realtime)"
  | "RunQueue Worker start"
  | "AdapterManager detect + register"
  | "CommandBus open"
  | "HTTP server bind + SSE accept";
export type RoleDraftGenerator = (input: RoleDraftGenerationInput) => Promise<RoleDraft>;
export type DaemonOptions = { readonly databasePath: string; readonly host?: string; readonly port?: number; readonly token?: string; readonly allowRemote?: boolean; readonly allowedOrigins?: readonly string[]; readonly adapterCommands?: { readonly claude?: { readonly command: string; readonly args?: readonly string[]; readonly env?: NodeJS.ProcessEnv }; readonly opencode?: { readonly command: string; readonly args?: readonly string[]; readonly env?: NodeJS.ProcessEnv } }; readonly now?: () => number; readonly modelTestFetch?: typeof fetch; readonly roleDraftGenerator?: RoleDraftGenerator; readonly onLifecyclePhase?: (event: { readonly direction: "startup" | "shutdown"; readonly phase: DaemonStartupPhase }) => void };
export type DaemonCloseOptions = { readonly forceCancelAfterMs?: number };
export type DaemonCloseResult = { readonly forced: boolean; readonly cancelledRunIds: readonly string[] };
export type DaemonApp = { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly commandBus: CommandBus; readonly lifecycle: RunLifecycleService; readonly roomMcpServer: RoomMcpServer; readonly adapterRegistry: AdapterRegistry; readonly mockAdapter: MockAdapterManager; readonly handle: (req: IncomingMessage, res: ServerResponse) => void; readonly inFlightRunIds: () => readonly string[]; start(): Promise<Server>; close(options?: DaemonCloseOptions): Promise<DaemonCloseResult> };
type StatusLineEventBus = EventBus & { flushStatusLines?: () => void };
const PHASE_SQLITE: DaemonStartupPhase = "SQLite open + pragma + migrate";
const PHASE_EVENT_STORE: DaemonStartupPhase = "EventStore readiness check";
const PHASE_EVENT_BUS: DaemonStartupPhase = "EventBus (PubSub + per-type)";
const PHASE_OUTBOX: DaemonStartupPhase = "Outbox Dispatcher start";
const PHASE_HANDLERS: DaemonStartupPhase = "Durable Handler Registry (register all, catch-up, realtime)";
const PHASE_RUN_QUEUE: DaemonStartupPhase = "RunQueue Worker start";
const PHASE_ADAPTERS: DaemonStartupPhase = "AdapterManager detect + register";
const PHASE_COMMAND_BUS: DaemonStartupPhase = "CommandBus open";
const PHASE_HTTP: DaemonStartupPhase = "HTTP server bind + SSE accept";
const DAEMON_SHUTDOWN_PHASES: readonly DaemonStartupPhase[] = [
  PHASE_HTTP,
  PHASE_COMMAND_BUS,
  PHASE_RUN_QUEUE,
  PHASE_ADAPTERS,
  PHASE_OUTBOX,
  PHASE_HANDLERS,
  PHASE_EVENT_BUS,
  PHASE_EVENT_STORE,
  PHASE_SQLITE
];

type DaemonRuntime = {
  database: AgentHubDatabase;
  eventBus: StatusLineEventBus;
  commandBus: CommandBus;
  roomMcpServer: RoomMcpServer;
  adapterRegistry: AdapterRegistry;
  mockAdapter: MockAdapterManager;
  artifactService: ArtifactService;
  taskService: TaskService;
  outbox: OutboxDispatcher;
  handlers: DurableHandlerRegistry;
  runQueue: RunQueue;
  agentProfiles: AgentProfileWatcher;
  roleDraftGcCleanup: () => void;
  lifecycle: RunLifecycleService;
};

type SseClient = { readonly res: ServerResponse; readonly close: () => void };
type SettingsJobStatus = "queued" | "pending" | "completed" | "failed";
type SettingsJobRecord = { readonly id: string; readonly type: string; readonly status: SettingsJobStatus; readonly createdAt: number; readonly updatedAt: number; readonly result?: unknown; readonly modelConfigId?: string; readonly runtimeId?: string };
type RuntimeJob = { status: "pending" | "completed" | "failed"; result?: RuntimeTestResult };
type RuntimeTestResult = { readonly ok: boolean; readonly version?: string; readonly latencyMs: number; readonly error?: string };

const runtimeTestJobs = new Map<string, RuntimeJob>();

export function createDaemon(options: DaemonOptions): DaemonApp {
  let runtime: DaemonRuntime | undefined;
  let server: Server | undefined;
  let ready = false;
  let starting: Promise<Server> | undefined;
  let closed = false;
  let stopping = false;
  let taskTimeoutTimer: ReturnType<typeof setInterval> | undefined;
  const sseClients = new Set<SseClient>();
  const settingsJobs = new Map<string, SettingsJobRecord>();
  const modelConfigSecrets = createKeychain("agenthub-model-configs");

  const emitPhase = (direction: "startup" | "shutdown", phase: DaemonStartupPhase): void => {
    options.onLifecyclePhase?.({ direction, phase });
  };

  const requireRuntime = (): DaemonRuntime => {
    if (runtime === undefined) throw new Error("Daemon has not completed startup");
    return runtime;
  };

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, stopping ? { status: "shutting_down" } : { ok: true });
    if (stopping) return json(res, 503, { error: "service_stopping" });
    if (!ready) return json(res, 503, { error: "service_starting", retryAfterMs: 500 });
    const app = requireRuntime();
    void route({ req, res, database: app.database, eventBus: app.eventBus, commandBus: app.commandBus, artifactService: app.artifactService, taskService: app.taskService, outbox: app.outbox, modelConfigSecrets, settingsJobs, modelTestFetch: options.modelTestFetch ?? globalThis.fetch.bind(globalThis), roleDraftGenerator: options.roleDraftGenerator ?? generateRoleDraftWithModelConfig, registerSseClient: (client) => { sseClients.add(client); return () => sseClients.delete(client); }, ...(options.token !== undefined ? { token: options.token } : {}), ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}), host: `${options.host ?? "127.0.0.1"}:${options.port ?? 6677}`, ...(options.now !== undefined ? { now: options.now } : {}) });
  };

  const start = async (): Promise<Server> => {
    if (starting !== undefined) return starting;
    starting = startDaemon();
    return starting;
  };

  const startDaemon = async (): Promise<Server> => {
    closed = false;
    ready = false;
    const host = options.host ?? "127.0.0.1";
    if (!isLoopbackHost(host) && (options.token === undefined || options.allowRemote !== true)) {
      process.stderr.write(`Refusing remote bind to ${host} without token and allowRemote=true\n`);
      throw new Error("Remote binding requires token and allowRemote=true");
    }
    emitPhase("startup", PHASE_SQLITE);
    const database = createDatabase({ path: options.databasePath, applyMigrations: true });
    migrateAgentProfilesToV10(database, options.now?.() ?? Date.now());
    seedDefaultData(database, options.now?.() ?? Date.now());
    seedBuiltInPermissionProfiles(database, options.now?.() ?? Date.now());
    cleanExpiredRoleDrafts(database, options.now?.() ?? Date.now());
    bootstrapBuiltInAgents();

    emitPhase("startup", PHASE_EVENT_STORE);
    database.sqlite.prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events").get();

    emitPhase("startup", PHASE_EVENT_BUS);
    const eventBus = withStatusLineCoalescing(createEventBus({ database }));
    seedBuiltinRoles(database, defaultBuiltinRolesDir(), eventBus, options.now?.() ?? Date.now());
    const skillRegistry = new SkillRegistry({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    const workspaceRow = database.sqlite.prepare("SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1").get() as { readonly id: string } | undefined;
    skillRegistry.seedBuiltins(workspaceRow?.id ?? "default-workspace");
    const agentProfiles = watchAgentProfiles({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    await agentProfiles.ready;
    const roleDraftGcCleanup = startRoleDraftGC(database, () => undefined);

    const now = options.now?.() ?? Date.now();
    database.sqlite.transaction(() => {
      database.sqlite.prepare(
        `INSERT INTO runtimes (
          id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version,
          supported_caps, version, status, manifest_json, created_at, updated_at
        ) VALUES (?, NULL, 'native', ?, NULL, NULL, NULL, ?, NULL, NULL, ?, NULL, NULL, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           kind = excluded.kind,
           name = excluded.name,
           command = NULL,
           args = NULL,
           env = NULL,
           detected_at = excluded.detected_at,
           detected_path = NULL,
           detected_version = NULL,
           supported_caps = excluded.supported_caps,
           version = NULL,
           status = NULL,
           manifest_json = excluded.manifest_json,
           updated_at = excluded.updated_at`
      ).run("native-default", "AgentHub Native", now, "[]", JSON.stringify({ runtimeKind: "native" }), now, now);
      eventBus.publish({
        id: randomUUID(),
        type: "runtime.detected",
        schemaVersion: 1,
        workspaceId: "default-workspace",
        payload: { runtimeId: "native-default", kind: "native", name: "AgentHub Native" },
        createdAt: now
      });
    })();

    const contextLedger = new ContextLedger({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    const permissionEngine = new PermissionEngine({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    const interventionEngine = new InterventionEngine({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    const artifactService = new ArtifactService({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    const onSkillMaterializationFailed = (input: { readonly taskId?: string; readonly skillId: string; readonly skillName: string; readonly workspaceId: string; readonly runId: string; readonly error: string }): void => {
      const now = options.now?.() ?? Date.now();
      database.sqlite.transaction(() => {
        if (input.taskId !== undefined) {
          taskService.updateStatus({ taskId: input.taskId, status: "blocked", blockerReason: "skill_materialization_failed" });
        }
        eventBus.publish({
          id: randomUUID(),
          type: "skill.materialization_failed",
          schemaVersion: 1,
          workspaceId: input.workspaceId,
          runId: input.runId,
          ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
          payload: { skillId: input.skillId, name: input.skillName, runId: input.runId, error: input.error },
          createdAt: now
        });
      });
    };
    const taskService = new TaskService({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}), onTaskCompleted: (task) => maybePublishTeamDispatchCompleted({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) }, task) });
    const artifactFs = new ArtifactFSRunRegistry({
      database,
      service: artifactService,
      eventBus,
      ...(options.now !== undefined ? { now: options.now } : {}),
      rootForRun: (input) => {
        const room = database.sqlite
          .prepare("SELECT mode FROM rooms WHERE id = ?")
          .get(input.roomId ?? "") as { readonly mode: string } | undefined;
        if (!room || (room.mode !== "squad" && room.mode !== "team")) return undefined;

        const workspace = database.sqlite
          .prepare("SELECT root_path FROM workspaces WHERE id = ?")
          .get(input.workspaceId) as { readonly root_path: string } | undefined;
        if (!workspace) return undefined;

        // Resolve to absolute path; skip if it resolves to cwd (test fixture pattern)
        const absoluteRoot = resolvePath(workspace.root_path);
        if (absoluteRoot === process.cwd()) return undefined;

        const worktreePath = join(absoluteRoot, ".agenthub", "worktrees", input.runId);
        try {
          // Verify this is a git repo before attempting worktree creation
          try {
            execFileSync("git", ["rev-parse", "--git-dir"], { cwd: absoluteRoot, timeout: 3_000, stdio: "pipe" });
          } catch {
            return undefined;
          }
          mkdirSync(join(absoluteRoot, ".agenthub", "worktrees"), { recursive: true });
          if (existsSync(worktreePath)) return worktreePath;
          execFileSync("git", ["worktree", "add", worktreePath, "HEAD"], { cwd: absoluteRoot, timeout: 15_000, stdio: "pipe" });
          return worktreePath;
        } catch (err) {
          console.warn("[worktree] Failed to create worktree for run", input.runId, err instanceof Error ? err.message : String(err));
          return undefined;
        }
      }
    });
    const activeWakes = new ActiveWakesRegistry();
    const mailbox = new MailboxService(database, options.now, eventBus);
    const commandBusRef: { current?: CommandBus } = {};
    const roomMcpServerRef: { current?: RoomMcpServer } = {};
    const pendingTurns = new PendingTurnService({ database, eventBus, getCommandBus: () => currentCommandBus(commandBusRef), ...(options.now !== undefined ? { now: options.now } : {}) });
    const runQueueRef: { current?: RunQueue } = {};
    const taskTerminalHooks = {
      onRunStarted: (runId: string) => {
        const run = database.sqlite.prepare("SELECT task_id, wake_reason FROM runs WHERE id = ?").get(runId) as { readonly task_id: string | null; readonly wake_reason: string | null } | undefined;
        if (!run?.task_id || run.wake_reason !== "delegated_task") return;
        taskService.startDelegatedRun(run.task_id, runId);
      },
      onRunCompleted: (runId: string) => {
        const run = database.sqlite.prepare("SELECT task_id, wake_reason FROM runs WHERE id = ?").get(runId) as { readonly task_id: string | null; readonly wake_reason: string | null } | undefined;
        if (!run?.task_id || run.wake_reason !== "delegated_task") return;
        // room.complete_task is now the authoritative completion path (D6).
        // If the run ends without it, onSessionEndedWithoutCompletion handles the missing report path.
      },
      onRunFailed: (runId: string) => {
        const run = database.sqlite.prepare("SELECT task_id, workspace_id, room_id, wake_reason FROM runs WHERE id = ?").get(runId) as { readonly task_id: string | null; readonly workspace_id: string; readonly room_id: string; readonly wake_reason: string | null } | undefined;
        if (!run?.task_id || run.wake_reason !== "delegated_task") return;
        const taskId = run.task_id;
        const task = database.sqlite.prepare("SELECT blocker_reason FROM tasks WHERE id = ?").get(taskId) as { readonly blocker_reason: string | null } | undefined;
        if (task?.blocker_reason === "turn_limit_exceeded") {
          appendTaskMailboxWake(run.workspace_id, run.room_id, taskId, runId, "task_blocked");
          return;
        }
        const taskResult = taskService.blockDelegatedRun(taskId, runId);
        if (!taskResult.ok) return;
        if (taskResult.data.task.expectsReview) return;
        appendTaskMailboxWake(run.workspace_id, run.room_id, taskId, runId, "task_blocked");
      }
    };
    const onSessionEndedWithoutCompletion = (taskId: string): void => {
      const task = database.sqlite.prepare("SELECT room_id, status FROM tasks WHERE id = ?").get(taskId) as { readonly room_id: string; readonly status: string } | undefined;
      if (task === undefined || (task.status !== "pending" && task.status !== "in_progress")) return;
      const room = database.sqlite.prepare("SELECT workspace_id, primary_agent_id FROM rooms WHERE id = ? AND archived_at IS NULL").get(task.room_id) as { readonly workspace_id: string; readonly primary_agent_id: string | null } | undefined;
      if (room?.primary_agent_id === undefined || room.primary_agent_id === null) return;

      const result = taskService.updateStatus({ taskId, status: "review", blockerReason: "missing_completion_report" });
      if (!result.ok) return;

      const now = options.now?.() ?? Date.now();
      void commandBusRef.current?.dispatch(
        {
          type: "WakeAgent",
          roomId: task.room_id,
          agentId: room.primary_agent_id,
          workspaceId: room.workspace_id,
          reason: "task_review",
          taskId,
          promptDelta: { kind: "delta_only", instructions: `Task ${taskId} ended without a completion report. Please review it.` },
          idempotencyKey: `missing-completion-report:${taskId}:${now}`
        },
        { actor: { type: "system" }, traceId: `missing-completion-report:${taskId}`, origin: "internal" }
      );
    };
    const onPlanPhaseEnded = async (runId: string): Promise<void> => {
      const run = database.sqlite.prepare("SELECT room_id, agent_id, workspace_id, wake_reason FROM runs WHERE id = ?").get(runId) as { readonly room_id: string; readonly agent_id: string; readonly workspace_id: string; readonly wake_reason: string | null } | undefined;
      if (run === undefined || run.wake_reason !== "plan") return;

      const assistantMessage = database.sqlite.prepare("SELECT id FROM messages WHERE run_id = ? AND role = 'assistant' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1").get(runId) as { readonly id: string } | undefined;
      if (assistantMessage !== undefined) {
        const text = messageText(database, assistantMessage.id) ?? "";
        const plan = parsePlanDocument(text);
        const now = options.now?.() ?? Date.now();
        if (plan !== undefined) {
          const planId = randomUUID();
          database.sqlite.transaction(() => {
            database.sqlite.prepare("INSERT INTO task_plans (id, room_id, run_id, plan_json, created_at) VALUES (?, ?, ?, ?, ?)").run(planId, run.room_id, runId, JSON.stringify(plan), now);
            eventBus.publish({ id: randomUUID(), type: "task.plan.created", schemaVersion: 1, workspaceId: run.workspace_id, roomId: run.room_id, runId, agentId: run.agent_id, payload: { roomId: run.room_id, runId, planId, taskCount: plan.tasks.length }, createdAt: now });
          })();
        } else {
          recordPlanParseFailure(database, eventBus, run.room_id, runId, now);
        }
      }

      void commandBusRef.current?.dispatch(
        { type: "WakeAgent", roomId: run.room_id, agentId: run.agent_id, workspaceId: run.workspace_id, reason: "execute", idempotencyKey: `plan-execute:${runId}` },
        { actor: { type: "system" }, traceId: `plan-execute:${runId}`, idempotencyKey: `plan-execute:${runId}`, origin: "internal" }
      );
    };
    const lifecycleOptions = {
      ...(options.now !== undefined ? { now: options.now } : {}),
      sideEffects: { onRunning: (runId: string) => taskTerminalHooks.onRunStarted(runId), onCompleted: (runId: string) => taskTerminalHooks.onRunCompleted(runId), onFailed: (runId: string) => taskTerminalHooks.onRunFailed(runId), onTerminal: (runId: string) => { activeWakes.releaseRun(runId); runQueueRef.current?.releaseLocks(runId); pendingTurns.handleTerminal(runId); void handleTeamDispatchReviewTerminal({ database, eventBus, commandBus: commandBusRef.current ?? commandBus, taskService, ...(options.now !== undefined ? { now: options.now } : {}) }, runId); }, finalizeNextTurns: (tx: AgentHubDatabase["sqlite"], runId: string, failureClass: Parameters<MailboxService["finalizeForRun"]>[2], now: number) => mailbox.finalizeForRun(tx, runId, failureClass, now), onTargetUnavailable: (tx: AgentHubDatabase["sqlite"], runId: string) => {
        const rows = tx.prepare("SELECT id FROM mailbox_messages WHERE claimed_run_id = ? AND delivery_failure_reason IS NULL").all(runId) as { readonly id: string }[];
        for (const row of rows) mailbox.publishTargetUnavailable(tx, row.id);
      } }
    };
    const lifecycle = new RunLifecycleService(database, eventBus, lifecycleOptions);
    // Synchronous brief resolver. HeuristicBriefGenerator.generate returns Effect<string,never>,
    // which is a pure value; Effect.runSync extracts it without async overhead. Cast through
    // `unknown` to widen the input shape — adapter-bridge's BriefResolver uses string for
    // `failureClass` while the context package narrows it to RunFailureClass.
    const briefGenerator = new HeuristicBriefGenerator();
    const briefResolver: BriefResolver = (input) => {
      try {
        return Effect.runSync(briefGenerator.generate(input as never)) as string;
      } catch {
        return "";
      }
    };
    const artifactFsBoundary = {
      beginRun: (input: Parameters<typeof artifactFs.beginRun>[0]) => artifactFs.beginRun(input),
      writeTextFile: (input: Parameters<typeof artifactFs.writeTextFile>[0]) => artifactFs.writeTextFile(input),
      deleteFile: (input: Parameters<typeof artifactFs.deleteFile>[0]) => artifactFs.deleteFile(input),
      buildRunArtifact: (input: Parameters<typeof artifactFs.buildRunArtifact>[0]) => artifactFs.buildRunArtifact(input),
      buildWorktreeDiffArtifact: (input: Parameters<typeof artifactFs.buildWorktreeDiffArtifact>[0]) => artifactFs.buildWorktreeDiffArtifact(input)
    };
    const adapterRegistry = new AdapterRegistry({ database, eventBus, lifecycle, permissionEngine, keychain: modelConfigSecrets, artifactFs: artifactFsBoundary, briefResolver, getRoomMcpServer: () => currentRoomMcpServer(roomMcpServerRef), getCommandBus: () => commandBusRef.current, onSessionEndedWithoutCompletion, onPlanPhaseEnded, onSkillMaterializationFailed, skillRegistry, ...(options.adapterCommands !== undefined ? { adapterCommands: options.adapterCommands } : {}), ...(options.now !== undefined ? { now: options.now } : {}) });

    emitPhase("startup", PHASE_OUTBOX);
    const handlers = createDurableHandlerRegistry({ database, retryDelaysMs: [0] });
    const outbox = createOutboxDispatcher({ database, eventBus, handlers });
    await outbox.drainPending();

    emitPhase("startup", PHASE_HANDLERS);
    const runQueue = new RunQueue({ database, lifecycle, adapterManager: adapterRegistry, ...(options.now !== undefined ? { now: options.now } : {}) });
    runQueueRef.current = runQueue;
    handlers.register({ name: "run-queue", subscribes: ["agent.run.queued", "agent.run.completed", "agent.run.failed", "agent.run.cancelled"], handle: (event) => runQueue.handleEvent(event) });
    // Force-flush the per-(agent,room) status_line buffer when a run finalizes so the UI
    // doesn't show "working" for up to 30 seconds after the agent already returned.
    handlers.register({
      name: "status-line-flush-on-run-end",
      subscribes: ["agent.run.completed", "agent.run.failed", "agent.run.cancelled"],
      handle: () => {
        eventBus.flushStatusLines?.();
        return Promise.resolve();
      }
    });
    // Note: ContextLedger subscribes to `context.snapshot` itself in its constructor (self-wires),
    // so we don't register a duplicate handler here.
    await handlers.catchUp();

    // Wire the bus to notify durable handlers immediately on every durable
    // publish. Without this, handlers (run-queue, status-line flush) only run
    // when `outbox.drainPending` fires, which happens at HTTP dispatch
    // boundaries — so events emitted by an in-flight agent run sit pending
    // until the next user action. With the notifier set, handlers process
    // events as soon as they're persisted, and SSE clients see them too.
    eventBus.setDurableNotifier((event) => handlers.notify(event));

    emitPhase("startup", PHASE_RUN_QUEUE);
    // Run startup recovery BEFORE the run queue tries to schedule anything.
    // Without this, runs from a previous daemon process that crashed/restarted
    // are still marked `running`/`starting` in the DB and still hold their
    // entries in `run_locks`. New runs that need the same locks (same room,
    // same workspace) get stuck in `waiting` forever because their lock
    // owners are dead processes. The recovery clears `run_locks`, fails any
    // dead-pid runs, and lets fresh runs acquire locks cleanly.
    const reclaim = new ReclaimStaleClaimedRun(database, lifecycle, (run) => adapterRegistry.reclaimAdapterFor(run), options.now ?? Date.now);
    await new StartupRecovery(database, lifecycle, reclaim, options.now ?? Date.now).run();
    await runQueue.scheduleTick();

    emitPhase("startup", PHASE_ADAPTERS);
    const mockAdapter = adapterRegistry.mockAdapter;

    function appendTaskMailboxWake(workspaceId: string, roomId: string, taskId: string, runId: string, reason: "task_completed" | "task_blocked"): void {
      const now = options.now?.() ?? Date.now();
        const room = database.sqlite.prepare("SELECT primary_agent_id FROM rooms WHERE id = ? AND archived_at IS NULL").get(roomId) as { readonly primary_agent_id: string | null } | undefined;
        const primaryAgentId = room?.primary_agent_id;
        if (!primaryAgentId) return;
      const task = database.sqlite.prepare("SELECT title, status FROM tasks WHERE id = ?").get(taskId) as { readonly title: string; readonly status: string } | undefined;
      if (!task) return;
      const mailboxMessageId = randomUUID();
      database.sqlite.transaction(() => {
        database.sqlite
          .prepare("INSERT INTO mailbox_messages (id, workspace_id, room_id, from_type, from_id, to_agent_id, kind, content, files, read, claimed_run_id, claimed_at, delivery_batch_id, delivery_failure_reason, attempt_count, created_at, consumed_at) VALUES (?, ?, ?, 'system', ?, ?, 'message', ?, '[]', 0, NULL, NULL, NULL, NULL, 0, ?, NULL)")
          .run(mailboxMessageId, workspaceId, roomId, taskId, primaryAgentId, JSON.stringify({ text: `[${reason}] Task ${taskId}: ${task.title} (${task.status})` }), now);
        eventBus.publish({ id: randomUUID(), type: "mailbox.message.created", schemaVersion: 1, workspaceId, roomId, agentId: primaryAgentId, payload: { mailboxMessageId, roomId, fromAgentId: taskId, targetAgentId: primaryAgentId, reason }, createdAt: now });
      })();
      void commandBusRef.current?.dispatch(
        { type: "WakeAgent", roomId, agentId: primaryAgentId, workspaceId, reason: "mailbox_message", promptDelta: { kind: "delta_only", instructions: `Task ${reason === "task_completed" ? "completed" : "blocked"}: ${task.title}` }, idempotencyKey: `task-mailbox:${taskId}:${runId}:${reason}` },
        { actor: { type: "system" }, traceId: `task-mailbox:${taskId}:${runId}`, idempotencyKey: `task-mailbox:${taskId}:${runId}:${reason}`, origin: "internal" }
      );
    }

    emitPhase("startup", PHASE_COMMAND_BUS);
    const commandBus = createCommandBus({
      database,
      handlers: {
        ...createDaemonCommandHandlers({ database, eventBus, getCommandBus: () => commandBus, pendingTurns, prewarmRoomAgents: (roomId) => adapterRegistry.prewarmRoomAgents(roomId), disposeRoomAgents: (roomId) => adapterRegistry.disposeRoomAgents(roomId), ...(options.now !== undefined ? { now: options.now } : {}) }),
        ...createContextCommandHandlers(contextLedger, options.now),
        ...createArtifactCommandHandlers(artifactService),
        ...createPermissionCommandHandlers(permissionEngine, database, eventBus, options.now),
        ...createInterventionCommandHandlers(interventionEngine),
        CreateTask: createCreateTaskHandler(taskService),
        UpdateTask: createUpdateTaskHandler(taskService),
        CompleteTask: createCompleteTaskHandler(taskService),
        WakeAgent: createWakeAgentHandler({ database, activeWakes, mailbox, lifecycle }) as CommandHandler,
        ConsumePendingTurn: createConsumePendingTurnHandler(pendingTurns) as CommandHandler,
        CancelRun: createCancelRunHandler({ lifecycle, adapterManager: adapterRegistry }),
        ApplyWorktree: (command) => {
          const server = roomMcpServerRef.current;
          if (!server) return { ok: false, error: { code: "internal_error", message: "RoomMcpServer not initialized" } };
          const roomId = typeof command.roomId === "string" ? command.roomId : undefined;
          const runId = typeof command.runId === "string" ? command.runId : undefined;
          if (!roomId || !runId) return { ok: false, error: { code: "validation_failed", message: "roomId and runId are required" } };
          const room = database.sqlite.prepare("SELECT primary_agent_id FROM rooms WHERE id = ?").get(roomId) as { readonly primary_agent_id: string | null } | undefined;
          const agentId = room?.primary_agent_id ?? "system";
          const session = { roomId, agentId };
          return Promise.resolve(server.handleApplyWorktree({ runId }, session, {})).then((result) => result.ok
            ? { ok: true, data: result.data, emittedEvents: [] }
            : { ok: false, error: { code: result.error.code as import("@agenthub/bus").CommandErrorCode, message: (result.error as { message: string }).message } }
          );
        },
        DiscardWorktree: (command) => {
          const server = roomMcpServerRef.current;
          if (!server) return { ok: false, error: { code: "internal_error", message: "RoomMcpServer not initialized" } };
          const roomId = typeof command.roomId === "string" ? command.roomId : undefined;
          const runId = typeof command.runId === "string" ? command.runId : undefined;
          if (!roomId || !runId) return { ok: false, error: { code: "validation_failed", message: "roomId and runId are required" } };
          const room = database.sqlite.prepare("SELECT primary_agent_id FROM rooms WHERE id = ?").get(roomId) as { readonly primary_agent_id: string | null } | undefined;
          const agentId = room?.primary_agent_id ?? "system";
          const session = { roomId, agentId };
          return Promise.resolve(server.handleDiscardWorktree({ runId }, session, {})).then((result) => result.ok
            ? { ok: true, data: result.data, emittedEvents: [] }
            : { ok: false, error: { code: result.error.code as import("@agenthub/bus").CommandErrorCode, message: (result.error as { message: string }).message } }
          );
        }
      }
    });
    commandBusRef.current = commandBus;
    const roomMcpServer = new RoomMcpServer({ commandBus, taskService, database, eventBus, permissionEngine, artifactFs, ...(options.now !== undefined ? { now: options.now } : {}) });
    // Start the TCP server so agents can reach room.* MCP tools via the stdio bridge.
    await roomMcpServer.startTcp();
    roomMcpServerRef.current = roomMcpServer;
    const delegatedTaskReconciliation = reconcileTerminalDelegatedTaskRuns({ database, eventBus, taskService, ...(options.now !== undefined ? { now: options.now } : {}) });
    for (const runId of delegatedTaskReconciliation.reviewDispatchRunIds) {
      await handleTeamDispatchReviewTerminal({ database, eventBus, commandBus, taskService, ...(options.now !== undefined ? { now: options.now } : {}) }, runId);
    }
    const runTaskTimeoutSweep = () => {
      const wakes = checkTaskTimeouts(database, eventBus, options.now?.() ?? Date.now());
      for (const wake of wakes) {
        void commandBus.dispatch(
          { type: "WakeAgent", roomId: wake.roomId, agentId: wake.agentId, workspaceId: wake.workspaceId, reason: "task_blocked", messageId: wake.mailboxMessageId, idempotencyKey: `task-timeout:${wake.taskId}:${wake.mailboxMessageId}` },
          { actor: { type: "system" }, traceId: `task-timeout:${wake.taskId}`, idempotencyKey: `task-timeout:${wake.taskId}:${wake.mailboxMessageId}`, origin: "internal" }
        );
      }
    };
    taskTimeoutTimer = setInterval(runTaskTimeoutSweep, 60_000);
    taskTimeoutTimer.unref?.();
    runtime = { database, eventBus, commandBus, roomMcpServer, adapterRegistry, mockAdapter, artifactService, taskService, outbox, handlers, runQueue, agentProfiles, roleDraftGcCleanup, lifecycle };

    emitPhase("startup", PHASE_HTTP);
    return await new Promise<Server>((resolve) => {
      server = createServer(handle).listen(options.port ?? 6677, host, () => {
        ready = true;
        resolve(server as Server);
      });
    });
  };

  const close = async (closeOptions: DaemonCloseOptions = {}): Promise<DaemonCloseResult> => {
    if (closed) return { forced: false, cancelledRunIds: [] };
    closed = true;
    stopping = true;
    ready = false;
    for (const client of sseClients) client.close();
    const shutdownRuns = await waitForInFlightRuns(closeOptions.forceCancelAfterMs ?? 0);
    for (const phase of DAEMON_SHUTDOWN_PHASES) {
      emitPhase("shutdown", phase);
      if (phase === PHASE_HTTP && server !== undefined) {
        await new Promise<void>((resolve, reject) => server?.close((err) => err ? reject(err) : resolve()));
        server = undefined;
      } else if (phase === PHASE_OUTBOX) {
        await runtime?.outbox.drainPending();
      } else if (phase === PHASE_EVENT_BUS) {
        runtime?.roleDraftGcCleanup();
        runtime?.eventBus.flushStatusLines?.();
        if (taskTimeoutTimer !== undefined) clearInterval(taskTimeoutTimer);
        taskTimeoutTimer = undefined;
        await runtime?.agentProfiles.close();
        runtime?.adapterRegistry.disposeAll();
        runtime?.roomMcpServer.stopTcp();
        runtime?.eventBus.close();
      } else if (phase === PHASE_SQLITE) {
        runtime?.database.sqlite.close();
      }
    }
    runtime = undefined;
    return shutdownRuns;
  };

  const waitForInFlightRuns = async (timeoutMs: number): Promise<DaemonCloseResult> => {
    if (runtime === undefined || inFlightRunIds().length === 0) return { forced: false, cancelledRunIds: [] };
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (inFlightRunIds().length === 0) return { forced: false, cancelledRunIds: [] };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const runIds = inFlightRunIds();
    for (const runId of runIds) {
      runtime.lifecycle.markCancelling(null, runId);
      runtime.lifecycle.cancelFinalized(null, runId, "daemon_shutdown");
    }
    await runtime.outbox.drainPending();
    return { forced: runIds.length > 0, cancelledRunIds: runIds };
  };

  const inFlightRunIds = (): string[] => {
    if (runtime === undefined) return [];
    const rows = runtime.database.sqlite.prepare("SELECT id FROM runs WHERE status IN ('queued','claimed','starting','running','waiting_permission','cancelling') ORDER BY created_at ASC").all() as { readonly id: string }[];
    return rows.map((row) => row.id);
  };

  return {
    get database() { return requireRuntime().database; },
    get eventBus() { return requireRuntime().eventBus; },
    get commandBus() { return requireRuntime().commandBus; },
    get lifecycle() { return requireRuntime().lifecycle; },
    get roomMcpServer() { return requireRuntime().roomMcpServer; },
    get adapterRegistry() { return requireRuntime().adapterRegistry; },
    get mockAdapter() { return requireRuntime().mockAdapter; },
    handle,
    inFlightRunIds,
    start,
    close
  };
}

function withStatusLineCoalescing(eventBus: EventBus): StatusLineEventBus {
  const basePublish = eventBus.publish.bind(eventBus);
  const buffers = new Map<string, { input: PublishInput; timer: ReturnType<typeof setTimeout> }>();
  const wrapped = eventBus as StatusLineEventBus;
  wrapped.publish = ((input: PublishInput) => {
    if (input.type !== "agent.status_line.updated") return basePublish(input);
    const key = `${input.agentId ?? ""}:${input.roomId ?? ""}`;
    const existing = buffers.get(key);
    if (existing) {
      existing.input = input;
      return { durability: "ephemeral", event: { ...input, durability: "ephemeral", visibility: "main" } as ReturnType<EventBus["publish"]>["event"] } as ReturnType<EventBus["publish"]>;
    }
    const timer = setTimeout(() => flushStatusLine(key), 30_000);
    timer.unref?.();
    buffers.set(key, { input, timer });
    return { durability: "ephemeral", event: { ...input, durability: "ephemeral", visibility: "main" } as ReturnType<EventBus["publish"]>["event"] } as ReturnType<EventBus["publish"]>;
  }) as EventBus["publish"];
  wrapped.flushStatusLines = () => {
    for (const key of [...buffers.keys()]) flushStatusLine(key);
  };
  const baseSubscribeAll = eventBus.subscribeAll.bind(eventBus);
  wrapped.subscribeAll = ((subscriber: EventBusSubscriber) => baseSubscribeAll(subscriber)) as EventBus["subscribeAll"];
  function flushStatusLine(key: string): void {
    const buffer = buffers.get(key);
    if (!buffer) return;
    clearTimeout(buffer.timer);
    buffers.delete(key);
    basePublish(buffer.input);
  }
  return wrapped;
}

type RouteContext = { readonly req: IncomingMessage; readonly res: ServerResponse; readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly commandBus: CommandBus; readonly artifactService: ArtifactService; readonly taskService: TaskService; readonly outbox: { drainPending(): Promise<void> }; readonly modelConfigSecrets: KeychainBridge; readonly settingsJobs: Map<string, SettingsJobRecord>; readonly modelTestFetch: typeof fetch; readonly roleDraftGenerator: RoleDraftGenerator; readonly registerSseClient: (client: SseClient) => () => void; readonly token?: string; readonly allowedOrigins?: readonly string[]; readonly host: string; readonly now?: () => number };

async function route(ctx: RouteContext): Promise<void> {
  const url = new URL(ctx.req.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  const auth = authenticate(ctx, url);
  if (!auth.ok) return json(ctx.res, auth.status, { error: auth.error });
  if (ctx.req.method === "POST" && url.pathname === "/auth/session") return authSession(ctx);
  if (ctx.req.method === "POST" && url.pathname === "/auth/tokens") { if (!requireScope(auth, "write", ctx.res)) return; return issueAuthToken(ctx, await body(ctx)); }
  if (ctx.req.method === "GET" && url.pathname === "/auth/tokens") { if (!requireScope(auth, "read", ctx.res)) return; return listAuthTokens(ctx); }
  if (ctx.req.method === "POST" && url.pathname === "/attachments") return attachments(ctx);
  if (ctx.req.method === "GET" && url.pathname === "/healthz") return json(ctx.res, 200, { ok: true });
  if (ctx.req.method === "GET" && url.pathname === "/openapi.json") return json(ctx.res, 200, openApiDocument);
  if (ctx.req.method === "GET" && url.pathname === "/model-configs") {
    const workspaceId = url.searchParams.get("workspaceId");
    const configs = all(
      ctx.database,
      workspaceId === null
        ? "SELECT * FROM model_configs ORDER BY created_at ASC"
        : "SELECT * FROM model_configs WHERE workspace_id = ? ORDER BY created_at ASC",
      ...(workspaceId === null ? [] : [workspaceId])
    ).map((row) => normalizeModelConfigRow(row as Record<string, unknown>));
    return json(ctx.res, 200, configs);
  }
  if (ctx.req.method === "POST" && parts[0] === "model-configs" && parts[1] && parts[2] === "test") return testModelConfig(ctx, parts[1], await body(ctx));
  if (ctx.req.method === "POST" && url.pathname === "/model-configs") {
    const input = await body(ctx) as Record<string, unknown>;
    const now = ctx.now?.() ?? Date.now();
    const id = typeof input.id === "string" && input.id.length > 0 ? input.id : randomUUID();
    const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : null;
    const name = typeof input.name === "string" && input.name.length > 0 ? input.name : "Model Config";
    const provider = typeof input.provider === "string" && input.provider.length > 0 ? input.provider : "openai";
    const model = typeof input.model === "string" && input.model.length > 0 ? input.model : "";
    const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl : null;
    const temperature = typeof input.temperature === "number" && Number.isFinite(input.temperature) ? input.temperature : null;
    const maxTokens = typeof input.maxTokens === "number" && Number.isFinite(input.maxTokens) ? input.maxTokens : null;
    const reasoning = input.reasoning === undefined || input.reasoning === null ? null : JSON.stringify(input.reasoning);
    const extra = input.extra === undefined || input.extra === null ? null : JSON.stringify(input.extra);
    const profile = typeof input.profile === "string" ? input.profile : null;
    const keyInput = typeof input.apiKey === "string" && input.apiKey.length > 0 ? input.apiKey : null;
    const keyRef = provider === "ollama" ? null : keyInput !== null ? createKeychainAccount({ workspaceId: workspaceId ?? "default", provider: "model-config", purpose: id }) : null;
    const fingerprint = provider === "ollama" ? null : keyInput !== null ? modelConfigFingerprint(keyInput) : null;
    try {
      if (keyRef !== null && keyInput !== null) await ctx.modelConfigSecrets.set(keyRef, keyInput);
      ctx.database.sqlite.transaction(() => {
        ctx.database.sqlite.prepare(
          "INSERT INTO model_configs (id, workspace_id, name, provider, model, base_url, api_key_ref, api_key_fingerprint, temperature, max_tokens, reasoning, extra, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(id, workspaceId, name, provider, model, baseUrl, keyRef, fingerprint, temperature, maxTokens, reasoning, extra, profile, now, now);
        ctx.eventBus.publish({
          id: randomUUID(),
          type: "model_config.created",
          schemaVersion: 1,
          workspaceId: workspaceId ?? "default-workspace",
          payload: { modelConfigId: id, workspaceId, name, provider, model },
          createdAt: now
        });
      })();
    } catch {
      if (keyRef !== null) await ctx.modelConfigSecrets.delete(keyRef).catch(() => undefined);
      return json(ctx.res, 500, { error: "model_config_keychain_failed" });
    }
    return json(ctx.res, 201, { modelConfig: getModelConfig(ctx.database, id) });
  }
  if (ctx.req.method === "GET" && url.pathname === "/runtimes") {
    const workspaceId = url.searchParams.get("workspaceId");
    const runtimes = all(
      ctx.database,
      workspaceId === null
        ? "SELECT * FROM runtimes ORDER BY created_at ASC"
        : "SELECT * FROM runtimes WHERE workspace_id = ? ORDER BY created_at ASC",
      ...(workspaceId === null ? [] : [workspaceId])
    ).map((row) => {
      const runtime = row as Record<string, unknown>;
      return {
        ...runtime,
        args: runtime.args !== null && runtime.args !== undefined ? JSON.parse(String(runtime.args)) as unknown : runtime.args,
        env: runtime.env !== null && runtime.env !== undefined ? JSON.parse(String(runtime.env)) as unknown : runtime.env,
        supported_caps: JSON.parse(String(runtime.supported_caps ?? "[]")) as unknown,
        manifest_json: runtime.manifest_json !== null && runtime.manifest_json !== undefined ? JSON.parse(String(runtime.manifest_json)) as unknown : runtime.manifest_json
      };
    });
    return json(ctx.res, 200, runtimes);
  }
  if (ctx.req.method === "GET" && url.pathname === "/agent-bindings") return agentBindings(ctx, url);
  if (ctx.req.method === "POST" && url.pathname === "/agent-bindings") return createAgentBinding(ctx, await body(ctx));
  if (ctx.req.method === "GET" && parts[0] === "agent-bindings" && parts[1]) return agentBinding(ctx, parts[1]);
  if (ctx.req.method === "PATCH" && parts[0] === "agent-bindings" && parts[1]) return updateAgentBinding(ctx, parts[1], await body(ctx));
  if (ctx.req.method === "DELETE" && parts[0] === "agent-bindings" && parts[1]) return deleteAgentBinding(ctx, parts[1]);
  if (ctx.req.method === "POST" && url.pathname === "/runtimes") {
    const input = await body(ctx) as Record<string, unknown>;
    const now = ctx.now?.() ?? Date.now();
    const id = typeof input.id === "string" && input.id.length > 0 ? input.id : randomUUID();
    const name = typeof input.name === "string" && input.name.length > 0 ? input.name : "Custom ACP Runtime";
    const command = typeof input.command === "string" ? input.command : null;
    const args = Array.isArray(input.args) ? JSON.stringify(input.args) : null;
    const env = input.env !== null && typeof input.env === "object" && !Array.isArray(input.env) ? JSON.stringify(input.env) : null;
    const supportedCaps = Array.isArray(input.supportedCaps) ? JSON.stringify(input.supportedCaps) : JSON.stringify([]);
    const manifestJson = typeof input.manifestJson === "string"
      ? input.manifestJson
      : JSON.stringify({ runtimeKind: "custom-acp" });
    const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : null;
    ctx.database.sqlite.transaction(() => {
      ctx.database.sqlite.prepare(
        "INSERT INTO runtimes (id, workspace_id, kind, name, command, args, env, detected_at, detected_path, detected_version, supported_caps, version, status, manifest_json, created_at, updated_at) VALUES (?, ?, 'custom-acp', ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, ?, ?)"
      ).run(id, workspaceId, name, command, args, env, supportedCaps, manifestJson, now, now);
      ctx.eventBus.publish({
        id: randomUUID(),
        type: "runtime.detected",
        schemaVersion: 1,
        workspaceId: workspaceId ?? "default-workspace",
        payload: { runtimeId: id, kind: "custom-acp", name },
        createdAt: now
      });
    })();
    const runtime = get(ctx.database, "SELECT * FROM runtimes WHERE id = ?", id) as Record<string, unknown> | undefined;
    return json(ctx.res, 201, runtime !== undefined ? { runtime } : { runtime: null });
  }
  if (ctx.req.method === "GET" && parts[0] === "model-configs" && parts[1]) {
    const modelConfig = getModelConfig(ctx.database, parts[1]);
    if (modelConfig === null) return json(ctx.res, 404, { error: "model_config_not_found" });
    return json(ctx.res, 200, { modelConfig });
  }
  if (ctx.req.method === "GET" && parts[0] === "settings" && parts[1] === "jobs" && parts[2]) return getSettingsJob(ctx, parts[2]);
  if (ctx.req.method === "PATCH" && parts[0] === "model-configs" && parts[1]) {
    const input = await body(ctx) as Record<string, unknown>;
    const existing = get(ctx.database, "SELECT * FROM model_configs WHERE id = ?", parts[1]) as Record<string, unknown> | null;
    if (existing === null) return json(ctx.res, 404, { error: "model_config_not_found" });
    const now = ctx.now?.() ?? Date.now();
    const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : stringOrNull(existing.workspace_id);
    const name = typeof input.name === "string" ? input.name : String(existing.name);
    const provider = typeof input.provider === "string" ? input.provider : String(existing.provider);
    const model = typeof input.model === "string" ? input.model : String(existing.model);
    const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl : existing.base_url ?? null;
    const temperature = typeof input.temperature === "number" && Number.isFinite(input.temperature) ? input.temperature : existing.temperature ?? null;
    const maxTokens = typeof input.maxTokens === "number" && Number.isFinite(input.maxTokens) ? input.maxTokens : existing.max_tokens ?? null;
    const reasoning = input.reasoning === undefined ? existing.reasoning ?? null : input.reasoning === null ? null : JSON.stringify(input.reasoning);
    const extra = input.extra === undefined ? existing.extra ?? null : input.extra === null ? null : JSON.stringify(input.extra);
    const profile = typeof input.profile === "string" ? input.profile : existing.profile ?? null;
    const keyInput = typeof input.apiKey === "string" && input.apiKey.length > 0 ? input.apiKey : null;
    const previousRef = typeof existing.api_key_ref === "string" ? existing.api_key_ref : null;
    const modelConfigId = parts[1];
    const keyRef = provider === "ollama"
      ? null
      : keyInput !== null
        ? previousRef ?? createKeychainAccount({ workspaceId: workspaceId ?? "default", provider: "model-config", purpose: modelConfigId })
        : previousRef;
    const fingerprint = provider === "ollama" ? null : keyInput !== null ? modelConfigFingerprint(keyInput) : stringOrNull(existing.api_key_fingerprint);
    try {
      if (keyRef !== null && keyInput !== null) await ctx.modelConfigSecrets.set(keyRef, keyInput);
      ctx.database.sqlite.transaction(() => {
        ctx.database.sqlite.prepare("UPDATE model_configs SET workspace_id = ?, name = ?, provider = ?, model = ?, base_url = ?, api_key_ref = ?, api_key_fingerprint = ?, temperature = ?, max_tokens = ?, reasoning = ?, extra = ?, profile = ?, updated_at = ? WHERE id = ?").run(workspaceId, name, provider, model, baseUrl, keyRef, fingerprint, temperature, maxTokens, reasoning, extra, profile, now, parts[1]);
        ctx.eventBus.publish({
          id: randomUUID(),
          type: "model_config.updated",
          schemaVersion: 1,
          workspaceId: workspaceId ?? "default-workspace",
          payload: { modelConfigId, workspaceId, name, provider, model },
          createdAt: now
        });
      })();
      if (provider === "ollama" && previousRef !== null) await ctx.modelConfigSecrets.delete(previousRef).catch(() => undefined);
    } catch {
      if (keyRef !== null && keyInput !== null) await ctx.modelConfigSecrets.delete(keyRef).catch(() => undefined);
      return json(ctx.res, 500, { error: "model_config_keychain_failed" });
    }
    return json(ctx.res, 200, { modelConfig: getModelConfig(ctx.database, modelConfigId) });
  }
  if (ctx.req.method === "DELETE" && parts[0] === "model-configs" && parts[1]) {
    const existing = get(ctx.database, "SELECT * FROM model_configs WHERE id = ?", parts[1]) as Record<string, unknown> | null;
    if (existing === null) return json(ctx.res, 404, { error: "model_config_not_found" });
    const now = ctx.now?.() ?? Date.now();
    let conflict = false;
    ctx.database.sqlite.transaction(() => {
      const bindings = get(ctx.database, "SELECT COUNT(*) AS count FROM agent_bindings WHERE model_config_id = ?", parts[1]) as { readonly count: number } | null;
      if ((bindings?.count ?? 0) > 0) {
        conflict = true;
        return;
      }
      ctx.database.sqlite.prepare("DELETE FROM model_configs WHERE id = ?").run(parts[1]);
      ctx.eventBus.publish({
        id: randomUUID(),
        type: "model_config.deleted",
        schemaVersion: 1,
        workspaceId: stringOrNull(existing.workspace_id) ?? "default-workspace",
        payload: { modelConfigId: parts[1], workspaceId: stringOrNull(existing.workspace_id), name: String(existing.name), provider: String(existing.provider), model: String(existing.model) },
        createdAt: now
      });
    })();
    if (conflict) return json(ctx.res, 409, { error: "model_config_has_bindings", bindingCount: scalar(ctx.database, "SELECT COUNT(*) AS count FROM agent_bindings WHERE model_config_id = ?", parts[1]) });
    const deletedRef = typeof existing.api_key_ref === "string" ? existing.api_key_ref : null;
    if (deletedRef !== null) await ctx.modelConfigSecrets.delete(deletedRef).catch(() => undefined);
      return json(ctx.res, 200, { ok: true });
  }
  if (ctx.req.method === "PATCH" && parts[0] === "runtimes" && parts[1]) {
    const input = await body(ctx) as Record<string, unknown>;
    const existing = get(ctx.database, "SELECT * FROM runtimes WHERE id = ?", parts[1]) as Record<string, unknown> | undefined;
    if (existing === undefined) return json(ctx.res, 404, { error: "runtime_not_found" });
    const now = ctx.now?.() ?? Date.now();
    const name = typeof input.name === "string" ? input.name : String(existing.name);
    const command = typeof input.command === "string" ? input.command : existing.command ?? null;
    const args = Array.isArray(input.args) ? JSON.stringify(input.args) : existing.args ?? null;
    const env = input.env !== null && typeof input.env === "object" && !Array.isArray(input.env) ? JSON.stringify(input.env) : existing.env ?? null;
    const supportedCaps = Array.isArray(input.supportedCaps) ? JSON.stringify(input.supportedCaps) : existing.supported_caps ?? "[]";
    const manifestJson = typeof input.manifestJson === "string" ? input.manifestJson : String(existing.manifest_json);
    const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : stringOrNull(existing.workspace_id);
    const detectedAt = typeof input.detectedAt === "number" && Number.isFinite(input.detectedAt) ? input.detectedAt : existing.detected_at ?? null;
    const detectedPath = typeof input.detectedPath === "string" ? input.detectedPath : existing.detected_path ?? null;
    const detectedVersion = typeof input.detectedVersion === "string" ? input.detectedVersion : existing.detected_version ?? null;
    const version = typeof input.version === "string" ? input.version : existing.version ?? null;
    const status = typeof input.status === "string" ? input.status : existing.status ?? null;
    ctx.database.sqlite.transaction(() => {
      ctx.database.sqlite.prepare(
        "UPDATE runtimes SET workspace_id = ?, name = ?, command = ?, args = ?, env = ?, detected_at = ?, detected_path = ?, detected_version = ?, supported_caps = ?, version = ?, status = ?, manifest_json = ?, updated_at = ? WHERE id = ?"
      ).run(workspaceId, name, command, args, env, detectedAt, detectedPath, detectedVersion, supportedCaps, version, status, manifestJson, now, parts[1]);
      ctx.eventBus.publish({
        id: randomUUID(),
        type: "runtime.updated",
        schemaVersion: 1,
        workspaceId: workspaceId ?? "default-workspace",
        payload: { runtimeId: parts[1], kind: String(existing.kind), name },
        createdAt: now
      });
    })();
    return json(ctx.res, 200, { runtime: get(ctx.database, "SELECT * FROM runtimes WHERE id = ?", parts[1]) });
  }
  if (ctx.req.method === "POST" && parts[0] === "runtimes" && parts[1] && parts[2] === "detect") return detectRuntime(ctx, parts[1]);
  if (ctx.req.method === "POST" && parts[0] === "runtimes" && parts[1] && parts[2] === "test") return testRuntime(ctx, parts[1], await body(ctx));
  if (ctx.req.method === "DELETE" && parts[0] === "runtimes" && parts[1]) {
    const existing = get(ctx.database, "SELECT * FROM runtimes WHERE id = ?", parts[1]) as Record<string, unknown> | undefined;
    if (existing === undefined) return json(ctx.res, 404, { error: "runtime_not_found" });
    const now = ctx.now?.() ?? Date.now();
    let conflict = false;
    ctx.database.sqlite.transaction(() => {
      const bindings = get(ctx.database, "SELECT COUNT(*) AS count FROM agent_bindings WHERE runtime_id = ?", parts[1]) as { readonly count: number } | undefined;
      if ((bindings?.count ?? 0) > 0) {
        conflict = true;
        return;
      }
      ctx.database.sqlite.prepare("DELETE FROM runtimes WHERE id = ?").run(parts[1]);
      ctx.eventBus.publish({
        id: randomUUID(),
        type: "runtime.removed",
        schemaVersion: 1,
        workspaceId: stringOrNull(existing.workspace_id) ?? "default-workspace",
        payload: { runtimeId: parts[1], kind: String(existing.kind), name: String(existing.name) },
        createdAt: now
      });
    })();
    if (conflict) return json(ctx.res, 409, { error: "runtime_has_bindings" });
    return json(ctx.res, 200, { ok: true });
  }
  if (ctx.req.method === "GET" && url.pathname === "/event") return sse(ctx, url, auth.scopes);
  if (ctx.req.method === "GET" && url.pathname === "/rooms") return json(ctx.res, 200, { rooms: all(ctx.database, "SELECT * FROM rooms ORDER BY created_at ASC") });
  if (ctx.req.method === "POST" && url.pathname === "/rooms") {
    const requestBody = await body(ctx);
    const normalized = normalizeRoomCreateCompat(ctx.database, requestBody);
    if (!normalized.ok) return json(ctx.res, normalized.status, { error: normalized.error });
    const mode = typeof normalized.body.mode === "string" ? normalized.body.mode : "solo";
    const leaderRoleId = typeof normalized.body.leaderRoleId === "string" && normalized.body.leaderRoleId.length > 0 ? normalized.body.leaderRoleId : undefined;
    if ((mode === "team" || mode === "squad") && leaderRoleId === undefined) return json(ctx.res, 400, { error: "squad_mode_requires_leader_role_id" });
    return dispatchCreated(ctx, normalized.body, "CreateRoom");
  }
  if (ctx.req.method === "POST" && url.pathname === "/roles/generate") return createRoleGenerationJob(ctx, await body(ctx));
  if (ctx.req.method === "GET" && parts[0] === "roles" && parts[1] === "generate" && parts[2] === "jobs" && parts[3]) return getRoleGenerationJob(ctx, parts[3]);
  if (ctx.req.method === "DELETE" && parts[0] === "roles" && parts[1] === "generate" && parts[2] === "jobs" && parts[3]) return cancelRoleGenerationJob(ctx, parts[3]);
  if (ctx.req.method === "GET" && url.pathname === "/roles") return roles(ctx, url);
  if (ctx.req.method === "POST" && url.pathname === "/roles") return createRole(ctx, await body(ctx));
  if (ctx.req.method === "DELETE" && parts[0] === "auth" && parts[1] === "tokens" && parts[2]) { if (!requireScope(auth, "write", ctx.res)) return; return revokeToken(ctx, parts[2]); }
  if (ctx.req.method === "GET" && parts[0] === "rooms" && parts.length === 1) return json(ctx.res, 200, { rooms: all(ctx.database, "SELECT * FROM rooms ORDER BY created_at ASC") });
  if (ctx.req.method === "GET" && parts[0] === "rooms" && parts.length === 2) return json(ctx.res, 200, { room: get(ctx.database, "SELECT * FROM rooms WHERE id = ?", parts[1]) });
  if (ctx.req.method === "GET" && parts[0] === "rooms" && parts[2] === "tasks") return tasks(ctx, parts[1] as string, url);
  if (ctx.req.method === "GET" && parts[0] === "tasks" && parts[1] && parts[2] === "activities") return taskActivities(ctx, parts[1] as string);
  // V1.1: POST /rooms/:id/tasks/:taskId/column MUST come before the generic POST /rooms/:id/tasks
  // to avoid route shadowing (both match parts[2]==="tasks").
  // Returns 501 stub — full implementation (UpdateTask with boardColumn field) lands in feat/v11-C.
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "tasks" && parts[4] === "column") return json(ctx.res, 501, { error: "not_implemented", capability: "v1.1-kanban-column" });
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "tasks") return dispatchCreated(ctx, { ...(await body(ctx)), roomId: parts[1] }, "CreateTask");
  if (ctx.req.method === "POST" && parts[0] === "tasks" && parts[2] === "complete") return dispatch(ctx, { taskId: parts[1] }, "CompleteTask");
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "archive") return dispatch(ctx, { roomId: parts[1] }, "ArchiveRoom");
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "unarchive") return dispatch(ctx, { roomId: parts[1] }, "UnarchiveRoom");
  if (ctx.req.method === "GET" && url.pathname === "/messages") return messages(ctx, url);
  if (ctx.req.method === "GET" && parts[0] === "rooms" && parts[2] === "messages") return messages(ctx, url, parts[1] as string);
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "messages") return dispatch(ctx, { ...(await body(ctx)), roomId: parts[1] }, "SendMessage");
  if (ctx.req.method === "DELETE" && parts[0] === "pending-turns" && parts[1]) return dispatch(ctx, { pendingTurnId: parts[1] }, "CancelPendingTurn");
  if (ctx.req.method === "PATCH" && parts[0] === "messages" && parts[1]) return dispatch(ctx, { ...(await body(ctx)), messageId: parts[1] }, "EditMessage");
  if (ctx.req.method === "POST" && parts[0] === "messages" && parts[1] && parts[2] === "regenerate") return dispatch(ctx, { ...(await body(ctx)), messageId: parts[1] }, "RegenerateMessage");
  if (ctx.req.method === "POST" && parts[0] === "messages" && parts[1] && parts[2] === "pin") return dispatch(ctx, { ...(await body(ctx)), messageId: parts[1] }, "PinMessage");
  if (ctx.req.method === "DELETE" && parts[0] === "messages" && parts[1]) return dispatch(ctx, { messageId: parts[1] }, "DeleteMessage");
  if (ctx.req.method === "GET" && url.pathname === "/agents") return json(ctx.res, 200, { agents: all(ctx.database, "SELECT * FROM agent_profiles ORDER BY name ASC") });
  if (ctx.req.method === "GET" && parts[0] === "agents" && parts[1]) return json(ctx.res, 200, { agent: get(ctx.database, "SELECT * FROM agent_profiles WHERE id = ?", parts[1]) });
  if (ctx.req.method === "GET" && parts[0] === "runs" && parts[1] && parts[2] === "permission-summary") {
    const runId = parts[1];
    const events = all(ctx.database, "SELECT payload FROM events WHERE run_id = ? AND type = 'permission.run_summary' ORDER BY created_at DESC LIMIT 1", runId) as Array<{ readonly payload: string }>;
    if (events.length === 0) return json(ctx.res, 200, { decisions: [] });
    const payload = JSON.parse(events[0]!.payload) as { decisions?: unknown[] };
    return json(ctx.res, 200, { decisions: payload.decisions ?? [] });
  }
  if (ctx.req.method === "GET" && parts[0] === "runs" && parts[1]) return json(ctx.res, 200, { run: get(ctx.database, "SELECT * FROM runs WHERE id = ?", parts[1]) });
  if (ctx.req.method === "GET" && url.pathname === "/context") return contextItems(ctx, url);
  if (ctx.req.method === "POST" && url.pathname === "/context/propose") return dispatch(ctx, await body(ctx), "ProposeContextItem");
  if (ctx.req.method === "POST" && url.pathname === "/context/write") return dispatch(ctx, await body(ctx), "WriteContextItem");
  if (ctx.req.method === "PATCH" && parts[0] === "context" && parts[1]) return dispatch(ctx, { ...(await body(ctx)), contextId: parts[1] }, "UpdateContextItem");
  if (ctx.req.method === "POST" && parts[0] === "context" && parts[2] === "confirm") return dispatch(ctx, { ...(await body(ctx)), contextId: parts[1] }, "ConfirmContextItem");
  if (ctx.req.method === "POST" && parts[0] === "context" && parts[2] === "deprecate") return dispatch(ctx, { ...(await body(ctx)), contextId: parts[1] }, "DeprecateContextItem");
  if (ctx.req.method === "POST" && parts[0] === "context" && parts[2] === "pin") return dispatch(ctx, { ...(await body(ctx)), contextId: parts[1] }, "PinContextItem");
  if (ctx.req.method === "GET" && url.pathname === "/permissions/profiles") return json(ctx.res, 200, { profiles: (all(ctx.database, "SELECT * FROM permission_profiles ORDER BY name ASC") as Array<Record<string, unknown>>).map(decodeProfilePayload) });
  if (ctx.req.method === "GET" && parts[0] === "permissions" && parts[1] === "profiles" && parts[2]) {
    const row = get(ctx.database, "SELECT * FROM permission_profiles WHERE id = ?", parts[2]) as Record<string, unknown> | undefined;
    return json(ctx.res, 200, { profile: row !== undefined ? decodeProfilePayload(row) : undefined });
  }
  if (ctx.req.method === "POST" && url.pathname === "/permissions/profiles") return dispatch(ctx, await body(ctx), "CreatePermissionProfile");
  if (ctx.req.method === "PATCH" && parts[0] === "permissions" && parts[1] === "profiles" && parts[2]) return dispatch(ctx, { ...(await body(ctx)), profileId: parts[2] }, "PatchPermissionProfile");
  if (ctx.req.method === "GET" && url.pathname === "/permissions/requests") return permissionRequests(ctx, url);
  if (ctx.req.method === "POST" && parts[0] === "permissions" && parts[2] === "resolve") return dispatch(ctx, { ...(await body(ctx)), requestId: parts[1] }, "ResolvePermission");
  if (ctx.req.method === "GET" && url.pathname === "/permissions/rules") return permissionRules(ctx, url);
  if (ctx.req.method === "DELETE" && parts[0] === "permissions" && parts[1] === "rules" && parts[2]) return dispatch(ctx, { ruleId: parts[2] }, "DeletePermissionRule");
  if (ctx.req.method === "GET" && url.pathname === "/interventions") return interventions(ctx, url);
  if (ctx.req.method === "POST" && url.pathname === "/interventions") return dispatch(ctx, await body(ctx), "RequestIntervention");
  if (ctx.req.method === "GET" && parts[0] === "interventions" && parts.length === 2) return json(ctx.res, 200, { intervention: get(ctx.database, "SELECT * FROM interventions WHERE id = ?", parts[1]) });
  if (ctx.req.method === "POST" && parts[0] === "interventions" && parts[2] === "approve") return dispatch(ctx, { ...(await body(ctx)), interventionId: parts[1] }, "ApproveIntervention");
  if (ctx.req.method === "POST" && parts[0] === "interventions" && parts[2] === "ignore") return dispatch(ctx, { interventionId: parts[1] }, "IgnoreIntervention");
  if (ctx.req.method === "POST" && parts[0] === "interventions" && parts[2] === "reject") return dispatch(ctx, { ...(await body(ctx)), interventionId: parts[1] }, "RejectIntervention");
  if (ctx.req.method === "POST" && parts[0] === "interventions" && parts[2] === "later") return dispatch(ctx, { ...(await body(ctx)), interventionId: parts[1] }, "SnoozeIntervention");
  if (parts[0] === "roles" && parts[1]) {
    if (ctx.req.method === "GET" && parts.length === 2) {
      const role = get(ctx.database, "SELECT * FROM roles WHERE id = ?", parts[1]);
      if (role === null) return json(ctx.res, 404, { error: "role_not_found" });
      return json(ctx.res, 200, role);
    }
    if (ctx.req.method === "PATCH" && parts.length === 2) return updateRole(ctx, parts[1], await body(ctx));
    if (ctx.req.method === "DELETE" && parts.length === 2) return deleteRole(ctx, parts[1]);
  }
  if (ctx.req.method === "GET" && url.pathname === "/artifacts") return artifacts(ctx, url);
  if (ctx.req.method === "POST" && url.pathname === "/artifacts") return dispatch(ctx, await body(ctx), "CreateArtifact");
  if (ctx.req.method === "GET" && parts[0] === "artifacts" && parts.length === 2) return json(ctx.res, 200, { artifact: ctx.artifactService.get(parts[1] as string) ?? null });
  if (ctx.req.method === "POST" && parts[0] === "artifacts" && parts[2] === "review") return dispatch(ctx, { artifactId: parts[1] }, "ReviewArtifact");
  if (ctx.req.method === "POST" && parts[0] === "artifacts" && parts[2] === "apply") return dispatch(ctx, { ...(await body(ctx)), artifactId: parts[1] }, "ApplyDiff");
  if (ctx.req.method === "POST" && parts[0] === "artifacts" && parts[2] === "reject") return dispatch(ctx, { ...(await body(ctx)), artifactId: parts[1] }, "RejectDiff");
  if (ctx.req.method === "POST" && parts[0] === "artifacts" && parts[2] === "revert") return dispatch(ctx, { artifactId: parts[1] }, "RevertArtifact");
  if (ctx.req.method === "GET" && parts[0] === "artifacts" && parts[2] === "files" && parts.length === 3) return json(ctx.res, 200, { files: ctx.artifactService.files(parts[1] as string) });
  if (ctx.req.method === "GET" && parts[0] === "artifacts" && parts[2] === "files" && parts.length >= 4) return json(ctx.res, 200, { content: ctx.artifactService.fileContent(parts[1] as string, decodeURIComponent(parts.slice(3).join("/"))) ?? null });
  if (ctx.req.method === "GET" && url.pathname === "/debug/events") return debugEvents(ctx, url, auth);
  if (ctx.req.method === "GET" && url.pathname === "/debug/stats") return debugStats(ctx, auth);
  if (ctx.req.method === "GET" && parts[0] === "workspaces" && parts[2] === "cost-summary") { if (!requireScope(auth, "read", ctx.res)) return; return costSummary(ctx, parts[1] as string, url); }
  if (ctx.req.method === "POST" && parts[0] === "workspaces" && parts[2] === "cost-budget") return json(ctx.res, 501, { error: "budget alerts are V1.5 (permission-dsl)" });
  if (ctx.req.method === "GET" && parts[0] === "workspaces" && parts[1]) return workspace(ctx, parts[1] as string);
  if (ctx.req.method === "GET" && (url.pathname === "/board" || url.pathname === "/timeline")) return json(ctx.res, 404, { error: "not_found", capability: "v1-roadmap" });
  // ---------------------------------------------------------------------------
  // V1.1 REST endpoint stubs (contract week — implementations land in feature branches)
  // ---------------------------------------------------------------------------
  // POST /rooms/:id/participants — add a participant to a running room (D10, task 4.7)
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "participants") return dispatch(ctx, { ...(await body(ctx)), roomId: parts[1] }, "AddParticipant");
  // POST /rooms/:id/worktrees/:runId/apply — apply worktree diff (D3, task 4.9)
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "worktrees" && parts[4] === "apply") return dispatch(ctx, { roomId: parts[1], runId: parts[3] }, "ApplyWorktree");
  // POST /rooms/:id/worktrees/:runId/discard — discard worktree (D3, task 4.9)
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "worktrees" && parts[4] === "discard") return dispatch(ctx, { roomId: parts[1], runId: parts[3] }, "DiscardWorktree");
  // POST /rooms/:id/unstall — dismiss stalled banner (D4, task 2.6)
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "unstall") {
    const roomId = parts[1] as string;
    const room = ctx.database.sqlite.prepare("SELECT workspace_id FROM rooms WHERE id = ? AND archived_at IS NULL").get(roomId) as { readonly workspace_id: string } | undefined;
    if (!room) return json(ctx.res, 404, { error: "room_not_found" });
    const now = ctx.now?.() ?? Date.now();
    ctx.database.sqlite.transaction(() => {
      ctx.database.sqlite.prepare("UPDATE rooms SET stalled_at = NULL, updated_at = ? WHERE id = ?").run(now, roomId);
      ctx.eventBus.publish({ id: randomUUID(), type: "room.unstalled", schemaVersion: 1, workspaceId: room.workspace_id, roomId, payload: { roomId }, createdAt: now });
    })();
    return json(ctx.res, 200, { ok: true, roomId });
  }
  // GET/POST/PUT/DELETE /skills — skill CRUD (D9, task 4.11)
  if (ctx.req.method === "GET" && url.pathname === "/skills") return json(ctx.res, 501, { error: "not_implemented", capability: "v1.1-skills" });
  if (ctx.req.method === "GET" && parts[0] === "skills" && parts[1]) return json(ctx.res, 501, { error: "not_implemented", capability: "v1.1-skills" });
  if (ctx.req.method === "POST" && url.pathname === "/skills") return json(ctx.res, 501, { error: "not_implemented", capability: "v1.1-skills" });
  if (ctx.req.method === "POST" && url.pathname === "/skills/import") return json(ctx.res, 501, { error: "not_implemented", capability: "v1.1-skills" });
  if (ctx.req.method === "PUT" && parts[0] === "skills" && parts[1]) return json(ctx.res, 501, { error: "not_implemented", capability: "v1.1-skills" });
  if (ctx.req.method === "DELETE" && parts[0] === "skills" && parts[1]) return json(ctx.res, 501, { error: "not_implemented", capability: "v1.1-skills" });
  return json(ctx.res, 404, { error: "not_found" });
}

async function detectRuntime(ctx: RouteContext, runtimeId: string): Promise<void> {
  const existing = get(ctx.database, "SELECT * FROM runtimes WHERE id = ?", runtimeId) as Record<string, unknown> | null;
  if (existing === null) return json(ctx.res, 404, { error: "runtime_not_found" });
  const detection = await runRuntimeDetection(existing);
  if (!detection.ok) return json(ctx.res, 400, { ok: false, error: detection.error });
  const now = ctx.now?.() ?? Date.now();
  const changed = existing.detected_path !== detection.detectedPath || existing.detected_version !== detection.detectedVersion || existing.detected_at === null;
  if (changed) {
    ctx.database.sqlite.transaction(() => {
      ctx.database.sqlite.prepare("UPDATE runtimes SET detected_at = ?, detected_path = ?, detected_version = ?, updated_at = ? WHERE id = ?").run(now, detection.detectedPath, detection.detectedVersion, now, runtimeId);
      ctx.eventBus.publish({
        id: randomUUID(),
        type: "runtime.detected",
        schemaVersion: 1,
        workspaceId: stringOrNull(existing.workspace_id) ?? "default-workspace",
        payload: { runtimeId, kind: String(existing.kind), name: String(existing.name), detectedPath: detection.detectedPath, detectedVersion: detection.detectedVersion },
        createdAt: now
      });
    })();
  }
  return json(ctx.res, 200, { runtime: get(ctx.database, "SELECT * FROM runtimes WHERE id = ?", runtimeId), changed });
}

async function testRuntime(ctx: RouteContext, runtimeId: string, input: Record<string, unknown>): Promise<void> {
  const runtime = get(ctx.database, "SELECT * FROM runtimes WHERE id = ?", runtimeId) as Record<string, unknown> | null;
  if (runtime === null) return json(ctx.res, 404, { error: "runtime_not_found" });
  if (input.async === true || input.slow === true) {
    const jobId = randomUUID();
    runtimeTestJobs.set(jobId, { status: "pending" });
    void runRuntimeTest(runtime).then(
      (result) => runtimeTestJobs.set(jobId, { status: result.ok ? "completed" : "failed", result }),
      (error: unknown) => runtimeTestJobs.set(jobId, { status: "failed", result: { ok: false, error: error instanceof Error ? error.message : "runtime test failed", latencyMs: 0 } })
    );
    return json(ctx.res, 202, { jobId });
  }
  const result = await runRuntimeTest(runtime);
  return json(ctx.res, 200, result);
}

async function runRuntimeDetection(runtime: Record<string, unknown>): Promise<{ readonly ok: true; readonly detectedPath: string | null; readonly detectedVersion: string | null } | { readonly ok: false; readonly error: string }> {
  if (runtime.kind === "native") return { ok: true, detectedPath: "agenthub-native", detectedVersion: "native" };
  const command = stringField(runtime.command);
  if (command === undefined) return { ok: false, error: "binary not found" };
  const args = parseStringArray(runtime.args);
  const env = parseEnv(runtime.env);
  const probe = await runCommandProbe(command, ["--version"], env);
  if (!probe.ok) {
    const fallback = await runCommandProbe(command, args, env);
    if (!fallback.ok) return { ok: false, error: fallback.error };
    return { ok: true, detectedPath: command, detectedVersion: firstOutputLine(fallback.output) };
  }
  return { ok: true, detectedPath: command, detectedVersion: firstOutputLine(probe.output) };
}

async function runRuntimeTest(runtime: Record<string, unknown>): Promise<RuntimeTestResult> {
  const started = Date.now();
  if (runtime.kind === "native") return { ok: true, version: stringOrNull(runtime.detected_version) ?? "native", latencyMs: Date.now() - started };
  const command = stringField(runtime.command);
  if (command === undefined) return { ok: false, error: "binary not found", latencyMs: Date.now() - started };
  const probe = await runCommandProbe(command, ["--version"], parseEnv(runtime.env));
  const latencyMs = Date.now() - started;
  if (!probe.ok) return { ok: false, error: probe.error, latencyMs };
  const version = firstOutputLine(probe.output) ?? stringOrNull(runtime.detected_version);
  return version === null ? { ok: true, latencyMs } : { ok: true, version, latencyMs };
}

async function runCommandProbe(command: string, args: readonly string[], env: Record<string, string>, timeoutMs = 4_000): Promise<{ readonly ok: true; readonly output: string } | { readonly ok: false; readonly error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    const child = spawn(command, args, { env: { ...process.env, ...env }, windowsHide: true });
    const finish = (result: { readonly ok: true; readonly output: string } | { readonly ok: false; readonly error: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: "runtime test timed out" });
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (chunk) => { output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk); });
    child.stderr.on("data", (chunk) => { output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk); });
    child.on("error", () => finish({ ok: false, error: "binary not found" }));
    child.on("close", (code) => finish(code === 0 ? { ok: true, output } : { ok: false, error: firstOutputLine(output) ?? `process exited ${code ?? "unknown"}` }));
  });
}

function firstOutputLine(output: string): string | null {
  const line = output.split(/\r?\n/u).map((part) => part.trim()).find((part) => part.length > 0);
  return line ?? null;
}

function parseStringArray(value: unknown): readonly string[] {
  const parsed = typeof value === "string" ? parseJsonField(value, []) : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseEnv(value: unknown): Record<string, string> {
  const parsed = typeof value === "string" ? parseJsonField(value, {}) : value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function authSession(ctx: RouteContext): void {
  const session = issueBrowserSession(ctx.database, ctx.now?.() ?? Date.now(), ctx.eventBus);
  ctx.res.setHeader("set-cookie", `agenthub_session=${session.sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
  json(ctx.res, 200, { csrfToken: session.csrfToken, expiresAt: session.expiresAt });
}

function issueAuthToken(ctx: RouteContext, input: Record<string, unknown>): void {
  const now = ctx.now?.() ?? Date.now();
  const token = `ah_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  const scopes = parseScopes(input.scopes);
  const expiresDays = typeof input.expiresDays === "number" && Number.isFinite(input.expiresDays) ? input.expiresDays : undefined;
  const expiresAt = expiresDays === undefined ? null : now + expiresDays * 86_400_000;
  const fingerprint = tokenFingerprint(token);
  ctx.database.sqlite.prepare("INSERT INTO auth_tokens (id, fingerprint, hash, description, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, fingerprint, sha256(token), typeof input.description === "string" ? input.description : null, JSON.stringify(scopes), now, expiresAt);
  ctx.eventBus.publish({ id: randomUUID(), type: "auth.token.issued", schemaVersion: 1, workspaceId: "default-workspace", payload: { tokenId: id, fingerprint, scopes }, createdAt: now });
  json(ctx.res, 201, { id, token, fingerprint, scopes, expiresAt });
}

function listAuthTokens(ctx: RouteContext): void {
  const tokens = all(ctx.database, "SELECT id, fingerprint, description, scopes, created_at, expires_at, last_used_at, revoked_at FROM auth_tokens ORDER BY created_at DESC").map((token) => {
    const row = token as { readonly id: string; readonly fingerprint: string; readonly description: string | null; readonly scopes: string; readonly created_at: number; readonly expires_at: number | null; readonly last_used_at: number | null; readonly revoked_at: number | null };
    return { id: row.id, fingerprint: row.fingerprint, description: row.description, scopes: JSON.parse(row.scopes) as unknown, createdAt: row.created_at, expiresAt: row.expires_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at };
  });
  json(ctx.res, 200, { tokens });
}

function revokeToken(ctx: RouteContext, tokenId: string): void {
  const now = ctx.now?.() ?? Date.now();
  const existing = get(ctx.database, "SELECT id, fingerprint FROM auth_tokens WHERE id = ?", tokenId) as { readonly id: string; readonly fingerprint: string } | null;
  if (existing === null) return json(ctx.res, 404, { error: "token_not_found" });
  ctx.database.sqlite.prepare("UPDATE auth_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now, tokenId);
  ctx.eventBus.publish({ id: randomUUID(), type: "auth.token.revoked", schemaVersion: 1, workspaceId: "default-workspace", payload: { tokenId, fingerprint: existing.fingerprint }, createdAt: now });
  json(ctx.res, 200, { ok: true });
}

function costSummary(ctx: RouteContext, workspaceId: string, url: URL): void {
  if (get(ctx.database, "SELECT id FROM workspaces WHERE id = ?", workspaceId) === null) return json(ctx.res, 404, { error: "workspace_not_found" });
  const groupBy = costGroupBy(url.searchParams.get("groupBy"));
  const now = ctx.now?.() ?? Date.now();
  const to = numberQuery(url, "to") ?? now;
  const from = numberQuery(url, "from") ?? to - 7 * 86_400_000;
  const groupExpression = groupBy === "agent" ? "agent_id" : groupBy === "model" ? "COALESCE(model_id, 'unknown')" : "strftime('%Y-%m-%d', ended_at / 1000, 'unixepoch', 'localtime')";
  const rows = all(ctx.database, `SELECT ${groupExpression} AS key, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(cached_tokens), 0) AS cachedTokens, COALESCE(SUM(cost_usd), 0) AS costUsd, COUNT(*) AS runCount FROM runs WHERE workspace_id = ? AND ended_at BETWEEN ? AND ? GROUP BY ${groupExpression} ORDER BY key ASC`, workspaceId, from, to) as CostRow[];
  const groups = rows.map(normalizeCostRow);
  const total = groups.reduce((acc, row) => ({ inputTokens: acc.inputTokens + row.inputTokens, outputTokens: acc.outputTokens + row.outputTokens, cachedTokens: acc.cachedTokens + row.cachedTokens, costUsd: acc.costUsd + row.costUsd, runCount: acc.runCount + row.runCount }), zeroCost());
  json(ctx.res, 200, { groupBy, from, to, groups, total });
}

function workspace(ctx: RouteContext, workspaceId: string): void {
  const row = get(ctx.database, "SELECT * FROM workspaces WHERE id = ?", workspaceId) as Record<string, unknown> | null;
  if (row === null) return json(ctx.res, 404, { error: "workspace_not_found" });
  json(ctx.res, 200, { workspace: row });
}

async function attachments(ctx: RouteContext): Promise<void> {
  const contentLength = Number(header(ctx, "content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > attachmentMaxBytes) return json(ctx.res, 413, { error: "attachment_too_large", maxBytes: attachmentMaxBytes });
  const parsed = await multipartFile(ctx);
  if (!parsed.ok) return json(ctx.res, parsed.status, parsed.body);
  const result = storeAttachment({ database: ctx.database, workspaceRoot: process.cwd(), originalName: parsed.file.originalName, mimeType: parsed.file.mimeType, bytes: parsed.file.bytes, now: ctx.now?.() ?? Date.now() });
  if (!result.ok) return json(ctx.res, result.status, result.error === "attachment_too_large" ? { error: result.error, maxBytes: result.maxBytes } : result.error === "attachment_mime_not_allowed" ? { error: result.error, mime: result.mime } : { error: result.error });
  return json(ctx.res, 200, result);
}

function artifacts(ctx: RouteContext, url: URL): void {
  const roomId = url.searchParams.get("roomId") ?? undefined;
  const taskId = url.searchParams.get("taskId") ?? undefined;
  const statusParam = url.searchParams.get("status");
  const status = statusParam === null ? undefined : statusParam.split(",").filter(Boolean) as NonNullable<Parameters<ArtifactService["list"]>[0]>["status"];
  json(ctx.res, 200, { artifacts: ctx.artifactService.list({ ...(roomId !== undefined ? { roomId } : {}), ...(taskId !== undefined ? { taskId } : {}), ...(status !== undefined ? { status } : {}) }) });
}

function tasks(ctx: RouteContext, roomId: string, url: URL): void {
  const runId = url.searchParams.get("runId") ?? undefined;
  json(ctx.res, 200, { tasks: ctx.taskService.list({ roomId, ...(runId !== undefined ? { runId } : {}) }) });
}

function taskActivities(ctx: RouteContext, taskId: string): void {
  const task = get(ctx.database, "SELECT id FROM tasks WHERE id = ?", taskId);
  if (task === null) return json(ctx.res, 404, { error: "task_not_found" });
  const activities = all(ctx.database, "SELECT * FROM task_activities WHERE task_id = ? ORDER BY created_at DESC, id DESC", taskId);
  json(ctx.res, 200, { activities });
}

function interventions(ctx: RouteContext, url: URL): void {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const [column, param] of [["room_id", "roomId"], ["status", "status"]] as const) {
    const value = url.searchParams.get(param);
    if (value !== null) {
      clauses.push(`${column} = ?`);
      params.push(value);
    }
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  json(ctx.res, 200, { interventions: all(ctx.database, `SELECT * FROM interventions${where} ORDER BY created_at ASC`, ...params) });
}

function debugEvents(ctx: RouteContext, url: URL, auth: BrowserAuthResult & { readonly ok: true }): void {
  // Spec: local loopback (authKind=local) or admin bearer may access /debug/events.
  // Browser session or non-admin bearer → 403 debug_disabled.
  if (auth.authKind !== "local" && !auth.scopes.includes("admin")) {
    return json(ctx.res, 403, { error: "debug_disabled" });
  }
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const [column, param] of [["trace_id", "traceId"], ["run_id", "runId"], ["room_id", "roomId"], ["type", "type"]] as const) {
    const value = url.searchParams.get(param);
    if (value !== null) {
      clauses.push(`${column} = ?`);
      params.push(value);
    }
  }
  const since = numberQuery(url, "since");
  const until = numberQuery(url, "until");
  if (since !== undefined) { clauses.push("created_at >= ?"); params.push(since); }
  if (until !== undefined) { clauses.push("created_at <= ?"); params.push(until); }
  const limit = Math.min(Math.max(numberQuery(url, "limit") ?? 100, 1), 1000);
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  json(ctx.res, 200, { events: all(ctx.database, `SELECT * FROM events${where} ORDER BY created_at ASC, seq ASC LIMIT ?`, ...params, limit) });
}

function debugStats(ctx: RouteContext, auth: BrowserAuthResult & { readonly ok: true }): void {
  const now = Date.now();
  // Spec: local loopback or admin bearer → full stats; browser session → basic health only (no PII).
  const isDebugAllowed = auth.authKind === "local" || auth.scopes.includes("admin");
  if (!isDebugAllowed) {
    return json(ctx.res, 200, {
      uptimeMs: Math.floor(process.uptime() * 1000),
      roomCount: scalar(ctx.database, "SELECT COUNT(*) AS count FROM rooms WHERE archived_at IS NULL"),
      activeRunCount: scalar(ctx.database, "SELECT COUNT(*) AS count FROM runs WHERE status IN ('queued', 'running', 'waiting_permission')"),
      pendingPermissionCount: scalar(ctx.database, "SELECT COUNT(*) AS count FROM permission_requests WHERE status = 'pending'"),
      pendingInterventionCount: scalar(ctx.database, "SELECT COUNT(*) AS count FROM interventions WHERE status = 'pending_user_decision'"),
      sseClientCount: 0
    });
  }
  json(ctx.res, 200, {
    uptimeMs: Math.floor(process.uptime() * 1000),
    roomCount: scalar(ctx.database, "SELECT COUNT(*) AS count FROM rooms WHERE archived_at IS NULL"),
    activeRunCount: scalar(ctx.database, "SELECT COUNT(*) AS count FROM runs WHERE status IN ('queued', 'running', 'waiting_permission')"),
    pendingPermissionCount: scalar(ctx.database, "SELECT COUNT(*) AS count FROM permission_requests WHERE status = 'pending'"),
    pendingInterventionCount: scalar(ctx.database, "SELECT COUNT(*) AS count FROM interventions WHERE status = 'pending_user_decision'"),
    eventsLast5min: scalar(ctx.database, "SELECT COUNT(*) AS count FROM events WHERE created_at >= ?", now - 5 * 60 * 1000),
    sseClientCount: 0,
    pubsub: ctx.eventBus.pubSubStats()
  });
}

function requireScope(auth: BrowserAuthResult & { readonly ok: true }, scope: "read" | "write" | "admin", res: ServerResponse): boolean {
  if (auth.scopes.includes(scope) || (scope !== "admin" && auth.scopes.includes("admin"))) return true;
  json(res, 403, { error: `requires_${scope}_scope` });
  return false;
}

function permissionRequests(ctx: RouteContext, url: URL): void {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const [column, param] of [["status", "status"], ["room_id", "roomId"]] as const) {
    const value = url.searchParams.get(param);
    if (value !== null) {
      clauses.push(`${column} = ?`);
      params.push(value);
    }
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  json(ctx.res, 200, { requests: all(ctx.database, `SELECT * FROM permission_requests${where} ORDER BY created_at ASC`, ...params) });
}

function contextItems(ctx: RouteContext, url: URL): void {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const [column, param] of [["workspace_id", "workspaceId"], ["room_id", "roomId"], ["task_id", "taskId"], ["status", "status"]] as const) {
    const value = url.searchParams.get(param);
    if (value !== null) {
      clauses.push(`${column} = ?`);
      params.push(value);
    }
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  json(ctx.res, 200, { items: all(ctx.database, `SELECT * FROM context_items${where} ORDER BY updated_at DESC, id ASC`, ...params) });
}

function messages(ctx: RouteContext, url: URL, roomIdOverride?: string): void {
  const roomId = roomIdOverride ?? url.searchParams.get("roomId") ?? undefined;
  if (roomId === undefined) return json(ctx.res, 400, { error: "roomId is required" });
  const limit = Math.min(Math.max(numberQuery(url, "limit") ?? 50, 1), 200);
  const includeDeleted = url.searchParams.get("includeDeleted") === "true";
  // Spec accepts `cursor` as an opaque base64 token meaning "give me the next page"; alias it to
  // `after` (forward pagination, default for chat history). `before` / `after` remain accepted
  // for callers that know which direction they want.
  const cursor = cursorParam(url.searchParams.get("cursor"));
  const before = cursorParam(url.searchParams.get("before"));
  const after = cursorParam(url.searchParams.get("after")) ?? cursor;
  const clauses = ["room_id = ?"];
  const params: unknown[] = [roomId];
  if (!includeDeleted) clauses.push("deleted_at IS NULL");
  if (before !== undefined) { clauses.push("(created_at < ? OR (created_at = ? AND id < ?))"); params.push(before.createdAt, before.createdAt, before.id); }
  if (after !== undefined) { clauses.push("(created_at > ? OR (created_at = ? AND id > ?))"); params.push(after.createdAt, after.createdAt, after.id); }
  const rows = all(ctx.database, `SELECT * FROM messages WHERE ${clauses.join(" AND ")} ORDER BY created_at ASC, id ASC LIMIT ?`, ...params, limit) as Array<{ readonly id: string; readonly created_at: number }>;
  const enriched = rows.map((row) => attachMessageText(ctx, row));
  const last = rows.length > 0 ? rows[rows.length - 1]! : undefined;
  const first = rows.length > 0 ? rows[0]! : undefined;
  const hasMore = rows.length === limit;
  // `nextCursor` is preserved for older clients; new clients should read `cursor: { before, after }`.
  const nextCursor = hasMore && last !== undefined ? encodeCursor(last) : null;
  json(ctx.res, 200, {
    messages: enriched,
    nextCursor,
    hasMore,
    cursor: {
      ...(hasMore && last !== undefined ? { after: encodeCursor(last) } : {}),
      ...(first !== undefined ? { before: encodeCursor(first) } : {})
    }
  });
}

/**
 * Hydrate a raw `messages` row with its `message_parts` so callers see the actual text content
 * without a follow-up round trip. Concatenates all `text` and `code` parts in seq order; keeps
 * non-text parts as-is in the `parts` array.
 */
function attachMessageText(ctx: RouteContext, row: { readonly id: string }): unknown {
  const parts = all(
    ctx.database,
    "SELECT seq, part_type, payload FROM message_parts WHERE message_id = ? ORDER BY seq ASC",
    row.id
  ) as Array<{ readonly seq: number; readonly part_type: string; readonly payload: string }>;
  const decoded = parts.map((part) => {
    let payload: unknown;
    try { payload = JSON.parse(part.payload); } catch { payload = part.payload; }
    return { seq: part.seq, type: part.part_type, payload };
  });
  const textChunks = decoded
    .filter((part) => part.type === "text" || part.type === "code")
    .map((part) => {
      const p = part.payload as { text?: unknown };
      return typeof p?.text === "string" ? p.text : "";
    })
    .filter((t) => t.length > 0);
  return { ...row, text: textChunks.join("\n"), parts: decoded };
}

function cursorParam(value: string | null): { readonly createdAt: number; readonly id: string } | undefined {
  if (value === null || value.length === 0) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { readonly createdAt?: unknown; readonly id?: unknown };
    return typeof parsed.createdAt === "number" && typeof parsed.id === "string" ? { createdAt: parsed.createdAt, id: parsed.id } : undefined;
  } catch {
    return undefined;
  }
}

function encodeCursor(row: { readonly created_at: number; readonly id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id }), "utf8").toString("base64url");
}

/**
 * Permission profile rows store `payload` as a JSON-encoded string in SQLite. Frontends expect
 * a parsed object so they don't have to JSON.parse a second time. Tolerates non-JSON payloads
 * (returns the raw string) so legacy or hand-edited rows don't break the endpoint.
 */
function decodeProfilePayload(row: Record<string, unknown>): Record<string, unknown> {
  const raw = row.payload;
  if (typeof raw !== "string") return row;
  try {
    return { ...row, payload: JSON.parse(raw) };
  } catch {
    return row;
  }
}

function permissionRules(ctx: RouteContext, url: URL): void {
  const workspaceId = url.searchParams.get("workspaceId");
  if (workspaceId === null) return json(ctx.res, 200, { rules: all(ctx.database, "SELECT * FROM permission_rules ORDER BY created_at ASC") });
  return json(ctx.res, 200, { rules: all(ctx.database, "SELECT * FROM permission_rules WHERE workspace_id = ? ORDER BY created_at ASC", workspaceId) });
}

function roles(ctx: RouteContext, url: URL): void {
  const workspaceId = url.searchParams.get("workspaceId") ?? "default-workspace";
   json(ctx.res, 200, all(
     ctx.database,
     `SELECT *
      FROM roles
      WHERE (workspace_id IS NULL OR workspace_id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM agent_profiles
          WHERE agent_profiles.id = roles.id
            AND roles.is_builtin = 0
        )
      ORDER BY is_builtin DESC, name ASC`,
     workspaceId
   ).map((row) => normalizeRoleRow(row as Record<string, unknown>)));
}

function createRole(ctx: RouteContext, input: Record<string, unknown>): void {
  const now = ctx.now?.() ?? Date.now();
  const workspaceId = stringField(input["workspaceId"]) ?? "default-workspace";
  const name = stringField(input["name"]);
  const prompt = stringField(input["prompt"]);
  if (name === undefined || prompt === undefined) return json(ctx.res, 400, { error: "validation_failed", message: "name and prompt are required" });
  const capabilitiesInput = normalizeCapabilitiesInput(input["capabilities"]);
  if (Array.isArray(capabilitiesInput)) {
    const invalidToken = capabilitiesInput.find((token): token is string => typeof token === "string" && !WELL_KNOWN_CAPABILITY_TOKENS.has(token));
    if (invalidToken !== undefined) return json(ctx.res, 400, { error: "unknown_capability_token", token: invalidToken });
  }
  const roleId = randomUUID();
  const role = roleRow({ id: roleId, workspaceId, name, prompt, input: { ...input, capabilities: capabilitiesInput }, now });
  const generationJobId = stringField(input["generationJobId"]);
  ctx.database.sqlite.transaction(() => {
    ctx.database.sqlite.prepare("INSERT INTO roles (id, workspace_id, name, avatar, description, prompt, capabilities, default_permission_profile_id, tags, is_builtin, source_path, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(role.id, role.workspace_id, role.name, role.avatar, role.description, role.prompt, role.capabilities, role.default_permission_profile_id, role.tags, role.is_builtin, role.source_path, role.version, role.created_at, role.updated_at);
    ctx.eventBus.publish({ id: randomUUID(), type: "role.created", schemaVersion: 1, workspaceId, payload: { roleId, workspaceId, ...(generationJobId !== undefined ? { source: "ai_generated", generationJobId } : {}) }, createdAt: now });
  })();
  json(ctx.res, 201, normalizeRoleRow(role));
}

function createRoleGenerationJob(ctx: RouteContext, input: Record<string, unknown>): void {
  const now = ctx.now?.() ?? Date.now();
  const jobId = stringField(input["jobId"]) ?? randomUUID();
  const description = stringField(input["description"]);
  const modelConfigId = stringField(input["modelConfigId"]);
  const targetWork = stringField(input["targetWork"]);
  const preferredTone = stringField(input["preferredTone"]);
  const capabilities = Array.isArray(input["capabilities"]) ? JSON.stringify(input["capabilities"].filter((value): value is string => typeof value === "string")) : null;
  if (description === undefined || modelConfigId === undefined) return json(ctx.res, 400, { error: "validation_failed", message: "description and modelConfigId are required" });
  const createdAt = now;
  const expiresAt = createdAt + 7 * 24 * 60 * 60 * 1000;
  ctx.database.sqlite.transaction(() => {
    ctx.database.sqlite.prepare("INSERT INTO role_drafts (job_id, description, target_work, preferred_tone, capabilities, model_config_id, draft_json, status, failure_reason, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(jobId, description, targetWork, preferredTone, capabilities, modelConfigId, null, "pending", null, createdAt, createdAt, expiresAt);
  })();
  void runRoleGenerationJob(ctx, jobId, modelConfigId);
  json(ctx.res, 202, { jobId });
}

function getRoleGenerationJob(ctx: RouteContext, jobId: string): void {
  const row = get(ctx.database, "SELECT * FROM role_drafts WHERE job_id = ?", jobId) as Record<string, unknown> | null;
  if (row === null) return json(ctx.res, 404, { error: "role_generation_job_not_found" });
  return json(ctx.res, 200, roleGenerationJobResponse(row));
}

function cancelRoleGenerationJob(ctx: RouteContext, jobId: string): void {
  const row = get(ctx.database, "SELECT * FROM role_drafts WHERE job_id = ?", jobId) as Record<string, unknown> | null;
  if (row === null) return json(ctx.res, 404, { error: "role_generation_job_not_found" });
  ctx.database.sqlite.transaction(() => {
    ctx.database.sqlite.prepare("DELETE FROM role_drafts WHERE job_id = ?").run(jobId);
  })();
  json(ctx.res, 200, { ok: true });
}

async function runRoleGenerationJob(ctx: RouteContext, jobId: string, modelConfigId: string): Promise<void> {
  await Promise.resolve();
  const startRow = get(ctx.database, "SELECT * FROM role_drafts WHERE job_id = ?", jobId) as Record<string, unknown> | null;
  if (startRow === null) return;
  const now = ctx.now?.() ?? Date.now();
  ctx.database.sqlite.transaction(() => {
    ctx.database.sqlite.prepare("UPDATE role_drafts SET status = ?, updated_at = ? WHERE job_id = ?").run("streaming", now, jobId);
  })();
  try {
    await Promise.resolve();
    const current = get(ctx.database, "SELECT * FROM role_drafts WHERE job_id = ?", jobId) as Record<string, unknown> | null;
    if (current === null) return;
    const modelConfig = get(ctx.database, "SELECT * FROM model_configs WHERE id = ?", modelConfigId) as Record<string, unknown> | null;
    if (modelConfig === null) throw new Error("model_config_not_found");
    const draftJson = await buildRoleDraft(ctx, current, modelConfig);
    const completedAt = ctx.now?.() ?? Date.now();
    ctx.database.sqlite.transaction(() => {
      ctx.database.sqlite.prepare("UPDATE role_drafts SET draft_json = ?, status = ?, failure_reason = NULL, updated_at = ? WHERE job_id = ?").run(JSON.stringify(draftJson), "completed", completedAt, jobId);
    })();
  } catch (error) {
    const failedAt = ctx.now?.() ?? Date.now();
    const failureReason = roleGenerationFailureReason(error);
    finalizeFailedRoleGenerationJob(ctx, jobId, failureReason, failedAt);
  }
}

export function finalizeFailedRoleGenerationJob(ctx: RouteContext, jobId: string, failureReason: string, failedAt: number): void {
  ctx.database.sqlite.transaction(() => {
    const current = get(ctx.database, "SELECT status FROM role_drafts WHERE job_id = ?", jobId) as Record<string, unknown> | null;
    if (current === null) return;
    if (String(current.status) === "cancelled") return;
    ctx.database.sqlite.prepare("UPDATE role_drafts SET status = ?, failure_reason = ?, updated_at = ? WHERE job_id = ?").run("failed", failureReason, failedAt, jobId);
  })();
}

async function buildRoleDraft(ctx: RouteContext, row: Record<string, unknown>, modelConfig: Record<string, unknown>): Promise<RoleDraft> {
  const description = stringField(row.description) ?? "AI generated role";
  const preferredTone = stringOrNull(row.preferred_tone);
  const targetWork = stringOrNull(row.target_work);
  const capabilities = parseJsonField(row.capabilities, []) as unknown[];
  const normalizedCapabilities = capabilities.filter((value): value is string => typeof value === "string");
  const provider = stringField(modelConfig.provider) ?? "openai";
  const apiKey = provider === "ollama" ? null : await resolveModelConfigApiKey(ctx, modelConfig);
  return ctx.roleDraftGenerator({
    modelConfig: modelConfigForGeneration(modelConfig),
    ...(apiKey !== null ? { apiKey } : {}),
    request: {
      description,
      targetWork,
      preferredTone,
      capabilities: normalizedCapabilities
    }
  });
}

function roleGenerationFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message === "model_config_not_found") return "model_config_not_found";
  if (message === "json_parse_failure") return "json_parse_failure";
  if (message === "invalid_api_key") return "invalid_api_key";
  const normalized = message.toLowerCase();
  if (normalized.includes("json") && (normalized.includes("parse") || normalized.includes("malformed") || normalized.includes("invalid"))) return "json_parse_failure";
  if (normalized.includes("api key") || normalized.includes("unauthorized") || normalized.includes("401")) return "invalid_api_key";
  return message.trim().length > 0 ? message : "role_generation_failed";
}

function roleGenerationJobResponse(row: Record<string, unknown>): Record<string, unknown> {
  const status = String(row.status);
  const response: Record<string, unknown> = {
    jobId: String(row.job_id),
    status,
    description: row.description,
    targetWork: row.target_work,
    preferredTone: row.preferred_tone,
    capabilities: parseJsonField(row.capabilities, []),
    modelConfigId: row.model_config_id,
    failureReason: row.failure_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at
  };
  if (status === "pending" || status === "streaming" || status === "completed") response.draftJson = parseJsonField(row.draft_json, null);
  return response;
}

function modelConfigForGeneration(row: Record<string, unknown>): ModelConfigRow {
  return {
    id: stringField(row.id) ?? "",
    provider: stringField(row.provider) ?? "openai",
    model: stringField(row.model) ?? "",
    base_url: stringOrNull(row.base_url),
    api_key_ref: stringOrNull(row.api_key_ref)
  };
}

function updateRole(ctx: RouteContext, roleId: string, input: Record<string, unknown>): void {
  const existing = get(ctx.database, "SELECT * FROM roles WHERE id = ?", roleId) as Record<string, unknown> | null;
  if (existing === null) return json(ctx.res, 404, { error: "role_not_found" });
  const now = ctx.now?.() ?? Date.now();
  const workspaceId = stringField(input["workspaceId"]) ?? stringField(existing["workspace_id"]) ?? "default-workspace";
  const capabilitiesInput = normalizeCapabilitiesInput(input["capabilities"]);
  if (Array.isArray(capabilitiesInput)) {
    const invalidToken = capabilitiesInput.find((token): token is string => typeof token === "string" && !WELL_KNOWN_CAPABILITY_TOKENS.has(token));
    if (invalidToken !== undefined) return json(ctx.res, 400, { error: "unknown_capability_token", token: invalidToken });
  }
  const role = roleRow({ id: roleId, workspaceId, name: stringField(input["name"]) ?? stringField(existing["name"]) ?? "", prompt: stringField(input["prompt"]) ?? stringField(existing["prompt"]) ?? "", input: { ...input, capabilities: capabilitiesInput }, existing, now });
  ctx.database.sqlite.transaction(() => {
    ctx.database.sqlite.prepare("UPDATE roles SET workspace_id = ?, name = ?, avatar = ?, description = ?, prompt = ?, capabilities = ?, default_permission_profile_id = ?, tags = ?, is_builtin = ?, source_path = ?, version = ?, updated_at = ? WHERE id = ?").run(role.workspace_id, role.name, role.avatar, role.description, role.prompt, role.capabilities, role.default_permission_profile_id, role.tags, role.is_builtin, role.source_path, role.version, role.updated_at, roleId);
    ctx.eventBus.publish({ id: randomUUID(), type: "role.updated", schemaVersion: 1, workspaceId, payload: { roleId, workspaceId }, createdAt: now });
  })();
  json(ctx.res, 200, normalizeRoleRow(get(ctx.database, "SELECT * FROM roles WHERE id = ?", roleId) as Record<string, unknown>));
}

function deleteRole(ctx: RouteContext, roleId: string): void {
  const existing = get(ctx.database, "SELECT * FROM roles WHERE id = ?", roleId) as Record<string, unknown> | null;
  if (existing === null) return json(ctx.res, 404, { error: "role_not_found" });
  const now = ctx.now?.() ?? Date.now();
  const workspaceId = stringField(existing["workspace_id"]) ?? "default-workspace";
  const bindingCount = scalar(ctx.database, "SELECT COUNT(*) AS count FROM agent_bindings WHERE role_id = ?", roleId);
  if (bindingCount > 0) return json(ctx.res, 409, { error: "role_has_bindings", bindingCount });
  ctx.database.sqlite.transaction(() => {
    ctx.database.sqlite.prepare("DELETE FROM roles WHERE id = ?").run(roleId);
    ctx.eventBus.publish({ id: randomUUID(), type: "role.deleted", schemaVersion: 1, workspaceId, payload: { roleId, workspaceId }, createdAt: now });
  })();
  json(ctx.res, 200, { ok: true });
}

function agentBindings(ctx: RouteContext, url: URL): void {
  const workspaceId = url.searchParams.get("workspaceId");
  const rows = all(
    ctx.database,
    `SELECT
      agent_bindings.*,
      roles.id AS role__id,
      roles.name AS role__name,
      roles.avatar AS role__avatar,
      runtimes.id AS runtime__id,
      runtimes.kind AS runtime__kind,
      runtimes.name AS runtime__name,
      runtimes.detected_version AS runtime__detected_version,
      model_configs.id AS model_config__id,
      model_configs.name AS model_config__name,
      model_configs.provider AS model_config__provider,
      model_configs.model AS model_config__model,
      model_configs.api_key_fingerprint AS model_config__api_key_fingerprint
    FROM agent_bindings
    LEFT JOIN roles ON roles.id = agent_bindings.role_id
    LEFT JOIN runtimes ON runtimes.id = agent_bindings.runtime_id
    LEFT JOIN model_configs ON model_configs.id = agent_bindings.model_config_id
    ${workspaceId === null ? "" : "WHERE agent_bindings.workspace_id = ?"}
    ORDER BY agent_bindings.created_at ASC`,
    ...(workspaceId === null ? [] : [workspaceId])
  ).map((row) => normalizeAgentBindingRow(row as Record<string, unknown>));
  json(ctx.res, 200, { agentBindings: rows });
}

function agentBinding(ctx: RouteContext, bindingId: string): void {
  const row = get(
    ctx.database,
    `SELECT
      agent_bindings.*,
      roles.id AS role__id,
      roles.name AS role__name,
      roles.avatar AS role__avatar,
      runtimes.id AS runtime__id,
      runtimes.kind AS runtime__kind,
      runtimes.name AS runtime__name,
      runtimes.detected_version AS runtime__detected_version,
      model_configs.id AS model_config__id,
      model_configs.name AS model_config__name,
      model_configs.provider AS model_config__provider,
      model_configs.model AS model_config__model,
      model_configs.api_key_fingerprint AS model_config__api_key_fingerprint
    FROM agent_bindings
    LEFT JOIN roles ON roles.id = agent_bindings.role_id
    LEFT JOIN runtimes ON runtimes.id = agent_bindings.runtime_id
    LEFT JOIN model_configs ON model_configs.id = agent_bindings.model_config_id
    WHERE agent_bindings.id = ?`,
    bindingId
  ) as Record<string, unknown> | null;
  if (row === null) return json(ctx.res, 404, { error: "agent_binding_not_found" });
  return json(ctx.res, 200, { agentBinding: normalizeAgentBindingRow(row) });
}

function createAgentBinding(ctx: RouteContext, input: Record<string, unknown>): void {
  const now = ctx.now?.() ?? Date.now();
  const id = stringField(input["id"]) ?? randomUUID();
  const workspaceId = stringField(input["workspaceId"]);
  const roleId = stringField(input["roleId"]);
  const runtimeId = stringField(input["runtimeId"]);
  const modelConfigId = stringField(input["modelConfigId"]);
  const overridePermissionProfileId = stringField(input["overridePermissionProfileId"]);
  if (roleId === undefined || runtimeId === undefined) return json(ctx.res, 400, { error: "validation_failed", message: "roleId and runtimeId are required" });
  const role = get(ctx.database, "SELECT * FROM roles WHERE id = ?", roleId) as Record<string, unknown> | null;
  if (role === null) return json(ctx.res, 404, { error: "role_not_found" });
  const runtime = get(ctx.database, "SELECT * FROM runtimes WHERE id = ?", runtimeId) as Record<string, unknown> | null;
  if (runtime === null) return json(ctx.res, 404, { error: "runtime_not_found" });
  if (String(runtime.kind) === "native" && modelConfigId === undefined) return json(ctx.res, 400, { error: "native_runtime_requires_model_config" });
  const modelConfig = modelConfigId === undefined ? null : get(ctx.database, "SELECT * FROM model_configs WHERE id = ?", modelConfigId) as Record<string, unknown> | null;
  if (modelConfigId !== undefined && modelConfig === null) return json(ctx.res, 404, { error: "model_config_not_found" });
  const binding = agentBindingRow({
    id,
    workspaceId: workspaceId ?? stringField(role.workspace_id) ?? stringField(runtime.workspace_id) ?? stringField(modelConfig?.workspace_id) ?? null,
    role,
    runtime,
    modelConfig,
    overridePermissionProfileId,
    now
  });
  ctx.database.sqlite.transaction(() => {
    ctx.database.sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(binding.id, binding.workspace_id, binding.role_id, binding.runtime_id, binding.model_config_id, binding.override_permission_profile_id, binding.created_at, binding.updated_at);
    ctx.eventBus.publish({ id: randomUUID(), type: "agent_binding.created", schemaVersion: 1, workspaceId: binding.workspace_id ?? "default-workspace", payload: { bindingId: binding.id, roleId: binding.role_id, runtimeId: binding.runtime_id, modelConfigId: binding.model_config_id, workspaceId: binding.workspace_id }, createdAt: now });
  })();
  json(ctx.res, 201, { agentBinding: agentBindingResponse(binding, role, runtime, modelConfig) });
}

function updateAgentBinding(ctx: RouteContext, bindingId: string, input: Record<string, unknown>): void {
  const existing = get(ctx.database, "SELECT * FROM agent_bindings WHERE id = ?", bindingId) as Record<string, unknown> | null;
  if (existing === null) return json(ctx.res, 404, { error: "agent_binding_not_found" });
  const now = ctx.now?.() ?? Date.now();
  const roleId = stringField(input["roleId"]) ?? stringField(existing.role_id);
  const runtimeId = stringField(input["runtimeId"]) ?? stringField(existing.runtime_id);
  const hasModelConfigId = Object.prototype.hasOwnProperty.call(input, "modelConfigId");
  const hasOverridePermissionProfileId = Object.prototype.hasOwnProperty.call(input, "overridePermissionProfileId");
  const hasWorkspaceId = Object.prototype.hasOwnProperty.call(input, "workspaceId");
  const modelConfigId = hasModelConfigId ? (stringField(input["modelConfigId"]) ?? null) : stringField(existing.model_config_id);
  const overridePermissionProfileId = hasOverridePermissionProfileId ? stringField(input["overridePermissionProfileId"]) : stringField(existing.override_permission_profile_id);
  const workspaceId = hasWorkspaceId ? stringField(input["workspaceId"]) : stringField(existing.workspace_id);
  if (roleId === undefined || runtimeId === undefined) return json(ctx.res, 400, { error: "validation_failed", message: "roleId and runtimeId are required" });
  const role = get(ctx.database, "SELECT * FROM roles WHERE id = ?", roleId) as Record<string, unknown> | null;
  if (role === null) return json(ctx.res, 404, { error: "role_not_found" });
  const runtime = get(ctx.database, "SELECT * FROM runtimes WHERE id = ?", runtimeId) as Record<string, unknown> | null;
  if (runtime === null) return json(ctx.res, 404, { error: "runtime_not_found" });
  if (String(runtime.kind) === "native" && modelConfigId === null) return json(ctx.res, 400, { error: "native_runtime_requires_model_config" });
  const modelConfig = modelConfigId === null ? null : get(ctx.database, "SELECT * FROM model_configs WHERE id = ?", modelConfigId) as Record<string, unknown> | null;
  if (modelConfigId !== null && modelConfig === null) return json(ctx.res, 404, { error: "model_config_not_found" });
  const binding = agentBindingRow({
    id: bindingId,
    workspaceId: workspaceId ?? stringField(role.workspace_id) ?? stringField(runtime.workspace_id) ?? stringField(modelConfig?.workspace_id) ?? stringField(existing.workspace_id) ?? null,
    role,
    runtime,
    modelConfig,
    overridePermissionProfileId,
    now
  });
  ctx.database.sqlite.transaction(() => {
    ctx.database.sqlite.prepare("UPDATE agent_bindings SET workspace_id = ?, role_id = ?, runtime_id = ?, model_config_id = ?, override_permission_profile_id = ?, updated_at = ? WHERE id = ?").run(binding.workspace_id, binding.role_id, binding.runtime_id, binding.model_config_id, binding.override_permission_profile_id, binding.updated_at, bindingId);
    ctx.eventBus.publish({ id: randomUUID(), type: "agent_binding.updated", schemaVersion: 1, workspaceId: binding.workspace_id ?? "default-workspace", payload: { bindingId: binding.id, roleId: binding.role_id, runtimeId: binding.runtime_id, modelConfigId: binding.model_config_id, workspaceId: binding.workspace_id }, createdAt: now });
  })();
  json(ctx.res, 200, { agentBinding: agentBindingResponse(binding, role, runtime, modelConfig) });
}

function deleteAgentBinding(ctx: RouteContext, bindingId: string): void {
  const existing = get(ctx.database, "SELECT * FROM agent_bindings WHERE id = ?", bindingId) as Record<string, unknown> | null;
  if (existing === null) return json(ctx.res, 404, { error: "agent_binding_not_found" });
  const now = ctx.now?.() ?? Date.now();
  const participantCount = scalar(ctx.database, "SELECT COUNT(*) AS count FROM room_participants WHERE participant_id = ? OR agent_binding_id = ?", bindingId, bindingId);
  if (participantCount > 0) return json(ctx.res, 409, { error: "agent_binding_has_room_participants", participantCount });
  ctx.database.sqlite.transaction(() => {
    ctx.database.sqlite.prepare("DELETE FROM agent_bindings WHERE id = ?").run(bindingId);
    ctx.eventBus.publish({ id: randomUUID(), type: "agent_binding.removed", schemaVersion: 1, workspaceId: stringField(existing.workspace_id) ?? "default-workspace", payload: { bindingId, roleId: stringField(existing.role_id), runtimeId: stringField(existing.runtime_id), modelConfigId: stringField(existing.model_config_id), workspaceId: stringField(existing.workspace_id) }, createdAt: now });
  })();
  json(ctx.res, 200, { ok: true });
}

function agentBindingRow(options: { readonly id: string; readonly workspaceId: string | null; readonly role: Record<string, unknown>; readonly runtime: Record<string, unknown>; readonly modelConfig: Record<string, unknown> | null; readonly overridePermissionProfileId: string | undefined; readonly now: number }): { readonly id: string; readonly workspace_id: string | null; readonly role_id: string; readonly runtime_id: string; readonly model_config_id: string | null; readonly override_permission_profile_id: string | null; readonly created_at: number; readonly updated_at: number } {
  return {
    id: options.id,
    workspace_id: options.workspaceId,
    role_id: String(options.role.id),
    runtime_id: String(options.runtime.id),
    model_config_id: options.modelConfig !== null ? String(options.modelConfig.id) : null,
    override_permission_profile_id: options.overridePermissionProfileId ?? null,
    created_at: options.now,
    updated_at: options.now
  };
}

function agentBindingResponse(binding: { readonly id: string; readonly workspace_id: string | null; readonly role_id: string; readonly runtime_id: string; readonly model_config_id: string | null; readonly override_permission_profile_id: string | null; readonly created_at: number; readonly updated_at: number }, role: Record<string, unknown>, runtime: Record<string, unknown>, modelConfig: Record<string, unknown> | null): Record<string, unknown> {
  return {
    ...binding,
    role: { id: String(role.id), name: stringField(role.name) ?? "", avatar: stringOrNull(role.avatar) },
    runtime: { id: String(runtime.id), kind: stringField(runtime.kind) ?? "", name: stringField(runtime.name) ?? "", detectedVersion: stringOrNull(runtime.detected_version) },
    ...(modelConfig !== null ? { modelConfig: { id: String(modelConfig.id), name: stringField(modelConfig.name) ?? "", provider: stringField(modelConfig.provider) ?? "", model: stringField(modelConfig.model) ?? "", apiKeyFingerprint: stringOrNull(modelConfig.api_key_fingerprint) } } : {})
  };
}

function normalizeAgentBindingRow(row: Record<string, unknown>): Record<string, unknown> {
  const binding = {
    id: row.id,
    workspaceId: row.workspace_id,
    roleId: row.role_id,
    runtimeId: row.runtime_id,
    modelConfigId: row.model_config_id,
    overridePermissionProfileId: row.override_permission_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  const modelConfig = row.model_config__id !== null && row.model_config__id !== undefined
    ? { id: row.model_config__id, name: row.model_config__name, provider: row.model_config__provider, model: row.model_config__model, apiKeyFingerprint: row.model_config__api_key_fingerprint }
    : undefined;
  return {
    ...binding,
    role: { id: row.role__id, name: row.role__name, avatar: row.role__avatar },
    runtime: { id: row.runtime__id, kind: row.runtime__kind, name: row.runtime__name, detectedVersion: row.runtime__detected_version },
    ...(modelConfig !== undefined ? { modelConfig } : {})
  };
}

function roleRow(options: { readonly id: string; readonly workspaceId: string; readonly name: string; readonly prompt: string; readonly input: Record<string, unknown>; readonly now: number; readonly existing?: Record<string, unknown> }): { readonly id: string; readonly workspace_id: string; readonly name: string; readonly avatar: string | null; readonly description: string | null; readonly prompt: string; readonly capabilities: string; readonly default_permission_profile_id: string | null; readonly tags: string | null; readonly is_builtin: number; readonly source_path: string | null; readonly version: string | null; readonly created_at: number; readonly updated_at: number } {
  const existing = options.existing ?? {};
  return {
    id: options.id,
    workspace_id: options.workspaceId,
    name: options.name,
    avatar: stringOrNull(options.input["avatar"] ?? existing["avatar"]),
    description: stringOrNull(options.input["description"] ?? existing["description"]),
    prompt: options.prompt,
    capabilities: stringOrJson(options.input["capabilities"] ?? existing["capabilities"] ?? "[]", "[]"),
    default_permission_profile_id: stringOrNull(options.input["defaultPermissionProfileId"] ?? options.input["default_permission_profile_id"] ?? existing["default_permission_profile_id"]),
    tags: stringOrJson(options.input["tags"] ?? existing["tags"] ?? null, null),
    is_builtin: options.input["isBuiltin"] === true ? 1 : Number(existing["is_builtin"] ?? 0),
    source_path: stringOrNull(options.input["sourcePath"] ?? options.input["source_path"] ?? existing["source_path"]),
    version: stringOrNull(options.input["version"] ?? existing["version"]),
    created_at: Number(existing["created_at"] ?? options.now),
    updated_at: options.now
  };
}

function normalizeRoleRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    capabilities: parseJsonField(row["capabilities"], []),
    tags: parseJsonField(row["tags"], null)
  };
}

function parseJsonField(value: unknown, fallback: unknown): unknown {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function stringField(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 ? value : undefined; }
function stringOrNull(value: unknown): string | null { return typeof value === "string" ? value : null; }
function stringOrJson(value: unknown, fallback: string): string;
function stringOrJson(value: unknown, fallback: string | null): string | null;
function stringOrJson(value: unknown, fallback: string | null): string | null { if (value === undefined) return fallback; if (value === null) return null; return typeof value === "string" ? value : JSON.stringify(value); }

function normalizeCapabilitiesInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

async function dispatch(ctx: RouteContext, data: Record<string, unknown>, type: CommandType): Promise<void> {
  const result = await ctx.commandBus.dispatch({ ...data, type, idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : randomUUID() }, { actor: { type: "user", id: "local" }, traceId: randomUUID(), origin: "http" });
  await ctx.outbox.drainPending();
  json(ctx.res, result.ok ? 200 : statusForError(result.error.code), result);
}

async function dispatchCreated(ctx: RouteContext, data: Record<string, unknown>, type: CommandType): Promise<void> {
  const result = await ctx.commandBus.dispatch({ ...data, type, idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : randomUUID() }, { actor: { type: "user", id: "local" }, traceId: randomUUID(), origin: "http" });
  await ctx.outbox.drainPending();
  json(ctx.res, result.ok ? 201 : statusForError(result.error.code), result);
}

function statusForError(code: string): number { return code === "rate_limited" ? 429 : code === "conflict" ? 409 : code === "not_found" ? 404 : code === "permission_denied" ? 403 : 400; }
function currentCommandBus(ref: { readonly current?: CommandBus }): CommandBus { if (!ref.current) throw new Error("CommandBus is not initialized"); return ref.current; }
function currentRoomMcpServer(ref: { readonly current?: RoomMcpServer }): RoomMcpServer { if (!ref.current) throw new Error("RoomMcpServer is not initialized"); return ref.current; }

type MultipartFile = { readonly originalName: string; readonly mimeType: string; readonly bytes: Buffer };
type MultipartResult = { readonly ok: true; readonly file: MultipartFile } | { readonly ok: false; readonly status: 400 | 413 | 415; readonly body: Record<string, unknown> };

async function multipartFile(ctx: RouteContext): Promise<MultipartResult> {
  const type = header(ctx, "content-type") ?? "";
  const boundary = type.match(/multipart\/form-data\s*;\s*boundary=(?:(?:"([^"]+)")|([^;]+))/iu)?.[1] ?? type.match(/multipart\/form-data\s*;\s*boundary=(?:(?:"([^"]+)")|([^;]+))/iu)?.[2];
  if (boundary === undefined || boundary.length === 0) return { ok: false, status: 415, body: { error: "attachment_multipart_required" } };
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of ctx.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > attachmentMaxBytes) return { ok: false, status: 413, body: { error: "attachment_too_large", maxBytes: attachmentMaxBytes } };
    chunks.push(buffer);
  }
  return parseMultipart(Buffer.concat(chunks), boundary.trim());
}

function parseMultipart(body: Buffer, boundary: string): MultipartResult {
  const delimiter = Buffer.from(`--${boundary}`);
  const files: MultipartFile[] = [];
  let position = body.indexOf(delimiter);
  while (position !== -1) {
    let partStart = position + delimiter.length;
    if (body.subarray(partStart, partStart + 2).toString("ascii") === "--") break;
    if (body.subarray(partStart, partStart + 2).toString("ascii") === "\r\n") partStart += 2;
    const next = body.indexOf(delimiter, partStart);
    if (next === -1) break;
    const rawPart = body.subarray(partStart, next - 2 >= partStart && body.subarray(next - 2, next).toString("ascii") === "\r\n" ? next - 2 : next);
    const split = rawPart.indexOf(Buffer.from("\r\n\r\n"));
    if (split !== -1) {
      const headers = parsePartHeaders(rawPart.subarray(0, split).toString("utf8"));
      const disposition = headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]*)"/iu)?.[1];
      if (filename !== undefined) files.push({ originalName: filename, mimeType: headers.get("content-type") ?? "", bytes: rawPart.subarray(split + 4) });
    }
    position = next;
  }
  if (files.length !== 1) return { ok: false, status: 400, body: { error: "attachment_single_file_required" } };
  return { ok: true, file: files[0] as MultipartFile };
}

function parsePartHeaders(value: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of value.split("\r\n")) {
    const index = line.indexOf(":");
    if (index > 0) headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }
  return headers;
}

function sse(ctx: RouteContext, url: URL, scopes: readonly string[]): void {
  const view = viewParam(url.searchParams.get("view"));
  if (view === "raw" && !scopes.includes("admin")) return json(ctx.res, 403, { error: "requires_admin_scope" });
  const roomId = url.searchParams.get("roomId") ?? undefined;
  const runId = url.searchParams.get("runId") ?? undefined;
  const filters = { view, ...(roomId !== undefined ? { roomId } : {}), ...(runId !== undefined ? { runId } : {}) };
  let closed = false;
  const sseState: {
    heartbeat?: ReturnType<typeof setInterval>;
    unsubscribe?: () => void;
    unregisterClient?: () => void;
  } = {};
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (sseState.heartbeat !== undefined) clearInterval(sseState.heartbeat);
    sseState.unsubscribe?.();
    sseState.unregisterClient?.();
  };
  const writeFrame = (frame: string) => {
    if (closed || ctx.res.destroyed || ctx.res.writableEnded) return;
    try {
      ctx.res.write(frame);
    } catch {
      cleanup();
    }
  };
  const send = (event: EventEnvelope) => {
    if (!visible(event, view, filters.roomId, filters.runId)) return;
    writeFrame(`${event.seq !== undefined ? `id: ${event.seq}\n` : ""}event: ${event.type}\ndata: ${redactAndTruncate(JSON.stringify(event), 64 * 1024)}\n\n`);
  };
  ctx.res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff"
  });
  // Force the response headers to flush immediately so EventSource's `open`
  // event fires without waiting for the first byte of body. Then disable
  // Nagle's algorithm on the underlying socket — without this, Node's TCP
  // stack batches small SSE writes and waits up to 200ms for an ACK before
  // flushing. When live events arrive at >1Hz the batching is invisible, but
  // when a single event arrives after a >5s idle gap (e.g. an agent is
  // thinking and finally emits `agent.run.started`) the write can sit in the
  // socket's send buffer indefinitely. Setting noDelay(true) makes each write
  // hit the wire immediately.
  if (typeof ctx.res.flushHeaders === "function") ctx.res.flushHeaders();
  if (ctx.res.socket && typeof (ctx.res.socket as { setNoDelay?: (v: boolean) => void }).setNoDelay === "function") {
    (ctx.res.socket as { setNoDelay: (v: boolean) => void }).setNoDelay(true);
  }
  writeFrame(": connected\n\n");
  const client: SseClient = {
    res: ctx.res,
    close: () => {
      writeFrame(`event: server.shutting_down\ndata: {"status":"shutting_down"}\n\n`);
      cleanup();
      if (!ctx.res.destroyed && !ctx.res.writableEnded) ctx.res.end();
    }
  };
  sseState.unregisterClient = ctx.registerSseClient(client);
  const cursor = Number(url.searchParams.get("cursor") ?? ctx.req.headers["last-event-id"] ?? 0);
  for (const event of ctx.eventBus.replayDurableSinceSeq(Number.isFinite(cursor) ? cursor : 0, filters)) send(event);
  sseState.unsubscribe = ctx.eventBus.subscribeAll(send);
  sseState.heartbeat = setInterval(() => writeFrame(": heartbeat\n\n"), 10_000);
  ctx.req.on("close", cleanup);
}

function visible(event: EventEnvelope, view: ReplayView, roomId?: string, runId?: string): boolean {
  if (roomId && event.roomId !== roomId) return false;
  if (runId && event.runId !== runId) return false;
  if (view === "main") return event.visibility === "main" || event.visibility === "both";
  if (view === "detail") return event.visibility === "detail" || event.visibility === "both";
  return event.type === "adapter.raw.stdout" || event.type === "adapter.raw.stderr";
}

function viewParam(value: string | null): ReplayView { return value === "main" || value === "raw" ? value : "detail"; }
function numberQuery(url: URL, key: string): number | undefined { const value = url.searchParams.get(key); if (value === null) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function isLoopbackHost(host: string): boolean { return host === "127.0.0.1" || host === "::1" || host === "localhost"; }
function authenticate(ctx: RouteContext, url: URL) {
  const authorization = typeof ctx.req.headers.authorization === "string" ? ctx.req.headers.authorization : url.searchParams.get("token") !== null ? `Bearer ${url.searchParams.get("token")}` : undefined;
  return authenticateBrowserRequest({ method: ctx.req.method ?? "GET", pathname: url.pathname, headers: { origin: header(ctx, "origin"), host: header(ctx, "host"), authorization, cookie: header(ctx, "cookie"), "content-type": header(ctx, "content-type"), "x-agenthub-csrf": header(ctx, "x-agenthub-csrf") }, database: ctx.database, ...(ctx.token !== undefined ? { token: ctx.token } : {}), host: ctx.host, ...(ctx.allowedOrigins !== undefined ? { allowedOrigins: ctx.allowedOrigins } : {}), now: ctx.now?.() ?? Date.now() });
}
function header(ctx: RouteContext, name: string): string | undefined { const value = ctx.req.headers[name]; return Array.isArray(value) ? value[0] : value; }
function all(database: AgentHubDatabase, sql: string, ...params: unknown[]): unknown[] { return database.sqlite.prepare(sql).all(...params); }
function get(database: AgentHubDatabase, sql: string, ...params: unknown[]): unknown { return database.sqlite.prepare(sql).get(...params) ?? null; }
function scalar(database: AgentHubDatabase, sql: string, ...params: unknown[]): number { const row = database.sqlite.prepare(sql).get(...params) as { readonly count: number } | undefined; return row?.count ?? 0; }
function json(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { "content-type": "application/json" }); res.end(redactAndTruncate(JSON.stringify(value), 64 * 1024)); }
async function body(ctx: RouteContext): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; for await (const chunk of ctx.req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); if (chunks.length === 0) return {}; return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }

type CostRow = { readonly key: string | null; readonly inputTokens: number | null; readonly outputTokens: number | null; readonly cachedTokens: number | null; readonly costUsd: number | null; readonly runCount: number };
type CostGroup = { readonly key: string; readonly inputTokens: number; readonly outputTokens: number; readonly cachedTokens: number; readonly costUsd: number; readonly runCount: number };
function normalizeCostRow(row: CostRow): CostGroup { return { key: row.key ?? "unknown", inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, cachedTokens: row.cachedTokens ?? 0, costUsd: row.costUsd ?? 0, runCount: row.runCount }; }
function zeroCost(): Omit<CostGroup, "key"> { return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, runCount: 0 }; }
function costGroupBy(value: string | null): "agent" | "model" | "day" { return value === "model" || value === "day" ? value : "agent"; }
function parseScopes(value: unknown): readonly string[] { const scopes = Array.isArray(value) ? value.filter((scope): scope is string => typeof scope === "string") : ["read", "write"]; const allowed = scopes.filter((scope) => scope === "read" || scope === "write" || scope === "admin"); return allowed.length > 0 ? [...new Set(allowed)] : ["read"]; }
function tokenFingerprint(token: string): string { return sha256(token).slice(0, 12); }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function modelConfigFingerprint(apiKey: string): string {
  if (apiKey.length <= 8) return apiKey;
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

function getModelConfig(database: AgentHubDatabase, id: string): Record<string, unknown> | null {
  const row = get(database, "SELECT * FROM model_configs WHERE id = ?", id) as Record<string, unknown> | null;
  return row === null ? null : normalizeModelConfigRow(row);
}

async function testModelConfig(ctx: RouteContext, modelConfigId: string, input: Record<string, unknown>): Promise<void> {
  const row = get(ctx.database, "SELECT * FROM model_configs WHERE id = ?", modelConfigId) as Record<string, unknown> | null;
  if (row === null) return json(ctx.res, 404, { error: "model_config_not_found" });
  const now = ctx.now?.() ?? Date.now();
  const jobId = randomUUID();
  ctx.settingsJobs.set(jobId, { id: jobId, type: "model_config.test", modelConfigId, status: "queued", createdAt: now, updatedAt: now });

  const provider = stringField(row.provider) ?? "openai";
  try {
    const result = await runModelConfigTest({
      provider,
      model: stringField(row.model) ?? "",
      baseUrl: stringOrNull(row.base_url),
      apiKey: provider === "ollama" ? null : await resolveModelConfigApiKey(ctx, row),
      fetchImpl: ctx.modelTestFetch,
      prompt: typeof input.prompt === "string" && input.prompt.length > 0 ? input.prompt : "Say 'ok'"
    });
    ctx.settingsJobs.set(jobId, { id: jobId, type: "model_config.test", modelConfigId, status: "completed", createdAt: now, updatedAt: ctx.now?.() ?? Date.now(), result });
    return json(ctx.res, 200, { jobId, ...result });
  } catch (error) {
    const mapped = mapModelTestError(error);
    ctx.settingsJobs.set(jobId, { id: jobId, type: "model_config.test", modelConfigId, status: "failed", createdAt: now, updatedAt: ctx.now?.() ?? Date.now(), result: { ok: false, error: mapped } });
    return json(ctx.res, 400, { jobId, ok: false, error: mapped });
  }
}

function getSettingsJob(ctx: RouteContext, jobId: string): void {
  const job = ctx.settingsJobs.get(jobId);
  if (job === undefined) {
    const runtimeJob = runtimeTestJobs.get(jobId);
    if (runtimeJob === undefined) return json(ctx.res, 404, { error: "job_not_found" });
    return json(ctx.res, 200, runtimeJob);
  }
  if (job.status === "pending") return json(ctx.res, 202, { jobId: job.id });
  return json(ctx.res, 200, { job });
}

async function resolveModelConfigApiKey(ctx: RouteContext, row: Record<string, unknown>): Promise<string | null> {
  const apiKeyRef = stringOrNull(row.api_key_ref);
  if (apiKeyRef === null) return null;
  return ctx.modelConfigSecrets.get(apiKeyRef);
}

async function runModelConfigTest(options: { readonly provider: string; readonly model: string; readonly baseUrl: string | null; readonly apiKey: string | null; readonly fetchImpl: typeof fetch; readonly prompt: string }): Promise<{ readonly ok: true; readonly model: string; readonly latencyMs: number; readonly inputTokens: number; readonly outputTokens: number }> {
  const startedAt = Date.now();
  const response = await resolveModelProvider(options.provider).test(options);
  return { ok: true, model: response.model, latencyMs: Math.max(0, Date.now() - startedAt), inputTokens: response.inputTokens, outputTokens: response.outputTokens };
}

function resolveModelProvider(provider: string): { readonly test: (input: { readonly provider: string; readonly model: string; readonly baseUrl: string | null; readonly apiKey: string | null; readonly fetchImpl: typeof fetch; readonly prompt: string }) => Promise<{ readonly model: string; readonly inputTokens: number; readonly outputTokens: number }> } {
  if (provider === "anthropic") return { test: testAnthropicModel };
  if (provider === "google") return { test: testGoogleModel };
  if (provider === "ollama") return { test: testOllamaModel };
  return { test: testOpenAiCompatibleModel };
}

async function testOpenAiCompatibleModel(input: { readonly provider: string; readonly model: string; readonly baseUrl: string | null; readonly apiKey: string | null; readonly fetchImpl: typeof fetch; readonly prompt: string }): Promise<{ readonly model: string; readonly inputTokens: number; readonly outputTokens: number }> {
  const root = input.baseUrl ?? "https://api.openai.com";
  const response = await input.fetchImpl(new URL("/v1/chat/completions", root), {
    method: "POST",
    headers: { "content-type": "application/json", ...(input.apiKey !== null ? { authorization: `Bearer ${input.apiKey}` } : {}) },
    body: JSON.stringify({ model: input.model, messages: [{ role: "user", content: input.prompt }], max_tokens: 1, temperature: 0 })
  });
  return handleProviderResponse(response, input.model, 1, 1);
}

async function testAnthropicModel(input: { readonly provider: string; readonly model: string; readonly baseUrl: string | null; readonly apiKey: string | null; readonly fetchImpl: typeof fetch; readonly prompt: string }): Promise<{ readonly model: string; readonly inputTokens: number; readonly outputTokens: number }> {
  const root = input.baseUrl ?? "https://api.anthropic.com";
  const response = await input.fetchImpl(new URL("/v1/messages", root), {
    method: "POST",
    headers: { "content-type": "application/json", ...(input.apiKey !== null ? { "x-api-key": input.apiKey } : {}), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: input.model, max_tokens: 1, messages: [{ role: "user", content: input.prompt }] })
  });
  return handleProviderResponse(response, input.model, 1, 1);
}

async function testGoogleModel(input: { readonly provider: string; readonly model: string; readonly baseUrl: string | null; readonly apiKey: string | null; readonly fetchImpl: typeof fetch; readonly prompt: string }): Promise<{ readonly model: string; readonly inputTokens: number; readonly outputTokens: number }> {
  const root = input.baseUrl ?? "https://generativelanguage.googleapis.com";
  const url = new URL(`/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, root);
  if (input.apiKey !== null) url.searchParams.set("key", input.apiKey);
  const response = await input.fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: input.prompt }] }], generationConfig: { maxOutputTokens: 1, temperature: 0 } })
  });
  return handleProviderResponse(response, input.model, 1, 1);
}

async function testOllamaModel(input: { readonly provider: string; readonly model: string; readonly baseUrl: string | null; readonly apiKey: string | null; readonly fetchImpl: typeof fetch; readonly prompt: string }): Promise<{ readonly model: string; readonly inputTokens: number; readonly outputTokens: number }> {
  const root = input.baseUrl ?? "http://127.0.0.1:11434";
  const response = await input.fetchImpl(new URL("/api/chat", root), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: input.model, messages: [{ role: "user", content: input.prompt }], stream: false, options: { temperature: 0, num_predict: 1 } })
  });
  return handleProviderResponse(response, input.model, 1, 1);
}

async function handleProviderResponse(response: Response, model: string, inputTokensFallback: number, outputTokensFallback: number): Promise<{ readonly model: string; readonly inputTokens: number; readonly outputTokens: number }> {
  if (response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const usage = (payload.usage ?? payload.usage_metadata ?? payload.meta) as Record<string, unknown> | undefined;
    return { model, inputTokens: numberField(usage?.input_tokens ?? usage?.prompt_token_count ?? inputTokensFallback), outputTokens: numberField(usage?.output_tokens ?? usage?.candidates_token_count ?? outputTokensFallback) };
  }
  throw new Error(await readProviderError(response));
}

async function readProviderError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { readonly error?: { readonly message?: string; readonly type?: string; readonly code?: string }; readonly message?: string; readonly errorMessage?: string };
    return parsed.error?.message ?? parsed.message ?? parsed.errorMessage ?? raw;
  } catch {
    return raw;
  }
}

function mapModelTestError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("rate limit") || message.includes("too many requests") || message.includes("429")) return "rate_limited";
  if (message.includes("invalid api key") || message.includes("unauthorized") || message.includes("incorrect api key") || message.includes("forbidden") || message.includes("401") || message.includes("403")) return "invalid_api_key";
  if (message.includes("model not found") || message.includes("unknown model") || message.includes("does not exist") || message.includes("404")) return "model_not_found";
  return "model_test_failed";
}

function numberField(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 1; }

function normalizeModelConfigRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspace_id ?? null,
    name: row.name,
    provider: row.provider,
    model: row.model,
    base_url: row.base_url ?? null,
    api_key_fingerprint: row.api_key_fingerprint ?? null,
    temperature: row.temperature ?? null,
    max_tokens: row.max_tokens ?? null,
    reasoning: parseJsonField(row.reasoning, null),
    extra: parseJsonField(row.extra, null),
    profile: row.profile ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
