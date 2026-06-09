import { useEffect, useMemo, useState } from "react";
import { Button, Card, Chip, Input, Label, Spinner, TextField } from "@heroui/react";
import type { ChipColor } from "../../lib/status.ts";

type RuntimeStatus = "connected" | "ready" | "error";

export interface RuntimeConfig {
  id: string;
  workspaceId: string | null;
  kind: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  detectedPath: string | null;
  detectedVersion: string | null;
  version: string | null;
  status: string | null;
}

export interface RuntimeTestResult {
  ok: boolean;
  version?: string | undefined;
  error?: string | undefined;
  latencyMs?: number | undefined;
}

type SettingsJob = {
  status?: string;
  result?: RuntimeTestResult;
  job?: {
    status?: string;
    result?: RuntimeTestResult;
  };
};

type RuntimeDraft = {
  name: string;
  command: string;
  argsText: string;
  envText: string;
};

interface RuntimesTabProps {
  data: unknown;
  fetchImpl?: typeof fetch;
  onChange?: (runtimes: RuntimeConfig[]) => void;
}

const terminalStatuses = new Set(["completed", "failed"]);

export function RuntimesTab({ data, fetchImpl = fetch, onChange }: RuntimesTabProps) {
  const [runtimes, setRuntimes] = useState<RuntimeConfig[]>(() => normalizeRuntimeList(data));
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined);
  const [drafts, setDrafts] = useState<Record<string, RuntimeDraft>>({});
  const [savingId, setSavingId] = useState<string | undefined>(undefined);
  const [testingId, setTestingId] = useState<string | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, RuntimeTestResult>>({});

  useEffect(() => {
    const next = normalizeRuntimeList(data);
    setRuntimes(next);
    setDrafts((current) => {
      const merged: Record<string, RuntimeDraft> = {};
      for (const runtime of next) merged[runtime.id] = current[runtime.id] ?? draftFromRuntime(runtime);
      return merged;
    });
  }, [data]);

  const customCount = useMemo(() => runtimes.filter((runtime) => runtime.kind === "custom-acp").length, [runtimes]);

  const updateRuntimes = (next: RuntimeConfig[]) => {
    setRuntimes(next);
    onChange?.(next);
  };

  const updateDraft = (id: string, patch: Partial<RuntimeDraft>) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? emptyDraft()), ...patch }
    }));
  };

  const addCustomRuntime = () => {
    const id = `custom-acp-${Date.now()}`;
    const runtime: RuntimeConfig = {
      id,
      workspaceId: null,
      kind: "custom-acp",
      name: `Custom ACP ${customCount + 1}`,
      command: "",
      args: [],
      env: {},
      detectedPath: null,
      detectedVersion: null,
      version: null,
      status: "draft"
    };
    updateRuntimes([...runtimes, runtime]);
    setDrafts((current) => ({ ...current, [id]: draftFromRuntime(runtime) }));
    setExpandedId(id);
  };

  const saveRuntime = async (runtime: RuntimeConfig) => {
    const draft = drafts[runtime.id] ?? draftFromRuntime(runtime);
    setSavingId(runtime.id);
    setErrors((current) => omitKey(current, runtime.id));
    try {
      const saved = await persistCustomRuntime(fetchImpl, runtime, draft);
      updateRuntimes(upsertRuntime(runtimes, saved));
      setDrafts((current) => ({ ...current, [saved.id]: draftFromRuntime(saved) }));
      setExpandedId(saved.id);
    } catch (err) {
      setErrors((current) => ({ ...current, [runtime.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSavingId(undefined);
    }
  };

  const deleteRuntime = async (runtime: RuntimeConfig) => {
    setDeletingId(runtime.id);
    setErrors((current) => omitKey(current, runtime.id));
    try {
      await deleteRuntimeConfig(fetchImpl, runtime.id);
      updateRuntimes(runtimes.filter((candidate) => candidate.id !== runtime.id));
      if (expandedId === runtime.id) setExpandedId(undefined);
    } catch (err) {
      setErrors((current) => ({ ...current, [runtime.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDeletingId(undefined);
    }
  };

  const testRuntime = async (runtime: RuntimeConfig) => {
    setTestingId(runtime.id);
    setErrors((current) => omitKey(current, runtime.id));
    try {
      const result = await testRuntimeConnection(fetchImpl, runtime.id);
      setTestResults((current) => ({ ...current, [runtime.id]: result }));
      if (result.ok && result.version) {
        updateRuntimes(runtimes.map((candidate) => candidate.id === runtime.id ? { ...candidate, detectedVersion: result.version ?? candidate.detectedVersion, version: result.version ?? candidate.version, status: "connected" } : candidate));
      }
    } catch (err) {
      setTestResults((current) => ({ ...current, [runtime.id]: { ok: false, error: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setTestingId(undefined);
    }
  };

  return (
    <section className="grid gap-4 p-5" data-testid="settings-panel-runtimes">
      <div className="rounded-2xl border border-border bg-overlay p-4 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">运行时</h3>
            <p className="mt-1 text-xs text-muted">本地 runtime 检测和自定义 ACP 命令配置。</p>
          </div>
          <Button variant="primary" size="sm" onPress={addCustomRuntime} data-testid="runtime-add-custom">
            添加自定义 ACP
          </Button>
        </div>

        {runtimes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
            暂无已注册的运行时。添加自定义 ACP runtime，或重启 daemon 初始化 native runtime 检测。
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {runtimes.map((runtime) => {
              const testResult = testResults[runtime.id];
              const status = runtimeStatus(runtime, testResult);
              const draft = drafts[runtime.id] ?? draftFromRuntime(runtime);
              const editable = runtime.kind === "custom-acp";
              const expanded = expandedId === runtime.id;
              const version = testResult?.version ?? runtime.detectedVersion ?? runtime.version ?? "unknown";
              return (
                <Card key={runtime.id} variant="default" className="border border-border" data-testid={`runtime-card-${runtime.id}`}>
                  <Card.Header>
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 text-left"
                      onClick={() => setExpandedId(expanded ? undefined : runtime.id)}
                      aria-expanded={expanded}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <Card.Title className="truncate">{runtime.name}</Card.Title>
                          <Chip size="sm" variant="soft" color="default">{runtime.kind}</Chip>
                          {isExperimentalRuntime(runtime) ? (
                            <Chip size="sm" variant="soft" color="warning" aria-label="运行时成熟度：实验性">
                              实验性
                            </Chip>
                          ) : null}
                        </div>
                        <Card.Description>
                          <span className="ah-mono">{runtime.detectedPath ?? "未检测到路径"}</span>
                        </Card.Description>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Chip size="sm" variant="soft" color={runtimeStatusColor(status)} aria-label={`运行时状态：${runtimeStatusLabel(status, version, testResult)}`}>
                          {runtimeStatusLabel(status, version, testResult)}
                        </Chip>
                        <span className="ah-mono text-xs text-muted">v{version}</span>
                      </div>
                    </button>
                  </Card.Header>

                  {expanded ? (
                    <Card.Content className="grid gap-3 border-t border-border pt-3">
                      {!editable ? (
                        <div className="rounded-2xl border border-dashed border-border bg-surface p-3 text-xs text-muted">
                          Native runtime 在设置中为只读。此处仅展示检测和测试结果，命令配置由 daemon 管理。
                        </div>
                      ) : (
                        <>
                          <TextField value={draft.name} onChange={(value) => updateDraft(runtime.id, { name: value })}>
                            <Label className="text-xs font-semibold uppercase tracking-wide text-muted">名称</Label>
                            <Input placeholder="自定义 ACP 运行时" />
                          </TextField>
                          <TextField value={draft.command} onChange={(value) => updateDraft(runtime.id, { command: value })}>
                            <Label className="text-xs font-semibold uppercase tracking-wide text-muted">命令</Label>
                            <Input className="ah-mono" placeholder="custom-acp" />
                          </TextField>
                          <TextField value={draft.argsText} onChange={(value) => updateDraft(runtime.id, { argsText: value })}>
                            <Label className="text-xs font-semibold uppercase tracking-wide text-muted">参数 JSON</Label>
                            <Input className="ah-mono" placeholder='["--stdio"]' />
                          </TextField>
                          <TextField value={draft.envText} onChange={(value) => updateDraft(runtime.id, { envText: value })}>
                            <Label className="text-xs font-semibold uppercase tracking-wide text-muted">环境变量 JSON</Label>
                            <Input className="ah-mono" placeholder='{"ACP_TOKEN":"..."}' />
                          </TextField>
                        </>
                      )}

                      {testResult ? (
                        <div className={`rounded-2xl border p-3 text-xs ${testResult.ok ? "border-success/40 bg-success-soft text-success-soft-foreground" : "border-danger/40 bg-surface text-danger"}`} data-testid={`runtime-test-result-${runtime.id}`}>
                          {testResult.ok ? `已连接${testResult.version ? ` (v${testResult.version})` : ""}` : runtimeErrorLabel(testResult.error) ?? "runtime 测试失败"}
                        </div>
                      ) : null}
                      {errors[runtime.id] ? <p className="text-xs text-danger" role="alert">{runtimeErrorLabel(errors[runtime.id])}</p> : null}
                    </Card.Content>
                  ) : null}

                  <Card.Footer className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onPress={() => testRuntime(runtime)} isPending={testingId === runtime.id}>
                      {testingId === runtime.id ? <Spinner size="sm" /> : null}
                      测试连接
                    </Button>
                    {editable ? (
                      <>
                        <Button size="sm" variant="primary" onPress={() => saveRuntime(runtime)} isPending={savingId === runtime.id}>
                          {runtime.status === "draft" ? "创建" : "保存"}
                        </Button>
                        <Button size="sm" variant="danger" onPress={() => deleteRuntime(runtime)} isPending={deletingId === runtime.id}>
                          删除
                        </Button>
                      </>
                    ) : null}
                  </Card.Footer>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export async function persistCustomRuntime(fetchImpl: typeof fetch, runtime: RuntimeConfig, draft: RuntimeDraft): Promise<RuntimeConfig> {
  const args = parseJsonArray(draft.argsText, "参数 JSON");
  const env = parseJsonObject(draft.envText, "环境变量 JSON");
  const isNew = runtime.status === "draft";
  const response = await fetchImpl(isNew ? "/runtimes" : `/runtimes/${encodeURIComponent(runtime.id)}`, {
    method: isNew ? "POST" : "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      id: runtime.id,
      workspaceId: runtime.workspaceId,
      name: draft.name.trim() || "自定义 ACP 运行时",
      command: draft.command.trim(),
      args,
      env,
      supportedCaps: [],
      manifestJson: JSON.stringify({ runtimeKind: "custom-acp" })
    })
  });
  if (!response.ok) throw new Error(await responseError(response, "保存运行时失败"));
  const payload = await response.json() as { runtime?: unknown };
  return normalizeRuntime(payload.runtime ?? payload);
}

export async function deleteRuntimeConfig(fetchImpl: typeof fetch, runtimeId: string): Promise<void> {
  const response = await fetchImpl(`/runtimes/${encodeURIComponent(runtimeId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (response.status === 409) throw new Error("该运行时仍被 agent bindings 使用");
  if (!response.ok) throw new Error(await responseError(response, "删除运行时失败"));
}

export async function testRuntimeConnection(fetchImpl: typeof fetch, runtimeId: string, pollMs = 500): Promise<RuntimeTestResult> {
  const response = await fetchImpl(`/runtimes/${encodeURIComponent(runtimeId)}/test`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({})
  });
  const payload = await response.json().catch(() => ({})) as RuntimeTestResult & { jobId?: string };
  if (response.status === 202) {
    if (!payload.jobId) throw new Error("运行时测试任务缺少 ID");
    return pollRuntimeTestJob(fetchImpl, payload.jobId, pollMs);
  }
  if (!response.ok) throw new Error(payload.error ?? await responseError(response, "运行时测试失败"));
  return payload;
}

export async function pollRuntimeTestJob(fetchImpl: typeof fetch, jobId: string, pollMs = 500): Promise<RuntimeTestResult> {
  for (;;) {
    const response = await fetchImpl(`/settings/jobs/${encodeURIComponent(jobId)}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(await responseError(response, "运行时测试任务失败"));
    const payload = await response.json() as SettingsJob;
    const job = payload.job ?? payload;
    if (job.status && terminalStatuses.has(job.status)) {
      const result = job.result ?? { ok: job.status === "completed" };
      return result.ok ? result : { ok: false, error: result.error ?? "运行时测试失败", latencyMs: result.latencyMs };
    }
    await delay(pollMs);
  }
}

export function normalizeRuntimeList(data: unknown): RuntimeConfig[] {
  const list = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { runtimes?: unknown }).runtimes) ? (data as { runtimes: unknown[] }).runtimes : [];
  return list.map(normalizeRuntime);
}

export function normalizeRuntime(value: unknown): RuntimeConfig {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    id: stringValue(row.id, `runtime-${Date.now()}`),
    workspaceId: nullableString(row.workspaceId ?? row.workspace_id),
    kind: stringValue(row.kind, "custom-acp"),
    name: stringValue(row.name, "运行时"),
    command: nullableString(row.command) ?? "",
    args: parseStringArray(row.args),
    env: parseEnv(row.env),
    detectedPath: nullableString(row.detectedPath ?? row.detected_path),
    detectedVersion: nullableString(row.detectedVersion ?? row.detected_version),
    version: nullableString(row.version),
    status: nullableString(row.status)
  };
}

function runtimeStatus(runtime: RuntimeConfig, result: RuntimeTestResult | undefined): RuntimeStatus {
  if (result?.ok) return "connected";
  if (result && !result.ok) return "error";
  if (runtime.status === "connected" || runtime.status === "error") return runtime.status;
  if (runtime.kind === "native" || runtime.detectedPath || runtime.detectedVersion) return "connected";
  return "ready";
}

function runtimeStatusColor(status: RuntimeStatus): ChipColor {
  switch (status) {
    case "connected": return "success";
    case "error": return "danger";
    case "ready":
    default: return "warning";
  }
}

function runtimeStatusLabel(status: RuntimeStatus, version: string, result: RuntimeTestResult | undefined): string {
  if (status === "connected") return `已连接 (v${result?.version ?? version})`;
  if (status === "error") return runtimeErrorLabel(result?.error) ?? "检测失败";
  return "待测试";
}

function runtimeErrorLabel(error: string | undefined): string | undefined {
  if (error === undefined || error.length === 0) return undefined;
  const normalized = error.trim().toLowerCase();
  if (normalized === "binary not found") return "未找到可执行文件";
  if (normalized === "detection failed") return "检测失败";
  if (normalized === "runtime test failed") return "runtime 测试失败";
  if (normalized === "运行时测试失败") return "运行时测试失败";
  return error;
}

function isExperimentalRuntime(runtime: RuntimeConfig): boolean {
  return runtime.kind === "codex";
}

function draftFromRuntime(runtime: RuntimeConfig): RuntimeDraft {
  return {
    name: runtime.name,
    command: runtime.command,
    argsText: JSON.stringify(runtime.args),
    envText: JSON.stringify(runtime.env)
  };
}

function emptyDraft(): RuntimeDraft {
  return { name: "自定义 ACP 运行时", command: "", argsText: "[]", envText: "{}" };
}

function upsertRuntime(runtimes: RuntimeConfig[], runtime: RuntimeConfig): RuntimeConfig[] {
  return runtimes.some((candidate) => candidate.id === runtime.id)
    ? runtimes.map((candidate) => candidate.id === runtime.id ? runtime : candidate)
    : [...runtimes, runtime];
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: removed, ...rest } = record;
  void removed;
  return rest;
}

function parseJsonArray(value: string, label: string): string[] {
  const parsed = JSON.parse(value || "[]") as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) throw new Error(`${label} 必须是 JSON 字符串数组`);
  return parsed;
}

function parseJsonObject(value: string, label: string): Record<string, string> {
  const parsed = JSON.parse(value || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} 必须是 JSON 对象`);
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (!entries.every(([, item]) => typeof item === "string")) throw new Error(`${label} 的值必须是字符串`);
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseStringArray(value: unknown): string[] {
  const parsed = typeof value === "string" ? safeJson(value, []) : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseEnv(value: unknown): Record<string, string> {
  const parsed = typeof value === "string" ? safeJson(value, {}) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function safeJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
  return payload?.error ?? `${fallback}: HTTP ${response.status}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
