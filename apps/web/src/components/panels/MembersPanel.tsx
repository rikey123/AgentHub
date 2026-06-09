import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Button,
  Chip,
  Input,
  Label,
  Modal,
  ScrollShadow,
  Switch,
  TextField
} from "@heroui/react";
import type { ParticipantViewModel, TaskViewModel } from "../../types.ts";
import { initials } from "../../lib/format.ts";
import { roleDisplayName } from "../../lib/roles.ts";
import { skillDisplayDescription, skillDisplayName } from "../../lib/skills.ts";
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

  const memberBindingIds = useMemo(
    () => new Set(members.map((member) => member.agentBindingId ?? member.id)),
    [members]
  );
  const visibleBindings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return bindings
      .filter((binding) => !memberBindingIds.has(binding.id))
      .filter((binding) => {
        if (!normalizedQuery) return true;
        return [
          binding.roleName,
          roleDisplayName(binding.roleName),
          binding.runtimeName,
          binding.runtimeKind,
          binding.modelName ?? ""
        ]
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
        if (!response.ok) throw new Error(await responseError(response, "添加队友失败"));
        setAddOpen(false);
        setQuery("");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPendingBindingId(undefined));
  };

  return (
    <div className="ah-members-panel flex flex-col gap-4 p-3">
      <div className="ah-panel-heading">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">成员</h3>
          <p className="text-xs text-muted">此房间中有 {members.length} 名成员</p>
        </div>
        <Button
          className="ah-pill-action"
          size="sm"
          variant="secondary"
          onPress={() => setAddOpen(true)}
          isDisabled={!roomId}
          aria-label="添加队友"
        >
          <span className="ah-pill-action-plus" aria-hidden="true">
            +
          </span>
          <span className="ah-pill-action-label">添加队友</span>
        </Button>
      </div>

      {members.length === 0 ? (
        <EmptyState label="此房间暂无成员。" />
      ) : (
        <ul className="flex flex-col gap-1.5" role="list">
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

      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {roomId ? <RoomSkillPool roomId={roomId} csrfFetch={csrfFetch} /> : null}

      <Modal.Backdrop isOpen={addOpen} onOpenChange={setAddOpen}>
        <Modal.Container size="lg">
          <Modal.Dialog aria-label="添加队友">
            <Modal.CloseTrigger aria-label="关闭添加队友" />
            <Modal.Header>
              <Modal.Heading>添加队友</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="grid gap-3">
                <TextField value={query} onChange={setQuery}>
                  <Label className="text-sm font-semibold">搜索绑定</Label>
                  <Input placeholder="角色、runtime 或模型" />
                </TextField>
                {loadingBindings ? <p className="text-sm text-muted">正在加载绑定...</p> : null}
                <ScrollShadow className="max-h-80 overflow-auto pr-1" orientation="vertical">
                  <div className="grid gap-2">
                    {visibleBindings.length === 0 && !loadingBindings ? (
                      <div className="rounded-lg border border-dashed border-border bg-surface p-3 text-sm text-muted">
                        暂无可用绑定。
                      </div>
                    ) : (
                      visibleBindings.map((binding) => (
                        <button
                          key={binding.id}
                          type="button"
                          className="grid gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:bg-surface-secondary"
                          onClick={() => addParticipant(binding.id)}
                          disabled={pendingBindingId !== undefined}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                              {roleDisplayName(binding.roleName)}
                            </span>
                            <Chip
                              size="sm"
                              variant="soft"
                              color={binding.runtimeKind === "native" ? "success" : "default"}
                            >
                              {binding.runtimeKind}
                            </Chip>
                          </span>
                          <span className="truncate text-xs text-muted">
                            {binding.runtimeName}
                            {binding.modelName ? ` / ${binding.modelName}` : ""}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </ScrollShadow>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={() => setAddOpen(false)}>
                关闭
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

function RoomSkillPool({ roomId, csrfFetch }: { roomId: string; csrfFetch: typeof fetch }) {
  const [open, setOpen] = useState(true);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [roomSkills, setRoomSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingSkillId, setPendingSkillId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const refresh = () => {
    setLoading(true);
    setError(undefined);
    void Promise.all([
      csrfFetch("/skills", {
        credentials: "same-origin",
        headers: { accept: "application/json" }
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Load skills failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      }),
      csrfFetch(`/rooms/${encodeURIComponent(roomId)}/skills`, {
        credentials: "same-origin",
        headers: { accept: "application/json" }
      }).then(async (response) => {
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

  const enabledIds = new Set(
    roomSkills.filter((skill) => skill.enabled !== false).map((skill) => skill.id)
  );
  const enabledCount = skills.filter((skill) => enabledIds.has(skill.id)).length;

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
        if (!response.ok)
          throw new Error(await responseError(response, "Update room skill failed"));
        refresh();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPendingSkillId(undefined));
  };

  return (
    <details
      className="ah-dashboard-section ah-skill-section"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="ah-section-summary">
        <span className="ah-skill-toggle" aria-hidden="true">
          <span className="ah-skill-toggle-bars">
            <span className="ah-skill-toggle-line ah-skill-toggle-line-1" />
            <span className="ah-skill-toggle-line ah-skill-toggle-line-2" />
            <span className="ah-skill-toggle-line ah-skill-toggle-line-3" />
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate">房间技能</span>
        <span className="ah-sr-only">房间技能开关</span>
        <Chip size="sm" variant="soft" color={enabledCount > 0 ? "accent" : "default"}>
          {enabledCount}/{skills.length}
        </Chip>
      </summary>
      <div className="mt-3 grid gap-3">
        {loading ? <p className="text-xs text-muted">正在加载房间技能...</p> : null}
        {error ? (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {open ? (
          <div className="grid gap-3">
            <div className="ah-subsection-label">
              <span>工作区技能池</span>
              <Chip size="sm" variant="soft" color="default">
                {enabledCount} 个已启用
              </Chip>
            </div>
            {skills.length === 0 && !loading ? (
              <p className="text-xs text-muted">当前工作区还没有可用技能。</p>
            ) : null}
            <div className="grid gap-2">
              {skills.map((skill) => {
                const enabled = enabledIds.has(skill.id);
                return (
                  <SkillToggleRow
                    key={skill.id}
                    skill={skill}
                    enabled={enabled}
                    pending={pendingSkillId !== undefined}
                    onChange={(selected) => setEnabled(skill.id, selected)}
                  />
                );
              })}
            </div>
          </div>
        ) : null}
        <p className="text-xs text-muted">
          打开后，此技能会加入房间默认技能池；关闭后，成员只会在单独追加时使用它。
        </p>
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
    <li className="ah-member-card">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar className="ah-agent-avatar">
          <Avatar.Fallback>{initials(member.name)}</Avatar.Fallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold">
              {roleDisplayName(member.name)}
            </span>
            {isLeader ? (
              <Chip size="sm" variant="soft" color="accent">
                Leader
              </Chip>
            ) : null}
            <Chip size="sm" variant="soft" color={presenceColor(member.presence)}>
              {presenceLabel(member.presence)}
            </Chip>
          </div>
          <p className="mt-1 truncate text-xs text-muted">
            {member.role} / {member.adapterId}
          </p>
          {task ? (
            <div className="mt-2 rounded-lg border border-border bg-surface-secondary px-2 py-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <Chip size="sm" variant="soft" color={taskStatusColor(task.status)}>
                  {taskStatusLabel(task.status)}
                </Chip>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {task.title}
                </span>
              </div>
              {task.blockerReason ? (
                <p className="mt-1 truncate text-xs text-danger">{task.blockerReason}</p>
              ) : null}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {capabilities.length === 0 ? (
              <Chip size="sm" variant="soft" color="default">
                暂无能力
              </Chip>
            ) : (
              capabilities.map((capability) => (
                <Chip key={capability} size="sm" variant="soft" color="default">
                  {capability}
                </Chip>
              ))
            )}
          </div>
          <MemberSkills roomId={roomId} participantId={member.id} csrfFetch={csrfFetch} />
        </div>
      </div>
    </li>
  );
}

function MemberSkills({
  roomId,
  participantId,
  csrfFetch
}: {
  roomId?: string | undefined;
  participantId: string;
  csrfFetch: typeof fetch;
}) {
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
      csrfFetch("/skills", {
        credentials: "same-origin",
        headers: { accept: "application/json" }
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Load skills failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      }),
      csrfFetch(
        `/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(participantId)}/skills`,
        {
          credentials: "same-origin",
          headers: { accept: "application/json" }
        }
      ).then(async (response) => {
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
    void csrfFetch(
      `/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(participantId)}/skills`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ skillId, mode })
      }
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(await responseError(response, "Update skill override failed"));
        refresh();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPending(undefined));
  };

  const removeOverride = (skillId: string) => {
    if (!roomId) return;
    setPending(`remove:${skillId}`);
    setError(undefined);
    void csrfFetch(
      `/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(participantId)}/skills/${encodeURIComponent(skillId)}`,
      {
        method: "DELETE",
        credentials: "same-origin",
        headers: { accept: "application/json" }
      }
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(await responseError(response, "Remove skill override failed"));
        refresh();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPending(undefined));
  };

  return (
    <details
      className="ah-member-skills"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="ah-member-skills-summary">
        <span>技能</span>
        <Chip size="sm" variant="soft" color="default">
          {state.effectiveSkills.length}
        </Chip>
      </summary>
      <div className="mt-3 grid gap-3">
        {loading ? <p className="text-xs text-muted">正在加载技能...</p> : null}
        {error ? (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1">
          {state.effectiveSkills.length === 0 ? (
            <Chip size="sm" variant="soft" color="default">
              暂无生效技能
            </Chip>
          ) : (
            state.effectiveSkills.map((skill) => (
              <Chip key={skill.id} size="sm" variant="soft" color="accent">
                {skillDisplayName(skill)}
              </Chip>
            ))
          )}
        </div>
        {open ? (
          <div className="grid gap-2">
            {skills.map((skill) => {
              const override = state.overrides.find((item) => item.id === skill.id);
              return (
                <div key={skill.id} className="ah-skill-override-row">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">{skillDisplayName(skill)}</div>
                    <div className="truncate text-xs text-muted">
                      {override?.mode
                        ? `覆盖：${skillOverrideModeLabel(override.mode)}`
                        : skillDisplayDescription(skill) || "无覆盖"}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button
                      isIconOnly
                      size="sm"
                      variant="secondary"
                      isDisabled={pending !== undefined}
                      onPress={() => writeOverride(skill.id, "add")}
                      aria-label={`添加 ${skillDisplayName(skill)}`}
                    >
                      +
                    </Button>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="tertiary"
                      isDisabled={pending !== undefined}
                      onPress={() => writeOverride(skill.id, "restrict")}
                      aria-label={`限制 ${skillDisplayName(skill)}`}
                    >
                      -
                    </Button>
                    {override ? (
                      <Button
                        isIconOnly
                        size="sm"
                        variant="danger"
                        isDisabled={pending !== undefined}
                        onPress={() => removeOverride(skill.id)}
                        aria-label={`清除 ${skillDisplayName(skill)}`}
                      >
                        x
                      </Button>
                    ) : null}
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

function SkillToggleRow({
  skill,
  enabled,
  pending,
  onChange
}: {
  skill: SkillSummary;
  enabled: boolean;
  pending: boolean;
  onChange: (selected: boolean) => void;
}) {
  const name = skillDisplayName(skill);
  return (
    <div className={enabled ? "ah-skill-row ah-skill-row-active" : "ah-skill-row"}>
      <span className="ah-skill-icon" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="truncate text-xs text-muted">
          {skillDisplayDescription(skill) || skill.origin || "无描述"}
        </div>
      </div>
      <div className="ah-skill-row-action">
        <span className={enabled ? "ah-skill-state is-enabled" : "ah-skill-state"}>
          {enabled ? "已启用" : "未启用"}
        </span>
        <Switch
          className="ah-room-skill-switch"
          size="sm"
          isSelected={enabled}
          isDisabled={pending}
          onChange={onChange}
          aria-label={`${enabled ? "停用" : "启用"} ${name}`}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </div>
    </div>
  );
}

function currentTaskForMember(
  member: ParticipantViewModel,
  tasks: ReadonlyArray<TaskViewModel>
): TaskViewModel | undefined {
  const bindingId = member.agentBindingId ?? member.id;
  return tasks.find(
    (task) =>
      task.status !== "completed" &&
      task.status !== "cancelled" &&
      (task.assigneeAgentId === member.id ||
        task.assigneeBindingId === bindingId ||
        task.assigneeBindingId === member.id ||
        (member.roleId !== undefined && task.assigneeRoleId === member.roleId))
  );
}

function taskStatusLabel(status: string): string {
  switch (status) {
    case "in_progress":
    case "running":
      return "进行中";
    case "queued":
    case "assigned":
      return "排队中";
    case "review":
    case "waiting_review":
      return "待评审";
    case "blocked":
      return "已阻塞";
    case "failed":
      return "失败";
    default:
      return status;
  }
}

function presenceLabel(presence: string): string {
  if (presence === "active") return "活跃";
  if (presence === "observing") return "观察中";
  return presence;
}

function taskStatusColor(status: string): "default" | "success" | "warning" | "danger" | "accent" {
  switch (status) {
    case "in_progress":
    case "running":
      return "success";
    case "queued":
    case "assigned":
      return "default";
    case "review":
    case "waiting_review":
      return "accent";
    case "blocked":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "default";
  }
}

function skillOverrideModeLabel(mode: string): string {
  if (mode === "add") return "添加";
  if (mode === "restrict") return "限制";
  return mode;
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
    return [
      {
        id,
        roleName: stringValue(role.name) ?? stringValue(row.roleId ?? row.role_id) ?? id,
        runtimeName:
          stringValue(runtime.name) ?? stringValue(row.runtimeId ?? row.runtime_id) ?? "Runtime",
        runtimeKind: stringValue(runtime.kind) ?? "runtime",
        modelName: modelConfig
          ? (stringValue(modelConfig.name) ?? stringValue(modelConfig.model))
          : undefined
      }
    ];
  });
}

function normalizeSkills(payload: unknown): SkillSummary[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.skills)
      ? payload.skills
      : [];
  return rows
    .flatMap((row) => {
      if (!isRecord(row)) return [];
      const id = stringValue(row.id);
      const name = stringValue(row.name);
      if (!id || !name) return [];
      return [
        {
          id,
          name,
          description: stringValue(row.description),
          origin: stringValue(row.origin),
          mode: stringValue(row.mode),
          enabled:
            typeof row.enabled === "boolean"
              ? row.enabled
              : typeof row.enabled === "number"
                ? row.enabled !== 0
                : undefined
        }
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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
    const payload = (await response.clone().json()) as unknown;
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
  return <div className="ah-empty-state">{label}</div>;
}
