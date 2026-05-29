import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Chip, Modal, ScrollShadow, Skeleton, Tabs } from "@heroui/react";
import { ModelsTab, type ModelConfig } from "./ModelsTab.tsx";
import { RolesTab, type RoleConfig } from "./RolesTab.tsx";
import { RuntimesTab, type RuntimeConfig } from "./RuntimesTab.tsx";

export type SettingsTabId = "roles" | "runtimes" | "models" | "permissions" | "workspace" | "mcp";

export const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string; endpoint?: SettingsEndpoint }> = [
  { id: "roles", label: "Roles", endpoint: "roles" },
  { id: "runtimes", label: "Runtimes", endpoint: "runtimes" },
  { id: "models", label: "Models", endpoint: "modelConfigs" },
  { id: "permissions", label: "Permissions", endpoint: "agentBindings" },
  { id: "workspace", label: "Workspace" },
  { id: "mcp", label: "MCP" }
];

type SettingsEndpoint = "roles" | "runtimes" | "modelConfigs" | "agentBindings";

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
  agentBindings: "/agent-bindings"
};

const emptySettingsData = (): SettingsData => ({
  roles: undefined,
  runtimes: undefined,
  modelConfigs: undefined,
  agentBindings: undefined,
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
                {loading ? "Loading" : status === "error" ? "REST error" : `${loadedCount}/5 loaded`}
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
  onModelConfigsChange
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
    return <PermissionsSettingsTab agentBindings={data} />;
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

function PermissionsSettingsTab({ agentBindings }: { agentBindings: unknown }) {
  const bindings = normalizeAgentBindings(agentBindings);
  if (bindings.length === 0) return <PlaceholderState tab={{ id: "permissions", label: "Permissions" }} data={agentBindings} />;

  return (
    <section className="grid gap-3 p-5" data-testid="settings-panel-permissions">
      {bindings.map((binding) => (
        <Card key={binding.id} variant="transparent" className="border border-border">
          <Card.Header>
            <div className="flex items-center gap-2">
              <Card.Title className="text-sm">{binding.roleName}</Card.Title>
              <Chip size="sm" variant="soft" color="accent">{binding.overridePermissionProfileId ?? "role profile"}</Chip>
            </div>
            <Card.Description className="text-xs">
              Runtime {binding.runtimeKind} · Model {binding.modelProvider}/{binding.modelName}
            </Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-1 text-xs text-muted">
            <div>Workspace: {binding.workspaceId}</div>
            <div>Binding: {binding.id}</div>
            <div>Runtime: {binding.runtimeName}{binding.runtimeVersion ? ` (${binding.runtimeVersion})` : ""}</div>
            <div>Model config: {binding.modelConfigName ?? binding.modelConfigId}</div>
          </Card.Content>
        </Card>
      ))}
    </section>
  );
}

function WorkspaceTab({ workspace }: { workspace: unknown }) {
  const rootPath = normalizeWorkspaceRootPath(workspace);
  const workspaceName = typeof workspace === "object" && workspace !== null && typeof (workspace as { readonly name?: unknown }).name === "string" ? (workspace as { readonly name: string }).name : undefined;
  const workspaceId = typeof workspace === "object" && workspace !== null && typeof (workspace as { readonly id?: unknown }).id === "string" ? (workspace as { readonly id: string }).id : undefined;

  return (
    <section className="grid gap-4 p-5" data-testid="settings-panel-workspace">
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <Card.Title className="text-sm">Workspace root</Card.Title>
          <Card.Description className="text-xs">Local storage, artifacts, and attachment cleanup all resolve from this path.</Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-2 text-sm">
          <div><span className="text-muted">Name:</span> {workspaceName ?? workspaceId ?? "Workspace"}</div>
          <div className="ah-mono rounded-xl border border-border bg-surface px-3 py-2 text-xs">{rootPath}</div>
        </Card.Content>
      </Card>
    </section>
  );
}

function McpPlaceholder() {
  return (
    <section className="grid gap-4 p-5" data-testid="settings-panel-mcp">
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <Card.Title className="text-sm">MCP / Tools</Card.Title>
          <Card.Description className="text-xs">MCP server management coming in V1.1. This release keeps the surface read-only.</Card.Description>
        </Card.Header>
        <Card.Content className="text-sm text-muted">
          Existing room tools remain available, but external server management is not editable yet.
        </Card.Content>
      </Card>
    </section>
  );
}

function normalizeAgentBindings(value: unknown): Array<{
  readonly id: string;
  readonly workspaceId: string;
  readonly roleName: string;
  readonly runtimeKind: string;
  readonly runtimeName: string;
  readonly runtimeVersion: string | undefined;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly modelConfigId: string;
  readonly modelConfigName: string | undefined;
  readonly overridePermissionProfileId: string | undefined;
}> {
  const bindings = value && typeof value === "object" && Array.isArray((value as { readonly agentBindings?: unknown }).agentBindings)
    ? (value as { readonly agentBindings: unknown[] }).agentBindings
    : [];
  return bindings.flatMap((binding) => {
    if (!binding || typeof binding !== "object") return [];
    const record = binding as Record<string, unknown>;
    const role = record.role && typeof record.role === "object" ? record.role as Record<string, unknown> : undefined;
    const runtime = record.runtime && typeof record.runtime === "object" ? record.runtime as Record<string, unknown> : undefined;
    const modelConfig = record.modelConfig && typeof record.modelConfig === "object" ? record.modelConfig as Record<string, unknown> : undefined;
    const id = typeof record.id === "string" ? record.id : undefined;
    const workspaceId = typeof record.workspaceId === "string" ? record.workspaceId : undefined;
    const roleName = typeof role?.name === "string" ? role.name : undefined;
    const runtimeKind = typeof runtime?.kind === "string" ? runtime.kind : undefined;
    const runtimeName = typeof runtime?.name === "string" ? runtime.name : undefined;
    const modelProvider = typeof modelConfig?.provider === "string" ? modelConfig.provider : undefined;
    const modelName = typeof modelConfig?.model === "string" ? modelConfig.model : undefined;
    if (!id || !workspaceId || !roleName || !runtimeKind || !runtimeName || !modelProvider || !modelName) return [];
    return [{
      id,
      workspaceId,
      roleName,
      runtimeKind,
      runtimeName,
      runtimeVersion: typeof runtime?.detectedVersion === "string" ? runtime.detectedVersion : undefined,
      modelProvider,
      modelName,
      modelConfigId: typeof modelConfig?.id === "string" ? modelConfig.id : "unknown",
      modelConfigName: typeof modelConfig?.name === "string" ? modelConfig.name : undefined,
      overridePermissionProfileId: typeof record.overridePermissionProfileId === "string" ? record.overridePermissionProfileId : undefined
    }];
  });
}

function normalizeWorkspaceRootPath(workspace: unknown): string {
  if (!workspace || typeof workspace !== "object") return ".";
  const record = workspace as Record<string, unknown>;
  if (typeof record.root_path === "string") return record.root_path;
  if (typeof record.rootPath === "string") return record.rootPath;
  return ".";
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
