import { useEffect, useMemo, useState } from "react";
import { Avatar, Button, Card, Chip, Input, Label, Modal, ScrollShadow, TextField } from "@heroui/react";
import type { ParticipantViewModel, TaskViewModel } from "../../types.ts";
import { initials } from "../../lib/format.ts";
import { presenceColor } from "../../lib/status.ts";

type AgentBindingOption = {
  readonly id: string;
  readonly roleName: string;
  readonly runtimeName: string;
  readonly runtimeKind: string;
  readonly modelName?: string | undefined;
};

type SkillSummary = {
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly origin?: string | undefined;
  readonly mode?: "add" | "restrict" | string | undefined;
  readonly enabled?: boolean | undefined;
};

type MemberSkillState = {
  readonly effectiveSkills: readonly SkillSummary[];
  readonly overrides: readonly SkillSummary[];
};

export function MembersPanel({
  roomId,
  members,
  tasks = [],
  csrfFetch = fetch
}: {
  roomId?: string | undefined;
  members: ReadonlyArray<ParticipantViewModel>;
  tasks?: ReadonlyArray<TaskViewModel> | undefined;
  csrfFetch?: typeof fetch | undefined;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [bindings, setBindings] = useState<AgentBindingOption[]>([]);
  const [query, setQuery] = useState("");
  const [loadingBindings, setLoadingBindings] = useState(false);
  const [pendingBindingId, setPendingBindingId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!addOpen) return;
    let cancelled = false;
    setLoadingBindings(true);
    setError(undefined);
    void csrfFetch("/agent-bindings", {
      credentials: "same-origin",
      headers: { accept: "application/json" }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Load agent bindings failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!cancelled) setBindings(normalizeAgentBindings(payload));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingBindings(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addOpen, csrfFetch]);

  const memberBindingIds = useMemo(() => new Set(members.map((member) => member.agentBindingId ?? member.id)), [members]);
  const visibleBindings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return bindings
      .filter((binding) => !memberBindingIds.has(binding.id))
      .filter((binding) => {
        if (!normalizedQuery) return true;
        return [binding.roleName, binding.runtimeName, binding.runtimeKind, binding.modelName ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      });
  }, [bindings, memberBindingIds, query]);

  const addParticipant = (agentBindingId: string) => {
    if (!roomId) return;
    setPendingBindingId(agentBindingId);
    setError(undefined);
    void csrfFetch(`/rooms/${encodeURIComponent(roomId)}/participants`, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ agentBindingId })
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Add teammate failed"));
        setAddOpen(false);
        setQuery("");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPendingBindingId(undefined));
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Members</h3>
          <p className="text-xs text-muted">{members.length} participant{members.length === 1 ? "" : "s"} in this room</p>
        </div>
        <Button size="sm" variant="secondary" onPress={() => setAddOpen(true)} isDisabled={!roomId}>
          Add teammate
        </Button>
      </div>

      {members.length === 0 ? (
        <EmptyState label="No members in this room yet." />
      ) : (
        <ul className="flex flex-col gap-2" role="list">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              roomId={roomId}
              member={member}
              task={currentTaskForMember(member, tasks)}
              csrfFetch={csrfFetch}
            />
          ))}
        </ul>
      )}

      {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}

      {roomId ? <RoomSkillPool roomId={roomId} csrfFetch={csrfFetch} /> : null}

      <Modal.Backdrop isOpen={addOpen} onOpenChange={setAddOpen}>
        <Modal.Container size="lg">
          <Modal.Dialog aria-label="Add teammate">
            <Modal.CloseTrigger aria-label="Close add teammate" />
            <Modal.Header>
              <Modal.Heading>Add teammate</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="grid gap-3">
                <TextField value={query} onChange={setQuery}>
                  <Label className="text-sm font-semibold">Search bindings</Label>
                  <Input placeholder="Role, runtime, or model" />
                </TextField>
                {loadingBindings ? <p className="text-sm text-muted">Loading bindings...</p> : null}
                <ScrollShadow className="max-h-80 overflow-auto pr-1" orientation="vertical">
                  <div className="grid gap-2">
                    {visibleBindings.length === 0 && !loadingBindings ? (
                      <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-sm text-muted">
                        No available bindings.
                      </div>
                    ) : visibleBindings.map((binding) => (
                      <button
                        key={binding.id}
                        type="button"
                        className="grid gap-1 rounded-xl border border-border bg-surface px-3 py-2 text-left hover:bg-surface-secondary"
                        onClick={() => addParticipant(binding.id)}
                        disabled={pendingBindingId !== undefined}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{binding.roleName}</span>
                          <Chip size="sm" variant="soft" color={binding.runtimeKind === "native" ? "success" : "default"}>{binding.runtimeKind}</Chip>
                        </span>
                        <span className="truncate text-xs text-muted">{binding.runtimeName}{binding.modelName ? ` / ${binding.modelName}` : ""}</span>
                      </button>
                    ))}
                  </div>
                </ScrollShadow>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={() => setAddOpen(false)}>Close</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

function RoomSkillPool({ roomId, csrfFetch }: { roomId: string; csrfFetch: typeof fetch }) {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [roomSkills, setRoomSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingSkillId, setPendingSkillId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const refresh = () => {
    setLoading(true);
    setError(undefined);
    void Promise.all([
      csrfFetch("/skills", { credentials: "same-origin", headers: { accept: "application/json" } }).then(async (response) => {
        if (!response.ok) throw new Error(`Load skills failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      }),
      csrfFetch(`/rooms/${encodeURIComponent(roomId)}/skills`, { credentials: "same-origin", headers: { accept: "application/json" } }).then(async (response) => {
        if (!response.ok) throw new Error(`Load room skills failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
    ])
      .then(([allSkills, assignedSkills]) => {
        setSkills(normalizeSkills(allSkills));
        setRoomSkills(normalizeSkills(assignedSkills));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) refresh();
  }, [open, roomId]);

  const enabledIds = new Set(roomSkills.filter((skill) => skill.enabled !== false).map((skill) => skill.id));

  const setEnabled = (skillId: string, enabled: boolean) => {
    setPendingSkillId(skillId);
    setError(undefined);
    void csrfFetch(`/rooms/${encodeURIComponent(roomId)}/skills`, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ skillId, enabled })
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Update room skill failed"));
        refresh();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPendingSkillId(undefined));
  };

  return (
    <details className="rounded-xl border border-border bg-surface-secondary px-3 py-2" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-xs font-semibold uppercase text-muted">Room skill pool</summary>
      <div className="mt-3 grid gap-3">
        {loading ? <p className="text-xs text-muted">Loading room skills...</p> : null}
        {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
        <div className="flex flex-wrap gap-1">
          {enabledIds.size === 0 ? (
            <Chip size="sm" variant="soft" color="default">no room skills</Chip>
          ) : roomSkills.filter((skill) => enabledIds.has(skill.id)).map((skill) => (
            <Chip key={skill.id} size="sm" variant="soft" color="accent">{skill.name}</Chip>
          ))}
        </div>
        {open ? (
          <div className="grid gap-2">
            {skills.length === 0 && !loading ? <p className="text-xs text-muted">No workspace skills found.</p> : null}
            {skills.map((skill) => {
              const enabled = enabledIds.has(skill.id);
              return (
                <div key={skill.id} className="grid gap-2 rounded-lg border border-border bg-overlay px-2 py-2 text-xs sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{skill.name}</div>
                    <div className="truncate text-muted">{skill.description ?? "No description"}</div>
                  </div>
                  <Button
                    size="sm"
                    variant={enabled ? "danger" : "secondary"}
                    isDisabled={pendingSkillId !== undefined}
                    onPress={() => setEnabled(skill.id, !enabled)}
                  >
                    {enabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function MemberRow({
  roomId,
  member,
  task,
  csrfFetch
}: {
  roomId?: string | undefined;
  member: ParticipantViewModel;
  task?: TaskViewModel | undefined;
  csrfFetch: typeof fetch;
}) {
  const isLeader = member.role === "primary" || member.role === "leader";
  const capabilities = member.capabilities ?? [];

  return (
    <li>
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <div className="flex min-w-0 items-start gap-3">
            <Avatar><Avatar.Fallback>{initials(member.name)}</Avatar.Fallback></Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Card.Title className="truncate text-sm">{member.name}</Card.Title>
                {isLeader ? <Chip size="sm" variant="soft" color="accent">Leader</Chip> : null}
                <Chip size="sm" variant="soft" color={presenceColor(member.presence)}>{member.presence}</Chip>
              </div>
              <Card.Description className="mt-1 text-xs">{member.role} / {member.adapterId}</Card.Description>
              {task ? <p className="mt-2 truncate text-xs text-muted">Current task: {task.title}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1">
                {capabilities.length === 0 ? (
                  <Chip size="sm" variant="soft" color="default">no capabilities</Chip>
                ) : capabilities.map((capability) => (
                  <Chip key={capability} size="sm" variant="soft" color="default">{capability}</Chip>
                ))}
              </div>
            </div>
          </div>
        </Card.Header>
        <Card.Content>
          <MemberSkills roomId={roomId} participantId={member.id} csrfFetch={csrfFetch} />
        </Card.Content>
      </Card>
    </li>
  );
}

function MemberSkills({ roomId, participantId, csrfFetch }: { roomId?: string | undefined; participantId: string; csrfFetch: typeof fetch }) {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [state, setState] = useState<MemberSkillState>({ effectiveSkills: [], overrides: [] });
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const refresh = () => {
    if (!roomId) return;
    setLoading(true);
    setError(undefined);
    void Promise.all([
      csrfFetch("/skills", { credentials: "same-origin", headers: { accept: "application/json" } }).then(async (response) => {
        if (!response.ok) throw new Error(`Load skills failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      }),
      csrfFetch(`/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(participantId)}/skills`, {
        credentials: "same-origin",
        headers: { accept: "application/json" }
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Load member skills failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
    ])
      .then(([allSkills, memberSkills]) => {
        setSkills(normalizeSkills(allSkills));
        setState(normalizeMemberSkills(memberSkills));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) refresh();
  }, [open, roomId, participantId]);

  const writeOverride = (skillId: string, mode: "add" | "restrict") => {
    if (!roomId) return;
    setPending(`${mode}:${skillId}`);
    setError(undefined);
    void csrfFetch(`/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(participantId)}/skills`, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ skillId, mode })
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Update skill override failed"));
        refresh();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPending(undefined));
  };

  const removeOverride = (skillId: string) => {
    if (!roomId) return;
    setPending(`remove:${skillId}`);
    setError(undefined);
    void csrfFetch(`/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(participantId)}/skills/${encodeURIComponent(skillId)}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { accept: "application/json" }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Remove skill override failed"));
        refresh();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPending(undefined));
  };

  return (
    <details className="rounded-xl border border-border bg-surface-secondary px-3 py-2" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-xs font-semibold uppercase text-muted">Skills</summary>
      <div className="mt-3 grid gap-3">
        {loading ? <p className="text-xs text-muted">Loading skills...</p> : null}
        {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
        <div className="flex flex-wrap gap-1">
          {state.effectiveSkills.length === 0 ? (
            <Chip size="sm" variant="soft" color="default">no effective skills</Chip>
          ) : state.effectiveSkills.map((skill) => (
            <Chip key={skill.id} size="sm" variant="soft" color="accent">{skill.name}</Chip>
          ))}
        </div>
        {open ? (
          <div className="grid gap-2">
            {skills.map((skill) => {
              const override = state.overrides.find((item) => item.id === skill.id);
              return (
                <div key={skill.id} className="grid gap-2 rounded-lg border border-border bg-overlay px-2 py-2 text-xs sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{skill.name}</div>
                    <div className="truncate text-muted">{override?.mode ? `Override: ${override.mode}` : skill.description ?? "No override"}</div>
                  </div>
                  <div className="flex flex-wrap gap-1 sm:justify-end">
                    <Button size="sm" variant="secondary" isDisabled={pending !== undefined} onPress={() => writeOverride(skill.id, "add")}>Add</Button>
                    <Button size="sm" variant="tertiary" isDisabled={pending !== undefined} onPress={() => writeOverride(skill.id, "restrict")}>Restrict</Button>
                    {override ? <Button size="sm" variant="danger" isDisabled={pending !== undefined} onPress={() => removeOverride(skill.id)}>Clear</Button> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function currentTaskForMember(member: ParticipantViewModel, tasks: ReadonlyArray<TaskViewModel>): TaskViewModel | undefined {
  const bindingId = member.agentBindingId ?? member.id;
  return tasks.find((task) =>
    task.status !== "completed"
    && task.status !== "cancelled"
    && (
      task.assigneeAgentId === member.id
      || task.assigneeBindingId === bindingId
      || task.assigneeBindingId === member.id
      || (member.roleId !== undefined && task.assigneeRoleId === member.roleId)
    )
  );
}

function normalizeAgentBindings(payload: unknown): AgentBindingOption[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.agentBindings)
      ? payload.agentBindings
      : [];
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringValue(row.id);
    if (!id) return [];
    const role = isRecord(row.role) ? row.role : {};
    const runtime = isRecord(row.runtime) ? row.runtime : {};
    const modelConfig = isRecord(row.modelConfig) ? row.modelConfig : undefined;
    return [{
      id,
      roleName: stringValue(role.name) ?? stringValue(row.roleId ?? row.role_id) ?? id,
      runtimeName: stringValue(runtime.name) ?? stringValue(row.runtimeId ?? row.runtime_id) ?? "Runtime",
      runtimeKind: stringValue(runtime.kind) ?? "runtime",
      modelName: modelConfig ? stringValue(modelConfig.name) ?? stringValue(modelConfig.model) : undefined
    }];
  });
}

function normalizeSkills(payload: unknown): SkillSummary[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.skills)
      ? payload.skills
      : [];
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringValue(row.id);
    const name = stringValue(row.name);
    if (!id || !name) return [];
    return [{
      id,
      name,
      description: stringValue(row.description),
      origin: stringValue(row.origin),
      mode: stringValue(row.mode),
      enabled: typeof row.enabled === "boolean" ? row.enabled : typeof row.enabled === "number" ? row.enabled !== 0 : undefined
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeMemberSkills(payload: unknown): MemberSkillState {
  if (!isRecord(payload)) return { effectiveSkills: [], overrides: [] };
  return {
    effectiveSkills: normalizeSkills({ skills: payload.effectiveSkills }),
    overrides: normalizeSkills({ skills: payload.skills })
  };
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.clone().json() as unknown;
    if (isRecord(payload)) {
      const error = stringValue(payload.error);
      const message = stringValue(payload.message);
      if (error && message) return `${error}: ${message}`;
      if (error) return error;
      if (message) return message;
    }
  } catch {
    // keep fallback
  }
  return `${fallback}: HTTP ${response.status}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">{label}</div>;
}
