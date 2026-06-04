export type AssistedSelectorParticipant = {
  readonly agentId: string;
  readonly name: string;
  readonly role: string;
  readonly description?: string;
  readonly presence?: string;
  readonly joinedAt?: number;
};

export type AssistedSelectorInput = {
  readonly roomId: string;
  readonly workspaceId: string;
  readonly userMessageId: string;
  readonly text: string;
  readonly participants: readonly AssistedSelectorParticipant[];
  readonly primaryAgentId?: string | null;
  readonly mentions?: readonly string[];
  readonly history?: string;
};

export type AssistedSelectorRequest = {
  readonly roomId: string;
  readonly workspaceId: string;
  readonly userMessageId: string;
  readonly text: string;
  readonly participants: readonly AssistedSelectorParticipant[];
  readonly previousSpeakerId?: string;
  history: string;
  readonly attempt: number;
  readonly feedback?: string;
};

export type AssistedSelectorSelection = {
  readonly agentId: string;
  readonly reason: "selector_func" | "selector" | "fallback";
  readonly turnIndex: number;
  readonly userMessageId: string;
};

export type AssistedSelectorStop = {
  readonly stopReason: "max_turns" | "no_candidates" | "unknown_turn" | "no_response" | "acknowledgement" | "selector_stop";
  readonly userMessageId: string;
};

export type AssistedSelectorResult = AssistedSelectorSelection | AssistedSelectorStop;

export type AssistedSelectorOptions = {
  readonly selectSpeaker: (request: AssistedSelectorRequest) => Promise<string | undefined>;
  readonly maxTurns?: number;
  readonly maxSelectorAttempts?: number;
  readonly allowRepeatedSpeaker?: boolean;
};

type TurnState = {
  readonly roomId: string;
  readonly workspaceId: string;
  readonly userMessageId: string;
  readonly text: string;
  readonly primaryAgentId?: string | null;
  readonly participants: readonly AssistedSelectorParticipant[];
  readonly mentions: readonly string[];
  history: string;
  readonly spokenAgentIds: string[];
  readonly selectedAgentIds: string[];
  fallbackUsed: boolean;
};

const DEFAULT_MAX_TURNS = 3;
const DEFAULT_MAX_SELECTOR_ATTEMPTS = 3;

export class AssistedSelectorGroupChatManager {
  private readonly maxTurns: number;
  private readonly maxSelectorAttempts: number;
  private readonly allowRepeatedSpeaker: boolean;
  private readonly turns = new Map<string, TurnState>();

  constructor(private readonly options: AssistedSelectorOptions) {
    this.maxTurns = Math.max(1, options.maxTurns ?? DEFAULT_MAX_TURNS);
    this.maxSelectorAttempts = Math.max(1, options.maxSelectorAttempts ?? DEFAULT_MAX_SELECTOR_ATTEMPTS);
    this.allowRepeatedSpeaker = options.allowRepeatedSpeaker ?? false;
  }

  async startTurn(input: AssistedSelectorInput): Promise<AssistedSelectorResult> {
    this.forgetRoomTurns(input.roomId);
    const state: TurnState = {
      roomId: input.roomId,
      workspaceId: input.workspaceId,
      userMessageId: input.userMessageId,
      text: input.text,
      ...(input.primaryAgentId !== undefined ? { primaryAgentId: input.primaryAgentId } : {}),
      participants: [...input.participants],
      mentions: [...(input.mentions ?? [])],
      history: input.history ?? `User: ${input.text}`,
      spokenAgentIds: [],
      selectedAgentIds: [],
      fallbackUsed: false
    };
    this.turns.set(input.userMessageId, state);
    return this.selectNext(state);
  }

  async continueTurn(input: { readonly userMessageId: string; readonly completedRunId: string; readonly completedAgentId: string; readonly completedText?: string; readonly history?: string }): Promise<AssistedSelectorResult> {
    void input.completedRunId;
    const state = this.turns.get(input.userMessageId);
    if (state === undefined) return { stopReason: "unknown_turn", userMessageId: input.userMessageId };
    if (input.history !== undefined && input.history.trim().length > 0) {
      state.history = input.history;
    }
    if (!state.spokenAgentIds.includes(input.completedAgentId)) {
      state.spokenAgentIds.push(input.completedAgentId);
    }
    if (input.completedText !== undefined) {
      const terminal = completedReplyStopReason(input.completedText);
      if (terminal !== undefined) {
        this.turns.delete(input.userMessageId);
        return { stopReason: terminal, userMessageId: input.userMessageId };
      }
    }
    if (state.spokenAgentIds.length >= this.maxTurns) {
      this.turns.delete(input.userMessageId);
      return { stopReason: "max_turns", userMessageId: input.userMessageId };
    }
    return this.selectNext(state);
  }

  forgetTurn(userMessageId: string): void {
    this.turns.delete(userMessageId);
  }

  forgetRoomTurns(roomId: string): void {
    for (const [userMessageId, state] of this.turns) {
      if (state.roomId === roomId) this.turns.delete(userMessageId);
    }
  }

  private async selectNext(state: TurnState): Promise<AssistedSelectorResult> {
    const candidates = this.candidates(state);
    const speakable = this.speakableParticipants(state);
    if (candidates.length === 0) {
      this.turns.delete(state.userMessageId);
      return { stopReason: "no_candidates", userMessageId: state.userMessageId };
    }

    const mentioned = state.mentions.find((agentId) => candidates.some((participant) => participant.agentId === agentId));
    if (mentioned !== undefined && state.spokenAgentIds.length === 0) {
      return this.selection(state, mentioned, "selector_func");
    }

    if (candidates.length === 1) return this.selection(state, candidates[0]!.agentId, "selector");

    let feedback: string | undefined;
    for (let attempt = 0; attempt < this.maxSelectorAttempts; attempt += 1) {
      const previousSpeakerId = state.spokenAgentIds.at(-1);
      const output = await this.options.selectSpeaker({
        roomId: state.roomId,
        workspaceId: state.workspaceId,
        userMessageId: state.userMessageId,
        text: state.text,
        participants: candidates,
        ...(previousSpeakerId !== undefined ? { previousSpeakerId } : {}),
        history: state.history,
        attempt: attempt + 1,
        ...(feedback !== undefined ? { feedback } : {})
      });
      if (isSelectorStopOutput(output)) {
        this.turns.delete(state.userMessageId);
        return { stopReason: "selector_stop", userMessageId: state.userMessageId };
      }
      const selection = parseSelectedAgent(output, speakable);
      if (selection.matches.length === 0) {
        feedback = `No valid name was mentioned. Please select from: ${candidateList(candidates)}.`;
        continue;
      }
      if (selection.matches.length > 1) {
        feedback = `Expected exactly one name to be mentioned. Please select only one from: ${candidateList(candidates)}.`;
        continue;
      }
      const agentId = selection.matches[0]!;
      if (!this.allowRepeatedSpeaker && previousSpeakerId !== undefined && agentId === previousSpeakerId) {
        feedback = `Repeated speaker is not allowed, please select a different name from: ${candidateList(candidates)}.`;
        continue;
      }
      if (candidates.some((candidate) => candidate.agentId === agentId)) return this.selection(state, agentId, "selector");
      feedback = `No valid name was mentioned. Please select from: ${candidateList(candidates)}.`;
    }

    const fallback = this.fallbackCandidate(state, candidates);
    if (fallback === undefined || state.fallbackUsed) {
      this.turns.delete(state.userMessageId);
      return { stopReason: "no_candidates", userMessageId: state.userMessageId };
    }
    state.fallbackUsed = true;
    return this.selection(state, fallback.agentId, "fallback");
  }

  private candidates(state: TurnState): AssistedSelectorParticipant[] {
    const previousSpeakerId = state.spokenAgentIds.at(-1);
    return this.speakableParticipants(state)
      .filter((participant) => this.allowRepeatedSpeaker || participant.agentId !== previousSpeakerId);
  }

  private speakableParticipants(state: TurnState): AssistedSelectorParticipant[] {
    return state.participants
      .filter((participant) => isSpeakable(participant));
  }

  private fallbackCandidate(state: TurnState, candidates: readonly AssistedSelectorParticipant[]): AssistedSelectorParticipant | undefined {
    const previousSpeakerId = state.spokenAgentIds.at(-1);
    if (previousSpeakerId !== undefined) {
      return this.speakableParticipants(state).find((candidate) => candidate.agentId === previousSpeakerId);
    }
    return candidates.find((candidate) => candidate.agentId === state.primaryAgentId) ?? candidates[0];
  }

  private selection(state: TurnState, agentId: string, reason: AssistedSelectorSelection["reason"]): AssistedSelectorSelection {
    state.selectedAgentIds.push(agentId);
    return {
      agentId,
      reason,
      turnIndex: state.selectedAgentIds.length,
      userMessageId: state.userMessageId
    };
  }
}

function isSpeakable(participant: AssistedSelectorParticipant): boolean {
  if (participant.role === "observer") return false;
  if (participant.presence === "observing" || participant.presence === "offline") return false;
  return true;
}

function parseSelectedAgent(output: string | undefined, participants: readonly AssistedSelectorParticipant[]): { readonly matches: readonly string[] } {
  if (output === undefined) return { matches: [] };
  const trimmed = output.trim();
  if (trimmed.length === 0) return { matches: [] };
  const matches = participants
    .filter((participant) => exactMention(trimmed, participant.agentId) || exactMention(trimmed, participant.name))
    .map((participant) => participant.agentId);
  return { matches: [...new Set(matches)] };
}

function completedReplyStopReason(text: string): "no_response" | "acknowledgement" | undefined {
  const normalized = text.trim();
  if (normalized.length === 0) return "no_response";
  return isAcknowledgementOnly(normalized) ? "acknowledgement" : undefined;
}

function isAcknowledgementOnly(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[。.!！?,，、；;:：~\s]+$/g, "")
    .replace(/^[。.!！?,，、；;:：~\s]+/g, "");
  const acknowledgements = new Set([
    "ok",
    "okay",
    "got it",
    "understood",
    "roger",
    "收到",
    "已收到",
    "明白",
    "明白了",
    "了解",
    "了解了",
    "好的",
    "好",
    "知道了"
  ]);
  return acknowledgements.has(normalized);
}

function isSelectorStopOutput(output: string | undefined): boolean {
  if (output === undefined) return false;
  const normalized = output.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return normalized === "STOP" || normalized === "NO_SPEAKER";
}

function exactMention(text: string, name: string): boolean {
  if (text === name) return true;
  const variants = new Set([name, name.replace(/_/g, " "), name.replace(/_/g, "\\_")]);
  return [...variants].some((variant) => {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\w-])${escaped}([^\\w-]|$)`).test(text);
  });
}

function candidateList(candidates: readonly AssistedSelectorParticipant[]): string {
  return `[${candidates.map((candidate) => `'${candidate.agentId}'`).join(", ")}]`;
}
