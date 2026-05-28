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
import { initials } from "../lib/format.ts";

export type CreateRoomInput = {
  title: string;
  mode: "solo" | "assisted";
  primaryAgentId: string;
  participants: Array<{ type: "agent"; agentId: string; role: "observer" | "reviewer" | "specialist"; defaultPresence: "observing" | "active" }>;
};

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

function roleForAgent(agent: AgentSummary | undefined): CreateRoomInput["participants"][number]["role"] {
  if (agent?.capabilities.includes("code.review")) return "reviewer";
  if (agent?.capabilities.includes("task.delegate")) return "specialist";
  return "observer";
}

export function NewRoomDialog({ isOpen, onOpenChange, onCreate }: NewRoomDialogProps) {
  const { agents, loading, error: agentsError } = useAgents();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"solo" | "assisted">("assisted");
  const [primaryId, setPrimaryId] = useState<string | undefined>(undefined);
  const [extraIds, setExtraIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (isOpen) {
      setTitle(`Room ${new Date().toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "2-digit" })}`);
      setError(undefined);
      setExtraIds(new Set());
      setMode("assisted");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!primaryId && agents.length > 0) {
      const builder = agents.find((a) => a.capabilities.includes("code.edit") || a.id.includes("builder"));
      setPrimaryId((builder ?? agents[0]!).id);
    }
  }, [agents, primaryId]);

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

  const toggleExtra = (id: string) => {
    setExtraIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!primaryId) {
      setError("Pick a primary agent");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const participants = Array.from(extraIds)
        .filter((id) => id !== primaryId)
        .map((id) => {
          const agent = agents.find((x) => x.id === id);
          const defaultPresence: "observing" | "active" = agent?.defaultPresence === "active" ? "active" : "observing";
          return { type: "agent" as const, agentId: id, role: roleForAgent(agent), defaultPresence };
        });
      const finalMode = mode === "solo" ? "solo" : "assisted";
      const finalParticipants = finalMode === "solo" ? [] : participants;
      await onCreate({
        title: title.trim() || "New room",
        mode: finalMode,
        primaryAgentId: primaryId,
        participants: finalParticipants
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg">
        <Modal.Dialog className="overflow-hidden">
          <Modal.CloseTrigger />
          <Modal.Header className="border-b border-border bg-[linear-gradient(135deg,var(--surface),var(--surface-secondary))] px-6 py-5">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-sm font-black text-accent-foreground shadow-[0_14px_30px_color-mix(in_oklab,var(--accent)_24%,transparent)]">
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

          <Modal.Body className="max-h-[72vh] gap-0 overflow-hidden p-0">
            <ScrollShadow className="overflow-auto" orientation="vertical">
              <div className="grid gap-4 p-5">
                <section className="rounded-2xl border border-border bg-overlay p-4 shadow-[var(--surface-shadow)]">
                  <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                    <TextField value={title} onChange={setTitle}>
                      <Label className="text-sm font-semibold">Title</Label>
                      <Input placeholder="e.g. Refactor auth flow" />
                    </TextField>

                    <div>
                      <h3 className="mb-2 text-sm font-semibold">Mode</h3>
                      <RadioGroup
                        value={mode}
                        onChange={(v: unknown) => setMode(v as "solo" | "assisted")}
                        aria-label="Room mode"
                      >
                        <div className="grid gap-2">
                          <RoomModeOption
                            value="assisted"
                            title="Assisted"
                            description="Multiple agents collaborate; observers can knock."
                          />
                          <RoomModeOption
                            value="solo"
                            title="Solo"
                            description="One primary agent only."
                          />
                        </div>
                      </RadioGroup>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-overlay p-4 shadow-[var(--surface-shadow)]">
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

                  <div role="radiogroup" aria-label="Primary agent" className="grid max-h-72 gap-2 overflow-auto pr-1 md:grid-cols-2">
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
                            "flex min-h-24 w-full items-start gap-3 rounded-2xl border p-3 text-left transition-all",
                            selected
                              ? "border-accent bg-accent-soft shadow-[0_12px_26px_color-mix(in_oklab,var(--accent)_18%,transparent)]"
                              : "border-border bg-surface hover:bg-surface-secondary"
                          ].join(" ")}
                        >
                          <Avatar size="sm">
                            <Avatar.Fallback>{agent.avatar ? agent.avatar : initials(agent.name)}</Avatar.Fallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <span className="truncate font-semibold">{agent.name}</span>
                              <Chip size="sm" variant="soft" color={providerColor[agent.provider] ?? "default"}>{agent.provider}</Chip>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{agent.description ?? agent.adapterId}</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <Chip size="sm" variant="soft" color="default">{capabilitySummary(agent)}</Chip>
                              <Chip size="sm" variant="soft" color={agent.defaultPresence === "active" ? "success" : "default"}>{agent.defaultPresence}</Chip>
                            </div>
                          </div>
                          {selected ? <Chip size="sm" variant="primary" color="accent">Primary</Chip> : null}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {mode === "assisted" ? (
                  <section className="rounded-2xl border border-border bg-overlay p-4 shadow-[var(--surface-shadow)]">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">Additional agents</h3>
                        <p className="text-xs text-muted">Add observers, reviewers, or specialists. They join according to their default presence.</p>
                      </div>
                      <Chip size="sm" variant="soft" color={selectedExtras.length > 0 ? "accent" : "default"}>
                        {selectedExtras.length} selected
                      </Chip>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
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
                : `${selectedExtras.length + 1} agent${selectedExtras.length === 0 ? "" : "s"} will join this room.`}
            </div>
            <Button slot="close" variant="tertiary">Cancel</Button>
            <Button
              variant="primary"
              isPending={submitting}
              isDisabled={!primaryId || submitting}
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

function RoomModeOption({ value, title, description }: { value: "solo" | "assisted"; title: string; description: string }) {
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
