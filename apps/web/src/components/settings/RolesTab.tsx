import { useEffect, useState } from "react";
import { Button, Card, Checkbox, Chip, Input, Label, Modal, TextArea, TextField } from "@heroui/react";
import { RoleGeneratorModal } from "./RoleGeneratorModal.tsx";
import { roleDisplayDescription, roleDisplayName } from "../../lib/roles.ts";

export interface RoleConfig {
  id: string;
  name: string;
  description: string;
  prompt: string;
  capabilities: string[];
  is_builtin: boolean;
}

export interface RoleInput {
  name: string;
  description: string;
  prompt: string;
  capabilities: string[];
}

interface RolesTabProps {
  roles: unknown;
  modelConfigs?: unknown;
  fetchImpl?: typeof fetch;
  onRolesChange?: (roles: RoleConfig[]) => void;
}

interface RoleDraft {
  name: string;
  description: string;
  prompt: string;
  capabilitiesText: string;
}

export const BUILTIN_ROLE_WARNING = "内置模板，修改后不再自动更新；运行 `agenthub roles reset --id=<id>` 可恢复";

export const WELL_KNOWN_CAPABILITY_TOKENS = [
  "chat",
  "code.edit",
  "code.review",
  "file.read",
  "file.write",
  "terminal.run",
  "context.read",
  "context.write",
  "intervention.knock",
  "task.delegate"
] as const;

export class RoleApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload: unknown) {
    super(message);
    this.name = "RoleApiError";
  }
}

export function RolesTab({ roles: initialRoles, modelConfigs, fetchImpl = fetch, onRolesChange }: RolesTabProps) {
  const [roles, setRoles] = useState<RoleConfig[]>(() => normalizeRoles(initialRoles));
  const [selectedId, setSelectedId] = useState<string | undefined>(() => normalizeRoles(initialRoles)[0]?.id);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [draft, setDraft] = useState<RoleDraft>(() => emptyDraft());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleConfig | undefined>();
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const nextRoles = normalizeRoles(initialRoles);
    setRoles(nextRoles);
    setSelectedId((current) => current && nextRoles.some((role) => role.id === current) ? current : nextRoles[0]?.id);
  }, [initialRoles]);

  const selectedRole = roles.find((role) => role.id === selectedId);

  const updateRoles = (nextRoles: RoleConfig[]) => {
    setRoles(nextRoles);
    onRolesChange?.(nextRoles);
  };

  const startCreate = () => {
    setMode("create");
    setDraft(emptyDraft());
    setError(undefined);
    setMessage(undefined);
  };

  const startEdit = (role: RoleConfig) => {
    setMode("edit");
    setSelectedId(role.id);
    setDraft(draftFromRole(role));
    setError(undefined);
    setMessage(undefined);
  };

  const saveRole = async () => {
    const input = inputFromDraft(draft);
    if (!input.name) {
      setError("角色名称不能为空。");
      return;
    }

    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const saved = mode === "edit" && selectedRole
        ? await updateRole(fetchImpl, selectedRole.id, input)
        : await createRole(fetchImpl, input);
      updateRoles(upsertRole(roles, saved));
      setMode("edit");
      setSelectedId(saved.id);
      setDraft(draftFromRole(saved));
      setMessage(mode === "edit" ? "角色已保存。" : "角色已创建。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await deleteRole(fetchImpl, deleteTarget.id);
      const nextRoles = roles.filter((role) => role.id !== deleteTarget.id);
      updateRoles(sortRolesByName(nextRoles));
      setDeleteTarget(undefined);
      setSelectedId(nextRoles[0]?.id);
      setMode("create");
      setDraft(emptyDraft());
      setMessage("角色已删除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleteTarget(undefined);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="grid gap-4 p-5 ah-roles-settings" data-testid="settings-panel-roles">
      <div className="grid gap-4 ah-roles-layout lg:grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)]">
        <Card variant="default" className="ah-roles-list-panel">
          <Card.Header className="ah-roles-list-header">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Card.Title>角色</Card.Title>
                <Card.Description>角色模板和可编辑的 agent 职责。</Card.Description>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="secondary" onPress={() => setGeneratorOpen(true)} data-testid="roles-generate-ai">
                  用 AI 生成
                </Button>
                <Button size="sm" variant="primary" onPress={startCreate} data-testid="roles-new-role">
                  新建角色
                </Button>
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            {roles.length === 0 ? (
              <div className="ah-roles-empty">
                尚未从 <code className="ah-mono">/roles</code> 返回角色。
              </div>
            ) : (
              <ul className="ah-roles-list" aria-label="角色">
                {roles.map((role) => (
                  <li key={role.id}>
                    <Card
                      variant={mode === "edit" && selectedId === role.id ? "secondary" : "transparent"}
                      className={[
                        "ah-role-list-card",
                        mode === "edit" && selectedId === role.id ? "ah-role-list-card-selected" : ""
                      ].join(" ")}
                    >
                      <Card.Header>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <Card.Title className="truncate text-sm">{roleDisplayName(role.name)}</Card.Title>
                            {role.is_builtin ? <Chip size="sm" variant="soft" color="accent">内置</Chip> : null}
                          </div>
                          <Card.Description className="line-clamp-2 text-xs">
                            {roleDisplayDescription(role) || "暂无描述。"}
                          </Card.Description>
                        </div>
                      </Card.Header>
                      <Card.Footer className="ah-role-list-actions">
                        <Button size="sm" variant="secondary" onPress={() => startEdit(role)} data-testid={`roles-edit-${role.id}`}>编辑</Button>
                        <Button
                          size="sm"
                          variant="danger"
                          isDisabled={role.is_builtin}
                          onPress={() => setDeleteTarget(role)}
                          data-testid={`roles-delete-${role.id}`}
                        >
                          删除
                        </Button>
                      </Card.Footer>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </Card.Content>
        </Card>

        <Card variant="default" className="ah-role-editor-card border border-border bg-overlay">
          <Card.Header>
            <div className="flex items-start justify-between gap-3">
              <div>
                <Card.Title>{mode === "edit" && selectedRole ? `编辑 ${roleDisplayName(selectedRole.name)}` : "创建角色"}</Card.Title>
                <Card.Description>通过 REST 保存；不附加 SSE 订阅。</Card.Description>
              </div>
              <Chip size="sm" variant="soft" color={mode === "edit" ? "accent" : "success"}>{mode === "edit" ? "PATCH" : "POST"}</Chip>
            </div>
          </Card.Header>
          <Card.Content className="grid gap-4 ah-role-editor-content">
            {mode === "edit" && selectedRole?.is_builtin ? (
              <div className="rounded-2xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground" role="alert">
                {BUILTIN_ROLE_WARNING.replace("<id>", selectedRole.id)}
              </div>
            ) : null}

            <TextField value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))}>
              <Label className="text-sm font-semibold">名称</Label>
              <Input placeholder="例如：发布评审员" data-testid="roles-name-input" />
            </TextField>

            <TextField value={draft.description} onChange={(value) => setDraft((current) => ({ ...current, description: value }))}>
              <Label className="text-sm font-semibold">描述</Label>
              <Input placeholder="角色列表中的简短说明" data-testid="roles-description-input" />
            </TextField>

            <TextField value={draft.prompt} onChange={(value) => setDraft((current) => ({ ...current, prompt: value }))}>
              <Label className="text-sm font-semibold">提示词</Label>
              <TextArea className="min-h-44" placeholder="描述这个角色的行为方式和职责" data-testid="roles-prompt-input" />
            </TextField>

            <div className="grid gap-2">
              <Label className="text-sm font-semibold">能力</Label>
              <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">
                能力用于角色展示和团队分派，不会直接授权工具调用。文件、终端和上下文写入权限请在“许可”页配置。
              </div>
              <div className="grid gap-2 rounded-2xl border border-border bg-surface p-3 sm:grid-cols-2" data-testid="roles-capabilities-input">
                {WELL_KNOWN_CAPABILITY_TOKENS.map((token) => {
                  const selected = parseCapabilities(draft.capabilitiesText).includes(token);
                  return (
                    <Checkbox
                      key={token}
                      isSelected={selected}
                      onChange={(selected) => setDraft((current) => ({
                        ...current,
                        capabilitiesText: setCapabilityToken(parseCapabilities(current.capabilitiesText), token, selected).join(", ")
                      }))}
                      className="rounded-xl border border-border bg-overlay px-3 py-2"
                    >
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <Checkbox.Content>
                        <Label className="text-sm ah-mono">{token}</Label>
                      </Checkbox.Content>
                    </Checkbox>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-1">
              {parseCapabilities(draft.capabilitiesText).length === 0 ? (
                <Chip size="sm" variant="soft" color="default">暂无能力</Chip>
              ) : parseCapabilities(draft.capabilitiesText).map((capability) => (
                <Chip key={capability} size="sm" variant="soft" color="default">{capability}</Chip>
              ))}
            </div>
          </Card.Content>
          <Card.Footer className="flex-wrap gap-2">
            <Button variant="primary" isPending={saving} onPress={saveRole} data-testid="roles-save">保存</Button>
            {mode === "edit" ? <Button variant="secondary" onPress={startCreate} data-testid="roles-new-draft">新建草稿</Button> : null}
            {message ? <span className="text-xs text-success" role="status">{message}</span> : null}
            {error ? <span className="text-xs text-danger" role="alert">{error}</span> : null}
          </Card.Footer>
        </Card>
      </div>

      <Modal.Backdrop isOpen={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(undefined); }}>
        <Modal.Container size="md">
          <Modal.Dialog aria-label="删除角色确认" data-testid="roles-delete-confirmation">
            <Modal.CloseTrigger aria-label="关闭删除角色确认" />
            <Modal.Header>
              <Modal.Heading>删除角色</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm text-muted">
                确认删除 <span className="font-semibold text-foreground">{deleteTarget?.name}</span>？如果仍有 agent bindings 引用该角色，daemon 会拒绝删除。
              </p>
            </Modal.Body>
            <Modal.Footer className="gap-2">
              <Button variant="secondary" onPress={() => setDeleteTarget(undefined)}>取消</Button>
              <Button variant="danger" isPending={deleting} onPress={confirmDelete} data-testid="roles-confirm-delete">删除</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <RoleGeneratorModal
        isOpen={generatorOpen}
        modelConfigs={modelConfigs}
        roles={roles}
        fetchImpl={fetchImpl}
        onClose={() => setGeneratorOpen(false)}
        onRoleSaved={(nextRoles) => {
          updateRoles(nextRoles);
          const saved = nextRoles.find((role) => !roles.some((existing) => existing.id === role.id));
          if (saved) {
            setMode("edit");
            setSelectedId(saved.id);
            setDraft(draftFromRole(saved));
          }
          setMessage("角色已创建。");
        }}
      />
    </section>
  );
}

export function normalizeRoles(payload: unknown): RoleConfig[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.roles)
      ? payload.roles
      : [];
  return sortRolesByName(rows.map(normalizeRole).filter((role): role is RoleConfig => role !== undefined));
}

export async function createRole(fetchImpl: typeof fetch, input: RoleInput): Promise<RoleConfig> {
  return writeRole(fetchImpl, "/roles", "POST", input);
}

export async function updateRole(fetchImpl: typeof fetch, id: string, input: RoleInput): Promise<RoleConfig> {
  return writeRole(fetchImpl, `/roles/${encodeURIComponent(id)}`, "PATCH", input);
}

export async function deleteRole(fetchImpl: typeof fetch, id: string): Promise<void> {
  const response = await fetchImpl(`/roles/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw await roleApiError(response, "删除角色失败");
}

export function upsertRole(roles: ReadonlyArray<RoleConfig>, role: RoleConfig): RoleConfig[] {
  return sortRolesByName([...roles.filter((candidate) => candidate.id !== role.id), role]);
}

export function parseCapabilities(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)));
}

export function toggleCapabilityToken(current: readonly string[], token: string): string[] {
  return current.includes(token)
    ? current.filter((candidate) => candidate !== token)
    : [...current, token];
}

export function setCapabilityToken(current: readonly string[], token: string, selected: boolean): string[] {
  const withoutToken = current.filter((candidate) => candidate !== token);
  return selected ? [...withoutToken, token] : withoutToken;
}

function emptyDraft(): RoleDraft {
  return { name: "", description: "", prompt: "", capabilitiesText: "" };
}

function draftFromRole(role: RoleConfig): RoleDraft {
  return {
    name: role.name,
    description: role.description,
    prompt: role.prompt,
    capabilitiesText: role.capabilities.join(", ")
  };
}

function inputFromDraft(draft: RoleDraft): RoleInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    prompt: draft.prompt,
    capabilities: parseCapabilities(draft.capabilitiesText)
  };
}

async function writeRole(fetchImpl: typeof fetch, path: string, method: "POST" | "PATCH", input: RoleInput): Promise<RoleConfig> {
  const response = await fetchImpl(path, {
    method,
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await roleApiError(response, "保存角色失败");
  const role = normalizeRole(await response.json());
  if (!role) throw new RoleApiError("角色响应中没有包含角色。", response.status, undefined);
  return role;
}

async function roleApiError(response: Response, fallback: string): Promise<RoleApiError> {
  const payload = await readJson(response);
  if (response.status === 409 && isRecord(payload) && payload.error === "role_has_bindings") {
    const bindingCount = typeof payload.bindingCount === "number" ? payload.bindingCount : undefined;
    return new RoleApiError(
      bindingCount === undefined
        ? "该角色仍有关联的 agent bindings；请先移除 bindings 再删除。"
        : `该角色仍有关联的 ${bindingCount} 个 agent bindings；请先移除 bindings 再删除。`,
      response.status,
      payload
    );
  }
  const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : `${fallback}: HTTP ${response.status}`;
  return new RoleApiError(message, response.status, payload);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function normalizeRole(raw: unknown): RoleConfig | undefined {
  const value = isRecord(raw) && isRecord(raw.role) ? raw.role : raw;
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return undefined;
  return {
    id: value.id,
    name: value.name,
    description: typeof value.description === "string" ? value.description : "",
    prompt: typeof value.prompt === "string" ? value.prompt : "",
    capabilities: normalizeCapabilities(value.capabilities),
    is_builtin: Boolean(value.is_builtin ?? value.isBuiltin)
  };
}

function normalizeCapabilities(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return parseCapabilities(value);
  }
  return [];
}

function sortRolesByName(roles: RoleConfig[]): RoleConfig[] {
  return roles.slice().sort((a, b) => a.name.localeCompare(b.name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
