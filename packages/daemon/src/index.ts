import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { createCommandBus, createDurableHandlerRegistry, createEventBus, createOutboxDispatcher, type CommandBus, type CommandHandler, type CommandType, type DurableHandlerRegistry, type EventBus, type EventBusSubscriber, type OutboxDispatcher, type PublishInput, type ReplayView } from "@agenthub/bus";
import { bootstrapBuiltInAgents, watchAgentProfiles, type AgentProfileWatcher } from "@agenthub/agents";
import { ArtifactFSRunRegistry, ArtifactService, createArtifactCommandHandlers } from "@agenthub/artifacts";
import { ContextLedger, createContextCommandHandlers } from "@agenthub/context";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { MockAdapterManager } from "@agenthub/adapter-mock";
import { createInterventionCommandHandlers, InterventionEngine } from "@agenthub/interventions";
import { ActiveWakesRegistry, createCancelRunHandler, createCompleteTaskHandler, createConsumePendingTurnHandler, createCreateTaskHandler, createUpdateTaskHandler, createWakeAgentHandler, MailboxService, PendingTurnService, RoomMcpServer, RunLifecycleService, RunQueue, TaskService } from "@agenthub/orchestrator";
import { createPermissionCommandHandlers, PermissionEngine, seedBuiltInPermissionProfiles } from "@agenthub/permissions";
import type { EventEnvelope } from "@agenthub/protocol/events";
import { authenticateBrowserRequest, issueBrowserSession, redactAndTruncate, type BrowserAuthResult } from "@agenthub/security";

import { AdapterRegistry } from "./adapters/registry.ts";
import { createDaemonCommandHandlers, seedDefaultData } from "./commands.ts";
import { openApiDocument } from "./openapi.ts";

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
export type DaemonOptions = { readonly databasePath: string; readonly host?: string; readonly port?: number; readonly token?: string; readonly allowRemote?: boolean; readonly allowedOrigins?: readonly string[]; readonly now?: () => number; readonly onLifecyclePhase?: (event: { readonly direction: "startup" | "shutdown"; readonly phase: DaemonStartupPhase }) => void };
export type DaemonApp = { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly commandBus: CommandBus; readonly roomMcpServer: RoomMcpServer; readonly adapterRegistry: AdapterRegistry; readonly mockAdapter: MockAdapterManager; readonly handle: (req: IncomingMessage, res: ServerResponse) => void; start(): Promise<Server>; close(): Promise<void> };
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
  eventBus: EventBus;
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
};

export function createDaemon(options: DaemonOptions): DaemonApp {
  let runtime: DaemonRuntime | undefined;
  let server: Server | undefined;
  let ready = false;
  let starting: Promise<Server> | undefined;
  let closed = false;

  const emitPhase = (direction: "startup" | "shutdown", phase: DaemonStartupPhase): void => {
    options.onLifecyclePhase?.({ direction, phase });
  };

  const requireRuntime = (): DaemonRuntime => {
    if (runtime === undefined) throw new Error("Daemon has not completed startup");
    return runtime;
  };

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { ok: true });
    if (!ready) return json(res, 503, { error: "service_starting", retryAfterMs: 500 });
    const app = requireRuntime();
    void route({ req, res, database: app.database, eventBus: app.eventBus, commandBus: app.commandBus, artifactService: app.artifactService, taskService: app.taskService, outbox: app.outbox, ...(options.token !== undefined ? { token: options.token } : {}), ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}), host: `${options.host ?? "127.0.0.1"}:${options.port ?? 6677}`, ...(options.now !== undefined ? { now: options.now } : {}) });
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
    seedDefaultData(database, options.now?.() ?? Date.now());
    seedBuiltInPermissionProfiles(database, options.now?.() ?? Date.now());
    bootstrapBuiltInAgents();

    emitPhase("startup", PHASE_EVENT_STORE);
    database.sqlite.prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events").get();

    emitPhase("startup", PHASE_EVENT_BUS);
    const eventBus = withStatusLineCoalescing(createEventBus({ database }));
    const agentProfiles = watchAgentProfiles({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    await agentProfiles.ready;
    const contextLedger = new ContextLedger({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    const permissionEngine = new PermissionEngine({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    const interventionEngine = new InterventionEngine({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    const artifactService = new ArtifactService({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    const taskService = new TaskService({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    const artifactFs = new ArtifactFSRunRegistry({ database, service: artifactService, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    const activeWakes = new ActiveWakesRegistry();
    const mailbox = new MailboxService(database, options.now, eventBus);
    const commandBusRef: { current?: CommandBus } = {};
    const pendingTurns = new PendingTurnService({ database, eventBus, getCommandBus: () => currentCommandBus(commandBusRef), ...(options.now !== undefined ? { now: options.now } : {}) });
    const runQueueRef: { current?: RunQueue } = {};
    const lifecycleOptions = {
      ...(options.now !== undefined ? { now: options.now } : {}),
      sideEffects: { onTerminal: (runId: string) => { activeWakes.releaseRun(runId); runQueueRef.current?.releaseLocks(runId); pendingTurns.handleTerminal(runId); }, finalizeNextTurns: (tx: AgentHubDatabase["sqlite"], runId: string, failureClass: Parameters<MailboxService["finalizeForRun"]>[2], now: number) => mailbox.finalizeForRun(tx, runId, failureClass, now) }
    };
    const lifecycle = new RunLifecycleService(database, eventBus, lifecycleOptions);
    const roomMcpServerRef: { current?: RoomMcpServer } = {};
    const adapterRegistry = new AdapterRegistry({ database, eventBus, lifecycle, permissionEngine, artifactFs, getRoomMcpServer: () => currentRoomMcpServer(roomMcpServerRef), ...(options.now !== undefined ? { now: options.now } : {}) });

    emitPhase("startup", PHASE_OUTBOX);
    const handlers = createDurableHandlerRegistry({ database, retryDelaysMs: [0] });
    const outbox = createOutboxDispatcher({ database, eventBus, handlers });
    await outbox.drainPending();

    emitPhase("startup", PHASE_HANDLERS);
    const runQueue = new RunQueue({ database, lifecycle, adapterManager: adapterRegistry, ...(options.now !== undefined ? { now: options.now } : {}) });
    runQueueRef.current = runQueue;
    handlers.register({ name: "run-queue", subscribes: ["agent.run.queued", "agent.run.completed", "agent.run.failed", "agent.run.cancelled"], handle: (event) => runQueue.handleEvent(event) });
    await handlers.catchUp();

    emitPhase("startup", PHASE_RUN_QUEUE);
    await runQueue.scheduleTick();

    emitPhase("startup", PHASE_ADAPTERS);
    const mockAdapter = adapterRegistry.mockAdapter;

    emitPhase("startup", PHASE_COMMAND_BUS);
    const commandBus = createCommandBus({
      database,
      handlers: {
        ...createDaemonCommandHandlers({ database, eventBus, getCommandBus: () => commandBus, pendingTurns, ...(options.now !== undefined ? { now: options.now } : {}) }),
        ...createContextCommandHandlers(contextLedger, options.now),
        ...createArtifactCommandHandlers(artifactService),
        ...createPermissionCommandHandlers(permissionEngine, database, eventBus, options.now),
        ...createInterventionCommandHandlers(interventionEngine),
        CreateTask: createCreateTaskHandler(taskService),
        UpdateTask: createUpdateTaskHandler(taskService),
        CompleteTask: createCompleteTaskHandler(taskService),
        WakeAgent: createWakeAgentHandler({ database, activeWakes, mailbox, lifecycle }) as CommandHandler,
        ConsumePendingTurn: createConsumePendingTurnHandler(pendingTurns) as CommandHandler,
        CancelRun: createCancelRunHandler({ lifecycle, adapterManager: adapterRegistry })
      }
    });
    commandBusRef.current = commandBus;
    const roomMcpServer = new RoomMcpServer({ commandBus, taskService, database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
    roomMcpServerRef.current = roomMcpServer;
    runtime = { database, eventBus, commandBus, roomMcpServer, adapterRegistry, mockAdapter, artifactService, taskService, outbox, handlers, runQueue, agentProfiles };

    emitPhase("startup", PHASE_HTTP);
    return await new Promise<Server>((resolve) => {
      server = createServer(handle).listen(options.port ?? 6677, host, () => {
        ready = true;
        resolve(server as Server);
      });
    });
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    ready = false;
    for (const phase of DAEMON_SHUTDOWN_PHASES) {
      emitPhase("shutdown", phase);
      if (phase === PHASE_HTTP && server !== undefined) {
        await new Promise<void>((resolve, reject) => server?.close((err) => err ? reject(err) : resolve()));
        server = undefined;
      } else if (phase === PHASE_OUTBOX) {
        await runtime?.outbox.drainPending();
      } else if (phase === PHASE_EVENT_BUS) {
        runtime?.eventBus.flushStatusLines?.();
        await runtime?.agentProfiles.close();
        runtime?.eventBus.close();
      } else if (phase === PHASE_SQLITE) {
        runtime?.database.sqlite.close();
      }
    }
  };

  return {
    get database() { return requireRuntime().database; },
    get eventBus() { return requireRuntime().eventBus; },
    get commandBus() { return requireRuntime().commandBus; },
    get roomMcpServer() { return requireRuntime().roomMcpServer; },
    get adapterRegistry() { return requireRuntime().adapterRegistry; },
    get mockAdapter() { return requireRuntime().mockAdapter; },
    handle,
    start,
    close
  };
}

type StatusLineEventBus = EventBus & { flushStatusLines?: () => void };

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

type RouteContext = { readonly req: IncomingMessage; readonly res: ServerResponse; readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly commandBus: CommandBus; readonly artifactService: ArtifactService; readonly taskService: TaskService; readonly outbox: { drainPending(): Promise<void> }; readonly token?: string; readonly allowedOrigins?: readonly string[]; readonly host: string; readonly now?: () => number };

async function route(ctx: RouteContext): Promise<void> {
  const url = new URL(ctx.req.url ?? "/", "http://127.0.0.1");
  const auth = authenticate(ctx, url);
  if (!auth.ok) return json(ctx.res, auth.status, { error: auth.error });
  if (ctx.req.method === "POST" && url.pathname === "/auth/session") return authSession(ctx);
  if (ctx.req.method === "GET" && url.pathname === "/healthz") return json(ctx.res, 200, { ok: true });
  if (ctx.req.method === "GET" && url.pathname === "/openapi.json") return json(ctx.res, 200, openApiDocument);
  if (ctx.req.method === "GET" && url.pathname === "/event") return sse(ctx, url, auth.scopes);
  if (ctx.req.method === "GET" && url.pathname === "/rooms") return json(ctx.res, 200, { rooms: all(ctx.database, "SELECT * FROM rooms ORDER BY created_at ASC") });
  if (ctx.req.method === "POST" && url.pathname === "/rooms") return dispatch(ctx, await body(ctx), "CreateRoom");
  const parts = url.pathname.split("/").filter(Boolean);
  if (ctx.req.method === "GET" && parts[0] === "rooms" && parts.length === 1) return json(ctx.res, 200, { rooms: all(ctx.database, "SELECT * FROM rooms ORDER BY created_at ASC") });
  if (ctx.req.method === "GET" && parts[0] === "rooms" && parts.length === 2) return json(ctx.res, 200, { room: get(ctx.database, "SELECT * FROM rooms WHERE id = ?", parts[1]) });
  if (ctx.req.method === "GET" && parts[0] === "rooms" && parts[2] === "tasks") return tasks(ctx, parts[1] as string, url);
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
  if (ctx.req.method === "GET" && parts[0] === "runs" && parts[1]) return json(ctx.res, 200, { run: get(ctx.database, "SELECT * FROM runs WHERE id = ?", parts[1]) });
  if (ctx.req.method === "GET" && url.pathname === "/context") return contextItems(ctx, url);
  if (ctx.req.method === "POST" && url.pathname === "/context/propose") return dispatch(ctx, await body(ctx), "ProposeContextItem");
  if (ctx.req.method === "POST" && url.pathname === "/context/write") return dispatch(ctx, await body(ctx), "WriteContextItem");
  if (ctx.req.method === "PATCH" && parts[0] === "context" && parts[1]) return dispatch(ctx, { ...(await body(ctx)), contextId: parts[1] }, "UpdateContextItem");
  if (ctx.req.method === "POST" && parts[0] === "context" && parts[2] === "confirm") return dispatch(ctx, { ...(await body(ctx)), contextId: parts[1] }, "ConfirmContextItem");
  if (ctx.req.method === "POST" && parts[0] === "context" && parts[2] === "deprecate") return dispatch(ctx, { ...(await body(ctx)), contextId: parts[1] }, "DeprecateContextItem");
  if (ctx.req.method === "POST" && parts[0] === "context" && parts[2] === "pin") return dispatch(ctx, { ...(await body(ctx)), contextId: parts[1] }, "PinContextItem");
  if (ctx.req.method === "GET" && url.pathname === "/permissions/profiles") return json(ctx.res, 200, { profiles: all(ctx.database, "SELECT * FROM permission_profiles ORDER BY name ASC") });
  if (ctx.req.method === "GET" && parts[0] === "permissions" && parts[1] === "profiles" && parts[2]) return json(ctx.res, 200, { profile: get(ctx.database, "SELECT * FROM permission_profiles WHERE id = ?", parts[2]) });
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
  if (ctx.req.method === "GET" && parts[0] === "workspaces" && parts[2] === "cost-summary") return json(ctx.res, 501, { error: "cost-panel-local is V0.5", capability: "v1-roadmap" });
  if (ctx.req.method === "GET" && (url.pathname === "/board" || url.pathname === "/timeline")) return json(ctx.res, 404, { error: "not_found", capability: "v1-roadmap" });
  return json(ctx.res, 404, { error: "not_found" });
}

function authSession(ctx: RouteContext): void {
  const session = issueBrowserSession(ctx.database, ctx.now?.() ?? Date.now(), ctx.eventBus);
  ctx.res.setHeader("set-cookie", `agenthub_session=${session.sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
  json(ctx.res, 200, { csrfToken: session.csrfToken, expiresAt: session.expiresAt });
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
  const limit = Math.min(Math.max(numberQuery(url, "limit") ?? 50, 1), 100);
  const includeDeleted = url.searchParams.get("includeDeleted") === "true";
  const before = cursorParam(url.searchParams.get("before"));
  const after = cursorParam(url.searchParams.get("after"));
  const clauses = ["room_id = ?"];
  const params: unknown[] = [roomId];
  if (!includeDeleted) clauses.push("deleted_at IS NULL");
  if (before !== undefined) { clauses.push("(created_at < ? OR (created_at = ? AND id < ?))"); params.push(before.createdAt, before.createdAt, before.id); }
  if (after !== undefined) { clauses.push("(created_at > ? OR (created_at = ? AND id > ?))"); params.push(after.createdAt, after.createdAt, after.id); }
  const rows = all(ctx.database, `SELECT * FROM messages WHERE ${clauses.join(" AND ")} ORDER BY created_at ASC, id ASC LIMIT ?`, ...params, limit) as { readonly id: string; readonly created_at: number }[];
  json(ctx.res, 200, { messages: rows, nextCursor: rows.length === limit ? encodeCursor(rows[rows.length - 1] as { readonly id: string; readonly created_at: number }) : null });
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

function permissionRules(ctx: RouteContext, url: URL): void {
  const workspaceId = url.searchParams.get("workspaceId");
  if (workspaceId === null) return json(ctx.res, 200, { rules: all(ctx.database, "SELECT * FROM permission_rules ORDER BY created_at ASC") });
  return json(ctx.res, 200, { rules: all(ctx.database, "SELECT * FROM permission_rules WHERE workspace_id = ? ORDER BY created_at ASC", workspaceId) });
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

function sse(ctx: RouteContext, url: URL, scopes: readonly string[]): void {
  const view = viewParam(url.searchParams.get("view"));
  if (view === "raw" && !scopes.includes("admin")) return json(ctx.res, 403, { error: "requires_admin_scope" });
  const roomId = url.searchParams.get("roomId") ?? undefined;
  const runId = url.searchParams.get("runId") ?? undefined;
  const filters = { view, ...(roomId !== undefined ? { roomId } : {}), ...(runId !== undefined ? { runId } : {}) };
  const send = (event: EventEnvelope) => {
    if (!visible(event, view, filters.roomId, filters.runId)) return;
    ctx.res.write(`${event.seq !== undefined ? `id: ${event.seq}\n` : ""}event: ${event.type}\ndata: ${redactAndTruncate(JSON.stringify(event), 64 * 1024)}\n\n`);
  };
  ctx.res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  ctx.res.write(": connected\n\n");
  const cursor = Number(url.searchParams.get("cursor") ?? ctx.req.headers["last-event-id"] ?? 0);
  for (const event of ctx.eventBus.replayDurableSinceSeq(Number.isFinite(cursor) ? cursor : 0, filters)) send(event);
  const unsubscribe = ctx.eventBus.subscribeAll(send);
  const heartbeat = setInterval(() => ctx.res.write(": heartbeat\n\n"), 10_000);
  ctx.req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
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
