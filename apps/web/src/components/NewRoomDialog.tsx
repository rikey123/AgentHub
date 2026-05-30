import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Button,
  Checkbox,
  Chip,
  Input,
  Label,
  Modal,
  Radio,
  RadioGroup,
  ScrollShadow,
  TextField
} from "@heroui/react";
import { useAgents, type AgentSummary } from "../hooks/useAgents.ts";
import { useRoomCreationOptions } from "../hooks/useRoomCreationOptions.ts";
import { initials } from "../lib/format.ts";

export type RoomMode = "solo" | "assisted" | "squad" | "team";
export type RoomParticipantRole = "observer" | "reviewer" | "specialist";
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
  role?: RoomParticipantRole;
  defaultPresence?: RoomPresence;
};

export type CreateRoomInput = {
  title: string;
  mode: RoomMode;
  primaryAgentId: string;
  leaderRoleId?: string;
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

export function buildCreateRoomInput(input: {
  title: string;
  mode: RoomMode;
  primaryAgentId: string;
  leaderRoleId?: string;
  legacyAgentParticipants: LegacyAgentParticipant[];
  v1Participants: BuildV1ParticipantInput[];
}): CreateRoomInput {
  const title = input.title.trim() || "New room";
  if (input.mode === "solo") {
    return { title, mode: "solo", primaryAgentId: input.primaryAgentId, participants: [] };
  }
  if (input.mode === "assisted") {
    return { title, mode: "assisted", primaryAgentId: input.primaryAgentId, participants: input.legacyAgentParticipants };
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
  const participants = input.v1Participants.map((participant) => {
    if (participant.runtimeKind === "native" && !participant.modelConfigId) {
      throw new Error("Native runtime participants require a model config.");
    }
    const next: V1RoomParticipant = {
      roleId: participant.roleId,
      runtimeId: participant.runtimeId
    };
    if (participant.modelConfigId) next.modelConfigId = participant.modelConfigId;
    if (participant.role) next.role = participant.role;
    if (participant.defaultPresence) next.defaultPresence = participant.defaultPresence;
    return next;
  });
  return {
    title,
    mode: input.mode,
    primaryAgentId: input.primaryAgentId,
    leaderRoleId: input.leaderRoleId,
    participants
  };
}

interface NewRoomDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateRoomInput) => Promise<void> | void;
}

const providerColor: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  "claude-code": "accent",
  "opencode": "warning",
  "codex": "warning",
  "native": "success",
  "mock": "default",
  "langgraph": "accent",
  "a2a": "accent"
};

function providerLabel(provider: string) {
  switch (provider) {
    case "claude-code": return "Claude";
    case "opencode": return "OpenCode";
    case "native": return "Native";
    default: return provider;
  }
}

function capabilitySummary(agent: AgentSummary) {
  const labels = [
    agent.capabilities.includes("code.edit") ? "builder" : undefined,
    agent.capabilities.includes("code.review") ? "review" : undefined,
    agent.capabilities.includes("task.delegate") ? "delegate" : undefined
  ].filter(Boolean);
  return labels.length > 0 ? labels.join(" / ") : agent.defaultPresence;
}

function roleForAgent(agent: AgentSummary | undefined): RoomParticipantRole {
  if (agent?.capabilities.includes("code.review")) return "reviewer";
  if (agent?.capabilities.includes("task.delegate")) return "specialist";
  return "observer";
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

export function NewRoomDialog({ isOpen, onOpenChange, onCreate }: NewRoomDialogProps) {
  const { agents, loading, error: agentsError } = useAgents();
  const {
    roles,
    runtimes,
    modelConfigs,
    agentBindings,
    loading: optionsLoading,
    error: optionsError
  } = useRoomCreationOptions();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<RoomMode>("assisted");
  const [primaryId, setPrimaryId] = useState<string | undefined>(undefined);
  const [leaderRoleId, setLeaderRoleId] = useState<string>("");
  const [v1Participants, setV1Participants] = useState<V1ParticipantDraft[]>([]);
  const [extraIds, setExtraIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (isOpen) {
      setTitle(`Room ${new Date().toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "2-digit" })}`);
      setError(undefined);
      setExtraIds(new Set());
      setMode("assisted");
      setLeaderRoleId("");
      setV1Participants([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!primaryId && agents.length > 0) {
      const builder = agents.find((a) => a.capabilities.includes("code.edit") || a.id.includes("builder"));
      setPrimaryId((builder ?? agents[0]!).id);
    }
  }, [agents, primaryId]);

  useEffect(() => {
    if (leaderRoleId || roles.length === 0) return;
    const leader = roles.find((role) => role.capabilities.includes("task.delegate")) ?? roles[0];
    setLeaderRoleId(leader?.id ?? "");
  }, [leaderRoleId, roles]);

  useEffect(() => {
    if (v1Participants.length > 0 || roles.length === 0 || runtimes.length === 0) return;
    const role = roles.find((candidate) => candidate.id === leaderRoleId) ?? roles[0];
    const runtime = runtimes.find((candidate) => candidate.kind === "native") ?? runtimes[0];
    const modelConfigId = runtime?.kind === "native" ? modelConfigs[0]?.id ?? "" : "";
    setV1Participants([newParticipantDraft(role?.id ?? "", runtime?.id ?? "", modelConfigId)]);
  }, [leaderRoleId, modelConfigs, roles, runtimes, v1Participants.length]);

  const sortedAgents = useMemo(
    () => agents.slice().sort((a, b) => {
      const score = (x: AgentSummary) => (x.defaultPresence === "active" ? 2 : 0) + (x.capabilities.includes("code.edit") ? 1 : 0);
      const diff = score(b) - score(a);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    }),
    [agents]
  );

  const primaryAgent = sortedAgents.find((agent) => agent.id === primaryId);
  const selectedExtras = sortedAgents.filter((agent) => extraIds.has(agent.id) && agent.id !== primaryId);
  const selectedLeader = roles.find((role) => role.id === leaderRoleId);
  const teamMode = mode === "squad" || mode === "team";

  const toggleExtra = (id: string) => {
    setExtraIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const updateV1Participant = (id: string, patch: Partial<V1ParticipantDraft>) => {
    setV1Participants((current) => current.map((participant) => {
      if (participant.id !== id) return participant;
      const runtimeId = patch.runtimeId ?? participant.runtimeId;
      const runtime = runtimes.find((candidate) => candidate.id === runtimeId);
      const modelConfigId = patch.modelConfigId ?? (runtime?.kind === "native" ? (participant.modelConfigId || modelConfigs[0]?.id || "") : "");
      return { ...participant, ...patch, runtimeId, modelConfigId };
    }));
  };

  const addV1Participant = () => {
    const role = roles.find((candidate) => candidate.id === leaderRoleId) ?? roles[0];
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
    if (!primaryId && !teamMode) {
      setError("Pick a primary agent");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const legacyAgentParticipants = Array.from(extraIds)
        .filter((id) => id !== primaryId)
        .map((id) => {
          const agent = agents.find((x) => x.id === id);
          const defaultPresence: RoomPresence = agent?.defaultPresence === "active" ? "active" : "observing";
          return { type: "agent" as const, agentId: id, role: roleForAgent(agent), defaultPresence };
        });
      const v1ParticipantInput = v1Participants.map((participant) => {
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
      const leaderParticipant = v1Participants.find((participant) => participant.roleId === leaderRoleId);
      const leaderBindingId = leaderParticipant
        ? agentBindings.find((binding) =>
            binding.roleId === leaderRoleId
            && binding.runtimeId === leaderParticipant.runtimeId
            && binding.modelConfigId === (leaderParticipant.modelConfigId || null)
          )?.id
        : undefined;
      const primaryAgentId = teamMode ? (leaderBindingId ?? "") : (primaryId ?? "");
      const createInput = {
        title,
        mode,
        primaryAgentId,
        legacyAgentParticipants,
        v1Participants: v1ParticipantInput
      };
      await onCreate(buildCreateRoomInput(leaderRoleId ? { ...createInput, leaderRoleId } : createInput));
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
        <Modal.Dialog className="max-h-[92vh] w-[min(96vw,1180px)] max-w-[1180px] overflow-hidden">
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

          <Modal.Body className="max-h-[70vh] gap-0 overflow-hidden p-0">
            <ScrollShadow className="overflow-auto" orientation="vertical">
              <div className="grid gap-4 p-5">
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

                {!teamMode ? (
                  <section className="rounded-2xl border border-border bg-overlay p-4 shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Primary agent</h3>
                      <p className="text-xs text-muted">This agent receives the first turn and owns the main run.</p>
                    </div>
                    {primaryAgent ? (
                      <Chip size="sm" variant="soft" color={providerColor[primaryAgent.provider] ?? "default"}>
                        {providerLabel(primaryAgent.provider)}
                      </Chip>
                    ) : null}
                  </div>

                  {agentsError ? <p className="mb-2 text-xs text-danger">{agentsError}</p> : null}
                  {loading ? <p className="mb-2 text-xs text-muted">Loading agents...</p> : null}

                  <div role="radiogroup" aria-label="Primary agent" className="grid max-h-[340px] gap-2 overflow-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
                    {sortedAgents.map((agent) => {
                      const selected = agent.id === primaryId;
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          onClick={() => setPrimaryId(agent.id)}
                          aria-checked={selected}
                          role="radio"
                          className={[
                            "relative flex min-h-[126px] w-full items-start gap-3 rounded-2xl border p-3 text-left transition-all",
                            selected
                              ? "border-accent bg-accent-soft shadow-[0_12px_26px_color-mix(in_oklab,var(--accent)_18%,transparent)]"
                              : "border-border bg-surface hover:bg-surface-secondary"
                          ].join(" ")}
                        >
                          <Avatar size="sm">
                            <Avatar.Fallback>{agent.avatar ? agent.avatar : initials(agent.name)}</Avatar.Fallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-start gap-2">
                              <span className="truncate font-semibold">{agent.name}</span>
                              <Chip className="ml-auto shrink-0" size="sm" variant="soft" color={providerColor[agent.provider] ?? "default"}>{agent.provider}</Chip>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{agent.description ?? agent.adapterId}</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <Chip size="sm" variant="soft" color="default">{capabilitySummary(agent)}</Chip>
                              <Chip size="sm" variant="soft" color={agent.defaultPresence === "active" ? "success" : "default"}>{agent.defaultPresence}</Chip>
                            </div>
                          </div>
                          {selected ? <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" /> : null}
                        </button>
                      );
                    })}
                  </div>
                  </section>
                ) : (
                  <section className="rounded-2xl border border-border bg-overlay p-4 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">Role team</h3>
                        <p className="text-xs text-muted">Choose a leader role and bind each participant to a role, runtime, and model when required.</p>
                      </div>
                      <Chip size="sm" variant="soft" color={selectedLeader ? "accent" : "default"}>
                        {selectedLeader?.name ?? "No leader"}
                      </Chip>
                    </div>

                    {optionsError ? <p className="mb-2 text-xs text-danger">{optionsError}</p> : null}
                    {optionsLoading ? <p className="mb-2 text-xs text-muted">Loading roles, runtimes, and models...</p> : null}

                    <label className="grid gap-1 text-sm font-semibold">
                      Leader Role
                      <select
                        className="rounded-xl border border-field-border bg-field-background px-3 py-2 text-sm text-foreground"
                        value={leaderRoleId}
                        onChange={(event) => setLeaderRoleId(event.currentTarget.value)}
                        data-testid="new-room-leader-role"
                      >
                        <option value="" disabled>Choose leader role</option>
                        {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                      </select>
                    </label>

                    <div className="mt-4 grid gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold">Participants</h4>
                        <Button size="sm" variant="secondary" onPress={addV1Participant} isDisabled={roles.length === 0 || runtimes.length === 0}>
                          Add participant
                        </Button>
                      </div>

                      {v1Participants.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border bg-surface p-3 text-sm text-muted">
                          Add at least one participant for squad or team rooms.
                        </div>
                      ) : v1Participants.map((participant, index) => {
                        const runtime = runtimes.find((candidate) => candidate.id === participant.runtimeId);
                        const needsModel = runtime?.kind === "native";
                        return (
                          <div key={participant.id} className="grid gap-3 rounded-xl border border-border bg-surface p-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
                            <label className="grid gap-1 text-xs font-semibold uppercase text-muted">
                              Role
                              <select
                                className="rounded-xl border border-field-border bg-field-background px-3 py-2 text-sm normal-case text-foreground"
                                value={participant.roleId}
                                onChange={(event) => updateV1Participant(participant.id, { roleId: event.currentTarget.value })}
                                data-testid={`new-room-participant-role-${index}`}
                              >
                                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                              </select>
                            </label>
                            <label className="grid gap-1 text-xs font-semibold uppercase text-muted">
                              Runtime
                              <select
                                className="rounded-xl border border-field-border bg-field-background px-3 py-2 text-sm normal-case text-foreground"
                                value={participant.runtimeId}
                                onChange={(event) => updateV1Participant(participant.id, { runtimeId: event.currentTarget.value })}
                                data-testid={`new-room-participant-runtime-${index}`}
                              >
                                {runtimes.map((runtimeOption) => (
                                  <option key={runtimeOption.id} value={runtimeOption.id}>{runtimeOption.name} ({runtimeOption.kind})</option>
                                ))}
                              </select>
                            </label>
                            <label className="grid gap-1 text-xs font-semibold uppercase text-muted">
                              Model
                              <select
                                className="rounded-xl border border-field-border bg-field-background px-3 py-2 text-sm normal-case text-foreground disabled:opacity-60"
                                value={participant.modelConfigId}
                                onChange={(event) => updateV1Participant(participant.id, { modelConfigId: event.currentTarget.value })}
                                disabled={!needsModel && modelConfigs.length === 0}
                                data-testid={`new-room-participant-model-${index}`}
                              >
                                <option value="">{needsModel ? "Choose model" : "No model override"}</option>
                                {modelConfigs.map((config) => <option key={config.id} value={config.id}>{config.name} ({config.model})</option>)}
                              </select>
                            </label>
                            <div className="flex items-end justify-between gap-2">
                              <label className="grid flex-1 gap-1 text-xs font-semibold uppercase text-muted">
                                Presence
                                <select
                                  className="rounded-xl border border-field-border bg-field-background px-3 py-2 text-sm normal-case text-foreground"
                                  value={participant.defaultPresence}
                                  onChange={(event) => updateV1Participant(participant.id, { defaultPresence: event.currentTarget.value as RoomPresence })}
                                >
                                  <option value="active">Active</option>
                                  <option value="observing">Observing</option>
                                </select>
                              </label>
                              <Button size="sm" variant="tertiary" onPress={() => removeV1Participant(participant.id)} isDisabled={v1Participants.length === 1}>
                                Remove
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {mode === "assisted" ? (
                  <section className="rounded-2xl border border-border bg-overlay p-4 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">Additional agents</h3>
                        <p className="text-xs text-muted">Add observers, reviewers, or specialists. They join according to their default presence.</p>
                      </div>
                      <Chip size="sm" variant="soft" color={selectedExtras.length > 0 ? "accent" : "default"}>
                        {selectedExtras.length} selected
                      </Chip>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {sortedAgents
                        .filter((agent) => agent.id !== primaryId)
                        .map((agent) => {
                          const checked = extraIds.has(agent.id);
                          return (
                            <Checkbox
                              key={agent.id}
                              isSelected={checked}
                              onChange={() => toggleExtra(agent.id)}
                              className={[
                                "rounded-2xl border bg-surface px-3 py-2 transition-colors",
                                checked ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-secondary"
                              ].join(" ")}
                            >
                              <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                              <Checkbox.Content>
                                <span className="flex min-w-0 items-center gap-2 text-sm">
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-xs font-semibold">
                                    {agent.avatar ?? initials(agent.name)}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate font-medium">{agent.name}</span>
                                  <Chip size="sm" variant="soft" color={providerColor[agent.provider] ?? "default"}>{agent.provider}</Chip>
                                </span>
                              </Checkbox.Content>
                            </Checkbox>
                          );
                        })}
                    </div>
                  </section>
                ) : null}

                {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
              </div>
            </ScrollShadow>
          </Modal.Body>

          <Modal.Footer className="border-t border-border bg-surface/90 px-5 py-4">
            <div className="mr-auto hidden text-xs text-muted sm:block">
              {mode === "solo"
                ? "Solo rooms start with the primary agent only."
                : teamMode
                  ? `${v1Participants.length} role participant${v1Participants.length === 1 ? "" : "s"} will join this room.`
                  : `${selectedExtras.length + 1} agent${selectedExtras.length === 0 ? "" : "s"} will join this room.`}
            </div>
            <Button slot="close" variant="tertiary">Cancel</Button>
            <Button
              variant="primary"
              isPending={submitting}
              isDisabled={submitting || (!teamMode && !primaryId) || (teamMode && (!leaderRoleId || v1Participants.length === 0))}
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
