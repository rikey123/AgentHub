import { useEffect, useState, type ReactNode } from "react";
import {
  Avatar,
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
import type { AgentContactViewModel } from "../types.ts";
import { normalizeAgentContacts } from "./rail/RailViews.tsx";
import { initials } from "../lib/format.ts";
import { roleDisplayText } from "../lib/roles.ts";
import { skillDisplayDescription, skillDisplayName, skillOriginColor, skillOriginLabel } from "../lib/skills.ts";

export type RoomMode = "solo" | "assisted" | "squad" | "team";
export type RoomParticipantRole = "observer" | "reviewer" | "specialist";
export type V1RoomParticipantRole = RoomParticipantRole | "primary" | "teammate";
export type RoomPresence = "observing" | "active";
export type LegacyAgentParticipant = {
  type: "agent";
  agentId: string;
  agentBindingId?: string;
  role: V1RoomParticipantRole;
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
  agentBindingId?: string;
  leaderRoleId?: string;
  skillIds?: string[];
  participants: Array<LegacyAgentParticipant | V1RoomParticipant>;
  participantSkillAssignments?: ParticipantSkillAssignment[];
};

export type ParticipantSkillAssignment = {
  participantId: string;
  skillIds: string[];
  mode?: "add" | "restrict";
};

export type ContactFirstParticipantConfig = {
  agentBindingId: string;
  roleId?: string;
  runtimeId?: string;
  runtimeKind?: string;
  modelConfigId?: string;
  defaultPresence?: RoomPresence;
  skillIds?: readonly string[];
};

export const ROOM_MODE_OPTIONS: ReadonlyArray<{ value: RoomMode; title: string; description: string }> = [
  { value: "solo", title: "单人", description: "仅包含一个主智能体。" },
  { value: "assisted", title: "协作", description: "主智能体可搭配可选协作者。" },
  { value: "squad", title: "小队", description: "由负责人角色协调一个聚焦小组。" },
  { value: "team", title: "团队", description: "由负责人角色在活跃队友之间分派工作。" }
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
  const title = input.title.trim() || "新建房间";
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

export function defaultRoomModeForSelectedContacts(selectedCount: number, currentMode: RoomMode): RoomMode {
  if (selectedCount === 1) return "solo";
  if (selectedCount > 1 && (currentMode === "team" || currentMode === "squad")) return currentMode;
  if (selectedCount > 1) return "assisted";
  return currentMode;
}

export function buildContactFirstCreateRoomInput(input: {
  readonly title: string;
  readonly mode: RoomMode;
  readonly contacts: readonly AgentContactViewModel[];
  readonly skillIds?: readonly string[];
  readonly participantConfigs?: readonly ContactFirstParticipantConfig[];
  readonly resolvedBindingIds?: Readonly<Record<string, string>>;
}): CreateRoomInput {
  const contactsById = new Map<string, AgentContactViewModel>();
  for (const contact of input.contacts) contactsById.set(contact.agentBindingId, contact);
  const contacts = Array.from(contactsById.values());
  const primary = contacts[0];
  if (primary === undefined) throw new Error("Pick at least one contact.");
  const configById = new Map<string, ContactFirstParticipantConfig>();
  for (const config of input.participantConfigs ?? []) configById.set(config.agentBindingId, config);
  const mode = defaultRoomModeForSelectedContacts(contacts.length, input.mode);
  const skillIds = Array.from(new Set(input.skillIds ?? [])).filter((id) => id.length > 0);
  const primaryConfig = configById.get(primary.agentBindingId);
  const primaryBindingId = input.resolvedBindingIds?.[primary.agentBindingId] ?? primary.agentBindingId;
  const leaderRoleId = mode === "team" || mode === "squad" ? primaryConfig?.roleId ?? primary.roleId : undefined;
  const participantRecords = contacts.flatMap((contact, index): LegacyAgentParticipant[] => {
    const config = configById.get(contact.agentBindingId);
    const participantId = input.resolvedBindingIds?.[contact.agentBindingId] ?? contact.agentBindingId;
    const defaultPresence = config?.defaultPresence ?? "active";
    const configSkillIds = uniqueStrings(config?.skillIds ?? []);
    const needsExplicitPrimary = index === 0 && (defaultPresence !== "active" || configSkillIds.length > 0 || participantId !== contact.agentBindingId);
    if (mode === "solo" && !needsExplicitPrimary) return [];
    if (index === 0 && !needsExplicitPrimary) return [];
    return [{
      type: "agent",
      agentId: participantId,
      agentBindingId: participantId,
      role: index === 0 ? "primary" : "teammate",
      defaultPresence
    }];
  });
  const participantSkillAssignments = contacts.flatMap((contact): ParticipantSkillAssignment[] => {
    const config = configById.get(contact.agentBindingId);
    const configSkillIds = uniqueStrings(config?.skillIds ?? []);
    if (configSkillIds.length === 0) return [];
    return [{
      participantId: input.resolvedBindingIds?.[contact.agentBindingId] ?? contact.agentBindingId,
      skillIds: configSkillIds,
      mode: "add"
    }];
  });
  return {
    title: input.title.trim() || `Chat with ${primary.displayName}`,
    mode,
    primaryAgentId: primaryBindingId,
    agentBindingId: primaryBindingId,
    ...(leaderRoleId !== undefined ? { leaderRoleId } : {}),
    ...(skillIds.length > 0 ? { skillIds } : {}),
    participants: participantRecords,
    ...(participantSkillAssignments.length > 0 ? { participantSkillAssignments } : {})
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).filter((id) => id.length > 0);
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
    { id: "", title: placeholder, description: "当前运行时不需要指定模型时可置为空。", badge: "可选", tone: "default" },
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
  { id: "active", title: "活跃", description: "进入房间后即可响应。", badge: "可响应", tone: "success" },
  { id: "observing", title: "观察中", description: "安静加入，并等待任务委派。", badge: "安静加入", tone: "default" }
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

export function ContactFirstPicker({
  contacts,
  selectedIds,
  loading,
  error,
  onToggle,
  onSelectionChange
}: {
  readonly contacts: readonly AgentContactViewModel[];
  readonly selectedIds: ReadonlySet<string>;
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly onToggle: (agentBindingId: string) => void;
  readonly onSelectionChange?: ((agentBindingIds: Set<string>) => void) | undefined;
}) {
  const sorted = [...contacts].sort((a, b) => contactStatusRank(a.status) - contactStatusRank(b.status) || a.displayName.localeCompare(b.displayName));
  const handleSelectionChange = (keys: unknown) => {
    if (keys === "all") return;
    const next = new Set(Array.from(keys as Iterable<unknown>, String));
    if (onSelectionChange) {
      onSelectionChange(next);
      return;
    }
    const added = Array.from(next).find((id) => !selectedIds.has(id));
    const removed = Array.from(selectedIds).find((id) => !next.has(id));
    const changed = added ?? removed;
    if (changed) onToggle(changed);
  };
  return (
    <section className="ah-new-room-panel ah-new-room-contacts">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">联系人</h3>
          <p className="text-xs text-muted">选择要加入房间的 Agent 联系人。</p>
        </div>
        <Chip size="sm" variant="soft" color={selectedIds.size > 0 ? "accent" : "default"}>
          已选择 {selectedIds.size} 个
        </Chip>
      </div>
      {error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}
      {loading ? <p className="mb-2 text-xs text-muted">正在加载联系人...</p> : null}
      {sorted.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-sm text-muted">
          暂无可用联系人。可在右侧高级配置中使用角色和运行时创建房间。
        </div>
      ) : (
        <ListBox
          aria-label="联系人"
          selectionMode="multiple"
          selectedKeys={selectedIds}
          className="ah-contact-list"
          onSelectionChange={handleSelectionChange}
          {...(onSelectionChange ? {} : { onAction: (key: unknown) => onToggle(String(key)) })}
        >
          {sorted.map((contact) => {
            const selected = selectedIds.has(contact.agentBindingId);
            const subtitle = [
              contact.roleName ?? contact.roleId,
              contact.runtimeName ?? contact.runtimeKind,
              contact.modelName
            ].filter(Boolean).join(" / ");
            return (
              <ListBox.Item
                key={contact.agentBindingId}
                id={contact.agentBindingId}
                textValue={contact.displayName}
                className="ah-contact-list-item"
              >
                <Avatar className="ah-contact-avatar" size="sm">
                  {contact.avatarUrl ? <Avatar.Image alt={contact.displayName} src={contact.avatarUrl} /> : null}
                  <Avatar.Fallback>{initials(contact.displayName)}</Avatar.Fallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{contact.displayName}</span>
                    <span className={`ah-contact-presence is-${contact.status}`} aria-hidden="true" />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">{subtitle}</span>
                  {contact.capabilities.length > 0 ? (
                    <span className="mt-1.5 flex min-w-0 gap-1.5 overflow-hidden">
                      {contact.capabilities.slice(0, 3).map((capability) => (
                        <Chip key={capability} size="sm" variant="soft" color="default">{capability}</Chip>
                      ))}
                      {contact.capabilities.length > 3 ? (
                        <span className="text-xs text-muted">+{contact.capabilities.length - 3}</span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Chip size="sm" variant="soft" color={contactStatusColor(contact.status)}>
                    {contactStatusLabel(contact.status)}
                  </Chip>
                  <span className={selected ? "ah-contact-check is-selected" : "ah-contact-check"}>
                    {selected ? "✓" : ""}
                  </span>
                </span>
              </ListBox.Item>
            );
          })}
        </ListBox>
      )}
    </section>
  );
}

function contactStatusColor(status: AgentContactViewModel["status"]): "success" | "warning" | "default" {
  if (status === "available") return "success";
  if (status === "busy") return "warning";
  return "default";
}

function contactStatusLabel(status: AgentContactViewModel["status"]): string {
  if (status === "available") return "在线";
  if (status === "busy") return "忙碌";
  return "离线";
}

function contactStatusRank(status: AgentContactViewModel["status"]): number {
  if (status === "available") return 0;
  if (status === "busy") return 1;
  return 2;
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
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <RoleSelect
          label="角色"
          value={roleId}
          roles={roles}
          onChange={(value) => onChange({ roleId: value })}
          testId={`${testIdPrefix}-role`}
        />
        <StyledSelect
          label="运行时"
          value={runtimeId}
          options={runtimeOptions(runtimes)}
          placeholder="选择运行时"
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

type ContactParticipantDraft = V1ParticipantDraft & {
  agentBindingId: string;
  skillIds: string[];
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

function newContactParticipantDraft(
  contact: AgentContactViewModel,
  runtimes: readonly { id: string; kind: string }[],
  modelConfigs: readonly { id: string }[]
): ContactParticipantDraft {
  const runtime = runtimes.find((candidate) => candidate.id === contact.runtimeId)
    ?? runtimes.find((candidate) => candidate.kind === contact.runtimeKind)
    ?? runtimes[0];
  const runtimeId = runtime?.id ?? contact.runtimeId ?? "";
  const modelConfigId = contact.modelConfigId ?? (runtime?.kind === "native" ? modelConfigs[0]?.id ?? "" : "");
  return {
    ...newParticipantDraft(contact.roleId, runtimeId, modelConfigId),
    agentBindingId: contact.agentBindingId,
    skillIds: []
  };
}

function contactDraftMatchesBinding(contact: AgentContactViewModel, draft: ContactParticipantDraft): boolean {
  return draft.roleId === contact.roleId
    && (contact.runtimeId === undefined || draft.runtimeId === contact.runtimeId)
    && normalizedModelConfigId(draft.modelConfigId) === normalizedModelConfigId(contact.modelConfigId);
}

export async function ensureAgentBindingsForParticipants(options: {
  readonly fetchImpl: typeof fetch;
  readonly existingBindings: readonly AgentBindingSummary[];
  readonly participants: readonly BuildV1ParticipantInput[];
}): Promise<{ readonly bindingIds: string[]; readonly ensuredBindings: AgentBindingSummary[]; readonly createdBindings: AgentBindingSummary[] }> {
  const known = new Map<string, AgentBindingSummary>();
  for (const binding of options.existingBindings) {
    if (binding.disabledAt !== undefined) continue;
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
      throw new Error(`为 ${participant.roleId}/${participant.runtimeId} 创建 Agent 绑定失败：${errorMessage(payload, response.status)}`);
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
    throw new Error("创建 Agent 绑定返回了无效响应。");
  }
  const row = record as Record<string, unknown>;
  const id = stringValue(row.id);
  if (!id) throw new Error("创建 Agent 绑定未返回 ID。");
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

const CREATE_ROOM_ERROR_TEXT: Record<string, string> = {
  "Native runtime participants require a model config.": "内置运行时参与者需要指定模型配置。",
  "Solo rooms require exactly one role participant.": "单人房间需要且仅需要一个角色参与者。",
  "Assisted rooms require a primary role participant.": "协作房间需要一个主角色参与者。",
  "Pick a leader role.": "请选择负责人角色。",
  "Add at least one role participant.": "请至少添加一个角色参与者。",
  "Leader role must be included as a participant.": "负责人角色必须包含在参与者中。"
};

function displayErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return CREATE_ROOM_ERROR_TEXT[message] ?? message;
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
  const [contacts, setContacts] = useState<AgentContactViewModel[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [contactParticipantDrafts, setContactParticipantDrafts] = useState<Record<string, ContactParticipantDraft>>({});
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | undefined>(undefined);
  const [skills, setSkills] = useState<WorkspaceSkillSummary[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (isOpen) {
      setTitle(`房间 ${new Date().toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "2-digit", day: "2-digit" })}`);
      setError(undefined);
      setMode("assisted");
      setLeaderRoleId("");
      setLeaderBinding(undefined);
      setV1Participants([]);
      setCreatedAgentBindings([]);
      setSelectedContactIds(new Set());
      setContactParticipantDrafts({});
      setContactsError(undefined);
      setSelectedSkillIds(new Set());
      setSkillsError(undefined);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const controller = new AbortController();
    setContactsLoading(true);
    setContactsError(undefined);
    void csrfFetch("/agents/contacts", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`contacts ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!cancelled) setContacts(normalizeAgentContacts(payload));
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          setContactsError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [csrfFetch, isOpen]);

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

  const teamMode = mode === "squad" || mode === "team";
  const selectedContacts = Array.from(selectedContactIds).flatMap((agentBindingId) => {
    const contact = contacts.find((candidate) => candidate.agentBindingId === agentBindingId);
    return contact ? [contact] : [];
  });
  const selectedContactDrafts = selectedContacts.map((contact) =>
    contactParticipantDrafts[contact.agentBindingId] ?? newContactParticipantDraft(contact, runtimes, modelConfigs)
  );
  const selectedLeader = roles.find((role) => role.id === (selectedContactDrafts[0]?.roleId ?? leaderBinding?.roleId ?? leaderRoleId));

  useEffect(() => {
    setContactParticipantDrafts((current) => {
      const next: Record<string, ContactParticipantDraft> = {};
      for (const contact of selectedContacts) {
        next[contact.agentBindingId] = current[contact.agentBindingId] ?? newContactParticipantDraft(contact, runtimes, modelConfigs);
      }
      return next;
    });
  }, [contacts, modelConfigs, runtimes, selectedContactIds]);

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

  const toggleContact = (agentBindingId: string) => {
    setSelectedContactIds((current) => {
      const next = new Set(current);
      if (next.has(agentBindingId)) next.delete(agentBindingId); else next.add(agentBindingId);
      setMode(defaultRoomModeForSelectedContacts(next.size, mode));
      return next;
    });
  };

  const setContactSelection = (agentBindingIds: Set<string>) => {
    setSelectedContactIds(agentBindingIds);
    setMode(defaultRoomModeForSelectedContacts(agentBindingIds.size, mode));
  };

  const updateContactParticipant = (agentBindingId: string, patch: Partial<V1ParticipantDraft>) => {
    setContactParticipantDrafts((current) => {
      const contact = contacts.find((candidate) => candidate.agentBindingId === agentBindingId);
      if (contact === undefined) return current;
      const base = current[agentBindingId] ?? newContactParticipantDraft(contact, runtimes, modelConfigs);
      const patched = patchParticipantRuntime(base, patch, runtimes, modelConfigs);
      return {
        ...current,
        [agentBindingId]: {
          ...base,
          ...patched,
          agentBindingId,
          skillIds: base.skillIds
        }
      };
    });
  };

  const setContactSkillSelected = (agentBindingId: string, skillId: string, selected: boolean) => {
    setContactParticipantDrafts((current) => {
      const contact = contacts.find((candidate) => candidate.agentBindingId === agentBindingId);
      if (contact === undefined) return current;
      const base = current[agentBindingId] ?? newContactParticipantDraft(contact, runtimes, modelConfigs);
      const nextSkillIds = new Set(base.skillIds);
      if (selected) nextSkillIds.add(skillId); else nextSkillIds.delete(skillId);
      return {
        ...current,
        [agentBindingId]: {
          ...base,
          skillIds: Array.from(nextSkillIds)
        }
      };
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
    if (selectedContacts.length > 0) {
      setSubmitting(true);
      setError(undefined);
      try {
        const contactDrafts = selectedContacts.map((contact) =>
          contactParticipantDrafts[contact.agentBindingId] ?? newContactParticipantDraft(contact, runtimes, modelConfigs)
        );
        const overrideParticipants = selectedContacts.flatMap((contact, index): BuildV1ParticipantInput[] => {
          const draft = contactDrafts[index]!;
          if (contactDraftMatchesBinding(contact, draft)) return [];
          const runtime = runtimes.find((candidate) => candidate.id === draft.runtimeId);
          const runtimeKind = runtime?.kind ?? contact.runtimeKind;
          if (runtimeKind === "native" && !draft.modelConfigId) throw new Error("Native runtime participants require a model config.");
          const participant: BuildV1ParticipantInput = {
            roleId: draft.roleId,
            runtimeId: draft.runtimeId,
            runtimeKind,
            defaultPresence: draft.defaultPresence
          };
          if (draft.modelConfigId) participant.modelConfigId = draft.modelConfigId;
          return [participant];
        });
        const resolvedBindingIds: Record<string, string> = {};
        if (overrideParticipants.length > 0) {
          const ensured = await ensureAgentBindingsForParticipants({
            fetchImpl: csrfFetch,
            existingBindings: [...agentBindings, ...createdAgentBindings],
            participants: overrideParticipants
          });
          if (ensured.createdBindings.length > 0) {
            setCreatedAgentBindings((current) => mergeAgentBindings(current, ensured.createdBindings));
          }
          let index = 0;
          for (let contactIndex = 0; contactIndex < selectedContacts.length; contactIndex += 1) {
            const contact = selectedContacts[contactIndex]!;
            const draft = contactDrafts[contactIndex]!;
            if (contactDraftMatchesBinding(contact, draft)) continue;
            const bindingId = ensured.bindingIds[index];
            if (bindingId !== undefined) resolvedBindingIds[contact.agentBindingId] = bindingId;
            index += 1;
          }
        }
        await onCreate(buildContactFirstCreateRoomInput({
          title,
          mode,
          contacts: selectedContacts,
          skillIds: Array.from(selectedSkillIds),
          participantConfigs: contactDrafts,
          resolvedBindingIds
        }));
        onOpenChange(false);
      } catch (err) {
        setError(displayErrorMessage(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!leaderBinding) {
      setError("请选择主角色绑定。");
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
      setError(displayErrorMessage(err));
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
                <Modal.Heading>新建房间</Modal.Heading>
                <p className="mt-1 max-w-xl text-sm text-muted">
                  配置一个本地智能体工作区，包含一个主智能体，并可按需添加协作者。
                </p>
              </div>
            </div>
          </Modal.Header>

          <Modal.Body className="min-h-0 flex-1 gap-0 overflow-hidden p-0">
            <ScrollShadow className="h-full min-h-0 overflow-auto pb-8" orientation="vertical">
              <div className="grid gap-4 p-5 pb-8">
                <section className="ah-new-room-panel ah-new-room-top">
                  <TextField value={title} onChange={setTitle}>
                    <Label className="text-sm font-semibold">标题</Label>
                    <Input placeholder="例如：重构认证流程" />
                  </TextField>

                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">模式</h3>
                      <Chip size="sm" variant="soft" color={selectedContacts.length > 0 ? "accent" : "default"}>
                        {selectedContacts.length > 0 ? `已选择 ${selectedContacts.length} 个联系人` : "未选择联系人"}
                      </Chip>
                    </div>
                    <RadioGroup
                      className="gap-0"
                      value={mode}
                      onChange={(v: unknown) => setMode(v as RoomMode)}
                      aria-label="房间模式"
                    >
                      <div className="ah-room-mode-grid">
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
                </section>

                <div className="ah-new-room-layout">
                  <ContactFirstPicker
                    contacts={contacts}
                    selectedIds={selectedContactIds}
                    loading={contactsLoading}
                    error={contactsError}
                    onToggle={toggleContact}
                    onSelectionChange={setContactSelection}
                  />

                  <div className="grid min-h-0 gap-4 content-start">
                    {selectedContacts.length > 0 ? (
                      <section className="ah-new-room-panel">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold">高级配置</h3>
                            <p className="text-xs text-muted">
                              覆盖联系人角色、运行时、模型和在线状态，并为特定联系人追加技能。
                            </p>
                          </div>
                          <Chip size="sm" variant="soft" color={selectedLeader ? "accent" : "default"}>
                            {selectedLeader ? roleDisplayText(selectedLeader).title : "未选择主角色"}
                          </Chip>
                        </div>

                        {optionsError ? <p className="mb-2 text-xs text-danger">{optionsError}</p> : null}
                        {optionsLoading ? <p className="mb-2 text-xs text-muted">正在加载角色、运行时和模型...</p> : null}

                        <div className="grid gap-3">
                          {selectedContacts.map((contact, index) => {
                            const draft = selectedContactDrafts[index] ?? newContactParticipantDraft(contact, runtimes, modelConfigs);
                            return (
                              <div key={contact.agentBindingId} className="grid gap-3 rounded-xl border border-border bg-surface p-3">
                                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <h4 className="truncate text-sm font-semibold">{contact.displayName}</h4>
                                    <p className="truncate text-xs text-muted">{contact.agentBindingId}</p>
                                  </div>
                                  <div className="flex flex-wrap justify-end gap-1.5">
                                    <Chip size="sm" variant="soft" color={index === 0 ? "accent" : "default"}>{index === 0 ? "主智能体" : "协作者"}</Chip>
                                    <Chip size="sm" variant="soft" color={contactStatusColor(contact.status)}>{contactStatusLabel(contact.status)}</Chip>
                                  </div>
                                </div>

                                <RoleBindingRow
                                  roleId={draft.roleId}
                                  runtimeId={draft.runtimeId}
                                  modelConfigId={draft.modelConfigId}
                                  presence={draft.defaultPresence}
                                  roles={roles}
                                  runtimes={runtimes}
                                  modelConfigs={modelConfigs}
                                  onChange={(patch) => updateContactParticipant(contact.agentBindingId, patch)}
                                  testIdPrefix={`new-room-contact-${index}`}
                                />

                                <div className="grid gap-2">
                                  <div className="flex items-center justify-between gap-3">
                                    <h5 className="text-xs font-semibold uppercase text-muted">联系人技能</h5>
                                    <Chip size="sm" variant="soft" color={draft.skillIds.length > 0 ? "accent" : "default"}>
                                      已选择 {draft.skillIds.length} 个
                                    </Chip>
                                  </div>
                                  {skills.length === 0 && !skillsLoading ? (
                                    <div className="rounded-xl border border-dashed border-border bg-overlay p-3 text-sm text-muted">
                                      未找到可追加到此联系人的技能。
                                    </div>
                                  ) : (
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      {skills.map((skill) => {
                                        const selected = draft.skillIds.includes(skill.id);
                                        return (
                                          <Checkbox
                                            key={skill.id}
                                            isSelected={selected}
                                            onChange={(selected) => setContactSkillSelected(contact.agentBindingId, skill.id, selected)}
                                            className={[
                                              "rounded-xl border bg-overlay px-3 py-2 transition-colors",
                                              selected ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-secondary"
                                            ].join(" ")}
                                          >
                                            <Checkbox.Control>
                                              <Checkbox.Indicator />
                                            </Checkbox.Control>
                                            <Checkbox.Content>
                                              <Label className="block truncate text-sm font-medium">{skill.name}</Label>
                                            </Checkbox.Content>
                                          </Checkbox>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ) : (
                      <section className="ah-new-room-panel">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold">高级配置</h3>
                            <p className="text-xs text-muted">
                              {teamMode
                                ? "未选择联系人时，可手动配置负责人、队友、运行时和模型。"
                                : "未选择联系人时，可手动配置主智能体的角色、运行时和模型。"}
                            </p>
                          </div>
                          <Chip size="sm" variant="soft" color={selectedLeader ? "accent" : "default"}>
                            {selectedLeader ? roleDisplayText(selectedLeader).title : "未选择主角色"}
                          </Chip>
                        </div>

                        {optionsError ? <p className="mb-2 text-xs text-danger">{optionsError}</p> : null}
                        {optionsLoading ? <p className="mb-2 text-xs text-muted">正在加载角色、运行时和模型...</p> : null}

                        {leaderBinding ? (
                          <RoleBindingRow
                            title={teamMode ? "负责人绑定" : "主绑定"}
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
                            正在加载角色绑定选项...
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
                                  ? "在此添加队友角色。上方的负责人绑定始终会包含在内。"
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
                    )}

                    <section className="ah-new-room-panel">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold">房间技能</h3>
                          <p className="text-xs text-muted">选中的 SKILL.md 包会在下一次运行时对该房间可用。</p>
                        </div>
                        <Chip size="sm" variant="soft" color={selectedSkillIds.size > 0 ? "accent" : "default"}>
                          已选择 {selectedSkillIds.size} 个
                        </Chip>
                      </div>

                      {skillsError ? <p className="mb-2 text-xs text-danger">{skillsError}</p> : null}
                      {skillsLoading ? <p className="mb-2 text-xs text-muted">正在加载技能...</p> : null}

                      {skills.length === 0 && !skillsLoading ? (
                        <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-sm text-muted">
                          未找到工作区技能。可在设置中创建或导入技能。
                        </div>
                      ) : (
                        <div className="ah-new-room-skill-grid">
                          {skills.map((skill) => {
                            const selected = selectedSkillIds.has(skill.id);
                            return (
                              <Checkbox
                                key={skill.id}
                                isSelected={selected}
                                onChange={(selected) => setSkillSelected(skill.id, selected)}
                                className={[
                                  "ah-new-room-skill-option rounded-xl border bg-surface px-3 py-2 transition-colors",
                                  selected ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-secondary"
                                ].join(" ")}
                              >
                                <Checkbox.Control>
                                  <Checkbox.Indicator />
                                </Checkbox.Control>
                                <Checkbox.Content className="min-w-0 flex-1">
                                  <span className="flex min-w-0 max-w-full items-center gap-2 text-sm">
                                    <span className="min-w-0 flex-1 overflow-hidden">
                                      <span className="block truncate font-medium">{skillDisplayName(skill)}</span>
                                      <span className="block truncate text-xs text-muted">{skillDisplayDescription(skill) || "无描述"}</span>
                                    </span>
                                    <Chip className="shrink-0" size="sm" variant="soft" color={skillOriginColor(skill.origin)}>{skillOriginLabel(skill.origin)}</Chip>
                                  </span>
                                </Checkbox.Content>
                              </Checkbox>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  </div>
                </div>

                {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
              </div>
            </ScrollShadow>
          </Modal.Body>

          <Modal.Footer className="border-t border-border bg-surface/90 px-5 py-4">
            <div className="mr-auto hidden text-xs text-muted sm:block">
              {mode === "solo"
                ? "主智能体将加入此房间。"
                : teamMode
                  ? `负责人和 ${v1Participants.length} 名队友将加入此房间。`
                  : `主智能体和 ${v1Participants.length} 名协作者将加入此房间。`}
            </div>
            <Button slot="close" variant="tertiary">取消</Button>
            <Button
              variant="primary"
              isPending={submitting}
              isDisabled={submitting || (selectedContacts.length === 0 && !leaderBinding)}
              onPress={() => void handleSubmit()}
            >
              创建房间
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
