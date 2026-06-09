import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  Modal,
  Spinner,
  TextArea,
  TextField
} from "@heroui/react";
import { normalizeModelConfigs } from "./ModelsTab.tsx";
import type { RoleConfig, RoleInput } from "./RolesTab.tsx";
import { parseCapabilities, upsertRole } from "./RolesTab.tsx";

export type RoleGenerationStatus =
  | "idle"
  | "validating"
  | "generating"
  | "completed"
  | "failed"
  | "expired";

export interface RoleGeneratorModalProps {
  isOpen: boolean;
  modelConfigs: unknown;
  roles: readonly RoleConfig[];
  fetchImpl?: typeof fetch;
  onClose: () => void;
  onRoleSaved: (roles: RoleConfig[]) => void;
}

export interface RoleDraftPreview {
  name: string;
  description: string;
  prompt: string;
  capabilities: string[];
  permissionProfileId?: string | null;
}

export interface RoleGenerationJob {
  jobId: string;
  status: "pending" | "running" | "completed" | "failed" | "expired";
  promptFragment: string;
  tokenCount: number;
  error?: string;
  draftJson?: RoleDraftPreview;
}

interface PreviewForm {
  name: string;
  description: string;
  prompt: string;
  capabilitiesText: string;
}

const terminalStatuses = new Set<RoleGenerationJob["status"]>(["completed", "failed", "expired"]);
const defaultPollIntervalMs = 500;

export function RoleGeneratorModal({
  isOpen,
  modelConfigs,
  roles,
  fetchImpl = fetch,
  onClose,
  onRoleSaved
}: RoleGeneratorModalProps) {
  const configs = normalizeModelConfigs(modelConfigs);
  const [description, setDescription] = useState("");
  const [modelConfigId, setModelConfigId] = useState("");
  const [job, setJob] = useState<RoleGenerationJob | undefined>();
  const [status, setStatus] = useState<RoleGenerationStatus>("idle");
  const [preview, setPreview] = useState<PreviewForm>(() => emptyPreview());
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pollAbortRef = useRef<AbortController | undefined>(undefined);
  const cleanedJobRef = useRef<string | undefined>(undefined);
  const scrolledPreviewJobRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isOpen) return;
    const firstConfig = configs[0]?.id ?? "";
    setModelConfigId((current) => current || firstConfig);
  }, [configs, isOpen]);

  useEffect(() => {
    if (isOpen) return;
    pollAbortRef.current?.abort();
    pollAbortRef.current = undefined;
    setDescription("");
    setModelConfigId("");
    setJob(undefined);
    setStatus("idle");
    setPreview(emptyPreview());
    setError(undefined);
    setSaving(false);
    cleanedJobRef.current = undefined;
    scrolledPreviewJobRef.current = undefined;
  }, [isOpen]);

  useEffect(() => {
    const jobId = job?.jobId;
    if (status !== "completed" || !jobId || scrolledPreviewJobRef.current === jobId) return;
    const frames: number[] = [];
    const scrollToPreview = () => {
      const body =
        bodyRef.current ??
        document.querySelector<HTMLDivElement>('[data-testid="role-generator-body"]');
      if (!body) return;
      body.scrollTop = body.scrollHeight;
    };
    frames.push(
      window.requestAnimationFrame(() => {
        scrollToPreview();
        frames.push(
          window.requestAnimationFrame(() => {
            scrollToPreview();
            scrolledPreviewJobRef.current = jobId;
          })
        );
      })
    );
    return () => {
      for (const frame of frames) window.cancelAnimationFrame(frame);
    };
  }, [job?.jobId, status]);

  const canGenerate =
    description.trim().length > 0 &&
    modelConfigId.trim().length > 0 &&
    status !== "generating" &&
    status !== "validating";
  const canSave =
    status === "completed" &&
    preview.name.trim().length > 0 &&
    preview.prompt.trim().length > 0 &&
    !saving;

  const cleanupJob = async (targetJobId: string | undefined) => {
    if (!targetJobId || cleanedJobRef.current === targetJobId) return;
    cleanedJobRef.current = targetJobId;
    await deleteRoleGenerationJob(fetchImpl, targetJobId);
  };

  const generate = async () => {
    if (!description.trim()) {
      setError("请先填写描述。");
      return;
    }
    if (!modelConfigId.trim()) {
      setError("请选择模型配置。");
      return;
    }

    pollAbortRef.current?.abort();
    const previousJobId = job?.jobId;
    setStatus("validating");
    setError(undefined);
    setPreview(emptyPreview());
    setJob(undefined);
    scrolledPreviewJobRef.current = undefined;
    try {
      await cleanupJob(previousJobId);
      const nextJobId = await startRoleGeneration(fetchImpl, { description, modelConfigId });
      cleanedJobRef.current = undefined;
      setJob({ jobId: nextJobId, status: "pending", promptFragment: "", tokenCount: 0 });
      setStatus("generating");
      const controller = new AbortController();
      pollAbortRef.current = controller;
      const completed = await pollRoleGenerationJob(fetchImpl, nextJobId, {
        intervalMs: defaultPollIntervalMs,
        signal: controller.signal,
        onUpdate: (update) => setJob(update)
      });
      if (controller.signal.aborted) return;
      setJob(completed);
      if (completed.status === "completed" && completed.draftJson) {
        setPreview(previewFromDraft(completed.draftJson));
        setStatus("completed");
      } else if (completed.status === "expired") {
        setStatus("expired");
        setError("草稿已过期，请重新生成。");
      } else {
        setStatus("failed");
        setError(completed.error ?? "角色生成失败。");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      pollAbortRef.current = undefined;
    }
  };

  const save = async () => {
    if (!job?.jobId) return;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await createGeneratedRole(
        fetchImpl,
        buildGeneratedRoleInput(preview, job.jobId)
      );
      await cleanupJob(job.jobId);
      onRoleSaved(upsertRole(roles, saved));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const cancelAndClose = async () => {
    pollAbortRef.current?.abort();
    const jobId = job?.jobId;
    setError(undefined);
    try {
      await cleanupJob(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    onClose();
  };

  const writeManually = async () => {
    await cancelAndClose();
  };

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) void cancelAndClose();
      }}
    >
      <Modal.Container size="lg">
        <Modal.Dialog
          className="flex max-h-[min(92vh,860px)] flex-col overflow-hidden"
          aria-label="用 AI 生成角色"
          data-testid="role-generator-modal"
        >
          <Modal.CloseTrigger aria-label="关闭角色生成器" />
          <Modal.Header>
            <Modal.Heading>用 AI 生成角色</Modal.Heading>
          </Modal.Header>
          <Modal.Body
            ref={bodyRef}
            className="min-h-0 flex-1 overflow-y-auto pb-8"
            data-testid="role-generator-body"
          >
            <div className="grid gap-4">
              <div className="rounded-2xl border border-border bg-surface p-3 text-sm text-muted">
                描述你希望这个角色承担的职责，选择已配置的模型，然后在保存为正式角色前检查生成草稿。
              </div>

              <TextField value={description} onChange={setDescription}>
                <Label className="text-sm font-semibold">描述</Label>
                <TextArea
                  className="min-h-28"
                  placeholder="例如：帮我生成一个擅长前端重构评审的 reviewer"
                  data-testid="role-generator-description"
                />
              </TextField>

              <label className="grid gap-1 text-sm font-semibold">
                模型配置
                <select
                  className="rounded-xl border border-field-border bg-field-background px-3 py-2 text-sm text-foreground"
                  value={modelConfigId}
                  onChange={(event) => setModelConfigId(event.currentTarget.value)}
                  data-testid="role-generator-model-config"
                >
                  <option value="">选择模型</option>
                  {configs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.name} · {config.model}
                    </option>
                  ))}
                </select>
              </label>

              {configs.length === 0 ? (
                <p className="text-xs text-warning" role="alert">
                  请先添加模型配置，再生成角色。
                </p>
              ) : null}

              {status === "generating" || status === "validating" ? (
                <Card variant="secondary" className="border border-border">
                  <Card.Content className="flex items-start gap-3 p-4">
                    <Spinner size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">正在生成草稿...</p>
                      <p className="mt-1 text-xs text-muted">{job?.tokenCount ?? 0} 个 token</p>
                      {job?.promptFragment ? (
                        <pre className="ah-mono mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-xs text-foreground">
                          {job.promptFragment}
                        </pre>
                      ) : null}
                    </div>
                  </Card.Content>
                </Card>
              ) : null}

              {status === "completed" ? (
                <Card variant="default" className="border border-border">
                  <Card.Header>
                    <div>
                      <Card.Title>草稿预览</Card.Title>
                      <Card.Description>保存前可以继续编辑生成的角色。</Card.Description>
                    </div>
                  </Card.Header>
                  <Card.Content className="grid gap-3" style={{ flex: "0 0 auto" }}>
                    <TextField
                      value={preview.name}
                      onChange={(value) => setPreview((current) => ({ ...current, name: value }))}
                    >
                      <Label className="text-sm font-semibold">名称</Label>
                      <Input data-testid="role-generator-preview-name" />
                    </TextField>
                    <TextField
                      value={preview.description}
                      onChange={(value) =>
                        setPreview((current) => ({ ...current, description: value }))
                      }
                    >
                      <Label className="text-sm font-semibold">描述</Label>
                      <Input data-testid="role-generator-preview-description" />
                    </TextField>
                    <TextField
                      value={preview.prompt}
                      onChange={(value) => setPreview((current) => ({ ...current, prompt: value }))}
                    >
                      <Label className="text-sm font-semibold">提示词</Label>
                      <TextArea
                        className="min-h-36 max-h-[32vh] resize-y overflow-y-auto"
                        data-testid="role-generator-preview-prompt"
                      />
                    </TextField>
                    <TextField
                      value={preview.capabilitiesText}
                      onChange={(value) =>
                        setPreview((current) => ({ ...current, capabilitiesText: value }))
                      }
                    >
                      <Label className="text-sm font-semibold">能力</Label>
                      <Input
                        placeholder="code.review, code.edit"
                        data-testid="role-generator-preview-capabilities"
                      />
                    </TextField>
                    <div className="flex flex-wrap gap-1">
                      {parseCapabilities(preview.capabilitiesText).length === 0 ? (
                        <Chip size="sm" variant="soft" color="default">
                          暂无能力
                        </Chip>
                      ) : (
                        parseCapabilities(preview.capabilitiesText).map((capability) => (
                          <Chip key={capability} size="sm" variant="soft" color="default">
                            {capability}
                          </Chip>
                        ))
                      )}
                    </div>
                    {job?.draftJson?.permissionProfileId ? (
                      <p className="text-xs text-muted">
                        建议权限配置：
                        <span className="ah-mono text-foreground">
                          {job.draftJson.permissionProfileId}
                        </span>
                      </p>
                    ) : null}
                  </Card.Content>
                </Card>
              ) : null}

              {status === "failed" || status === "expired" ? (
                <div
                  className="rounded-2xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
                  role="alert"
                >
                  <div className="font-semibold">
                    {status === "expired" ? "草稿已过期" : "生成失败"}
                  </div>
                  <div className="mt-1">{error ?? "可以重试，或手动编写角色。"}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => void generate()}
                      data-testid="role-generator-try-again"
                    >
                      重试
                    </Button>
                    <Button
                      size="sm"
                      variant="tertiary"
                      onPress={() => void writeManually()}
                      data-testid="role-generator-write-manually"
                    >
                      手动编写
                    </Button>
                  </div>
                </div>
              ) : null}

              {error && status !== "failed" && status !== "expired" ? (
                <p className="text-xs text-danger" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </Modal.Body>
          <Modal.Footer
            className="shrink-0 gap-2 border-t border-border bg-overlay/95"
            data-testid="role-generator-footer"
          >
            <Button
              variant="tertiary"
              onPress={() => void cancelAndClose()}
              data-testid="role-generator-cancel"
            >
              取消
            </Button>
            <Button
              variant="secondary"
              isDisabled={!canGenerate}
              isPending={status === "validating" || status === "generating"}
              onPress={() => void generate()}
              data-testid="role-generator-generate"
            >
              生成
            </Button>
            <Button
              variant="primary"
              isDisabled={!canSave}
              isPending={saving}
              onPress={() => void save()}
              data-testid="role-generator-save"
            >
              保存
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function buildGeneratedRoleInput(
  preview: PreviewForm,
  generationJobId: string
): RoleInput & { generationJobId: string } {
  return {
    name: preview.name.trim(),
    description: preview.description.trim(),
    prompt: preview.prompt,
    capabilities: parseCapabilities(preview.capabilitiesText),
    generationJobId
  };
}

export async function startRoleGeneration(
  fetchImpl: typeof fetch,
  input: { description: string; modelConfigId: string }
): Promise<string> {
  const response = await fetchImpl("/roles/generate", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      description: input.description.trim(),
      modelConfigId: input.modelConfigId.trim()
    })
  });
  if (!response.ok) throw new Error(await responseError(response, "Start role generation failed"));
  const payload = (await response.json().catch(() => undefined)) as { jobId?: unknown } | undefined;
  if (typeof payload?.jobId !== "string" || payload.jobId.length === 0)
    throw new Error("Role generation response did not include jobId.");
  return payload.jobId;
}

export async function getRoleGenerationJob(
  fetchImpl: typeof fetch,
  jobId: string,
  signal?: AbortSignal
): Promise<RoleGenerationJob> {
  const init: RequestInit = {
    credentials: "same-origin",
    headers: { accept: "application/json" }
  };
  if (signal) init.signal = signal;
  const response = await fetchImpl(`/roles/generate/jobs/${encodeURIComponent(jobId)}`, init);
  if (response.status === 404) {
    return {
      jobId,
      status: "expired",
      promptFragment: "",
      tokenCount: 0,
      error: "草稿已过期，请重新生成。"
    };
  }
  if (!response.ok) throw new Error(await responseError(response, "Poll role generation failed"));
  return normalizeRoleGenerationJob(jobId, await response.json().catch(() => undefined));
}

export async function pollRoleGenerationJob(
  fetchImpl: typeof fetch,
  jobId: string,
  options: {
    intervalMs?: number;
    signal?: AbortSignal;
    onUpdate?: (job: RoleGenerationJob) => void;
  } = {}
): Promise<RoleGenerationJob> {
  const intervalMs = options.intervalMs ?? defaultPollIntervalMs;
  for (;;) {
    throwIfAborted(options.signal);
    const job = await getRoleGenerationJob(fetchImpl, jobId, options.signal);
    options.onUpdate?.(job);
    if (terminalStatuses.has(job.status)) return job;
    await delay(intervalMs, options.signal);
  }
}

export async function createGeneratedRole(
  fetchImpl: typeof fetch,
  input: RoleInput & { generationJobId: string }
): Promise<RoleConfig> {
  const response = await fetchImpl("/roles", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await responseError(response, "Create generated role failed"));
  const role = normalizeGeneratedRole(await response.json().catch(() => undefined));
  if (!role) throw new Error("生成角色响应中没有包含角色。");
  return role;
}

export async function deleteRoleGenerationJob(
  fetchImpl: typeof fetch,
  jobId: string
): Promise<void> {
  const response = await fetchImpl(`/roles/generate/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok && response.status !== 404)
    throw new Error(await responseError(response, "Delete role generation job failed"));
}

export function normalizeRoleGenerationJob(
  fallbackJobId: string,
  payload: unknown
): RoleGenerationJob {
  const row = isRecord(payload) && isRecord(payload.job) ? payload.job : payload;
  const status = normalizeJobStatus(isRecord(row) ? row.status : undefined);
  const draftJson = normalizeDraft(isRecord(row) ? row.draftJson : undefined);
  const job: RoleGenerationJob = {
    jobId: stringField(isRecord(row) ? (row.jobId ?? row.id) : undefined) ?? fallbackJobId,
    status,
    promptFragment:
      stringField(
        isRecord(row) ? (row.promptFragment ?? row.prompt_fragment ?? row.partialPrompt) : undefined
      ) ?? "",
    tokenCount:
      numberField(isRecord(row) ? (row.tokenCount ?? row.token_count ?? row.tokens) : undefined) ??
      0
  };
  const error = stringField(
    isRecord(row) ? (row.error ?? row.failureReason ?? row.failure_reason) : undefined
  );
  if (error) job.error = error;
  if (draftJson) job.draftJson = draftJson;
  return job;
}

function normalizeGeneratedRole(payload: unknown): RoleConfig | undefined {
  const value = isRecord(payload) && isRecord(payload.role) ? payload.role : payload;
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string")
    return undefined;
  return {
    id: value.id,
    name: value.name,
    description: stringField(value.description) ?? "",
    prompt: stringField(value.prompt) ?? "",
    capabilities: normalizeCapabilities(value.capabilities),
    is_builtin: Boolean(value.is_builtin ?? value.isBuiltin)
  };
}

function normalizeDraft(value: unknown): RoleDraftPreview | undefined {
  if (!isRecord(value)) return undefined;
  const name = stringField(value.name);
  const prompt = stringField(value.prompt);
  if (!name || !prompt) return undefined;
  return {
    name,
    description: stringField(value.description) ?? "",
    prompt,
    capabilities: normalizeCapabilities(value.capabilities),
    permissionProfileId:
      stringField(
        value.permissionProfileId ??
          value.permission_profile_id ??
          value.suggestedPermissionProfileId ??
          value.suggested_permission_profile_id
      ) ?? null
  };
}

function normalizeCapabilities(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed))
      return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return parseCapabilities(value);
  }
  return [];
}

function previewFromDraft(draft: RoleDraftPreview): PreviewForm {
  return {
    name: draft.name,
    description: draft.description,
    prompt: draft.prompt,
    capabilitiesText: draft.capabilities.join(", ")
  };
}

function emptyPreview(): PreviewForm {
  return { name: "", description: "", prompt: "", capabilitiesText: "" };
}

function normalizeJobStatus(value: unknown): RoleGenerationJob["status"] {
  if (value === "completed" || value === "failed" || value === "expired") return value;
  if (value === "running" || value === "generating") return "running";
  return "pending";
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => undefined);
  return isRecord(payload) && typeof payload.error === "string"
    ? payload.error
    : `${fallback}: HTTP ${response.status}`;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
