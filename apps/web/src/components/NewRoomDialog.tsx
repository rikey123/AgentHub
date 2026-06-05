import { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  Chip,
  Input,
  Label,
  ListBox,
  Modal,
  Radio,
  RadioGroup,
  ScrollShadow,
  Select,
  TextField
} from "@heroui/react";
import { useRoomCreationOptions, type AgentBindingSummary } from "../hooks/useRoomCreationOptions.ts";

export type RoomMode = "solo" | "assisted" | "squad" | "team";
export type RoomParticipantRole = "observer" | "reviewer" | "specialist";
export type V1RoomParticipantRole = RoomParticipantRole | "primary" | "teammate";
export type RoomPresence = "observing" | "active";
export type LegacyAgentParticipant = {
  type: "agent";
  agentId: string;
  role: RoomParticipantRole;
  defaultPresence: RoomPresence;
};
export type V1RoomParticipant = {
  roleId: string;
  runtimeId: string;
  modelConfigId?: string;
  role?: V1RoomParticipantRole;
  defaultPresence?: RoomPresence;
};

export type CreateRoomInput = {
  title: string;
  mode: RoomMode;
  primaryAgentId: string;
  leaderRoleId?: string;
  skillIds?: string[];
  participants: Array<LegacyAgentParticipant | V1RoomParticipant>;
};

export const ROOM_MODE_OPTIONS: ReadonlyArray<{ value: RoomMode; title: string; description: string }> = [
  { value: "solo", title: "Solo", description: "仅包含一个主 agent。" },
  { value: "assisted", title: "Assisted", description: "主 agent 可搭配可选协作者。" },
  { value: "squad", title: "Squad", description: "由 leader role 协调一个聚焦小组。" },
  { value: "team", title: "Team", description: "由 leader role 在活跃队友之间分派工作。" }
];

export type BuildV1ParticipantInput = V1RoomParticipant & {
  runtimeKind: string;
};

type SelectOption = {
  id: string;
  title: string;
  description?: string | undefined;
  badge?: string | undefined;
  tone?: "default" | "accent" | "success" | "warning" | "danger" | undefined;
};

type WorkspaceSkillSummary = {
  id: string;
  name: string;
  description: string;
  origin: string;
};

function IconRobot() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="3" x2="12" y2="5.5" />
      <circle cx="12" cy="2.5" r="1" fill="currentColor" stroke="none" />
      <rect x="4.5" y="5.5" width="15" height="12" rx="3" />
      <circle cx="9" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
      <line x1="2.5" y1="10" x2="2.5" y2="14" />
      <line x1="21.5" y1="10" x2="21.5" y2="14" />
    </svg>
  );
}

export function buildCreateRoomInput(input: {
  title: string;
  mode: RoomMode;
  primaryAgentId: string;
  leaderRoleId?: string;
  skillIds?: string[];
  legacyAgentParticipants: LegacyAgentParticipant[];
  v1Participants: BuildV1ParticipantInput[];
}): CreateRoomInput {
  const title = input.title.trim() || "新建 Room";
  const skillIds = Array.from(new Set(input.skillIds ?? [])).filter((id) => id.length > 0);
  const selectedSkills = skillIds.length > 0 ? { skillIds } : {};
  const toV1Participant = (
    participant: BuildV1ParticipantInput,
    patch: Partial<Pick<V1RoomParticipant, "role" | "defaultPresence">> = {}
  ): V1RoomParticipant => {
    if (participant.runtimeKind === "native" && !participant.modelConfigId) {
      throw new Error("native Runtime 参与者需要指定模型配置。");
    }
    const next: V1RoomParticipant = {
      roleId: participant.roleId,
      runtimeId: participant.runtimeId
    };
    if (participant.modelConfigId) next.modelConfigId = participant.modelConfigId;
    const role = patch.role ?? participant.role;
    const defaultPresence = patch.defaultPresence ?? participant.defaultPresence;
    if (role !== undefined) next.role = role;
    if (defaultPresence !== undefined) next.defaultPresence = defaultPresence;
    return next;
  };
  if (input.mode === "solo") {
    if (input.v1Participants.length !== 1) {
      throw new Error("Solo Room 需要且仅需要一个 role 参与者。");
    }
    return {
      title,
      mode: "solo",
      primaryAgentId: input.primaryAgentId,
      participants: [toV1Participant(input.v1Participants[0]!, { role: "primary", defaultPresence: "active" })],
      ...selectedSkills
    };
  }
  if (input.mode === "assisted") {
    if (input.v1Participants.length === 0) {
      throw new Error("Assisted Room 需要一个主 role 参与者。");
    }
    return {
      title,
      mode: "assisted",
      primaryAgentId: input.primaryAgentId,
      participants: input.v1Participants.map((participant, index) => toV1Participant(participant, {
        role: index === 0 ? "primary" : "teammate",
        defaultPresence: "active"
      })),
      ...selectedSkills
    };
  }
  if (!input.leaderRoleId) {
    throw new Error("请选择 leader role。");
  }
  if (input.v1Participants.length === 0) {
    throw new Error("请至少添加一个 role 参与者。");
  }
  if (!input.v1Participants.some((participant) => participant.roleId === input.leaderRoleId)) {
    throw new Error("leader role 必须包含在参与者中。");
  }
  const participants = input.v1Participants.map((participant) => toV1Participant(participant));
  return {
    title,
    mode: input.mode,
    primaryAgentId: input.primaryAgentId,
    leaderRoleId: input.leaderRoleId,
    participants,
    ...selectedSkills
  };
}

interface NewRoomDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateRoomInput) => Promise<void> | void;
  csrfFetch?: typeof fetch | undefined;
}

function selectValue(key: unknown): string {
  if (key instanceof Set) return String(Array.from(key)[0] ?? "");
  return String(key ?? "");
}

function selectLabel(options: readonly SelectOption[], value: string, placeholder: string): string {
  return options.find((option) => option.id === value)?.title ?? placeholder;
}

function roleTone(capabilities: readonly string[]): SelectOption["tone"] {
  if (capabilities.includes("task.delegate")) return "accent";
  if (capabilities.includes("code.review")) return "warning";
  if (capabilities.includes("code.edit")) return "success";
  return "default";
}

function roleBadge(capabilities: readonly string[]): string {
  if (capabilities.includes("task.delegate")) return "delegate";
  if (capabilities.includes("code.review")) return "review";
  if (capabilities.includes("code.edit")) return "builder";
  return "role";
}

const ROLE_DISPLAY_TEXT: Record<string, { title: string; description: string }> = {
  Archivist: {
    title: "归档员",
    description: "归档上下文，并产出已确认的摘要。"
  },
  Builder: {
    title: "构建者",
    description: "通用代码构建者。"
  },
  Generalist: {
    title: "通用助手",
    description: "没有特定专长方向的通用助手。"
  },
  "Project Manager": {
    title: "项目经理",
    description: "将工作拆分为任务，并把执行路由给合适的 agents。"
  },
  Reviewer: {
    title: "评审员",
    description: "审查代码，并可通过干预反馈发起提醒。"
  }
};

function roleDisplayText(role: { name: string; description?: string | undefined }): { title: string; description?: string | undefined } {
  const mapped = ROLE_DISPLAY_TEXT[role.name];
  if (mapped) return mapped;
  return { title: role.name, description: role.description };
}

function roleOptions(roles: readonly { id: string; name: string; description?: string; capabilities: string[] }[]): SelectOption[] {
  return roles.map((role) => {
    const display = roleDisplayText(role);
    return {
      id: role.id,
      title: display.title,
      description: display.description,
      badge: roleBadge(role.capabilities),
      tone: roleTone(role.capabilities)
    };
  });
}

function runtimeOptions(runtimes: readonly { id: string; name: string; kind: string; detectedVersion?: string | null; version?: string | null }[]): SelectOption[] {
  return runtimes.map((runtime) => ({
    id: runtime.id,
    title: runtime.name,
    description: runtime.detectedVersion ?? runtime.version ?? runtime.kind,
    badge: runtime.kind,
    tone: runtime.kind === "native" ? "success" : runtime.kind === "claude-code" ? "accent" : runtime.kind === "opencode" ? "warning" : "default"
  }));
}

function modelOptions(modelConfigs: readonly { id: string; name: string; provider: string; model: string }[], placeholder: string): SelectOption[] {
  return [
    { id: "", title: placeholder, description: "当前 Runtime 不需要指定模型时可置为空。", badge: "optional", tone: "default" },
    ...modelConfigs.map((config) => ({
      id: config.id,
      title: config.name,
      description: config.model,
      badge: config.provider,
      tone: config.provider === "openai" ? "accent" as const : config.provider === "anthropic" ? "warning" as const : config.provider === "ollama" ? "success" as const : "default" as const
    }))
  ];
}

const presenceOptions: SelectOption[] = [
  { id: "active", title: "活跃", description: "进入 Room 后即可响应。", badge: "live", tone: "success" },
  { id: "observing", title: "观察中", description: "安静加入，并等待任务委派。", badge: "quiet", tone: "default" }
];

function StyledSelect({
  label,
  value,
  options,
  placeholder,
  onChange,
  testId,
  isDisabled = false,
  popoverClassName = "max-h-72"
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  testId?: string | undefined;
  isDisabled?: boolean | undefined;
  popoverClassName?: string | undefined;
}) {
  return (
    <Select
      aria-label={label}
      className="w-full"
      fullWidth
      selectedKey={value}
      isDisabled={isDisabled}
      placeholder={placeholder}
      variant="secondary"
      onSelectionChange={(key: unknown) => onChange(selectValue(key))}
    >
      <Label className="text-xs font-semibold uppercase text-muted">{label}</Label>
      <Select.Trigger className="min-h-12 items-center bg-field-background" data-testid={testId}>
        <Select.Value className="flex min-w-0 flex-1 items-center">
          <span className="truncate font-semibold leading-none">{selectLabel(options, value, placeholder)}</span>
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className={popoverClassName}>
        <ListBox aria-label={label}>
          {options.map((option) => (
            <ListBox.Item key={option.id || "__empty"} id={option.id} textValue={option.title}>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{option.title}</div>
                  {option.description ? <div className="line-clamp-2 text-xs leading-5 text-muted">{option.description}</div> : null}
                </div>
                <span className="flex min-w-[76px] justify-end">
                  {option.badge ? <Chip size="sm" variant="soft" color={option.tone ?? "default"}>{option.badge}</Chip> : null}
                </span>
                <span className="flex w-5 justify-end"><ListBox.ItemIndicator /></span>
              </div>
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function RoleSelect({
  label,
  value,
  roles,
  onChange,
  testId
}: {
  label: string;
  value: string;
  roles: readonly { id: string; name: string; description?: string; prompt?: string; capabilities: string[]; is_builtin?: boolean }[];
  onChange: (value: string) => void;
  testId?: string;
}) {
  return (
    <StyledSelect
      label={label}
      value={value}
      options={roleOptions(roles)}
      placeholder="选择角色"
      onChange={onChange}
      testId={testId}
      isDisabled={roles.length === 0}
      popoverClassName="max-h-80 w-[min(92vw,520px)]"
    />
  );
}

export function RoleBindingRow({
  title,
  roleId,
  runtimeId,
  modelConfigId,
  presence,
  roles,
  runtimes,
  modelConfigs,
  onChange,
  testIdPrefix,
  action
}: {
  title?: string;
  roleId: string;
  runtimeId: string;
  modelConfigId: string;
  presence: RoomPresence;
  roles: readonly { id: string; name: string; description?: string; prompt?: string; capabilities: string[]; is_builtin?: boolean }[];
  runtimes: readonly { id: string; name: string; kind: string; detectedVersion?: string | null; version?: string | null }[];
  modelConfigs: readonly { id: string; name: string; provider: string; model: string }[];
  onChange: (patch: Partial<V1ParticipantDraft>) => void;
  testIdPrefix: string;
  action?: ReactNode;
}) {
  const runtime = runtimes.find((candidate) => candidate.id === runtimeId);
  const needsModel = runtime?.kind === "native";
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-surface p-3">
      {title ? (
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">{title}</h4>
          {runtime ? <Chip size="sm" variant="soft" color={runtime.kind === "native" ? "success" : "default"}>{runtime.kind}</Chip> : null}
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(190px,1fr)_minmax(190px,1fr)_minmax(170px,0.8fr)_auto]">
        <RoleSelect
          label="角色"
          value={roleId}
          roles={roles}
          onChange={(value) => onChange({ roleId: value })}
          testId={`${testIdPrefix}-role`}
        />
        <StyledSelect
          label="Runtime"
          value={runtimeId}
          options={runtimeOptions(runtimes)}
          placeholder="选择 Runtime"
          onChange={(value) => onChange({ runtimeId: value })}
          testId={`${testIdPrefix}-runtime`}
          isDisabled={runtimes.length === 0}
        />
        <StyledSelect
          label="模型"
          value={modelConfigId}
          options={modelOptions(modelConfigs, needsModel ? "选择模型" : "不覆盖模型")}
          placeholder={needsModel ? "选择模型" : "不覆盖模型"}
          onChange={(value) => onChange({ modelConfigId: value })}
          testId={`${testIdPrefix}-model`}
          isDisabled={!needsModel && modelConfigs.length === 0}
        />
        <StyledSelect
          label="状态"
          value={presence}
          options={presenceOptions}
          placeholder="选择状态"
          onChange={(value) => onChange({ defaultPresence: value as RoomPresence })}
          testId={`${testIdPrefix}-presence`}
        />
        <div className="flex items-end justify-end gap-2">
          {action}
        </div>
      </div>
    </div>
  );
}

type V1ParticipantDraft = {
  id: string;
  roleId: string;
  runtimeId: string;
  modelConfigId: string;
  defaultPresence: RoomPresence;
};

function newParticipantDraft(roleId: string, runtimeId: string, modelConfigId = ""): V1ParticipantDraft {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `participant-${Date.now()}-${Math.random()}`,
    roleId,
    runtimeId,
    modelConfigId,
    defaultPresence: "active"
  };
}

function patchParticipantRuntime(
  participant: V1ParticipantDraft,
  patch: Partial<V1ParticipantDraft>,
  runtimes: readonly { id: string; kind: string }[],
  modelConfigs: readonly { id: string }[]
): V1ParticipantDraft {
  const runtimeId = patch.runtimeId ?? participant.runtimeId;
  const runtime = runtimes.find((candidate) => candidate.id === runtimeId);
  const modelConfigId = patch.modelConfigId ?? (runtime?.kind === "native" ? (participant.modelConfigId || modelConfigs[0]?.id || "") : "");
  return { ...participant, ...patch, runtimeId, modelConfigId };
}

export async function ensureAgentBindingsForParticipants(options: {
  readonly fetchImpl: typeof fetch;
  readonly existingBindings: readonly AgentBindingSummary[];
  readonly participants: readonly BuildV1ParticipantInput[];
}): Promise<{ readonly bindingIds: string[]; readonly ensuredBindings: AgentBindingSummary[]; readonly createdBindings: AgentBindingSummary[] }> {
  const known = new Map<string, AgentBindingSummary>();
  for (const binding of options.existingBindings) {
    known.set(agentBindingKey(binding.roleId, binding.runtimeId, binding.modelConfigId), binding);
  }

  const bindingIds: string[] = [];
  const ensuredBindings: AgentBindingSummary[] = [];
  const createdBindings: AgentBindingSummary[] = [];
  for (const participant of options.participants) {
    const modelConfigId = normalizedModelConfigId(participant.modelConfigId);
    const key = agentBindingKey(participant.roleId, participant.runtimeId, modelConfigId);
    const existing = known.get(key);
    if (existing) {
      bindingIds.push(existing.id);
      ensuredBindings.push(existing);
      continue;
    }

    const body: { roleId: string; runtimeId: string; modelConfigId?: string } = {
      roleId: participant.roleId,
      runtimeId: participant.runtimeId
    };
    if (modelConfigId !== null) body.modelConfigId = modelConfigId;
    const response = await options.fetchImpl("/agent-bindings", {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`为 ${participant.roleId}/${participant.runtimeId} 创建 agent 绑定失败：${errorMessage(payload, response.status)}`);
    }
    const created = normalizeCreatedAgentBinding(payload, participant);
    known.set(key, created);
    bindingIds.push(created.id);
    ensuredBindings.push(created);
    createdBindings.push(created);
  }
  return { bindingIds, ensuredBindings, createdBindings };
}

function agentBindingKey(roleId: string, runtimeId: string, modelConfigId: string | null | undefined): string {
  return `${roleId}\u0000${runtimeId}\u0000${modelConfigId ?? ""}`;
}

function normalizedModelConfigId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return undefined;
  }
}

function normalizeCreatedAgentBinding(payload: unknown, participant: BuildV1ParticipantInput): AgentBindingSummary {
  const record = payload && typeof payload === "object" && "agentBinding" in payload
    ? (payload as { readonly agentBinding?: unknown }).agentBinding
    : payload;
  if (!record || typeof record !== "object") {
    throw new Error("创建 agent 绑定返回了无效响应。");
  }
  const row = record as Record<string, unknown>;
  const id = stringValue(row.id);
  if (!id) throw new Error("创建 agent 绑定未返回 id。");
  return {
    id,
    roleId: stringValue(row.roleId ?? row.role_id) ?? participant.roleId,
    runtimeId: stringValue(row.runtimeId ?? row.runtime_id) ?? participant.runtimeId,
    modelConfigId: normalizedModelConfigId(stringValue(row.modelConfigId ?? row.model_config_id) ?? participant.modelConfigId)
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = stringValue(record.message);
    const error = stringValue(record.error);
    if (message && error) return `${error}: ${message}`;
    if (message) return message;
    if (error) return error;
  }
  return `HTTP ${status}`;
}

function normalizeWorkspaceSkills(payload: unknown): WorkspaceSkillSummary[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { readonly skills?: unknown }).skills)
      ? (payload as { readonly skills: unknown[] }).skills
      : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = stringValue(record.id);
    const name = stringValue(record.name);
    if (!id || !name) return [];
    return [{
      id,
      name,
      description: typeof record.description === "string" ? record.description : "",
      origin: typeof record.origin === "string" ? record.origin : "workspace"
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function skillOriginColor(origin: string): "default" | "accent" | "success" | "warning" | "danger" {
  if (origin === "builtin") return "accent";
  if (origin === "workspace") return "success";
  if (origin === "imported") return "warning";
  return "default";
}

const SKILL_DESCRIPTION_TEXT: Record<string, string> = {
  "skill-creator": "帮助用户按标准 SKILL.md 格式创建新的 skills。",
  "task-planner": "帮助 agents 将复杂工作拆解为边界清晰、依赖明确、可分配的任务。"
};

function skillDescription(skill: WorkspaceSkillSummary): string {
  return SKILL_DESCRIPTION_TEXT[skill.name] ?? skill.description;
}

export function NewRoomDialog({ isOpen, onOpenChange, onCreate, csrfFetch = fetch }: NewRoomDialogProps) {
  const {
    roles,
    runtimes,
    modelConfigs,
    agentBindings,
    loading: optionsLoading,
    error: optionsError
  } = useRoomCreationOptions();
  const [createdAgentBindings, setCreatedAgentBindings] = useState<AgentBindingSummary[]>([]);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<RoomMode>("assisted");
  const [leaderRoleId, setLeaderRoleId] = useState<string>("");
  const [leaderBinding, setLeaderBinding] = useState<V1ParticipantDraft | undefined>(undefined);
  const [v1Participants, setV1Participants] = useState<V1ParticipantDraft[]>([]);
  const [skills, setSkills] = useState<WorkspaceSkillSummary[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (isOpen) {
      setTitle(`Room ${new Date().toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "2-digit" })}`);
      setError(undefined);
      setMode("assisted");
      setLeaderRoleId("");
      setLeaderBinding(undefined);
      setV1Participants([]);
      setCreatedAgentBindings([]);
      setSelectedSkillIds(new Set());
      setSkillsError(undefined);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const controller = new AbortController();
    setSkillsLoading(true);
    setSkillsError(undefined);
    void csrfFetch("/skills", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`加载 skills 失败：${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!cancelled) setSkills(normalizeWorkspaceSkills(payload));
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          setSkillsError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [csrfFetch, isOpen]);

  useEffect(() => {
    if (leaderRoleId || roles.length === 0) return;
    const leader = roles.find((role) => role.capabilities.includes("task.delegate")) ?? roles[0];
    setLeaderRoleId(leader?.id ?? "");
  }, [leaderRoleId, roles]);

  useEffect(() => {
    if (leaderBinding || roles.length === 0 || runtimes.length === 0) return;
    const role = roles.find((candidate) => candidate.id === leaderRoleId) ?? roles.find((candidate) => candidate.capabilities.includes("task.delegate")) ?? roles[0];
    const runtime = runtimes.find((candidate) => candidate.kind === "native") ?? runtimes[0];
    const modelConfigId = runtime?.kind === "native" ? modelConfigs[0]?.id ?? "" : "";
    const next = newParticipantDraft(role?.id ?? "", runtime?.id ?? "", modelConfigId);
    setLeaderBinding(next);
    setLeaderRoleId(next.roleId);
  }, [leaderBinding, leaderRoleId, modelConfigs, roles, runtimes]);

  const selectedLeader = roles.find((role) => role.id === (leaderBinding?.roleId ?? leaderRoleId));
  const teamMode = mode === "squad" || mode === "team";

  const updateV1Participant = (id: string, patch: Partial<V1ParticipantDraft>) => {
    setV1Participants((current) => current.map((participant) => {
      if (participant.id !== id) return participant;
      return patchParticipantRuntime(participant, patch, runtimes, modelConfigs);
    }));
  };

  const setSkillSelected = (id: string, selected: boolean) => {
    setSelectedSkillIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id); else next.delete(id);
      return next;
    });
  };

  const updateLeaderBinding = (patch: Partial<V1ParticipantDraft>) => {
    let nextRoleId: string | undefined;
    setLeaderBinding((current) => {
      const fallbackRole = roles.find((candidate) => candidate.id === leaderRoleId) ?? roles[0];
      const fallbackRuntime = runtimes.find((candidate) => candidate.kind === "native") ?? runtimes[0];
      const base = current ?? newParticipantDraft(fallbackRole?.id ?? "", fallbackRuntime?.id ?? "", fallbackRuntime?.kind === "native" ? modelConfigs[0]?.id ?? "" : "");
      const next = patchParticipantRuntime(base, patch, runtimes, modelConfigs);
      nextRoleId = next.roleId;
      return next;
    });
    if (nextRoleId) setLeaderRoleId(nextRoleId);
  };

  const addV1Participant = () => {
    const currentLeaderRoleId = leaderBinding?.roleId ?? leaderRoleId;
    const role = roles.find((candidate) => candidate.id !== currentLeaderRoleId && candidate.capabilities.includes("code.review"))
      ?? roles.find((candidate) => candidate.id !== currentLeaderRoleId)
      ?? roles[0];
    const runtime = runtimes.find((candidate) => candidate.kind === "native") ?? runtimes[0];
    const modelConfigId = runtime?.kind === "native" ? modelConfigs[0]?.id ?? "" : "";
    setV1Participants((current) => [
      ...current,
      newParticipantDraft(role?.id ?? "", runtime?.id ?? "", modelConfigId)
    ]);
  };

  const removeV1Participant = (id: string) => {
    setV1Participants((current) => current.filter((participant) => participant.id !== id));
  };

  const handleSubmit = async () => {
    if (!leaderBinding) {
      setError("请选择主 role 绑定。");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const allV1Participants = leaderBinding
        ? mode === "solo" ? [leaderBinding] : [leaderBinding, ...v1Participants]
        : v1Participants;
      const v1ParticipantInput = allV1Participants.map((participant) => {
        const runtime = runtimes.find((candidate) => candidate.id === participant.runtimeId);
        const next: BuildV1ParticipantInput = {
          roleId: participant.roleId,
          runtimeId: participant.runtimeId,
          runtimeKind: runtime?.kind ?? "",
          defaultPresence: participant.defaultPresence
        };
        if (participant.modelConfigId) next.modelConfigId = participant.modelConfigId;
        return next;
      });
      const currentLeaderRoleId = leaderBinding?.roleId ?? leaderRoleId;
      const leaderParticipant = leaderBinding ?? allV1Participants.find((participant) => participant.roleId === currentLeaderRoleId);
      const ensured = await ensureAgentBindingsForParticipants({
        fetchImpl: csrfFetch,
        existingBindings: [...agentBindings, ...createdAgentBindings],
        participants: v1ParticipantInput
      });
      if (ensured.createdBindings.length > 0) {
        setCreatedAgentBindings((current) => mergeAgentBindings(current, ensured.createdBindings));
      }
      let primaryAgentId = ensured.bindingIds[0] ?? "";
      if (leaderParticipant) {
        const leaderIndex = v1ParticipantInput.findIndex((participant) =>
          participant.roleId === currentLeaderRoleId
          && participant.runtimeId === leaderParticipant.runtimeId
          && normalizedModelConfigId(participant.modelConfigId) === normalizedModelConfigId(leaderParticipant.modelConfigId)
        );
        primaryAgentId = ensured.bindingIds[leaderIndex >= 0 ? leaderIndex : 0] ?? primaryAgentId;
      }
      const createInput = {
        title,
        mode,
        primaryAgentId,
        skillIds: Array.from(selectedSkillIds),
        legacyAgentParticipants: [],
        v1Participants: v1ParticipantInput
      };
      await onCreate(buildCreateRoomInput(currentLeaderRoleId ? { ...createInput, leaderRoleId: currentLeaderRoleId } : createInput));
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="full" className="items-center justify-center p-4">
        <Modal.Dialog className="flex h-[min(94vh,920px)] w-[min(96vw,1180px)] max-w-[1180px] overflow-hidden p-0">
          <Modal.CloseTrigger />
          <Modal.Header className="border-b border-border bg-[linear-gradient(135deg,var(--surface),var(--surface-secondary))] px-6 py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-[0_14px_30px_color-mix(in_oklab,var(--accent)_24%,transparent)]">
                <IconRobot />
              </div>
              <div className="min-w-0">
                <Modal.Heading>新建 Room</Modal.Heading>
                <p className="mt-1 max-w-xl text-sm text-muted">
                  配置一个本地 agent 工作区，包含一个主 agent，并可按需添加协作者。
                </p>
              </div>
            </div>
          </Modal.Header>

          <Modal.Body className="min-h-0 flex-1 gap-0 overflow-hidden p-0">
            <ScrollShadow className="h-full min-h-0 overflow-auto pb-8" orientation="vertical">
              <div className="grid gap-4 p-5 pb-8">
                <section className="rounded-2xl border border-border bg-overlay p-4 shadow-sm">
                  <div className="grid gap-4">
                    <TextField value={title} onChange={setTitle}>
                      <Label className="text-sm font-semibold">标题</Label>
                      <Input placeholder="例如：重构认证流程" />
                    </TextField>

                    <div className="grid gap-2">
                      <h3 className="text-sm font-semibold">模式</h3>
                      <RadioGroup
                        className="gap-0"
                        value={mode}
                        onChange={(v: unknown) => setMode(v as RoomMode)}
                        aria-label="Room 模式"
                      >
                        <div className="-mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                          {ROOM_MODE_OPTIONS.map((option) => (
                            <RoomModeOption
                              key={option.value}
                              value={option.value}
                              title={option.title}
                              description={option.description}
                            />
                          ))}
                        </div>
                      </RadioGroup>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-overlay p-4 shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">{teamMode ? "角色团队" : "主角色"}</h3>
                      <p className="text-xs text-muted">
                        {teamMode
                          ? "为 leader 绑定角色、Runtime 和模型，并按需添加队友。"
                          : "为此 Room 的主 agent 选择角色、Runtime 和模型。"}
                      </p>
                    </div>
                    <Chip size="sm" variant="soft" color={selectedLeader ? "accent" : "default"}>
                      {selectedLeader ? roleDisplayText(selectedLeader).title : "未选择主角色"}
                    </Chip>
                  </div>

                  {optionsError ? <p className="mb-2 text-xs text-danger">{optionsError}</p> : null}
                  {optionsLoading ? <p className="mb-2 text-xs text-muted">正在加载角色、Runtime 和模型...</p> : null}

                  {leaderBinding ? (
                    <RoleBindingRow
                      title={teamMode ? "Leader 绑定" : "主绑定"}
                      roleId={leaderBinding.roleId}
                      runtimeId={leaderBinding.runtimeId}
                      modelConfigId={leaderBinding.modelConfigId}
                      presence={leaderBinding.defaultPresence}
                      roles={roles}
                      runtimes={runtimes}
                      modelConfigs={modelConfigs}
                      onChange={updateLeaderBinding}
                      testIdPrefix="new-room-leader"
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-sm text-muted">
                      正在加载 role 绑定选项...
                    </div>
                  )}

                  {mode !== "solo" ? (
                    <div className="mt-4 grid gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold">{teamMode ? "队友" : "协作者"}</h4>
                        <Button size="sm" variant="secondary" onPress={addV1Participant} isDisabled={roles.length === 0 || runtimes.length === 0}>
                          {teamMode ? "添加队友" : "添加协作者"}
                        </Button>
                      </div>

                      {v1Participants.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-sm text-muted">
                          {teamMode
                            ? "在此添加队友角色。上方的 leader 绑定始终会包含在内。"
                            : "在此添加协作者角色。上方的主绑定始终会包含在内。"}
                        </div>
                      ) : v1Participants.map((participant, index) => {
                        return (
                          <RoleBindingRow
                            key={participant.id}
                            roleId={participant.roleId}
                            runtimeId={participant.runtimeId}
                            modelConfigId={participant.modelConfigId}
                            presence={participant.defaultPresence}
                            roles={roles}
                            runtimes={runtimes}
                            modelConfigs={modelConfigs}
                            onChange={(patch) => updateV1Participant(participant.id, patch)}
                            testIdPrefix={`new-room-participant-${index}`}
                            action={
                              <Button size="sm" variant="tertiary" onPress={() => removeV1Participant(participant.id)} isDisabled={v1Participants.length === 1}>
                                移除
                              </Button>
                            }
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </section>

                <section className="rounded-2xl border border-border bg-overlay p-4 shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Skills</h3>
                      <p className="text-xs text-muted">选中的 SKILL.md 包会在下一次运行时对该 Room 可用。</p>
                    </div>
                    <Chip size="sm" variant="soft" color={selectedSkillIds.size > 0 ? "accent" : "default"}>
                      已选择 {selectedSkillIds.size} 个
                    </Chip>
                  </div>

                  {skillsError ? <p className="mb-2 text-xs text-danger">{skillsError}</p> : null}
                  {skillsLoading ? <p className="mb-2 text-xs text-muted">正在加载 skills...</p> : null}

                  {skills.length === 0 && !skillsLoading ? (
                    <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-sm text-muted">
                      未找到工作区 skills。可在设置中创建或导入 skills。
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {skills.map((skill) => {
                        const selected = selectedSkillIds.has(skill.id);
                        return (
                          <Checkbox
                            key={skill.id}
                            isSelected={selected}
                            onChange={(selected) => setSkillSelected(skill.id, selected)}
                            className={[
                              "rounded-2xl border bg-surface px-3 py-2 transition-colors",
                              selected ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-secondary"
                            ].join(" ")}
                          >
                            <span className="flex min-w-0 items-center gap-2 text-sm">
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{skill.name}</span>
                                <span className="block truncate text-xs text-muted">{skillDescription(skill) || "无描述"}</span>
                              </span>
                              <Chip size="sm" variant="soft" color={skillOriginColor(skill.origin)}>{skill.origin}</Chip>
                            </span>
                          </Checkbox>
                        );
                      })}
                    </div>
                  )}
                </section>

                {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
              </div>
            </ScrollShadow>
          </Modal.Body>

          <Modal.Footer className="border-t border-border bg-surface/90 px-5 py-4">
            <div className="mr-auto hidden text-xs text-muted sm:block">
              {mode === "solo"
                ? "主Agent将加入此Room。"
                : teamMode
                  ? `leader和${v1Participants.length}名队友将加入此Room。`
                  : `主Agent和${v1Participants.length}名协作者将加入此Room。`}
            </div>
            <Button slot="close" variant="tertiary">取消</Button>
            <Button
              variant="primary"
              isPending={submitting}
              isDisabled={submitting || !leaderBinding}
              onPress={() => void handleSubmit()}
            >
              创建 Room
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function mergeAgentBindings(current: readonly AgentBindingSummary[], next: readonly AgentBindingSummary[]): AgentBindingSummary[] {
  const bindings = new Map<string, AgentBindingSummary>();
  for (const binding of current) bindings.set(agentBindingKey(binding.roleId, binding.runtimeId, binding.modelConfigId), binding);
  for (const binding of next) bindings.set(agentBindingKey(binding.roleId, binding.runtimeId, binding.modelConfigId), binding);
  return Array.from(bindings.values());
}

function RoomModeOption({ value, title, description }: { value: RoomMode; title: string; description: string }) {
  return (
    <Radio value={value} className="rounded-xl border border-border bg-surface px-4 py-3 hover:bg-surface-secondary">
      <Radio.Control><Radio.Indicator /></Radio.Control>
      <Radio.Content className="grid gap-1">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs leading-5 text-muted">{description}</span>
      </Radio.Content>
    </Radio>
  );
}
