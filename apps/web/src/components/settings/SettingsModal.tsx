import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Chip, Input, Label, Modal, ScrollShadow, Skeleton, Tabs, TextArea, TextField } from "@heroui/react";
import { ModelsTab, type ModelConfig } from "./ModelsTab.tsx";
import { RolesTab, type RoleConfig } from "./RolesTab.tsx";
import { RuntimesTab, type RuntimeConfig } from "./RuntimesTab.tsx";
import { formatBytes } from "../../lib/format.ts";

export type SettingsTabId = "roles" | "runtimes" | "models" | "permissions" | "workspace" | "mcp";

export const ROOM_MCP_TOOLS = [
  "room.delegate",
  "room.read_mailbox",
  "room.create_task",
  "room.update_task",
  "room.list_tasks",
  "room.send_message",
  "room.list_members",
  "room.spawn_agent",
  "room.file",
  "room.shell"
] as const;

export const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string; endpoint?: SettingsEndpoint }> = [
  { id: "roles", label: "Roles", endpoint: "roles" },
  { id: "runtimes", label: "Runtimes", endpoint: "runtimes" },
  { id: "models", label: "Models", endpoint: "modelConfigs" },
  { id: "permissions", label: "Permissions", endpoint: "permissionProfiles" },
  { id: "workspace", label: "Workspace" },
  { id: "mcp", label: "MCP" }
];

type SettingsEndpoint = "roles" | "runtimes" | "modelConfigs" | "agentBindings" | "permissionProfiles" | "permissionRules";

type SettingsData = Record<SettingsEndpoint, unknown> & { workspace: unknown };

type SettingsStatus = "idle" | "loading" | "ready" | "error";

interface SettingsModalProps {
  isOpen: boolean;
  selectedTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  onOpenChange: (open: boolean) => void;
  fetchImpl?: typeof fetch;
}

const endpointPaths: Record<SettingsEndpoint, string> = {
  roles: "/roles",
  runtimes: "/runtimes",
  modelConfigs: "/model-configs",
  agentBindings: "/agent-bindings",
  permissionProfiles: "/permissions/profiles",
  permissionRules: "/permissions/rules"
};

const emptySettingsData = (): SettingsData => ({
  roles: undefined,
  runtimes: undefined,
  modelConfigs: undefined,
  agentBindings: undefined,
  permissionProfiles: undefined,
  permissionRules: undefined,
  workspace: undefined
});

export async function fetchSettingsBootstrap(fetchImpl: typeof fetch, signal: AbortSignal): Promise<SettingsData> {
  const entries = await Promise.all(
    (Object.entries(endpointPaths) as Array<[SettingsEndpoint, string]>).map(async ([key, path]) => {
      const response = await fetchImpl(path, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal
      });
      if (!response.ok) throw new Error(`Settings bootstrap ${path} failed: ${response.status}`);
      return [key, await response.json()] as const;
    })
  );
  const data = Object.fromEntries(entries) as Omit<SettingsData, "workspace">;
  const workspaceId = extractWorkspaceId(data.agentBindings) ?? "default-workspace";
  const workspaceResponse = await fetchImpl(`/workspaces/${encodeURIComponent(workspaceId)}`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal
  });
  if (!workspaceResponse.ok) throw new Error(`Settings bootstrap /workspaces/${workspaceId} failed: ${workspaceResponse.status}`);
  return { ...data, workspace: await workspaceResponse.json() };
}

export function SettingsModal({ isOpen, selectedTab, onTabChange, onOpenChange, fetchImpl = fetch }: SettingsModalProps) {
  const [status, setStatus] = useState<SettingsStatus>("idle");
  const [data, setData] = useState<SettingsData>(() => emptySettingsData());
  const [error, setError] = useState<string | undefined>();
  const abortRef = useRef<AbortController | undefined>(undefined);

  const resetLocalState = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setStatus("idle");
    setData(emptySettingsData());
    setError(undefined);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetLocalState();
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(undefined);
    setData(emptySettingsData());

    void fetchSettingsBootstrap(fetchImpl, controller.signal)
      .then((nextData) => {
        if (controller.signal.aborted) return;
        setData(nextData);
        setStatus("ready");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });

    return () => {
      controller.abort();
      if (abortRef.current === controller) abortRef.current = undefined;
    };
  }, [fetchImpl, isOpen, resetLocalState]);

  const loading = status === "loading";
  const loadedCount = useMemo(
    () => Object.values(data).filter((value) => value !== undefined).length,
    [data]
  );

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="full" className="items-center justify-center p-4">
        <Modal.Dialog className="max-h-[92vh] w-[min(96vw,1120px)] max-w-[1120px] overflow-hidden" aria-label="Settings">
          <Modal.CloseTrigger />
          <Modal.Header className="border-b border-border bg-[linear-gradient(135deg,var(--surface),var(--surface-secondary))] px-6 py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-sm font-black text-accent-foreground shadow-[0_14px_30px_color-mix(in_oklab,var(--accent)_24%,transparent)]">
                SE
              </div>
              <div className="min-w-0">
                <Modal.Heading>Settings</Modal.Heading>
                <p className="mt-1 max-w-2xl text-sm text-muted">
                  Configure local roles, runtimes, models, permissions, workspace defaults, and MCP tool surfaces.
                </p>
              </div>
                <Chip className="ml-auto" size="sm" variant="soft" color={status === "error" ? "danger" : loading ? "warning" : "success"}>
                {loading ? "Loading" : status === "error" ? "REST error" : `${loadedCount}/7 loaded`}
                </Chip>
            </div>
          </Modal.Header>

          <Modal.Body className="max-h-[72vh] gap-0 overflow-hidden p-0">
            <Tabs selectedKey={selectedTab} onSelectionChange={(key) => onTabChange(String(key) as SettingsTabId)} className="flex min-h-0 flex-1 flex-col">
              <Tabs.ListContainer>
                <Tabs.List aria-label="Settings sections" data-testid="settings-tabs">
                  {SETTINGS_TABS.map((tab, index) => (
                    <Tabs.Tab key={tab.id} id={tab.id} data-testid={`settings-tab-${tab.id}`}>
                      {index > 0 ? <Tabs.Separator /> : null}
                      {tab.label}
                      {tab.endpoint ? (
                        <Chip className="ml-2" size="sm" variant="soft" color={data[tab.endpoint] === undefined ? "default" : "success"}>
                          {data[tab.endpoint] === undefined ? "pending" : "ready"}
                        </Chip>
                      ) : null}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>

              <ScrollShadow className="flex-1 overflow-auto" orientation="vertical">
                {SETTINGS_TABS.map((tab) => (
                  <Tabs.Panel key={tab.id} id={tab.id}>
                    <SettingsPanel
                      tab={tab}
                      loading={loading}
                      error={error}
                      data={tab.endpoint ? data[tab.endpoint] : undefined}
                      allData={data}
                      fetchImpl={fetchImpl}
                      onRolesChange={(roles) => setData((current) => ({ ...current, roles }))}
                      onRuntimesChange={(runtimes) => setData((current) => ({ ...current, runtimes }))}
                      onModelConfigsChange={(configs) => setData((current) => ({ ...current, modelConfigs: configs }))}
                      onPermissionProfilesChange={(permissionProfiles) => setData((current) => ({ ...current, permissionProfiles }))}
                      onPermissionRulesChange={(permissionRules) => setData((current) => ({ ...current, permissionRules }))}
                    />
                  </Tabs.Panel>
                ))}
              </ScrollShadow>
            </Tabs>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function SettingsPanel({
  tab,
  loading,
  error,
  data,
  allData,
  fetchImpl,
  onRolesChange,
  onRuntimesChange,
  onModelConfigsChange,
  onPermissionProfilesChange,
  onPermissionRulesChange
}: {
  tab: (typeof SETTINGS_TABS)[number];
  loading: boolean;
  error: string | undefined;
  data: unknown;
  allData: SettingsData;
  fetchImpl: typeof fetch;
  onRolesChange: (roles: RoleConfig[]) => void;
  onRuntimesChange: (runtimes: RuntimeConfig[]) => void;
  onModelConfigsChange: (configs: ModelConfig[]) => void;
  onPermissionProfilesChange: (permissionProfiles: unknown) => void;
  onPermissionRulesChange: (permissionRules: unknown) => void;
}) {
  if (tab.id === "roles" && !loading && !error && data !== undefined) {
    return <RolesTab roles={data} modelConfigs={allData.modelConfigs} fetchImpl={fetchImpl} onRolesChange={onRolesChange} />;
  }

  if (tab.id === "runtimes" && !loading && !error && data !== undefined) {
    return <RuntimesTab data={data} fetchImpl={fetchImpl} onChange={onRuntimesChange} />;
  }

  if (tab.id === "models" && !loading && !error && data !== undefined) {
    return <ModelsTab modelConfigs={data} fetchImpl={fetchImpl} onModelConfigsChange={onModelConfigsChange} />;
  }

  if (tab.id === "permissions" && !loading && !error && data !== undefined) {
    return (
      <PermissionsSettingsTab
        permissionProfiles={data}
        permissionRules={allData.permissionRules}
        fetchImpl={fetchImpl}
        onPermissionProfilesChange={onPermissionProfilesChange}
        onPermissionRulesChange={onPermissionRulesChange}
      />
    );
  }

  if (tab.id === "workspace" && !loading && !error && allData.workspace !== undefined) {
    return <WorkspaceTab workspace={allData.workspace} />;
  }

  if (tab.id === "mcp" && !loading && !error) {
    return <McpPlaceholder />;
  }

  return (
    <section className="grid gap-4 p-5" data-testid={`settings-panel-${tab.id}`}>
      <div className="rounded-2xl border border-border bg-overlay p-4 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{tab.label}</h3>
            <p className="mt-1 text-xs text-muted">{panelDescription(tab.id)}</p>
          </div>
          <Chip size="sm" variant="soft" color={tab.endpoint ? "accent" : "default"}>
            {tab.endpoint ? endpointPaths[tab.endpoint] : "placeholder"}
          </Chip>
        </div>

        {error ? <p className="mb-3 text-xs text-danger" role="alert">{error}</p> : null}
        {loading || (tab.endpoint && data === undefined) ? <SettingsSkeleton /> : <PlaceholderState tab={tab} data={data} />}
      </div>
    </section>
  );
}

function SettingsSkeleton() {
  return (
    <div className="grid gap-3" aria-label="Loading settings section">
      <Skeleton className="h-6 w-2/5 rounded-full" />
      <Skeleton className="h-20 rounded-2xl" />
      <Skeleton className="h-20 rounded-2xl" />
      <Skeleton className="h-12 rounded-2xl" />
    </div>
  );
}

function PlaceholderState({ tab, data }: { tab: (typeof SETTINGS_TABS)[number]; data: unknown }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
      <p className="font-medium text-foreground">{tab.label} content arrives in later settings tasks.</p>
      <p className="mt-1 text-xs">
        This shell keeps the data local to the modal and uses REST bootstrap data only.
        {tab.endpoint && data !== undefined ? " Endpoint payload is loaded and ready for the upcoming tab implementation." : " No live subscription is attached."}
      </p>
    </div>
  );
}

export function PermissionsSettingsTab({
  permissionProfiles,
  permissionRules,
  fetchImpl,
  onPermissionProfilesChange,
  onPermissionRulesChange
}: {
  permissionProfiles: unknown;
  permissionRules: unknown;
  fetchImpl: typeof fetch;
  onPermissionProfilesChange: (permissionProfiles: unknown) => void;
  onPermissionRulesChange: (permissionRules: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingRuleId, setDeletingRuleId] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [ruleError, setRuleError] = useState<string | undefined>(undefined);
  const profiles = normalizePermissionProfiles(permissionProfiles);
  const rules = normalizePermissionRules(permissionRules);

  const createProfile = async () => {
    if (name.trim().length === 0) return;
    setCreating(true);
    setFormError(undefined);
    try {
      const response = await fetchImpl("/permissions/profiles", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), payload: { description: description.trim() } })
      });
      if (!response.ok) throw new Error(`Create profile failed: ${response.status}`);
      const created = await response.json() as { readonly profile?: unknown; readonly profiles?: unknown[] };
      if (created.profile !== undefined) {
        onPermissionProfilesChange({ profiles: [...profiles, created.profile] });
      } else if (Array.isArray(created.profiles)) {
        onPermissionProfilesChange({ profiles: created.profiles });
      } else {
        const refreshed = await fetchJson(fetchImpl, "/permissions/profiles");
        onPermissionProfilesChange(refreshed);
      }
      setName("");
      setDescription("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const deleteRule = async (ruleId: string) => {
    setDeletingRuleId(ruleId);
    setRuleError(undefined);
    try {
      const response = await fetchImpl(`/permissions/rules/${encodeURIComponent(ruleId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { accept: "application/json" }
      });
      if (!response.ok) throw new Error(`Delete rule failed: ${response.status}`);
      onPermissionRulesChange({ rules: rules.filter((rule) => rule.id !== ruleId) });
    } catch (error) {
      setRuleError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingRuleId(undefined);
    }
  };

  return (
    <section className="grid gap-3 p-5" data-testid="settings-panel-permissions">
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <Card.Title className="text-sm">Create profile</Card.Title>
          <Card.Description className="text-xs">Create a custom permission profile for agents.</Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-3">
          <TextField value={name} onChange={setName}>
            <Label className="text-sm font-semibold">Name</Label>
            <Input placeholder="e.g. Builder Strict Clone" data-testid="permission-profile-name" />
          </TextField>
          <TextField value={description} onChange={setDescription}>
            <Label className="text-sm font-semibold">Description</Label>
            <TextArea className="min-h-24" placeholder="Explain when to use this profile" data-testid="permission-profile-description" />
          </TextField>
          {formError ? <p className="text-xs text-danger" role="alert">{formError}</p> : null}
          <div>
            <Button size="sm" variant="primary" isPending={creating} isDisabled={name.trim().length === 0} onPress={() => void createProfile()}>
              Create Profile
            </Button>
          </div>
        </Card.Content>
      </Card>
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <div className="flex flex-wrap items-center gap-2">
            <Card.Title className="text-sm">Permission rules</Card.Title>
            <Chip size="sm" variant="soft" color="success">{rules.length} loaded</Chip>
          </div>
          <Card.Description className="text-xs">
            Stored allow, deny, and ask decisions returned by GET /permissions/rules. Rule creation is not exposed by the V1.0 daemon API.
          </Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-2">
          {ruleError ? <p className="text-xs text-danger" role="alert">{ruleError}</p> : null}
          {rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface px-3 py-3 text-sm text-muted">
              No remembered permission rules are stored yet.
            </div>
          ) : rules.map((rule) => (
            <div key={rule.id} className="grid gap-2 rounded-xl border border-border bg-surface px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{rule.resourceMatch}</span>
                  <Chip size="sm" variant="soft" color={rule.action === "deny" ? "danger" : rule.action === "allow" ? "success" : "warning"}>{rule.action}</Chip>
                  <Chip size="sm" variant="soft" color="default">{rule.resourceType}</Chip>
                </div>
                <div className="mt-1 text-xs text-muted">
                  Workspace {rule.workspaceId ?? "all"}{rule.agentId ? ` · Agent ${rule.agentId}` : ""}{rule.profileId ? ` · Profile ${rule.profileId}` : ""}
                </div>
              </div>
              <Button size="sm" variant="danger" isPending={deletingRuleId === rule.id} onPress={() => void deleteRule(rule.id)}>
                Delete Rule
              </Button>
            </div>
          ))}
        </Card.Content>
      </Card>
      {profiles.map((profile) => (
        <Card key={profile.id} variant="transparent" className="border border-border">
          <Card.Header>
            <div className="flex items-center gap-2">
              <Card.Title className="text-sm">{profile.name}</Card.Title>
              <Chip size="sm" variant="soft" color="accent">profile</Chip>
            </div>
            <Card.Description className="text-xs">{profile.description ?? "No description provided."}</Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-1 text-xs text-muted">
            <div>Rules are configured per-agent-binding.</div>
            <div className="ah-mono">Profile ID: {profile.id}</div>
          </Card.Content>
        </Card>
      ))}
    </section>
  );
}

export function WorkspaceTab({ workspace }: { workspace: unknown }) {
  const rootPath = normalizeWorkspaceRootPath(workspace);
  const workspaceRecord = unwrapWorkspace(workspace);
  const workspaceName = typeof workspaceRecord.name === "string" ? workspaceRecord.name : undefined;
  const workspaceId = typeof workspaceRecord.id === "string" ? workspaceRecord.id : undefined;
  const worktreeMode = readWorkspaceString(workspace, ["worktree_mode", "worktreeMode", "workspace_mode", "workspaceMode"]);
  const artifactStorage = readWorkspaceString(workspace, ["artifact_storage", "artifactStorage", "artifact_storage_mode", "artifactStorageMode"]) ?? "Artifact storage is managed by the daemon";
  const attachmentLimit = readWorkspaceNumber(workspace, ["attachment_max_bytes", "attachmentMaxBytes", "attachment_limit_bytes", "attachmentLimitBytes"]);
  const gcPolicy = readWorkspaceString(workspace, ["gc_policy", "gcPolicy", "attachment_gc_policy", "attachmentGcPolicy"]) ?? "Garbage collection is daemon-managed";
  const updatedAt = readWorkspaceNumber(workspace, ["updated_at", "updatedAt"]);

  return (
    <section className="grid gap-4 p-5" data-testid="settings-panel-workspace">
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <div className="flex flex-wrap items-center gap-2">
            <Card.Title className="text-sm">Workspace root</Card.Title>
            <Chip size="sm" variant="soft" color="warning">Read-only</Chip>
          </div>
          <Card.Description className="text-xs">
            Local storage, artifacts, and attachment cleanup all resolve from this path. No PATCH /workspaces endpoint is exposed in V1.0.
          </Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-2 text-sm">
          <div><span className="text-muted">Name:</span> {workspaceName ?? workspaceId ?? "Workspace"}</div>
          <div><span className="text-muted">Configuration endpoint:</span> GET /workspaces/{workspaceId ?? "default-workspace"}</div>
          <div className="ah-mono rounded-xl border border-border bg-surface px-3 py-2 text-xs">{rootPath}</div>
          <div><span className="text-muted">Worktree mode:</span> {worktreeMode ?? "Not reported"}</div>
          <div><span className="text-muted">Artifacts:</span> {artifactStorage}</div>
          <div><span className="text-muted">Attachment limit:</span> {attachmentLimit !== undefined ? formatBytes(attachmentLimit) : "Not reported"}</div>
          <div><span className="text-muted">GC:</span> {gcPolicy}</div>
          <div><span className="text-muted">Last updated:</span> {updatedAt !== undefined ? String(updatedAt) : "Not reported"}</div>
        </Card.Content>
      </Card>
    </section>
  );
}

export function McpPlaceholder() {
  return (
    <section className="grid gap-4 p-5" data-testid="settings-panel-mcp">
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <div className="flex flex-wrap items-center gap-2">
            <Card.Title className="text-sm">MCP / Tools</Card.Title>
            <Chip size="sm" variant="soft" color="warning">Read-only</Chip>
          </div>
          <Card.Description className="text-xs">MCP server management coming in V1.1. This release shows the enabled V1.0 room tools.</Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-3 text-sm text-muted">
          <p>Existing room tools remain available, but external server management is not editable yet.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROOM_MCP_TOOLS.map((tool) => (
              <div key={tool} className="ah-mono rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground">
                {tool}
              </div>
            ))}
          </div>
        </Card.Content>
      </Card>
    </section>
  );
}

async function fetchJson(fetchImpl: typeof fetch, path: string): Promise<unknown> {
  const response = await fetchImpl(path, {
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Fetch ${path} failed: ${response.status}`);
  return response.json();
}

function normalizePermissionProfiles(value: unknown): Array<{
  readonly id: string;
  readonly name: string;
  readonly description: string | undefined;
}> {
  const profiles = value && typeof value === "object" && Array.isArray((value as { readonly profiles?: unknown }).profiles)
    ? (value as { readonly profiles: unknown[] }).profiles
    : [];
  return profiles.flatMap((profile) => {
    if (!profile || typeof profile !== "object") return [];
    const record = profile as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : undefined;
    const name = typeof record.name === "string" ? record.name : undefined;
    if (!id || !name) return [];
    const payload = profile && typeof profile === "object" && typeof record.payload === "object" && record.payload !== null ? record.payload as Record<string, unknown> : undefined;
    return [{
      id,
      name,
      description: typeof record.description === "string" ? record.description : typeof payload?.description === "string" ? payload.description : undefined
    }];
  });
}

function normalizePermissionRules(value: unknown): Array<{
  readonly id: string;
  readonly workspaceId: string | undefined;
  readonly agentId: string | undefined;
  readonly profileId: string | undefined;
  readonly resourceType: string;
  readonly resourceMatch: string;
  readonly action: "allow" | "deny" | "ask" | string;
}> {
  const rules = value && typeof value === "object" && Array.isArray((value as { readonly rules?: unknown }).rules)
    ? (value as { readonly rules: unknown[] }).rules
    : [];
  return rules.flatMap((rule) => {
    if (!rule || typeof rule !== "object") return [];
    const record = rule as Record<string, unknown>;
    const id = readStringFromRecord(record, ["id"]);
    const resourceType = readStringFromRecord(record, ["resource_type", "resourceType"]) ?? "resource";
    const resourceMatch = readStringFromRecord(record, ["resource_match", "resourceMatch"]) ?? "*";
    const action = readStringFromRecord(record, ["action"]) ?? "ask";
    if (!id) return [];
    return [{
      id,
      workspaceId: readStringFromRecord(record, ["workspace_id", "workspaceId"]),
      agentId: readStringFromRecord(record, ["agent_id", "agentId"]),
      profileId: readStringFromRecord(record, ["profile_id", "profileId"]),
      resourceType,
      resourceMatch,
      action
    }];
  });
}

function normalizeWorkspaceRootPath(workspace: unknown): string {
  const record = unwrapWorkspace(workspace);
  if (typeof record.root_path === "string") return record.root_path;
  if (typeof record.rootPath === "string") return record.rootPath;
  return ".";
}

function readWorkspaceString(workspace: unknown, keys: readonly string[]): string | undefined {
  const record = unwrapWorkspace(workspace);
  for (const key of keys) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return undefined;
}

function readWorkspaceNumber(workspace: unknown, keys: readonly string[]): number | undefined {
  const record = unwrapWorkspace(workspace);
  for (const key of keys) {
    if (typeof record[key] === "number" && Number.isFinite(record[key])) return record[key] as number;
    if (typeof record[key] === "string" && record[key].trim().length > 0) {
      const parsed = Number(record[key]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function unwrapWorkspace(workspace: unknown): Record<string, unknown> {
  if (!workspace || typeof workspace !== "object") return {};
  const record = workspace as Record<string, unknown>;
  const nested = record.workspace;
  return nested && typeof nested === "object" ? nested as Record<string, unknown> : record;
}

function readStringFromRecord(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].length > 0) return record[key] as string;
  }
  return undefined;
}

function extractWorkspaceId(agentBindings: unknown): string | undefined {
  if (!agentBindings || typeof agentBindings !== "object") return undefined;
  const bindings = (agentBindings as { readonly agentBindings?: unknown }).agentBindings;
  if (!Array.isArray(bindings)) return undefined;
  for (const binding of bindings) {
    if (!binding || typeof binding !== "object") continue;
    const record = binding as Record<string, unknown>;
    if (typeof record.workspaceId === "string" && record.workspaceId.length > 0) return record.workspaceId;
  }
  return undefined;
}

function panelDescription(tab: SettingsTabId): string {
  switch (tab) {
    case "roles":
      return "Role templates and editable agent responsibilities.";
    case "runtimes":
      return "Local runtime detection and command configuration.";
    case "models":
      return "Provider, model, keychain, and test-call configuration.";
    case "permissions":
      return "Agent binding and permission-profile assignments.";
    case "workspace":
      return "Workspace root, artifacts, attachment limits, and cleanup policy.";
    case "mcp":
      return "MCP/tool management is read-only in V1.0.";
  }
}
