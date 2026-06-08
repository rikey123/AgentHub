export type AgentHubClientOptions = { readonly baseUrl?: string; readonly token?: string; readonly fetchImpl?: typeof fetch };
export type SendMessageContextRef =
  | { readonly type: "artifact"; readonly artifactId: string; readonly lineStart?: number | undefined; readonly lineEnd?: number | undefined; readonly slide?: number | undefined }
  | { readonly type: "workspace"; readonly path: string; readonly lineStart?: number | undefined; readonly lineEnd?: number | undefined };
export type SendMessageInput = {
  readonly text: string;
  readonly idempotencyKey?: string;
  readonly quotedMessageId?: string;
  readonly attachmentIds?: readonly string[];
  readonly mentions?: readonly string[];
  readonly refs?: readonly SendMessageContextRef[];
};
export type CreateRoomInput = {
  readonly title?: string;
  readonly mode?: "solo" | "assisted" | "squad" | "team";
  readonly workspaceId?: string;
  readonly primaryAgentId?: string;
  readonly leaderRoleId?: string;
  readonly agentBindingId?: string;
  readonly skillIds?: readonly string[];
  readonly participantSkillAssignments?: readonly {
    readonly participantId: string;
    readonly skillIds: readonly string[];
    readonly mode?: "add" | "restrict";
  }[];
  readonly participants?: readonly unknown[];
};

export class AgentHubClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AgentHubClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:6677";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  health(): Promise<unknown> { return this.request("/healthz"); }
  openApi(): Promise<unknown> { return this.request("/openapi.json"); }
  listRooms(): Promise<unknown> { return this.request("/rooms"); }
  createRoom(input: CreateRoomInput): Promise<unknown> { return this.request("/rooms", { method: "POST", body: input }); }
  listMessages(roomId: string): Promise<unknown> { return this.request(`/rooms/${encodeURIComponent(roomId)}/messages`); }
  sendMessage(roomId: string, input: SendMessageInput): Promise<unknown> { return this.request(`/rooms/${encodeURIComponent(roomId)}/messages`, { method: "POST", body: input }); }
  stopDiscussion(roomId: string): Promise<unknown> { return this.request(`/rooms/${encodeURIComponent(roomId)}/discussion/stop`, { method: "POST" }); }
  listAgents(): Promise<unknown> { return this.request("/agents"); }
  getRun(runId: string): Promise<unknown> { return this.request(`/runs/${encodeURIComponent(runId)}`); }
  listContext(filters: { readonly workspaceId?: string; readonly roomId?: string; readonly taskId?: string; readonly status?: string } = {}): Promise<unknown> { return this.request(`/context${query(filters)}`); }
  proposeContext(input: Record<string, unknown>): Promise<unknown> { return this.request("/context/propose", { method: "POST", body: input }); }
  writeContext(input: Record<string, unknown>): Promise<unknown> { return this.request("/context/write", { method: "POST", body: input }); }
  updateContext(contextId: string, input: Record<string, unknown>): Promise<unknown> { return this.request(`/context/${encodeURIComponent(contextId)}`, { method: "PATCH", body: input }); }
  confirmContext(contextId: string, input: { readonly baseVersion?: number; readonly idempotencyKey?: string } = {}): Promise<unknown> { return this.request(`/context/${encodeURIComponent(contextId)}/confirm`, { method: "POST", body: input }); }
  deprecateContext(contextId: string, input: { readonly baseVersion: number; readonly reason?: string; readonly idempotencyKey?: string }): Promise<unknown> { return this.request(`/context/${encodeURIComponent(contextId)}/deprecate`, { method: "POST", body: input }); }
  pinContext(contextId: string, input: { readonly baseVersion: number; readonly idempotencyKey?: string }): Promise<unknown> { return this.request(`/context/${encodeURIComponent(contextId)}/pin`, { method: "POST", body: input }); }
  listPermissionProfiles(): Promise<unknown> { return this.request("/permissions/profiles"); }
  getPermissionProfile(profileId: string): Promise<unknown> { return this.request(`/permissions/profiles/${encodeURIComponent(profileId)}`); }
  createPermissionProfile(input: { readonly id?: string; readonly name: string; readonly payload: unknown }): Promise<unknown> { return this.request("/permissions/profiles", { method: "POST", body: input }); }
  patchPermissionProfile(profileId: string, input: { readonly name: string; readonly payload: unknown }): Promise<unknown> { return this.request(`/permissions/profiles/${encodeURIComponent(profileId)}`, { method: "PATCH", body: input }); }
  listPermissionRequests(filters: { readonly status?: string; readonly roomId?: string } = {}): Promise<unknown> { return this.request(`/permissions/requests${query(filters)}`); }
  resolvePermission(requestId: string, input: { readonly decision: "allow" | "deny"; readonly remember?: boolean; readonly scope?: string; readonly idempotencyKey?: string }): Promise<unknown> { return this.request(`/permissions/${encodeURIComponent(requestId)}/resolve`, { method: "POST", body: input }); }
  listPermissionRules(filters: { readonly workspaceId?: string } = {}): Promise<unknown> { return this.request(`/permissions/rules${query(filters)}`); }
  deletePermissionRule(ruleId: string): Promise<unknown> { return this.request(`/permissions/rules/${encodeURIComponent(ruleId)}`, { method: "DELETE" }); }
  listInterventions(filters: { readonly roomId?: string; readonly status?: string } = {}): Promise<unknown> { return this.request(`/interventions${query(filters)}`); }
  getIntervention(interventionId: string): Promise<unknown> { return this.request(`/interventions/${encodeURIComponent(interventionId)}`); }
  requestIntervention(input: Record<string, unknown>): Promise<unknown> { return this.request("/interventions", { method: "POST", body: input }); }
  approveIntervention(interventionId: string, input: { readonly effectiveText?: string; readonly idempotencyKey?: string } = {}): Promise<unknown> { return this.request(`/interventions/${encodeURIComponent(interventionId)}/approve`, { method: "POST", body: input }); }
  ignoreIntervention(interventionId: string, input: { readonly idempotencyKey?: string } = {}): Promise<unknown> { return this.request(`/interventions/${encodeURIComponent(interventionId)}/ignore`, { method: "POST", body: input }); }
  rejectIntervention(interventionId: string, input: { readonly reason?: string; readonly idempotencyKey?: string } = {}): Promise<unknown> { return this.request(`/interventions/${encodeURIComponent(interventionId)}/reject`, { method: "POST", body: input }); }
  snoozeIntervention(interventionId: string, input: { readonly snoozeSeconds?: number; readonly idempotencyKey?: string } = {}): Promise<unknown> { return this.request(`/interventions/${encodeURIComponent(interventionId)}/later`, { method: "POST", body: input }); }
  listArtifacts(filters: { readonly roomId?: string; readonly taskId?: string; readonly status?: string } = {}): Promise<unknown> { return this.request(`/artifacts${query(filters)}`); }
  getArtifact(artifactId: string): Promise<unknown> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}`); }
  createArtifact(input: Record<string, unknown>): Promise<unknown> { return this.request("/artifacts", { method: "POST", body: input }); }
  reviewArtifact(artifactId: string, input: { readonly idempotencyKey?: string } = {}): Promise<unknown> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/review`, { method: "POST", body: input }); }
  applyDiff(artifactId: string, input: { readonly idempotencyKey?: string } = {}): Promise<unknown> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/apply`, { method: "POST", body: input }); }
  rejectDiff(artifactId: string, input: { readonly reason?: string; readonly idempotencyKey?: string } = {}): Promise<unknown> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/reject`, { method: "POST", body: input }); }
  revertArtifact(artifactId: string, input: { readonly idempotencyKey?: string } = {}): Promise<unknown> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/revert`, { method: "POST", body: input }); }
  listArtifactFiles(artifactId: string): Promise<unknown> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/files`); }
  getArtifactFileContent(artifactId: string, path: string): Promise<unknown> { return this.request(`/artifacts/${encodeURIComponent(artifactId)}/files/${encodeURIComponent(path)}`); }
  debugEvents(filters: { readonly traceId?: string; readonly runId?: string; readonly roomId?: string; readonly type?: string; readonly since?: string; readonly until?: string; readonly limit?: string } = {}): Promise<unknown> { return this.request(`/debug/events${query(filters)}`); }
  debugStats(): Promise<unknown> { return this.request("/debug/stats"); }

  private async request(path: string, init: { readonly method?: string; readonly body?: unknown } = {}): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const requestInit: RequestInit = { method: init.method ?? "GET", headers };
    if (init.body !== undefined) requestInit.body = JSON.stringify(init.body);
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, requestInit);
    const text = await response.text();
    const value = text.length === 0 ? null : JSON.parse(text) as unknown;
    if (!response.ok) throw new AgentHubApiError(response.status, value);
    return value;
  }
}

function query(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, value);
  const text = params.toString();
  return text.length > 0 ? `?${text}` : "";
}

export class AgentHubApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`AgentHub API request failed with ${status}`);
    this.name = "AgentHubApiError";
  }
}
