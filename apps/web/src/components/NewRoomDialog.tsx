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
  { value: "solo", title: "Solo", description: "One primary agent only." },
  { value: "assisted", title: "Assisted", description: "Primary agent plus optional collaborators." },
  { value: "squad", title: "Squad", description: "Leader role coordinates a focused group." },
  { value: "team", title: "Team", description: "Leader role routes work across active teammates." }
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

export function buildCreateRoomInput(input: {
  title: string;
  mode: RoomMode;
  primaryAgentId: string;
  leaderRoleId?: string;
  skillIds?: string[];
  legacyAgentParticipants: LegacyAgentParticipant[];
  v1Participants: BuildV1ParticipantInput[];
}): CreateRoomInput {
  const title = input.title.trim() || "New room";
  const skillIds = Array.from(new Set(input.skillIds ?? [])).filter((id) => id.length > 0);
  const selectedSkills = skillIds.length > 0 ? { skillIds } : {};
  const toV1Participant = (
    participant: BuildV1ParticipantInput,
    patch: Partial<Pick<V1RoomParticipant, "role" | "defaultPresence">> = {}
  ): V1RoomParticipant => {
    if (participant.runtimeKind === "native" && !participant.modelConfigId) {
      throw new Error("Native runtime participants require a model config.");
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
      throw new Error("Solo rooms require exactly one role participant.");
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
      throw new Error("Assisted rooms require a primary role participant.");
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
    throw new Error("Pick a leader role.");
  }
  if (input.v1Participants.length === 0) {
    throw new Error("Add at least one role participant.");
  }
  if (!input.v1Participants.some((participant) => participant.roleId === input.leaderRoleId)) {
    throw new Error("Leader role must be included as a participant.");
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

function roleOptions(roles: readonly { id: string; name: string; description?: string; capabilities: string[] }[]): SelectOption[] {
  return roles.map((role) => ({
    id: role.id,
    title: role.name,
    description: role.description,
    badge: roleBadge(role.capabilities),
    tone: roleTone(role.capabilities)
  }));
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
    { id: "", title: placeholder, description: "Leave unset when this runtime does not require a model.", badge: "optional", tone: "default" },
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
  { id: "active", title: "Active", description: "Starts ready to respond.", badge: "live", tone: "success" },
  { id: "observing", title: "Observing", description: "Joins quietly and waits for delegation.", badge: "quiet", tone: "default" }
];

function StyledSelect({
  label,
  value,
  options,
  placeholder,
  onChange,
  testId,
  isDisabled = false
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  testId?: string | undefined;
  isDisabled?: boolean | undefined;
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
      <Select.Trigger className="min-h-12 bg-field-background" data-testid={testId}>
        <Select.Value>
          <span className="truncate font-semibold">{selectLabel(options, value, placeholder)}</span>
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="max-h-72">
        <ListBox aria-label={label}>
          {options.map((option) => (
            <ListBox.Item key={option.id || "__empty"} id={option.id} textValue={option.title}>
              <div className="flex min-w-0 items-center gap-2 py-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{option.title}</div>
                  {option.description ? <div className="truncate text-xs text-muted">{option.description}</div> : null}
                </div>
                {option.badge ? <Chip size="sm" variant="soft" color={option.tone ?? "default"}>{option.badge}</Chip> : null}
                <ListBox.ItemIndicator />
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
      placeholder="Choose role"
      onChange={onChange}
      testId={testId}
      isDisabled={roles.length === 0}
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
          label="Role"
          value={roleId}
          roles={roles}
          onChange={(value) => onChange({ roleId: value })}
          testId={`${testIdPrefix}-role`}
        />
        <StyledSelect
          label="Runtime"
          value={runtimeId}
          options={runtimeOptions(runtimes)}
          placeholder="Choose runtime"
          onChange={(value) => onChange({ runtimeId: value })}
          testId={`${testIdPrefix}-runtime`}
          isDisabled={runtimes.length === 0}
        />
        <StyledSelect
          label="Model"
          value={modelConfigId}
          options={modelOptions(modelConfigs, needsModel ? "Choose model" : "No model override")}
          placeholder={needsModel ? "Choose model" : "No model override"}
          onChange={(value) => onChange({ modelConfigId: value })}
          testId={`${testIdPrefix}-model`}
          isDisabled={!needsModel && modelConfigs.length === 0}
        />
        <StyledSelect
          label="Presence"
          value={presence}
          options={presenceOptions}
          placeholder="Choose presence"
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
      throw new Error(`Create agent binding failed for ${participant.roleId}/${participant.runtimeId}: ${errorMessage(payload, response.status)}`);
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
    throw new Error("Create agent binding returned an invalid response.");
  }
  const row = record as Record<string, unknown>;
  const id = stringValue(row.id);
  if (!id) throw new Error("Create agent binding returned no id.");
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
        if (!response.ok) throw new Error(`Load skills failed: ${response.status}`);
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
      setError("Pick a primary role binding.");
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
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-sm font-black text-accent-foreground shadow-[0_14px_30px_color-mix(in_oklab,var(--accent)_24%,transparent)]">
                AH
              </div>
              <div className="min-w-0">
                <Modal.Heading>New room</Modal.Heading>
                <p className="mt-1 max-w-xl text-sm text-muted">
                  Set up a local agent workspace with one primary agent and optional collaborators.
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
                      <Label className="text-sm font-semibold">Title</Label>
                      <Input placeholder="e.g. Refactor auth flow" />
                    </TextField>

                    <div>
                      <h3 className="mb-2 text-sm font-semibold">Mode</h3>
                      <RadioGroup
                        value={mode}
                        onChange={(v: unknown) => setMode(v as RoomMode)}
                        aria-label="Room mode"
                      >
                        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
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
                      <h3 className="text-sm font-semibold">{teamMode ? "Role team" : "Primary role"}</h3>
                      <p className="text-xs text-muted">
                        {teamMode
                          ? "Bind the leader to a role, runtime, and model, then add teammates when needed."
                          : "Choose the role, runtime, and model for the primary agent in this room."}
                      </p>
                    </div>
                    <Chip size="sm" variant="soft" color={selectedLeader ? "accent" : "default"}>
                      {selectedLeader?.name ?? "No primary"}
                    </Chip>
                  </div>

                  {optionsError ? <p className="mb-2 text-xs text-danger">{optionsError}</p> : null}
                  {optionsLoading ? <p className="mb-2 text-xs text-muted">Loading roles, runtimes, and models...</p> : null}

                  {leaderBinding ? (
                    <RoleBindingRow
                      title={teamMode ? "Leader binding" : "Primary binding"}
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
                      Loading role binding options...
                    </div>
                  )}

                  {mode !== "solo" ? (
                    <div className="mt-4 grid gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold">{teamMode ? "Teammates" : "Collaborators"}</h4>
                        <Button size="sm" variant="secondary" onPress={addV1Participant} isDisabled={roles.length === 0 || runtimes.length === 0}>
                          {teamMode ? "Add teammate" : "Add collaborator"}
                        </Button>
                      </div>

                      {v1Participants.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-sm text-muted">
                          {teamMode
                            ? "Add teammate roles here. The leader binding above is always included."
                            : "Add collaborator roles here. The primary binding above is always included."}
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
                                Remove
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
                      <p className="text-xs text-muted">Selected SKILL.md packages are available to this room on the next run.</p>
                    </div>
                    <Chip size="sm" variant="soft" color={selectedSkillIds.size > 0 ? "accent" : "default"}>
                      {selectedSkillIds.size} selected
                    </Chip>
                  </div>

                  {skillsError ? <p className="mb-2 text-xs text-danger">{skillsError}</p> : null}
                  {skillsLoading ? <p className="mb-2 text-xs text-muted">Loading skills...</p> : null}

                  {skills.length === 0 && !skillsLoading ? (
                    <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-sm text-muted">
                      No workspace skills found. Create or import skills from Settings.
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
                                <span className="block truncate text-xs text-muted">{skill.description || "No description"}</span>
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
                ? "Solo rooms start with the primary agent only."
                : teamMode
                  ? `Leader plus ${v1Participants.length} teammate${v1Participants.length === 1 ? "" : "s"} will join this room.`
                  : `Primary plus ${v1Participants.length} collaborator${v1Participants.length === 1 ? "" : "s"} will join this room.`}
            </div>
            <Button slot="close" variant="tertiary">Cancel</Button>
            <Button
              variant="primary"
              isPending={submitting}
              isDisabled={submitting || !leaderBinding}
              onPress={() => void handleSubmit()}
            >
              Create room
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
    <Radio value={value} className="rounded-xl border border-border bg-surface px-3 py-2 hover:bg-surface-secondary">
      <Radio.Control><Radio.Indicator /></Radio.Control>
      <Radio.Content>
        <span className="text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{description}</span>
      </Radio.Content>
    </Radio>
  );
}
