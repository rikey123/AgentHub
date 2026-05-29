import { useMemo, useState } from "react";
import { Button, Card, Chip, Input, Label, Modal, TextField } from "@heroui/react";

export type ModelProvider = "openai" | "anthropic" | "google" | "openai-compatible" | "ollama";

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  model: string;
  base_url: string | null;
  api_key_fingerprint: string | null;
}

interface ModelsTabProps {
  modelConfigs: unknown;
  fetchImpl?: typeof fetch;
  onModelConfigsChange?: (configs: ModelConfig[]) => void;
}

type DialogMode = "add" | "edit" | "reset-key";

type TestState = Record<string, { status: "pending" | "success" | "error"; message: string }>;

interface ModelFormState {
  id?: string;
  mode: DialogMode;
  provider: ModelProvider;
  name: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

interface ModelTestResult {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

interface SettingsJobResponse {
  job?: { status?: string; result?: ModelTestResult };
  status?: string;
  result?: ModelTestResult;
  jobId?: string;
}

const providerOrder: ModelProvider[] = ["openai", "anthropic", "google", "openai-compatible", "ollama"];

const providerLabels: Record<ModelProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "openai-compatible": "OpenAI-compatible",
  ollama: "Ollama"
};

const providerColors: Record<ModelProvider, "default" | "accent" | "success" | "warning" | "danger"> = {
  openai: "accent",
  anthropic: "warning",
  google: "success",
  "openai-compatible": "default",
  ollama: "success"
};

const defaultBaseUrls: Partial<Record<ModelProvider, string>> = {
  ollama: "http://localhost:11434/v1"
};

export function ModelsTab({ modelConfigs, fetchImpl = fetch, onModelConfigsChange }: ModelsTabProps) {
  const [configs, setConfigs] = useState<ModelConfig[]>(() => normalizeModelConfigs(modelConfigs));
  const [dialog, setDialog] = useState<ModelFormState | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [testState, setTestState] = useState<TestState>({});

  const sourceConfigs = normalizeModelConfigs(modelConfigs);
  const visibleConfigs = configs.length > 0 || sourceConfigs.length === 0 ? configs : sourceConfigs;

  const groups = useMemo(() => groupModelConfigsByProvider(visibleConfigs), [visibleConfigs]);

  const updateConfigs = (next: ModelConfig[]) => {
    setConfigs(next);
    onModelConfigsChange?.(next);
  };

  const openAdd = () => {
    setError(undefined);
    setDialog({ mode: "add", provider: "openai", name: "", model: "", apiKey: "", baseUrl: "" });
  };

  const openEdit = (config: ModelConfig) => {
    setError(undefined);
    setDialog({
      id: config.id,
      mode: "edit",
      provider: config.provider,
      name: config.name,
      model: config.model,
      apiKey: "",
      baseUrl: config.base_url ?? defaultBaseUrls[config.provider] ?? ""
    });
  };

  const openResetKey = (config: ModelConfig) => {
    setError(undefined);
    setDialog({
      id: config.id,
      mode: "reset-key",
      provider: config.provider,
      name: config.name,
      model: config.model,
      apiKey: "",
      baseUrl: config.base_url ?? defaultBaseUrls[config.provider] ?? ""
    });
  };

  const saveDialog = async () => {
    if (!dialog) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const saved = dialog.mode === "add"
        ? await createModelConfig(fetchImpl, dialog)
        : await updateModelConfig(fetchImpl, dialog.id ?? "", dialog);
      const next = upsertModelConfig(visibleConfigs, saved);
      updateConfigs(next);
      setDialog(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteConfig = async (config: ModelConfig) => {
    setError(undefined);
    try {
      await deleteModelConfig(fetchImpl, config.id);
      updateConfigs(visibleConfigs.filter((item) => item.id !== config.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runTest = async (config: ModelConfig) => {
    setTestState((prev) => ({ ...prev, [config.id]: { status: "pending", message: "Testing model call..." } }));
    try {
      const result = await testModelConfig(fetchImpl, config.id);
      setTestState((prev) => ({
        ...prev,
        [config.id]: { status: result.ok ? "success" : "error", message: formatModelTestResult(result) }
      }));
    } catch (err) {
      setTestState((prev) => ({
        ...prev,
        [config.id]: { status: "error", message: err instanceof Error ? err.message : String(err) }
      }));
    }
  };

  return (
    <section className="grid gap-4 p-5" data-testid="settings-panel-models">
      <Card variant="default" className="gap-4">
        <Card.Header>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Card.Title>Models</Card.Title>
              <Card.Description>Configure provider credentials without exposing saved API keys.</Card.Description>
            </div>
            <Button variant="primary" onPress={openAdd} data-testid="models-add-button">Add Model</Button>
          </div>
        </Card.Header>
        <Card.Content className="grid gap-4">
          {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
          {providerOrder.map((provider) => {
            const providerConfigs = groups[provider];
            return (
              <section key={provider} className="rounded-2xl border border-border bg-surface p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{providerLabels[provider]}</h3>
                    <p className="text-xs text-muted">{providerConfigs.length} configured</p>
                  </div>
                  <Chip size="sm" variant="soft" color={providerColors[provider]}>{provider}</Chip>
                </div>

                {providerConfigs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-overlay p-3 text-sm text-muted">No models configured for this provider.</div>
                ) : (
                  <div className="grid gap-2">
                    {providerConfigs.map((config) => (
                      <div key={config.id} className="rounded-xl border border-border bg-overlay p-3" data-testid={`model-config-${config.id}`}>
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="min-w-[220px] flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{config.name}</span>
                              <Chip size="sm" variant="soft" color={providerColors[config.provider]}>{providerLabels[config.provider]}</Chip>
                            </div>
                            <p className="mt-1 text-xs text-muted">{config.model}</p>
                          </div>
                          <div className="min-w-[160px] text-xs">
                            <div className="font-semibold text-muted">Fingerprint</div>
                            <div className="ah-mono text-foreground" data-testid={`model-fingerprint-${config.id}`}>
                              {displayFingerprint(config.api_key_fingerprint)}
                            </div>
                          </div>
                          <div className="ml-auto flex flex-wrap justify-end gap-2">
                            <Button size="sm" variant="secondary" onPress={() => void runTest(config)}>Test Model Call</Button>
                            <Button size="sm" variant="tertiary" onPress={() => openEdit(config)}>Edit</Button>
                            {providerNeedsApiKey(config.provider) ? <Button size="sm" variant="tertiary" onPress={() => openResetKey(config)}>Reset key</Button> : null}
                            <Button size="sm" variant="tertiary" onPress={() => void deleteConfig(config)}>Delete</Button>
                          </div>
                        </div>
                        {config.base_url ? <p className="mt-2 text-xs text-muted">Base URL: <span className="ah-mono">{config.base_url}</span></p> : null}
                        {testState[config.id] ? (
                          <p className={testState[config.id]!.status === "success" ? "mt-2 text-xs text-success" : "mt-2 text-xs text-danger"} role="status">
                            {testState[config.id]!.message}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </Card.Content>
      </Card>

      <ModelConfigDialog
        dialog={dialog}
        error={error}
        submitting={submitting}
        onChange={setDialog}
        onClose={() => setDialog(undefined)}
        onSave={() => void saveDialog()}
      />
    </section>
  );
}

function ModelConfigDialog({
  dialog,
  error,
  submitting,
  onChange,
  onClose,
  onSave
}: {
  dialog: ModelFormState | undefined;
  error: string | undefined;
  submitting: boolean;
  onChange: (state: ModelFormState | undefined) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const provider = dialog?.provider ?? "openai";
  const showApiKey = dialog !== undefined && dialog.mode !== "edit" && providerNeedsApiKey(provider);
  const showBaseUrl = provider === "openai-compatible" || provider === "ollama";
  const canSave = dialog !== undefined && dialog.model.trim().length > 0 && dialog.name.trim().length > 0 && (!showApiKey || dialog.apiKey.trim().length > 0);

  const patchDialog = (patch: Partial<ModelFormState>) => {
    if (!dialog) return;
    const nextProvider = patch.provider ?? dialog.provider;
    const nextBaseUrl = patch.baseUrl ?? (patch.provider === "ollama" && dialog.baseUrl.trim().length === 0 ? defaultBaseUrls.ollama ?? "" : dialog.baseUrl);
    onChange({
      ...dialog,
      ...patch,
      baseUrl: nextBaseUrl,
      apiKey: nextProvider === "ollama" ? "" : patch.apiKey ?? dialog.apiKey
    });
  };

  return (
    <Modal.Backdrop isOpen={dialog !== undefined} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Container size="md">
        <Modal.Dialog aria-label="Model config dialog">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{dialog?.mode === "reset-key" ? "Reset API key" : dialog?.mode === "edit" ? "Edit model" : "Add model"}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="grid gap-4">
            <label className="grid gap-1 text-sm font-semibold">
              Provider
              <select
                className="rounded-xl border border-field-border bg-field-background px-3 py-2 text-sm text-foreground"
                value={provider}
                onChange={(event) => patchDialog({ provider: event.currentTarget.value as ModelProvider })}
                disabled={dialog?.mode === "reset-key"}
                data-testid="model-provider-select"
              >
                {providerOrder.map((item) => <option key={item} value={item}>{providerLabels[item]}</option>)}
              </select>
            </label>

            <TextField value={dialog?.name ?? ""} onChange={(value) => patchDialog({ name: value })}>
              <Label className="text-sm font-semibold">Name</Label>
              <Input placeholder="Production GPT-4o" disabled={dialog?.mode === "reset-key"} />
            </TextField>

            <TextField value={dialog?.model ?? ""} onChange={(value) => patchDialog({ model: value })}>
              <Label className="text-sm font-semibold">Model ID</Label>
              <Input placeholder="gpt-4o" disabled={dialog?.mode === "reset-key"} />
            </TextField>

            {showApiKey ? (
              <TextField value={dialog?.apiKey ?? ""} onChange={(value) => patchDialog({ apiKey: value })}>
                <Label className="text-sm font-semibold">API key</Label>
                <Input type="password" placeholder="Paste API key" autoComplete="off" data-testid="model-api-key-input" />
              </TextField>
            ) : null}

            {showBaseUrl ? (
              <TextField value={dialog?.baseUrl ?? ""} onChange={(value) => patchDialog({ baseUrl: value })}>
                <Label className="text-sm font-semibold">Base URL</Label>
                <Input placeholder={provider === "ollama" ? defaultBaseUrls.ollama ?? "http://localhost:11434/v1" : "https://api.example.com/v1"} data-testid="model-base-url-input" />
              </TextField>
            ) : null}

            {provider === "ollama" ? <p className="text-xs text-muted">Ollama is local and does not use an API key.</p> : null}
            {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">Cancel</Button>
            <Button variant="primary" isPending={submitting} isDisabled={!canSave || submitting} onPress={onSave}>
              {dialog?.mode === "reset-key" ? "Reset key" : "Save model"}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function normalizeModelConfigs(value: unknown): ModelConfig[] {
  const rows = Array.isArray(value)
    ? value
    : value !== null && typeof value === "object" && Array.isArray((value as { modelConfigs?: unknown }).modelConfigs)
      ? (value as { modelConfigs: unknown[] }).modelConfigs
      : [];

  return rows.map((row) => normalizeModelConfig(row)).filter((row): row is ModelConfig => row !== undefined);
}

export function normalizeModelConfig(value: unknown): ModelConfig | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const id = stringField(row.id);
  const provider = normalizeProvider(row.provider);
  const model = stringField(row.model);
  if (!id || !provider || !model) return undefined;
  return {
    id,
    name: stringField(row.name) ?? model,
    provider,
    model,
    base_url: nullableString(row.base_url ?? row.baseUrl),
    api_key_fingerprint: nullableString(row.api_key_fingerprint ?? row.apiKeyFingerprint)
  };
}

export function groupModelConfigsByProvider(configs: readonly ModelConfig[]): Record<ModelProvider, ModelConfig[]> {
  const groups: Record<ModelProvider, ModelConfig[]> = {
    openai: [],
    anthropic: [],
    google: [],
    "openai-compatible": [],
    ollama: []
  };
  for (const config of configs) groups[config.provider].push(config);
  return groups;
}

export function providerNeedsApiKey(provider: ModelProvider): boolean {
  return provider !== "ollama";
}

export function displayFingerprint(fingerprint: string | null): string {
  if (fingerprint === null || fingerprint.length === 0) return "No API key";
  if (fingerprint.includes("...")) return fingerprint;
  if (fingerprint.length <= 4) return fingerprint;
  return fingerprint.slice(-4).padStart(Math.min(8, fingerprint.length), "•");
}

export function buildModelConfigPayload(form: Pick<ModelFormState, "provider" | "name" | "model" | "apiKey" | "baseUrl" | "mode">): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    provider: form.provider,
    name: form.name.trim(),
    model: form.model.trim()
  };
  const baseUrl = form.baseUrl.trim();
  if (form.provider === "ollama") {
    payload.baseUrl = baseUrl.length > 0 ? baseUrl : defaultBaseUrls.ollama;
  } else if (form.provider === "openai-compatible" && baseUrl.length > 0) {
    payload.baseUrl = baseUrl;
  }
  if (providerNeedsApiKey(form.provider) && form.apiKey.trim().length > 0) {
    payload.apiKey = form.apiKey.trim();
  }
  return payload;
}

export async function createModelConfig(fetchImpl: typeof fetch, form: Pick<ModelFormState, "provider" | "name" | "model" | "apiKey" | "baseUrl" | "mode">): Promise<ModelConfig> {
  const response = await fetchImpl("/model-configs", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(buildModelConfigPayload(form))
  });
  return readModelConfigResponse(response);
}

export async function updateModelConfig(fetchImpl: typeof fetch, id: string, form: Pick<ModelFormState, "provider" | "name" | "model" | "apiKey" | "baseUrl" | "mode">): Promise<ModelConfig> {
  const response = await fetchImpl(`/model-configs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(buildModelConfigPayload(form))
  });
  return readModelConfigResponse(response);
}

export async function deleteModelConfig(fetchImpl: typeof fetch, id: string): Promise<void> {
  const response = await fetchImpl(`/model-configs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (response.status === 409) {
    const payload = await response.json().catch(() => ({})) as { bindingCount?: unknown };
    throw new Error(`Cannot delete model config while ${Number(payload.bindingCount ?? 0)} binding(s) use it.`);
  }
  if (!response.ok) throw new Error(`Delete model config failed: ${response.status}`);
}

export async function testModelConfig(fetchImpl: typeof fetch, id: string): Promise<ModelTestResult> {
  const response = await fetchImpl(`/model-configs/${encodeURIComponent(id)}/test`, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Say 'ok'" })
  });
  const payload = await response.json().catch(() => ({})) as SettingsJobResponse & ModelTestResult;
  if (response.status === 202 || (payload.jobId && !isModelTestResult(payload))) {
    return pollModelTestJob(fetchImpl, payload.jobId ?? "");
  }
  if (isModelTestResult(payload)) return payload;
  if (!response.ok) throw new Error(`Test model call failed: ${response.status}`);
  return { ok: false, error: "model_test_failed" };
}

async function pollModelTestJob(fetchImpl: typeof fetch, jobId: string): Promise<ModelTestResult> {
  if (jobId.length === 0) throw new Error("Missing settings job id");
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetchImpl(`/settings/jobs/${encodeURIComponent(jobId)}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({})) as SettingsJobResponse;
    const status = payload.job?.status ?? payload.status;
    const result = payload.job?.result ?? payload.result;
    if (result && isModelTestResult(result)) return result;
    if (status === "failed") return { ok: false, error: "model_test_failed" };
  }
  return { ok: false, error: "model_test_timeout" };
}

async function readModelConfigResponse(response: Response): Promise<ModelConfig> {
  const payload = await response.json().catch(() => ({})) as { modelConfig?: unknown };
  if (!response.ok) throw new Error(`Save model config failed: ${response.status}`);
  const modelConfig = normalizeModelConfig(payload.modelConfig ?? payload);
  if (!modelConfig) throw new Error("Model config response was invalid");
  return modelConfig;
}

function upsertModelConfig(configs: readonly ModelConfig[], saved: ModelConfig): ModelConfig[] {
  const exists = configs.some((config) => config.id === saved.id);
  return exists ? configs.map((config) => config.id === saved.id ? saved : config) : [...configs, saved];
}

function formatModelTestResult(result: ModelTestResult): string {
  if (!result.ok) return result.error ?? "Model test failed";
  const latency = typeof result.latencyMs === "number" ? `${result.latencyMs}ms` : "ok";
  const tokens = typeof result.inputTokens === "number" && typeof result.outputTokens === "number"
    ? `, ${result.inputTokens}/${result.outputTokens} tokens`
    : "";
  return `${result.model ?? "model"} succeeded in ${latency}${tokens}`;
}

function isModelTestResult(value: unknown): value is ModelTestResult {
  return value !== null && typeof value === "object" && typeof (value as { ok?: unknown }).ok === "boolean";
}

function normalizeProvider(value: unknown): ModelProvider | undefined {
  return providerOrder.includes(value as ModelProvider) ? value as ModelProvider : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
