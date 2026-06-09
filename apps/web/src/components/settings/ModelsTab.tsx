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
    setTestState((prev) => ({ ...prev, [config.id]: { status: "pending", message: "正在测试模型调用..." } }));
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
              <Card.Title>模型</Card.Title>
              <Card.Description>配置 provider 凭据，同时不暴露已保存的 api-key。</Card.Description>
            </div>
            <Button variant="primary" onPress={openAdd} data-testid="models-add-button">添加模型</Button>
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
                    <p className="text-xs text-muted">已配置 {providerConfigs.length} 个</p>
                  </div>
                  <Chip size="sm" variant="soft" color={providerColors[provider]}>{provider}</Chip>
                </div>

                {providerConfigs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-overlay p-3 text-sm text-muted">此 provider 暂未配置模型。</div>
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
                            <div className="font-semibold text-muted">api-key</div>
                            <div className="ah-mono text-foreground" data-testid={`model-fingerprint-${config.id}`}>
                              {displayFingerprint(config.api_key_fingerprint)}
                            </div>
                          </div>
                          <div className="ml-auto flex flex-wrap justify-end gap-2">
                            <Button size="sm" variant="secondary" onPress={() => void runTest(config)}>测试模型调用</Button>
                            <Button size="sm" variant="tertiary" onPress={() => openEdit(config)}>编辑</Button>
                            {providerNeedsApiKey(config.provider) ? <Button size="sm" variant="tertiary" onPress={() => openResetKey(config)}>重置 api-key</Button> : null}
                            <Button size="sm" variant="tertiary" onPress={() => void deleteConfig(config)}>删除</Button>
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
        <Modal.Dialog aria-label="模型配置弹窗">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{dialog?.mode === "reset-key" ? "重置 api-key" : dialog?.mode === "edit" ? "编辑模型" : "添加模型"}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="grid gap-4">
            <label className="grid gap-1 text-sm font-semibold">
              provider
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
              <Label className="text-sm font-semibold">名称</Label>
              <Input placeholder="Production GPT-4o" disabled={dialog?.mode === "reset-key"} />
            </TextField>

            <TextField value={dialog?.model ?? ""} onChange={(value) => patchDialog({ model: value })}>
              <Label className="text-sm font-semibold">模型 ID</Label>
              <Input placeholder="gpt-4o" disabled={dialog?.mode === "reset-key"} />
            </TextField>

            {showApiKey ? (
              <TextField value={dialog?.apiKey ?? ""} onChange={(value) => patchDialog({ apiKey: value })}>
                <Label className="text-sm font-semibold">api-key</Label>
                <Input type="password" placeholder="粘贴 api-key" autoComplete="off" data-testid="model-api-key-input" />
              </TextField>
            ) : null}

            {showBaseUrl ? (
              <TextField value={dialog?.baseUrl ?? ""} onChange={(value) => patchDialog({ baseUrl: value })}>
                <Label className="text-sm font-semibold">Base URL</Label>
                <Input placeholder={provider === "ollama" ? defaultBaseUrls.ollama ?? "http://localhost:11434/v1" : "https://api.example.com/v1"} data-testid="model-base-url-input" />
              </TextField>
            ) : null}

            {provider === "ollama" ? <p className="text-xs text-muted">Ollama 是本地 provider，不使用 api-key。</p> : null}
            {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">取消</Button>
            <Button variant="primary" isPending={submitting} isDisabled={!canSave || submitting} onPress={onSave}>
              {dialog?.mode === "reset-key" ? "重置 api-key" : "保存模型"}
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
  if (fingerprint === null || fingerprint.length === 0) return "无 api-key";
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
    throw new Error(`仍有 ${Number(payload.bindingCount ?? 0)} 个 binding 正在使用此模型配置，无法删除。`);
  }
  if (!response.ok) throw new Error(`删除模型配置失败：${response.status}`);
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
  if (!response.ok) throw new Error(`测试模型调用失败：${response.status}`);
  return { ok: false, error: "model_test_failed" };
}

async function pollModelTestJob(fetchImpl: typeof fetch, jobId: string): Promise<ModelTestResult> {
  if (jobId.length === 0) throw new Error("缺少 settings job id");
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
  if (!response.ok) throw new Error(`保存模型配置失败：${response.status}`);
  const modelConfig = normalizeModelConfig(payload.modelConfig ?? payload);
  if (!modelConfig) throw new Error("模型配置响应无效");
  return modelConfig;
}

function upsertModelConfig(configs: readonly ModelConfig[], saved: ModelConfig): ModelConfig[] {
  const exists = configs.some((config) => config.id === saved.id);
  return exists ? configs.map((config) => config.id === saved.id ? saved : config) : [...configs, saved];
}

function formatModelTestResult(result: ModelTestResult): string {
  if (!result.ok) return result.error ?? "模型测试失败";
  const latency = typeof result.latencyMs === "number" ? `${result.latencyMs}ms` : "ok";
  const tokens = typeof result.inputTokens === "number" && typeof result.outputTokens === "number"
    ? `, ${result.inputTokens}/${result.outputTokens} tokens`
    : "";
  return `${result.model ?? "model"} 测试成功，用时 ${latency}${tokens}`;
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
