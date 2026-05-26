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

export function NewRoomDialog({ isOpen, onOpenChange, onCreate }: NewRoomDialogProps) {
  const { agents, loading, error: agentsError } = useAgents();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"solo" | "assisted">("assisted");
  const [primaryId, setPrimaryId] = useState<string | undefined>(undefined);
  const [extraIds, setExtraIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Reset state on open / pick a sensible primary default
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
      // Prefer a builder-capable agent if available, otherwise first agent.
      const builder = agents.find((a) => a.capabilities.includes("code.edit") || a.id.includes("builder"));
      setPrimaryId((builder ?? agents[0]!).id);
    }
  }, [agents, primaryId]);

  const sortedAgents = useMemo(
    () => agents.slice().sort((a, b) => {
      // Active presence and code-edit capable rise to the top.
      const score = (x: AgentSummary) => (x.defaultPresence === "active" ? 2 : 0) + (x.capabilities.includes("code.edit") ? 1 : 0);
      const diff = score(b) - score(a);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    }),
    [agents]
  );

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
          const a = agents.find((x) => x.id === id);
          const role: CreateRoomInput["participants"][number]["role"] =
            a?.capabilities.includes("code.review") ? "reviewer" :
            a?.capabilities.includes("task.delegate") ? "specialist" :
            "observer";
          const defaultPresence: "observing" | "active" = a?.defaultPresence === "active" ? "active" : "observing";
          return { type: "agent" as const, agentId: id, role, defaultPresence };
        });
      // Solo mode forbids extra agents
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

  const soloHasExtras = mode === "solo" && extraIds.size > 0;

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>New room</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4">
            <TextField value={title} onChange={setTitle}>
              <Label>Title</Label>
              <Input placeholder="e.g. Refactor auth flow" />
            </TextField>

            <div>
              <h3 className="mb-1 text-sm font-medium">Mode</h3>
              <RadioGroup
                value={mode}
                onChange={(v: unknown) => setMode(v as "solo" | "assisted")}
                aria-label="Room mode"
              >
                <div className="flex flex-col gap-2">
                  <Radio value="assisted">
                    <Radio.Control><Radio.Indicator /></Radio.Control>
                    <Radio.Content>
                      <span className="text-sm font-medium">Assisted</span>
                      <span className="block text-xs text-muted">Multiple agents collaborate; observers can knock.</span>
                    </Radio.Content>
                  </Radio>
                  <Radio value="solo">
                    <Radio.Control><Radio.Indicator /></Radio.Control>
                    <Radio.Content>
                      <span className="text-sm font-medium">Solo</span>
                      <span className="block text-xs text-muted">One primary agent only.</span>
                    </Radio.Content>
                  </Radio>
                </div>
              </RadioGroup>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Primary agent</h3>
              {agentsError ? <p className="text-xs text-danger">{agentsError}</p> : null}
              {loading ? <p className="text-xs text-muted">Loading agents…</p> : null}
              <ScrollShadow className="max-h-56 overflow-auto rounded border border-border" orientation="vertical">
                <ul role="radiogroup" aria-label="Primary agent" className="flex flex-col">
                  {sortedAgents.map((a) => {
                    const selected = a.id === primaryId;
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => setPrimaryId(a.id)}
                          aria-checked={selected}
                          role="radio"
                          className={[
                            "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                            selected ? "bg-accent-soft" : "hover:bg-default"
                          ].join(" ")}
                        >
                          <Avatar size="sm">
                            <Avatar.Fallback>{a.avatar ? a.avatar : initials(a.name)}</Avatar.Fallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">{a.name}</span>
                              <Chip size="sm" variant="soft" color={providerColor[a.provider] ?? "default"}>{a.provider}</Chip>
                            </div>
                            <p className="truncate text-xs text-muted">{a.description ?? a.adapterId}</p>
                          </div>
                          {selected ? <Chip size="sm" variant="primary" color="accent">Primary</Chip> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </ScrollShadow>
            </div>

            {mode === "assisted" ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Additional agents</h3>
                <p className="text-xs text-muted">Add observers, reviewers, or specialists. They join according to their default presence.</p>
                <div className="flex flex-wrap gap-1.5">
                  {sortedAgents
                    .filter((a) => a.id !== primaryId)
                    .map((a) => {
                      const checked = extraIds.has(a.id);
                      return (
                        <Checkbox
                          key={a.id}
                          isSelected={checked}
                          onChange={() => toggleExtra(a.id)}
                          className="rounded border border-border bg-surface px-2 py-1"
                        >
                          <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                          <Checkbox.Content>
                            <span className="flex items-center gap-2 text-sm">
                              <span aria-hidden="true">{a.avatar ?? "🤖"}</span>
                              <span>{a.name}</span>
                              <Chip size="sm" variant="soft" color={providerColor[a.provider] ?? "default"}>{a.provider}</Chip>
                            </span>
                          </Checkbox.Content>
                        </Checkbox>
                      );
                    })}
                </div>
                {soloHasExtras ? <p className="text-xs text-warning">Solo rooms only allow the primary agent.</p> : null}
              </div>
            ) : null}

            {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
          </Modal.Body>
          <Modal.Footer>
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
