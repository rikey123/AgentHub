import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Chip, Input, Label, Modal, ScrollShadow, Skeleton, Tabs, TextArea, TextField } from "@heroui/react";
import { ModelsTab, type ModelConfig } from "./ModelsTab.tsx";
import { RolesTab, type RoleConfig } from "./RolesTab.tsx";
import { RuntimesTab, type RuntimeConfig } from "./RuntimesTab.tsx";
import { SkillsTab, type SkillConfig } from "./SkillsTab.tsx";
import { formatBytes } from "../../lib/format.ts";

export type SettingsTabId = "roles" | "runtimes" | "models" | "skills" | "permissions" | "workspace" | "deploy-providers" | "mcp";

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
  { id: "skills", label: "Skills", endpoint: "skills" },
  { id: "permissions", label: "Permissions", endpoint: "permissionProfiles" },
  { id: "workspace", label: "Workspace" },
  { id: "deploy-providers", label: "Deploy Providers", endpoint: "deploymentProviders" },
  { id: "mcp", label: "MCP" }
];

type SettingsEndpoint = "roles" | "runtimes" | "modelConfigs" | "skills" | "agentBindings" | "permissionProfiles" | "permissionRules" | "deploymentProviders";

type SettingsData = Record<SettingsEndpoint, unknown> & {
  workspace: unknown;
  errors: Partial<Record<SettingsEndpoint | "workspace", string>>;
};

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
  skills: "/skills",
  agentBindings: "/agent-bindings",
  permissionProfiles: "/permissions/profiles",
  permissionRules: "/permissions/rules",
  deploymentProviders: "/deployment-providers"
};

const emptySettingsData = (): SettingsData => ({
  roles: undefined,
  runtimes: undefined,
  modelConfigs: undefined,
  skills: undefined,
  agentBindings: undefined,
  permissionProfiles: undefined,
  permissionRules: undefined,
  deploymentProviders: undefined,
  workspace: undefined,
  errors: {}
});

export async function fetchSettingsBootstrap(fetchImpl: typeof fetch, signal: AbortSignal): Promise<SettingsData> {
  const results = await Promise.all(
    (Object.entries(endpointPaths) as Array<[SettingsEndpoint, string]>).map(async ([key, path]) => {
      try {
        const response = await fetchImpl(path, {
          credentials: "same-origin",
          headers: { accept: "application/json" },
          signal
        });
        if (!response.ok) throw new Error(`Settings bootstrap ${path} failed: ${response.status}`);
        return { key, value: await response.json() } as const;
      } catch (error) {
        if (isAbortError(error)) throw error;
        return { key, error: errorMessage(error) } as const;
      }
    })
  );
  const data = emptySettingsData();
  for (const result of results) {
    if ("error" in result) {
      data.errors[result.key] = result.error;
    } else {
      data[result.key] = result.value;
    }
  }
  const workspaceId = extractWorkspaceId(data.agentBindings) ?? "default-workspace";
  try {
    const workspaceResponse = await fetchImpl(`/workspaces/${encodeURIComponent(workspaceId)}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal
    });
    if (!workspaceResponse.ok) throw new Error(`Settings bootstrap /workspaces/${workspaceId} failed: ${workspaceResponse.status}`);
    data.workspace = await workspaceResponse.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    data.errors.workspace = errorMessage(error);
  }
  return data;
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
        setStatus(Object.keys(nextData.errors).length > 0 ? "error" : "ready");
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
  const loadedCount = useMemo(() => settingsLoadedCount(data), [data]);
  const expectedLoadedCount = Object.keys(endpointPaths).length + 1;
  const errorCount = Object.keys(data.errors).length;
  const allDataEndpointsFailed = errorCount >= Object.keys(endpointPaths).length && loadedCount === 0;

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="full" className="items-center justify-center p-4">
        <Modal.Dialog className="flex h-[min(92vh,900px)] w-[min(96vw,1120px)] max-w-[1120px] overflow-hidden p-0" aria-label="Settings">
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
                {loading ? "Loading" : status === "error" ? `${errorCount} REST error${errorCount === 1 ? "" : "s"}` : `${loadedCount}/${expectedLoadedCount} loaded`}
                </Chip>
            </div>
          </Modal.Header>

          <Modal.Body className="min-h-0 flex-1 gap-0 overflow-hidden p-0">
            <Tabs selectedKey={selectedTab} onSelectionChange={(key) => onTabChange(String(key) as SettingsTabId)} className="flex h-full min-h-0 flex-1 flex-col">
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

              <ScrollShadow className="min-h-0 flex-1 overflow-auto pb-8" orientation="vertical">
                {SETTINGS_TABS.map((tab) => (
                  <Tabs.Panel key={tab.id} id={tab.id}>
                    <SettingsPanel
                      tab={tab}
                      loading={loading}
                      error={tab.endpoint ? data.errors[tab.endpoint] : tab.id === "workspace" ? data.errors.workspace : allDataEndpointsFailed ? error : undefined}
                      data={tab.endpoint ? data[tab.endpoint] : undefined}
                      allData={data}
                      fetchImpl={fetchImpl}
                      onRolesChange={(roles) => setData((current) => ({ ...current, roles }))}
                      onRuntimesChange={(runtimes) => setData((current) => ({ ...current, runtimes }))}
                      onModelConfigsChange={(configs) => setData((current) => ({ ...current, modelConfigs: configs }))}
                      onSkillsChange={(skills) => setData((current) => ({ ...current, skills: { skills } }))}
                      onPermissionProfilesChange={(permissionProfiles) => setData((current) => ({ ...current, permissionProfiles }))}
                      onPermissionRulesChange={(permissionRules) => setData((current) => ({ ...current, permissionRules }))}
                      onDeploymentProvidersChange={(deploymentProviders) => setData((current) => ({ ...current, deploymentProviders }))}
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

export function SettingsPanel({
  tab,
  loading,
  error,
  data,
  allData,
  fetchImpl,
  onRolesChange,
  onRuntimesChange,
  onModelConfigsChange,
  onSkillsChange,
  onPermissionProfilesChange,
  onPermissionRulesChange,
  onDeploymentProvidersChange
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
  onSkillsChange: (skills: SkillConfig[]) => void;
  onPermissionProfilesChange: (permissionProfiles: unknown) => void;
  onPermissionRulesChange: (permissionRules: unknown) => void;
  onDeploymentProvidersChange: (deploymentProviders: unknown) => void;
}) {
  if (tab.id === "roles" && data !== undefined) {
    return <RolesTab roles={data} modelConfigs={allData.modelConfigs} fetchImpl={fetchImpl} onRolesChange={onRolesChange} />;
  }

  if (tab.id === "runtimes" && data !== undefined) {
    return <RuntimesTab data={data} fetchImpl={fetchImpl} onChange={onRuntimesChange} />;
  }

  if (tab.id === "models" && data !== undefined) {
    return <ModelsTab modelConfigs={data} fetchImpl={fetchImpl} onModelConfigsChange={onModelConfigsChange} />;
  }

  if (tab.id === "skills" && data !== undefined) {
    return <SkillsTab skills={data} runtimes={allData.runtimes} fetchImpl={fetchImpl} onSkillsChange={onSkillsChange} />;
  }

  if (tab.id === "permissions" && data !== undefined) {
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

  if (tab.id === "workspace" && allData.workspace !== undefined) {
    return <WorkspaceTab workspace={allData.workspace} />;
  }

  if (tab.id === "deploy-providers" && data !== undefined) {
    return <DeployProvidersSettingsTab providers={data} fetchImpl={fetchImpl} onProvidersChange={onDeploymentProvidersChange} />;
  }

  if (tab.id === "mcp" && !loading) {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function settingsLoadedCount(data: SettingsData): number {
  const endpointCount = (Object.keys(endpointPaths) as SettingsEndpoint[]).filter((key) => data[key] !== undefined).length;
  return endpointCount + (data.workspace !== undefined ? 1 : 0);
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

export type DeploymentProviderConfig = {
  readonly id: string;
  readonly kind: "caprover";
  readonly name: string;
  readonly baseUrl: string;
  readonly workspaceId?: string | undefined;
  readonly hasCredential: boolean;
  readonly masked: boolean;
  readonly createdAt?: number | undefined;
  readonly updatedAt?: number | undefined;
};

type DeploymentProviderInput = {
  readonly kind: "caprover";
  readonly name: string;
  readonly baseUrl: string;
  readonly credential: string;
};

type DeploymentProviderUpdateInput = {
  readonly name: string;
  readonly baseUrl: string;
  readonly credential?: string | undefined;
};

type DeploymentProviderTestResult = {
  readonly ok: boolean;
  readonly version?: string | undefined;
  readonly error?: string | undefined;
};

export function DeployProvidersSettingsTab({
  providers,
  fetchImpl,
  onProvidersChange
}: {
  providers: unknown;
  fetchImpl: typeof fetch;
  onProvidersChange: (providers: unknown) => void;
}) {
  const normalized = normalizeDeploymentProviders(providers);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [credential, setCredential] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [pendingId, setPendingId] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [testResultsByProvider, setTestResultsByProvider] = useState<Record<string, DeploymentProviderTestResult>>({});
  const providerTestGenerationsRef = useRef<Record<string, number>>({});

  const resetForm = () => {
    setEditingId(undefined);
    setName("");
    setBaseUrl("");
    setCredential("");
    setFormError(undefined);
  };

  const submit = async () => {
    if (name.trim().length === 0 || baseUrl.trim().length === 0) return;
    if (!editingId && credential.trim().length === 0) {
      setFormError("API token is required when adding a provider.");
      return;
    }
    setPendingId("form");
    setFormError(undefined);
    try {
      const provider = editingId
        ? await updateDeploymentProvider(fetchImpl, editingId, {
            name: name.trim(),
            baseUrl: baseUrl.trim(),
            ...(credential.trim().length > 0 ? { credential: credential.trim() } : {})
          })
        : await createDeploymentProvider(fetchImpl, {
            kind: "caprover",
            name: name.trim(),
            baseUrl: baseUrl.trim(),
            credential: credential.trim()
          });
      const next = editingId
        ? normalized.map((item) => item.id === provider.id ? provider : item)
        : [...normalized, provider];
      providerTestGenerationsRef.current = bumpDeploymentProviderTestGenerations(providerTestGenerationsRef.current, [provider.id]);
      setTestResultsByProvider((current) => clearDeploymentProviderTestResultsForChangedProviders(current, next, [provider.id]));
      onProvidersChange({ providers: next });
      resetForm();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setPendingId(undefined);
    }
  };

  const edit = (provider: DeploymentProviderConfig) => {
    setEditingId(provider.id);
    setName(provider.name);
    setBaseUrl(provider.baseUrl);
    setCredential("");
    setFormError(undefined);
  };

  const test = async (providerId: string) => {
    if (!(providerId in providerTestGenerationsRef.current)) {
      providerTestGenerationsRef.current = { ...providerTestGenerationsRef.current, [providerId]: 0 };
    }
    const generation = providerTestGenerationsRef.current[providerId] ?? 0;
    setPendingId(providerId);
    setTestResultsByProvider((current) => updateDeploymentProviderTestResults(current, providerId, undefined));
    try {
      const result = await testDeploymentProvider(fetchImpl, providerId);
      if (!shouldApplyDeploymentProviderTestResult(providerTestGenerationsRef.current, providerId, generation)) return;
      setTestResultsByProvider((current) => updateDeploymentProviderTestResults(current, providerId, result));
    } catch (error) {
      if (!shouldApplyDeploymentProviderTestResult(providerTestGenerationsRef.current, providerId, generation)) return;
      setTestResultsByProvider((current) => updateDeploymentProviderTestResults(current, providerId, { ok: false, error: errorMessage(error) }));
    } finally {
      setPendingId(undefined);
    }
  };

  const remove = async (providerId: string) => {
    setPendingId(providerId);
    setFormError(undefined);
    try {
      await deleteDeploymentProvider(fetchImpl, providerId);
      const next = normalized.filter((provider) => provider.id !== providerId);
      providerTestGenerationsRef.current = bumpDeploymentProviderTestGenerations(providerTestGenerationsRef.current, [providerId]);
      setTestResultsByProvider((current) => clearDeploymentProviderTestResultsForChangedProviders(current, next, [providerId]));
      onProvidersChange({ providers: next });
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setPendingId(undefined);
    }
  };

  return (
    <section className="grid gap-4 p-5" data-testid="settings-panel-deploy-providers">
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <div className="flex flex-wrap items-center gap-2">
            <Card.Title className="text-sm">Deploy Providers</Card.Title>
            <Chip size="sm" variant="soft" color="accent">CapRover</Chip>
          </div>
          <Card.Description className="text-xs">
            V1.2 only supports CapRover self-hosted deployment providers. Tokens are stored in the daemon keychain and are never echoed back.
          </Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-3">
          {normalized.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface px-3 py-3 text-sm text-muted">
              <div className="font-semibold text-foreground">Add a CapRover provider</div>
              <div className="mt-1 text-xs">Configure a CapRover base URL and API token to enable self-hosted deployments.</div>
            </div>
          ) : normalized.map((provider) => {
            const testResult = testResultsByProvider[provider.id];
            return (
              <div key={provider.id} className="grid gap-3 rounded-xl border border-border bg-surface px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{provider.name}</span>
                    <Chip size="sm" variant="soft" color="success">CapRover</Chip>
                    <Chip size="sm" variant="soft" color={provider.hasCredential ? "success" : "warning"}>
                      {provider.hasCredential ? "Credential stored" : "Credential missing"}
                    </Chip>
                  </div>
                  <div className="mt-1 break-all text-xs text-muted">{provider.baseUrl}</div>
                  {testResult && pendingId !== provider.id ? (
                    <div className={`mt-1 text-xs ${testResult.ok ? "text-success" : "text-danger"}`}>
                      {testResult.ok ? `Connection ready${testResult.version ? ` (${testResult.version})` : ""}` : testResult.error ?? "Connection failed"}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" isPending={pendingId === provider.id} onPress={() => void test(provider.id)}>Test Connection</Button>
                  <Button size="sm" variant="secondary" onPress={() => edit(provider)}>Edit</Button>
                  <Button size="sm" variant="danger" isPending={pendingId === provider.id} onPress={() => void remove(provider.id)}>Delete</Button>
                </div>
              </div>
            );
          })}
        </Card.Content>
      </Card>
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <Card.Title className="text-sm">{editingId ? "Edit CapRover provider" : "Add CapRover provider"}</Card.Title>
          <Card.Description className="text-xs">Use the CapRover base URL and API token from your self-hosted instance.</Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-3">
          <TextField value={name} onChange={setName}>
            <Label className="text-sm font-semibold">Name</Label>
            <Input placeholder="Production Captain" data-testid="deployment-provider-name" />
          </TextField>
          <TextField value={baseUrl} onChange={setBaseUrl}>
            <Label className="text-sm font-semibold">Base URL</Label>
            <Input placeholder="https://captain.example.com" data-testid="deployment-provider-base-url" />
          </TextField>
          <TextField value={credential} onChange={setCredential}>
            <Label className="text-sm font-semibold">API token</Label>
            <Input placeholder={editingId ? "Leave blank to keep existing token" : "CapRover API token"} type="password" data-testid="deployment-provider-token" />
          </TextField>
          {formError ? <p className="text-xs text-danger" role="alert">{formError}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" isPending={pendingId === "form"} isDisabled={name.trim().length === 0 || baseUrl.trim().length === 0 || (!editingId && credential.trim().length === 0)} onPress={() => void submit()}>
              {editingId ? "Save Provider" : "Create Provider"}
            </Button>
            {editingId ? <Button size="sm" variant="secondary" onPress={resetForm}>Cancel Edit</Button> : null}
          </div>
        </Card.Content>
      </Card>
    </section>
  );
}

export function normalizeDeploymentProviders(value: unknown): DeploymentProviderConfig[] {
  const rows = value && typeof value === "object" && Array.isArray((value as { readonly providers?: unknown }).providers)
    ? (value as { readonly providers: unknown[] }).providers
    : [];
  return rows.flatMap((provider) => {
    if (!provider || typeof provider !== "object") return [];
    const record = provider as Record<string, unknown>;
    const id = readStringFromRecord(record, ["id"]);
    const kind = readStringFromRecord(record, ["kind"]);
    const name = readStringFromRecord(record, ["name"]);
    const baseUrl = readStringFromRecord(record, ["baseUrl", "base_url"]);
    if (!id || kind !== "caprover" || !name || !baseUrl) return [];
    return [{
      id,
      kind,
      name,
      baseUrl,
      workspaceId: readStringFromRecord(record, ["workspaceId", "workspace_id"]),
      hasCredential: readBooleanFromRecord(record, ["hasCredential", "has_credential"]) ?? readStringFromRecord(record, ["credentialRef", "credential_ref"]) !== undefined,
      masked: readBooleanFromRecord(record, ["masked"]) ?? readStringFromRecord(record, ["credentialRef", "credential_ref"]) !== undefined,
      createdAt: readNumberFromRecord(record, ["createdAt", "created_at"]),
      updatedAt: readNumberFromRecord(record, ["updatedAt", "updated_at"])
    }];
  });
}

export async function createDeploymentProvider(fetchImpl: typeof fetch, input: DeploymentProviderInput): Promise<DeploymentProviderConfig> {
  const response = await fetchImpl("/deployment-providers", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return readDeploymentProviderResponse(response);
}

export async function updateDeploymentProvider(fetchImpl: typeof fetch, providerId: string, input: DeploymentProviderUpdateInput): Promise<DeploymentProviderConfig> {
  const response = await fetchImpl(`/deployment-providers/${encodeURIComponent(providerId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return readDeploymentProviderResponse(response);
}

export async function testDeploymentProvider(fetchImpl: typeof fetch, providerId: string): Promise<DeploymentProviderTestResult> {
  const response = await fetchImpl(`/deployment-providers/${encodeURIComponent(providerId)}/test`, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Test deployment provider failed: ${response.status}`);
  return response.json() as Promise<DeploymentProviderTestResult>;
}

export function updateDeploymentProviderTestResults(
  current: Readonly<Record<string, DeploymentProviderTestResult>>,
  providerId: string,
  result: DeploymentProviderTestResult | undefined
): Record<string, DeploymentProviderTestResult> {
  const next = { ...current };
  if (result === undefined) {
    delete next[providerId];
    return next;
  }
  next[providerId] = result;
  return next;
}

export function clearDeploymentProviderTestResultsForChangedProviders(
  current: Readonly<Record<string, DeploymentProviderTestResult>>,
  providers: readonly DeploymentProviderConfig[],
  changedProviderIds: readonly string[]
): Record<string, DeploymentProviderTestResult> {
  const providerIds = new Set(providers.map((provider) => provider.id));
  const changedIds = new Set(changedProviderIds);
  const next: Record<string, DeploymentProviderTestResult> = {};
  for (const [providerId, result] of Object.entries(current)) {
    if (!providerIds.has(providerId) || changedIds.has(providerId)) continue;
    next[providerId] = result;
  }
  return next;
}

export function shouldApplyDeploymentProviderTestResult(
  generations: Readonly<Record<string, number>>,
  providerId: string,
  testedGeneration: number
): boolean {
  return generations[providerId] === testedGeneration;
}

function bumpDeploymentProviderTestGenerations(
  current: Readonly<Record<string, number>>,
  providerIds: readonly string[]
): Record<string, number> {
  const next = { ...current };
  for (const providerId of providerIds) {
    next[providerId] = (next[providerId] ?? 0) + 1;
  }
  return next;
}

export async function deleteDeploymentProvider(fetchImpl: typeof fetch, providerId: string): Promise<void> {
  const response = await fetchImpl(`/deployment-providers/${encodeURIComponent(providerId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Delete deployment provider failed: ${response.status}`);
}

async function readDeploymentProviderResponse(response: Response): Promise<DeploymentProviderConfig> {
  if (!response.ok) throw new Error(`Deployment provider request failed: ${response.status}`);
  const payload = await response.json() as { readonly provider?: unknown };
  const provider = normalizeDeploymentProviders({ providers: payload.provider !== undefined ? [payload.provider] : [] })[0];
  if (provider === undefined) throw new Error("Deployment provider response missing provider");
  return provider;
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

function readNumberFromRecord(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    if (typeof record[key] === "number" && Number.isFinite(record[key])) return record[key] as number;
    if (typeof record[key] === "string" && record[key].trim().length > 0) {
      const parsed = Number(record[key]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readBooleanFromRecord(record: Record<string, unknown>, keys: readonly string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof record[key] === "boolean") return record[key] as boolean;
    if (typeof record[key] === "number") return record[key] !== 0;
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
    case "skills":
      return "Standard SKILL.md packages for room and agent capability guidance.";
    case "permissions":
      return "Agent binding and permission-profile assignments.";
    case "workspace":
      return "Workspace root, artifacts, attachment limits, and cleanup policy.";
    case "deploy-providers":
      return "CapRover provider credentials and connection checks for V1.2 deployments.";
    case "mcp":
      return "MCP/tool management is read-only in V1.0.";
  }
}
