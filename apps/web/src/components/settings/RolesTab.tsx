import { useEffect, useState } from "react";
import { Button, Card, Chip, Input, Label, Modal, TextArea, TextField } from "@heroui/react";

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

export class RoleApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload: unknown) {
    super(message);
    this.name = "RoleApiError";
  }
}

export function RolesTab({ roles: initialRoles, fetchImpl = fetch, onRolesChange }: RolesTabProps) {
  const [roles, setRoles] = useState<RoleConfig[]>(() => normalizeRoles(initialRoles));
  const [selectedId, setSelectedId] = useState<string | undefined>(() => normalizeRoles(initialRoles)[0]?.id);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [draft, setDraft] = useState<RoleDraft>(() => emptyDraft());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleConfig | undefined>();
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
      setError("Role name is required.");
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
      setMessage(mode === "edit" ? "Role saved." : "Role created.");
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
      setMessage("Role deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleteTarget(undefined);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="grid gap-4 p-5" data-testid="settings-panel-roles">
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)]">
        <Card variant="default" className="border border-border bg-overlay">
          <Card.Header>
            <div className="flex items-start justify-between gap-3">
              <div>
                <Card.Title>Roles</Card.Title>
                <Card.Description>Role templates and editable agent responsibilities.</Card.Description>
              </div>
              <Button size="sm" variant="primary" onPress={startCreate} data-testid="roles-new-role">
                New Role
              </Button>
            </div>
          </Card.Header>
          <Card.Content>
            {roles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
                No roles returned from <code className="ah-mono">/roles</code> yet.
              </div>
            ) : (
              <ul className="flex max-h-[52vh] flex-col gap-2 overflow-auto pr-1" aria-label="Roles">
                {roles.map((role) => (
                  <li key={role.id}>
                    <Card variant={mode === "edit" && selectedId === role.id ? "secondary" : "transparent"} className="border border-border">
                      <Card.Header>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <Card.Title className="truncate text-sm">{role.name}</Card.Title>
                            {role.is_builtin ? <Chip size="sm" variant="soft" color="accent">builtin</Chip> : null}
                          </div>
                          <Card.Description className="line-clamp-2 text-xs">
                            {role.description || "No description."}
                          </Card.Description>
                        </div>
                      </Card.Header>
                      <Card.Footer className="gap-2">
                        <Button size="sm" variant="secondary" onPress={() => startEdit(role)} data-testid={`roles-edit-${role.id}`}>Edit</Button>
                        <Button
                          size="sm"
                          variant="danger"
                          isDisabled={role.is_builtin}
                          onPress={() => setDeleteTarget(role)}
                          data-testid={`roles-delete-${role.id}`}
                        >
                          Delete
                        </Button>
                      </Card.Footer>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </Card.Content>
        </Card>

        <Card variant="default" className="border border-border bg-overlay">
          <Card.Header>
            <div className="flex items-start justify-between gap-3">
              <div>
                <Card.Title>{mode === "edit" && selectedRole ? `Edit ${selectedRole.name}` : "Create role"}</Card.Title>
                <Card.Description>Save with REST; no SSE subscription is attached.</Card.Description>
              </div>
              <Chip size="sm" variant="soft" color={mode === "edit" ? "accent" : "success"}>{mode === "edit" ? "PATCH" : "POST"}</Chip>
            </div>
          </Card.Header>
          <Card.Content className="grid gap-4">
            {mode === "edit" && selectedRole?.is_builtin ? (
              <div className="rounded-2xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground" role="alert">
                {BUILTIN_ROLE_WARNING.replace("<id>", selectedRole.id)}
              </div>
            ) : null}

            <TextField value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))}>
              <Label className="text-sm font-semibold">Name</Label>
              <Input placeholder="e.g. Release reviewer" data-testid="roles-name-input" />
            </TextField>

            <TextField value={draft.description} onChange={(value) => setDraft((current) => ({ ...current, description: value }))}>
              <Label className="text-sm font-semibold">Description</Label>
              <Input placeholder="Short summary for the role list" data-testid="roles-description-input" />
            </TextField>

            <TextField value={draft.prompt} onChange={(value) => setDraft((current) => ({ ...current, prompt: value }))}>
              <Label className="text-sm font-semibold">Prompt</Label>
              <TextArea className="min-h-44" placeholder="Describe the role behavior and responsibilities" data-testid="roles-prompt-input" />
            </TextField>

            <TextField value={draft.capabilitiesText} onChange={(value) => setDraft((current) => ({ ...current, capabilitiesText: value }))}>
              <Label className="text-sm font-semibold">Capabilities</Label>
              <Input placeholder="code.edit, code.review, task.delegate" data-testid="roles-capabilities-input" />
            </TextField>

            <div className="flex flex-wrap gap-1">
              {parseCapabilities(draft.capabilitiesText).length === 0 ? (
                <Chip size="sm" variant="soft" color="default">no capabilities</Chip>
              ) : parseCapabilities(draft.capabilitiesText).map((capability) => (
                <Chip key={capability} size="sm" variant="soft" color="default">{capability}</Chip>
              ))}
            </div>
          </Card.Content>
          <Card.Footer className="flex-wrap gap-2">
            <Button variant="primary" isPending={saving} onPress={saveRole} data-testid="roles-save">Save</Button>
            {mode === "edit" ? <Button variant="secondary" onPress={startCreate} data-testid="roles-new-draft">New draft</Button> : null}
            {message ? <span className="text-xs text-success" role="status">{message}</span> : null}
            {error ? <span className="text-xs text-danger" role="alert">{error}</span> : null}
          </Card.Footer>
        </Card>
      </div>

      <Modal.Backdrop isOpen={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(undefined); }}>
        <Modal.Container size="md">
          <Modal.Dialog aria-label="Delete role confirmation" data-testid="roles-delete-confirmation">
            <Modal.CloseTrigger aria-label="Close delete role confirmation" />
            <Modal.Header>
              <Modal.Heading>Delete role</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm text-muted">
                Delete <span className="font-semibold text-foreground">{deleteTarget?.name}</span>? The daemon rejects this when agent bindings still reference the role.
              </p>
            </Modal.Body>
            <Modal.Footer className="gap-2">
              <Button variant="secondary" onPress={() => setDeleteTarget(undefined)}>Cancel</Button>
              <Button variant="danger" isPending={deleting} onPress={confirmDelete} data-testid="roles-confirm-delete">Delete</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
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
  if (!response.ok) throw await roleApiError(response, "Delete role failed");
}

export function upsertRole(roles: ReadonlyArray<RoleConfig>, role: RoleConfig): RoleConfig[] {
  return sortRolesByName([...roles.filter((candidate) => candidate.id !== role.id), role]);
}

export function parseCapabilities(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)));
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
  if (!response.ok) throw await roleApiError(response, `${method} role failed`);
  const role = normalizeRole(await response.json());
  if (!role) throw new RoleApiError("Role response did not include a role.", response.status, undefined);
  return role;
}

async function roleApiError(response: Response, fallback: string): Promise<RoleApiError> {
  const payload = await readJson(response);
  if (response.status === 409 && isRecord(payload) && payload.error === "role_has_bindings") {
    const bindingCount = typeof payload.bindingCount === "number" ? payload.bindingCount : undefined;
    return new RoleApiError(
      bindingCount === undefined
        ? "Role has agent bindings; remove bindings before deleting."
        : `Role has ${bindingCount} agent binding${bindingCount === 1 ? "" : "s"}; remove bindings before deleting.`,
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
