import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chip, Modal, ScrollShadow, Skeleton, Tabs } from "@heroui/react";

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

type SettingsData = Record<SettingsEndpoint, unknown>;

type SettingsStatus = "idle" | "loading" | "ready" | "error";

interface SettingsModalProps {
  isOpen: boolean;
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
  agentBindings: undefined
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
  return Object.fromEntries(entries) as SettingsData;
}

export function SettingsModal({ isOpen, onOpenChange, fetchImpl = fetch }: SettingsModalProps) {
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
                {loading ? "Loading" : status === "error" ? "REST error" : `${loadedCount}/4 loaded`}
              </Chip>
            </div>
          </Modal.Header>

          <Modal.Body className="max-h-[72vh] gap-0 overflow-hidden p-0">
            <Tabs defaultSelectedKey="roles" className="flex min-h-0 flex-1 flex-col">
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
                    <SettingsPanel tab={tab} loading={loading} error={error} data={tab.endpoint ? data[tab.endpoint] : undefined} />
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
  data
}: {
  tab: (typeof SETTINGS_TABS)[number];
  loading: boolean;
  error: string | undefined;
  data: unknown;
}) {
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
      return "MCP/tool management placeholder for V1.0 read-only surfaces.";
  }
}
