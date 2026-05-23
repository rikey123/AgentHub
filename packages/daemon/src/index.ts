import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { createCommandBus, createDurableHandlerRegistry, createEventBus, createOutboxDispatcher, type CommandBus, type CommandHandler, type CommandType, type EventBus, type ReplayView } from "@agenthub/bus";
import { ArtifactFSRunRegistry, ArtifactService, createArtifactCommandHandlers } from "@agenthub/artifacts";
import { ContextLedger, createContextCommandHandlers } from "@agenthub/context";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { MockAdapterManager } from "@agenthub/adapter-mock";
import { createInterventionCommandHandlers, InterventionEngine } from "@agenthub/interventions";
import { ActiveWakesRegistry, createCancelRunHandler, createConsumePendingTurnHandler, createWakeAgentHandler, MailboxService, PendingTurnService, RunLifecycleService, RunQueue } from "@agenthub/orchestrator";
import { createPermissionCommandHandlers, PermissionEngine, seedBuiltInPermissionProfiles } from "@agenthub/permissions";
import type { EventEnvelope } from "@agenthub/protocol/events";
import { authenticateBrowserRequest, issueBrowserSession, redactAndTruncate } from "@agenthub/security";

import { createDaemonCommandHandlers, seedDefaultData } from "./commands.ts";
import { openApiDocument } from "./openapi.ts";

export type DaemonOptions = { readonly databasePath: string; readonly host?: string; readonly port?: number; readonly token?: string; readonly allowedOrigins?: readonly string[]; readonly now?: () => number };
export type DaemonApp = { readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly commandBus: CommandBus; readonly mockAdapter: MockAdapterManager; readonly handle: (req: IncomingMessage, res: ServerResponse) => void; start(): Promise<Server>; close(): Promise<void> };

export function createDaemon(options: DaemonOptions): DaemonApp {
  const database = createDatabase({ path: options.databasePath, applyMigrations: true });
  seedDefaultData(database, options.now?.() ?? Date.now());
  seedBuiltInPermissionProfiles(database, options.now?.() ?? Date.now());
  const eventBus = createEventBus({ database });
  const contextLedger = new ContextLedger({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
  const permissionEngine = new PermissionEngine({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
  const interventionEngine = new InterventionEngine({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
  const artifactService = new ArtifactService({ database, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
  const artifactFs = new ArtifactFSRunRegistry({ database, service: artifactService, eventBus, ...(options.now !== undefined ? { now: options.now } : {}) });
  const activeWakes = new ActiveWakesRegistry();
  const mailbox = new MailboxService(database, options.now);
  const commandBusRef: { current?: CommandBus } = {};
  const pendingTurns = new PendingTurnService({ database, eventBus, getCommandBus: () => currentCommandBus(commandBusRef), ...(options.now !== undefined ? { now: options.now } : {}) });
  const lifecycleOptions = {
    ...(options.now !== undefined ? { now: options.now } : {}),
    sideEffects: { onTerminal: (runId: string) => { activeWakes.releaseRun(runId); runQueue.releaseLocks(runId); pendingTurns.handleTerminal(runId); }, finalizeNextTurns: (tx: AgentHubDatabase["sqlite"], runId: string, failureClass: Parameters<MailboxService["finalizeForRun"]>[2], now: number) => mailbox.finalizeForRun(tx, runId, failureClass, now) }
  };
  const lifecycle = new RunLifecycleService(database, eventBus, lifecycleOptions);
  const mockAdapter = new MockAdapterManager({ database, eventBus, lifecycle, artifactFs, ...(options.now !== undefined ? { now: options.now } : {}) });
  const runQueue = new RunQueue({ database, lifecycle, adapterManager: mockAdapter, ...(options.now !== undefined ? { now: options.now } : {}) });
  const handlers = createDurableHandlerRegistry({ database, retryDelaysMs: [0] });
  handlers.register({ name: "run-queue", subscribes: ["agent.run.queued", "agent.run.completed", "agent.run.failed", "agent.run.cancelled"], handle: (event) => runQueue.handleEvent(event) });
  const outbox = createOutboxDispatcher({ database, eventBus, handlers });
  const commandBus = createCommandBus({
    database,
    handlers: {
      ...createDaemonCommandHandlers({ database, eventBus, getCommandBus: () => commandBus, pendingTurns, ...(options.now !== undefined ? { now: options.now } : {}) }),
      ...createContextCommandHandlers(contextLedger, options.now),
      ...createArtifactCommandHandlers(artifactService),
      ...createPermissionCommandHandlers(permissionEngine, database, eventBus, options.now),
      ...createInterventionCommandHandlers(interventionEngine),
      WakeAgent: createWakeAgentHandler({ database, activeWakes, mailbox, lifecycle }) as CommandHandler,
      ConsumePendingTurn: createConsumePendingTurnHandler(pendingTurns) as CommandHandler,
      CancelRun: createCancelRunHandler({ lifecycle, adapterManager: mockAdapter })
    }
  });
  commandBusRef.current = commandBus;

  const handle = (req: IncomingMessage, res: ServerResponse) => { void route({ req, res, database, eventBus, commandBus, artifactService, outbox, ...(options.token !== undefined ? { token: options.token } : {}), ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}), host: `${options.host ?? "127.0.0.1"}:${options.port ?? 6677}`, ...(options.now !== undefined ? { now: options.now } : {}) }); };
  let server: Server | undefined;
  return { database, eventBus, commandBus, mockAdapter, handle, start: () => new Promise((resolve) => { server = createServer(handle).listen(options.port ?? 6677, options.host ?? "127.0.0.1", () => resolve(server as Server)); }), close: () => new Promise((resolve, reject) => { eventBus.close(); database.sqlite.close(); if (!server) resolve(); else server.close((err) => err ? reject(err) : resolve()); }) };
}

type RouteContext = { readonly req: IncomingMessage; readonly res: ServerResponse; readonly database: AgentHubDatabase; readonly eventBus: EventBus; readonly commandBus: CommandBus; readonly artifactService: ArtifactService; readonly outbox: { drainPending(): Promise<void> }; readonly token?: string; readonly allowedOrigins?: readonly string[]; readonly host: string; readonly now?: () => number };

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
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "archive") return dispatch(ctx, { roomId: parts[1] }, "ArchiveRoom");
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "unarchive") return dispatch(ctx, { roomId: parts[1] }, "UnarchiveRoom");
  if (ctx.req.method === "GET" && parts[0] === "rooms" && parts[2] === "messages") return json(ctx.res, 200, { messages: all(ctx.database, "SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC", parts[1]) });
  if (ctx.req.method === "POST" && parts[0] === "rooms" && parts[2] === "messages") return dispatch(ctx, { ...(await body(ctx)), roomId: parts[1] }, "SendMessage");
  if (ctx.req.method === "DELETE" && parts[0] === "pending-turns" && parts[1]) return dispatch(ctx, { pendingTurnId: parts[1] }, "CancelPendingTurn");
  if (ctx.req.method === "PATCH" && parts[0] === "messages" && parts[1]) return dispatch(ctx, { ...(await body(ctx)), messageId: parts[1] }, "EditMessage");
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
  if (ctx.req.method === "GET" && url.pathname === "/debug/events") return debugEvents(ctx, url);
  if (ctx.req.method === "GET" && url.pathname === "/debug/stats") return debugStats(ctx);
  if (ctx.req.method === "GET" && parts[0] === "workspaces" && parts[2] === "cost-summary") return json(ctx.res, 501, { error: "cost-panel-local is V0.5", capability: "v1-roadmap" });
  if (ctx.req.method === "GET" && (url.pathname === "/board" || url.pathname === "/timeline")) return json(ctx.res, 404, { error: "not_found", capability: "v1-roadmap" });
  return json(ctx.res, 404, { error: "not_found" });
}

function authSession(ctx: RouteContext): void {
  const session = issueBrowserSession(ctx.database, ctx.now?.() ?? Date.now());
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

function debugEvents(ctx: RouteContext, url: URL): void {
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

function debugStats(ctx: RouteContext): void {
  const now = Date.now();
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

function statusForError(code: string): number { return code === "rate_limited" ? 429 : code === "conflict" ? 409 : code === "not_found" ? 404 : code === "permission_denied" ? 403 : 400; }
function currentCommandBus(ref: { readonly current?: CommandBus }): CommandBus { if (!ref.current) throw new Error("CommandBus is not initialized"); return ref.current; }

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
