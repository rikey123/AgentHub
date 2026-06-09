import { EVENT_REGISTRY, type EventEnvelope } from "@agenthub/protocol/events";

export type AgentHubJsonPrimitive = string | number | boolean | null;
export type AgentHubJsonValue = AgentHubJsonPrimitive | AgentHubJsonObject | AgentHubJsonValue[];
export type AgentHubJsonObject = { readonly [key: string]: AgentHubJsonValue };

export type AgentHubClientOptions = { readonly baseUrl?: string; readonly token?: string; readonly fetchImpl?: typeof fetch };
export type CreateRoomInput = {
  readonly title?: string;
  readonly mode?: "solo" | "assisted" | "squad" | "team";
  readonly workspaceId?: string;
  readonly primaryAgentId?: string;
  readonly leaderRoleId?: string;
  readonly agentBindingId?: string;
  readonly skillIds?: readonly string[];
  readonly participants?: readonly AgentHubJsonValue[];
};

export type SendMessageInput = {
  readonly text: string;
  readonly idempotencyKey?: string;
  readonly quotedMessageId?: string;
  readonly attachmentIds?: readonly string[];
  readonly mentions?: readonly string[];
};
export type ContextFilters = { readonly workspaceId?: string; readonly roomId?: string; readonly taskId?: string; readonly status?: string };
export type PermissionRequestFilters = { readonly status?: string; readonly roomId?: string };
export type PermissionRuleFilters = { readonly workspaceId?: string };
export type InterventionFilters = { readonly roomId?: string; readonly status?: string };
export type ArtifactFilters = { readonly roomId?: string; readonly taskId?: string; readonly status?: string };
export type DebugEventFilters = { readonly traceId?: string; readonly runId?: string; readonly roomId?: string; readonly type?: string; readonly since?: string; readonly until?: string; readonly limit?: string };
export type MobileSnapshotFilters = { readonly roomId?: string };

export type HealthResponse = { readonly ok?: true; readonly status?: "shutting_down"; readonly error?: string };
export type OpenApiResponse = AgentHubJsonObject;
export type RoomsResponse = { readonly rooms: readonly AgentHubJsonObject[] };
export type RoomResponse = { readonly room?: AgentHubJsonObject | null; readonly data?: AgentHubJsonObject };
export type MessagesResponse = { readonly messages?: readonly AgentHubJsonObject[]; readonly data?: AgentHubJsonValue };
export type AgentsResponse = { readonly agents?: readonly AgentHubJsonObject[]; readonly data?: AgentHubJsonValue };
export type RunResponse = { readonly run?: AgentHubJsonObject | null; readonly data?: AgentHubJsonValue };
export type ContextResponse = { readonly contexts?: readonly AgentHubJsonObject[]; readonly context?: AgentHubJsonObject; readonly data?: AgentHubJsonValue; readonly ok?: boolean };
export type PermissionProfilesResponse = { readonly profiles?: readonly AgentHubJsonObject[]; readonly profile?: AgentHubJsonObject; readonly data?: AgentHubJsonValue; readonly ok?: boolean };
export type PermissionRequestsResponse = { readonly requests?: readonly AgentHubJsonObject[]; readonly data?: AgentHubJsonValue };
export type PermissionRulesResponse = { readonly rules?: readonly AgentHubJsonObject[]; readonly ok?: boolean; readonly data?: AgentHubJsonValue };
export type InterventionsResponse = { readonly interventions?: readonly AgentHubJsonObject[]; readonly intervention?: AgentHubJsonObject; readonly ok?: boolean; readonly data?: AgentHubJsonValue };
export type ArtifactsResponse = { readonly artifacts?: readonly AgentHubJsonObject[]; readonly artifact?: AgentHubJsonObject; readonly files?: readonly AgentHubJsonObject[]; readonly content?: string; readonly ok?: boolean; readonly data?: AgentHubJsonValue };
export type DebugEventsResponse = { readonly events?: readonly EventEnvelope[]; readonly data?: AgentHubJsonValue };
export type MobileConnectionConfig = {
  readonly version: number;
  readonly url: string;
  readonly host: string;
  readonly port: number | null;
  readonly token: string;
  readonly tokenId?: string;
  readonly scopes?: readonly string[];
  readonly expiresAt?: number | null;
};
export type MobileSnapshotResponse = {
  readonly view: "mobile";
  readonly cursor: number;
  readonly rooms: readonly AgentHubJsonObject[];
  readonly tasks: readonly AgentHubJsonObject[];
  readonly runs: readonly AgentHubJsonObject[];
  readonly permissions: readonly AgentHubJsonObject[];
  readonly artifacts: readonly AgentHubJsonObject[];
};
export type MobileArtifactPreviewResponse = {
  readonly artifact: AgentHubJsonObject;
  readonly file: AgentHubJsonObject;
  readonly content: string | null;
};
export type DebugStatsResponse = {
  readonly pendingPermissionCount: number;
  readonly pendingInterventionCount: number;
  readonly activeRunCount: number;
  readonly roomCount: number;
  readonly uptimeMs: number;
  readonly sseClientCount: number;
  readonly eventsLast5min?: number;
  readonly pubsub?: readonly { readonly channel: string; readonly subscribers?: number; readonly queued?: number }[];
};
export type MutationResponse = { readonly ok?: boolean; readonly data?: AgentHubJsonValue; readonly [key: string]: AgentHubJsonValue | undefined };

export class AgentHubClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AgentHubClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? "http://127.0.0.1:6677");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  health(): Promise<HealthResponse> { return this.request("/healthz"); }
  openApi(): Promise<OpenApiResponse> { return this.request("/openapi.json"); }
  listRooms(): Promise<RoomsResponse> { return this.request("/rooms"); }
  createRoom(input: CreateRoomInput): Promise<RoomResponse> { return this.request("/rooms", { method: "POST", body: input }); }
  listMessages(roomId: string): Promise<MessagesResponse> { return this.request(`/rooms/${encodeURIComponent(roomId)}/messages`); }
  sendMessage(roomId: string, input: SendMessageInput): Promise<MessagesResponse> { return this.request(`/rooms/${encodeURIComponent(roomId)}/messages`, { method: "POST", body: input }); }
  stopDiscussion(roomId: string): Promise<MutationResponse> { return this.request(`/rooms/${encodeURIComponent(roomId)}/discussion/stop`, { method: "POST" }); }
  listAgents(): Promise<AgentsResponse> { return this.request("/agents"); }
  getRun(runId: string): Promise<RunResponse> { return this.request(`/runs/${encodeURIComponent(runId)}`); }
  listContext(filters: ContextFilters = {}): Promise<ContextResponse> { return this.request(`/context${query(filters)}`); }
  proposeContext(input: AgentHubJsonObject): Promise<ContextResponse> { return this.request("/context/propose", { method: "POST", body: input }); }
  writeContext(input: AgentHubJsonObject): Promise<ContextResponse> { return this.request("/context/write", { method: "POST", body: input }); }
  updateContext(contextId: string, input: AgentHubJsonObject): Promise<ContextResponse> { return this.request(`/context/${encodeURIComponent(contextId)}`, { method: "PATCH", body: input }); }
  confirmContext(contextId: string, input: { readonly baseVersion?: number; readonly idempotencyKey?: string } = {}): Promise<ContextResponse> { return this.request(`/context/${encodeURIComponent(contextId)}/confirm`, { method: "POST", body: input }); }
  deprecateContext(contextId: string, input: { readonly baseVersion: number; readonly reason?: string; readonly idempotencyKey?: string }): Promise<ContextResponse> { return this.request(`/context/${encodeURIComponent(contextId)}/deprecate`, { method: "POST", body: input }); }
  pinContext(contextId: string, input: { readonly baseVersion: number; readonly idempotencyKey?: string }): Promise<ContextResponse> { return this.request(`/context/${encodeURIComponent(contextId)}/pin`, { method: "POST", body: input }); }
  listPermissionProfiles(): Promise<PermissionProfilesResponse> { return this.request("/permissions/profiles"); }
  getPermissionProfile(profileId: string): Promise<PermissionProfilesResponse> { return this.request(`/permissions/profiles/${encodeURIComponent(profileId)}`); }
  createPermissionProfile(input: { readonly id?: string; readonly name: string; readonly payload: AgentHubJsonValue }): Promise<PermissionProfilesResponse> { return this.request("/permissions/profiles", { method: "POST", body: input }); }
  patchPermissionProfile(profileId: string, input: { readonly name: string; readonly payload: AgentHubJsonValue }): Promise<PermissionProfilesResponse> { return this.request(`/permissions/profiles/${encodeURIComponent(profileId)}`, { method: "PATCH", body: input }); }
  listPermissionRequests(filters: PermissionRequestFilters = {}): Promise<PermissionRequestsResponse> { return this.request(`/permissions/requests${query(filters)}`); }
  resolvePermission(requestId: string, input: { readonly decision: "allow" | "deny"; readonly remember?: boolean; readonly scope?: string; readonly idempotencyKey?: string }): Promise<MutationResponse> { return this.request(`/permissions/${encodeURIComponent(requestId)}/resolve`, { method: "POST", body: input }); }
  listPermissionRules(filters: PermissionRuleFilters = {}): Promise<PermissionRulesResponse> { return this.request(`/permissions/rules${query(filters)}`); }
  deletePermissionRule(ruleId: string): Promise<MutationResponse> { return this.request(`/permissions/rules/${encodeURIComponent(ruleId)}`, { method: "DELETE" }); }
  listInterventions(filters: InterventionFilters = {}): Promise<InterventionsResponse> { return this.request(`/interventions${query(filters)}`); }
  getIntervention(interventionId: string): Promise<InterventionsResponse> { return this.request(`/interventions/${encodeURIComponent(interventionId)}`); }
  requestIntervention(input: AgentHubJsonObject): Promise<InterventionsResponse> { return this.request("/interventions", { method: "POST", body: input }); }
  approveIntervention(interventionId: string, input: { readonly effectiveText?: string; readonly idempotencyKey?: string } = {}): Promise<InterventionsResponse> { return this.request(`/interventions/${encodeURIComponent(interventionId)}/approve`, { method: "POST", body: input }); }
  ignoreIntervention(interventionId: string, input: { readonly idempotencyKey?: string } = {}): Promise<InterventionsResponse> { return this.request(`/interventions/${encodeURIComponent(interventionId)}/ignore`, { method: "POST", body: input }); }
  rejectIntervention(interventionId: string, input: { readonly reason?: string; readonly idempotencyKey?: string } = {}): Promise<InterventionsResponse> { return this.request(`/interventions/${encodeURIComponent(interventionId)}/reject`, { method: "POST", body: input }); }
  snoozeIntervention(interventionId: string, input: { readonly snoozeSeconds?: number; readonly idempotencyKey?: string } = {}): Promise<InterventionsResponse> { return this.request(`/interventions/${encodeURIComponent(interventionId)}/later`, { method: "POST", body: input }); }
  listArtifacts(filters: ArtifactFilters = {}): Promise<ArtifactsResponse> { return this.request(`/artifacts${query(filters)}`); }
  getArtifact(artifactId: string): Promise<ArtifactsResponse> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}`); }
  createArtifact(input: AgentHubJsonObject): Promise<ArtifactsResponse> { return this.request("/artifacts", { method: "POST", body: input }); }
  reviewArtifact(artifactId: string, input: { readonly idempotencyKey?: string } = {}): Promise<ArtifactsResponse> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/review`, { method: "POST", body: input }); }
  applyDiff(artifactId: string, input: { readonly idempotencyKey?: string } = {}): Promise<ArtifactsResponse> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/apply`, { method: "POST", body: input }); }
  rejectDiff(artifactId: string, input: { readonly reason?: string; readonly idempotencyKey?: string } = {}): Promise<ArtifactsResponse> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/reject`, { method: "POST", body: input }); }
  revertArtifact(artifactId: string, input: { readonly idempotencyKey?: string } = {}): Promise<ArtifactsResponse> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/revert`, { method: "POST", body: input }); }
  listArtifactFiles(artifactId: string): Promise<ArtifactsResponse> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/files`); }
  getArtifactFileContent(artifactId: string, path: string): Promise<ArtifactsResponse> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/files/${encodeURIComponent(path)}`); }
  syncSnapshot(filters: MobileSnapshotFilters = {}): Promise<MobileSnapshotResponse> { return this.request(`/sync/snapshot${query({ view: "mobile", ...filters })}`); }
  mobileArtifactPreview(artifactId: string, path: string): Promise<MobileArtifactPreviewResponse> { return this.request(`/mobile/artifacts/${encodeURIComponent(artifactId)}/files/${encodeURIComponent(path)}`); }
  debugEvents(filters: DebugEventFilters = {}): Promise<DebugEventsResponse> { return this.request(`/debug/events${query(filters)}`); }
  debugStats(): Promise<DebugStatsResponse> { return this.request("/debug/stats"); }

  eventStream(options: AgentHubEventStreamOptions): AgentHubEventStream {
    return new AgentHubEventStream({
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
      ...(this.options.token !== undefined ? { token: this.options.token } : {}),
      ...options
    });
  }

  private async request<T>(path: string, init: { readonly method?: string; readonly body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const requestInit: RequestInit = { method: init.method ?? "GET", headers };
    if (init.body !== undefined) requestInit.body = JSON.stringify(init.body);
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, requestInit);
    const text = await response.text();
    const value = text.length === 0 ? null : JSON.parse(text) as AgentHubJsonValue;
    if (!response.ok) throw new AgentHubApiError(response.status, value);
    return value as T;
  }
}

export type AgentHubEventView = "main" | "detail" | "raw" | "mobile";
export type AgentHubEventChannel = "sse" | "json-poll";
export type AgentHubCursorStore = {
  read(): number | Promise<number | undefined> | undefined;
  write(cursor: number): void | Promise<void>;
};
export type AgentHubEventStreamOptions = {
  readonly view?: AgentHubEventView;
  readonly roomId?: string;
  readonly runId?: string;
  readonly channel?: AgentHubEventChannel;
  readonly cursorStore?: AgentHubCursorStore;
  readonly initialCursor?: number;
  readonly reconnect?: { readonly initialDelayMs?: number; readonly maxDelayMs?: number };
  readonly pollIntervalMs?: number;
  readonly eventSourceFactory?: EventSourceFactory;
};
export type AgentHubEventStreamInit = AgentHubEventStreamOptions & {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
};
export type AgentHubEventListener = (event: EventEnvelope) => void | Promise<void>;
export type AgentHubEventErrorListener = (error: Error) => void;
export type AgentHubEventStreamStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";
export type AgentHubEventSubscription = { close(): void; readonly status: AgentHubEventStreamStatus; readonly cursor: number };
export type SyncEventsResponse = { readonly events?: readonly EventEnvelope[]; readonly data?: readonly EventEnvelope[]; readonly nextCursor?: number };
export type EventSourceLike = {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
};
export type EventSourceFactory = (url: string) => EventSourceLike;

export class AgentHubEventStream {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly channel: AgentHubEventChannel;
  private readonly view: AgentHubEventView;
  private readonly roomId: string | undefined;
  private readonly runId: string | undefined;
  private readonly token: string | undefined;
  private readonly cursorStore: AgentHubCursorStore | undefined;
  private readonly reconnectInitialDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly pollIntervalMs: number;
  private readonly eventSourceFactory: EventSourceFactory | undefined;
  private eventSource: EventSourceLike | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private reconnectDelayMs: number;
  private currentCursor = 0;
  private currentStatus: AgentHubEventStreamStatus = "idle";

  constructor(options: AgentHubEventStreamInit = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? "http://127.0.0.1:6677");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.channel = options.channel ?? "sse";
    this.view = options.view ?? "main";
    this.roomId = options.roomId;
    this.runId = options.runId;
    this.token = options.token;
    this.cursorStore = options.cursorStore;
    this.reconnectInitialDelayMs = options.reconnect?.initialDelayMs ?? 1_000;
    this.reconnectMaxDelayMs = options.reconnect?.maxDelayMs ?? 30_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.eventSourceFactory = options.eventSourceFactory;
    this.reconnectDelayMs = this.reconnectInitialDelayMs;
    this.currentCursor = options.initialCursor ?? 0;
  }

  get status(): AgentHubEventStreamStatus { return this.currentStatus; }
  get cursor(): number { return this.currentCursor; }

  subscribe(listener: AgentHubEventListener, onError?: AgentHubEventErrorListener): AgentHubEventSubscription {
    this.stopped = false;
    const thisRef = this;
    void this.open(listener, onError);
    return {
      close: () => this.close(),
      get status() { return thisRef.currentStatus; },
      get cursor() { return thisRef.currentCursor; }
    };
  }

  close(): void {
    this.stopped = true;
    this.currentStatus = "closed";
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.eventSource?.close();
    this.eventSource = undefined;
  }

  private async open(listener: AgentHubEventListener, onError?: AgentHubEventErrorListener): Promise<void> {
    try {
      this.currentCursor = await this.readCursor();
      if (this.channel === "json-poll") {
        await this.poll(listener, onError);
        return;
      }
      this.openSse(listener, onError);
    } catch (error) {
      this.handleError(error, listener, onError);
    }
  }

  private openSse(listener: AgentHubEventListener, onError?: AgentHubEventErrorListener): void {
    this.currentStatus = this.currentStatus === "idle" ? "connecting" : "reconnecting";
    const source = this.createEventSource(this.eventUrl("/event", "cursor"));
    this.eventSource = source;
    source.onopen = () => {
      this.currentStatus = "connected";
      this.reconnectDelayMs = this.reconnectInitialDelayMs;
    };
    const handleMessage = (message: MessageEvent<string>) => {
      try {
        void this.deliver(JSON.parse(message.data) as EventEnvelope, listener);
      } catch (error) {
        this.handleError(error, listener, onError);
      }
    };
    source.onmessage = handleMessage;
    for (const entry of EVENT_REGISTRY) source.addEventListener(entry.type, handleMessage);
    source.onerror = () => {
      if (this.stopped) return;
      source.close();
      this.currentStatus = "reconnecting";
      this.scheduleReconnect(listener, onError);
    };
  }

  private async poll(listener: AgentHubEventListener, onError?: AgentHubEventErrorListener): Promise<void> {
    if (this.stopped) return;
    this.currentStatus = this.currentStatus === "idle" ? "connecting" : "reconnecting";
    try {
      const response = await this.fetchImpl(this.eventUrl("/sync/events", "sinceSeq"), { headers: this.headers() });
      const text = await response.text();
      const value = text.length === 0 ? {} : JSON.parse(text) as SyncEventsResponse;
      if (!response.ok) throw new AgentHubApiError(response.status, value as AgentHubJsonValue);
      for (const event of value.events ?? value.data ?? []) await this.deliver(event, listener);
      if (typeof value.nextCursor === "number" && value.nextCursor > this.currentCursor) {
        this.currentCursor = value.nextCursor;
        await this.cursorStore?.write(this.currentCursor);
      }
      this.currentStatus = "connected";
      this.reconnectDelayMs = this.reconnectInitialDelayMs;
      this.timer = setTimeout(() => { void this.poll(listener, onError); }, this.pollIntervalMs);
    } catch (error) {
      this.handleError(error, listener, onError);
    }
  }

  private async deliver(event: EventEnvelope, listener: AgentHubEventListener): Promise<void> {
    if (typeof event.seq === "number") {
      if (event.seq <= this.currentCursor) return;
      this.currentCursor = event.seq;
      await this.cursorStore?.write(this.currentCursor);
    }
    await listener(event);
  }

  private scheduleReconnect(listener: AgentHubEventListener, onError?: AgentHubEventErrorListener): void {
    if (this.stopped) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.reconnectMaxDelayMs);
    this.timer = setTimeout(() => { void this.open(listener, onError); }, delay);
  }

  private handleError(error: unknown, listener: AgentHubEventListener, onError?: AgentHubEventErrorListener): void {
    onError?.(error instanceof Error ? error : new Error(String(error)));
    if (!this.stopped) {
      this.currentStatus = "reconnecting";
      this.scheduleReconnect(listener, onError);
    }
  }

  private async readCursor(): Promise<number> {
    const stored = await this.cursorStore?.read();
    return typeof stored === "number" && Number.isFinite(stored) ? stored : this.currentCursor;
  }

  private createEventSource(url: string): EventSourceLike {
    if (this.eventSourceFactory !== undefined) return this.eventSourceFactory(url);
    if (typeof EventSource === "undefined") throw new Error("EventSource is not available; provide eventSourceFactory or use json-poll channel");
    return new EventSource(url);
  }

  private eventUrl(path: "/event" | "/sync/events", cursorName: "cursor" | "sinceSeq"): string {
    const params = new URLSearchParams();
    params.set("view", this.view);
    if (this.roomId !== undefined) params.set("roomId", this.roomId);
    if (this.runId !== undefined) params.set("runId", this.runId);
    if (this.currentCursor > 0) params.set(cursorName, String(this.currentCursor));
    if (this.token !== undefined && path === "/event") params.set("token", this.token);
    return `${this.baseUrl}${path}?${params.toString()}`;
  }

  private headers(): HeadersInit {
    return this.token === undefined ? { accept: "application/json" } : { accept: "application/json", authorization: `Bearer ${this.token}` };
  }
}

function query(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, value);
  const text = params.toString();
  return text.length > 0 ? `?${text}` : "";
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function parseMobileConnectionConfig(input: string): MobileConnectionConfig {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error("Connection config is empty");
  const parsed = parseConnectionInput(trimmed);
  const url = configString(parsed, "url");
  const token = configString(parsed, "token");
  if (url === undefined) throw new Error("Connection config is missing url");
  if (token === undefined) throw new Error("Connection config is missing token");
  const endpoint = new URL(url);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error("Connection config url must be http or https");
  const host = configString(parsed, "host") ?? endpoint.hostname;
  const port = configNumber(parsed, "port") ?? (endpoint.port.length > 0 ? Number(endpoint.port) : null);
  const tokenId = configString(parsed, "tokenId");
  const scopes = configStringArray(parsed, "scopes");
  const expiresAt = configOptionalNumber(parsed, "expiresAt");
  return {
    version: configNumber(parsed, "version") ?? 1,
    url: normalizeBaseUrl(endpoint.toString()),
    host,
    port: Number.isFinite(port) ? port : null,
    token,
    ...(tokenId !== undefined ? { tokenId } : {}),
    ...(scopes !== undefined ? { scopes } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {})
  };
}

function parseConnectionInput(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // Fall through to URL parsing.
  }
  const url = new URL(input);
  const token = url.searchParams.get("token") ?? undefined;
  const configUrl = url.searchParams.get("url") ?? `${url.protocol}//${url.host}`;
  return { version: 1, url: configUrl, host: url.hostname, port: url.port.length > 0 ? Number(url.port) : null, ...(token !== undefined ? { token } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function configNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function configOptionalNumber(record: Record<string, unknown>, key: string): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  const value = record[key];
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function configStringArray(record: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = record[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

export class AgentHubApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`AgentHub API request failed with ${status}`);
    this.name = "AgentHubApiError";
  }
}
