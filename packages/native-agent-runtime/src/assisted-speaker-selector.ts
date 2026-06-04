import { generateText, type LanguageModel } from "ai";

import type { AssistedSelectorRequest } from "@agenthub/orchestrator";

import { resolveProvider, type ModelConfigRow } from "./provider-registry.ts";

export type AssistedSpeakerSelectionInput = {
  readonly modelConfig: ModelConfigRow;
  readonly apiKey?: string;
  readonly request: AssistedSelectorRequest;
};

export async function selectAssistedSpeakerWithModelConfig(input: AssistedSpeakerSelectionInput): Promise<string | undefined> {
  const model = resolveProvider(input.modelConfig, input.apiKey) as LanguageModel;
  const result = await generateText({
    model,
    prompt: selectorPrompt(input.request)
  });
  return result.text.trim();
}

function selectorPrompt(request: AssistedSelectorRequest): string {
  const roles = request.participants
    .map((participant) => `- ${participant.name} (${participant.agentId}, ${participant.role}): ${participant.description ?? "No description provided."}`)
    .join("\n");
  const candidates = request.participants
    .map((participant) => `- ${participant.agentId} / ${participant.name}`)
    .join("\n");
  const feedback = request.feedback !== undefined
    ? ["", "Selector feedback from previous attempt:", request.feedback, `Attempt: ${request.attempt}`]
    : ["", `Attempt: ${request.attempt}`];
  return [
    "You are managing an AutoGen-style SelectorGroupChat for AgentHub assisted mode.",
    "",
    "First inspect the shared conversation history.",
    "Use the shared history like AutoGen's group chat message thread.",
    "Choose exactly one candidate whose role can add the most useful next contribution.",
    "Prefer a candidate who can respond to a concrete prior point, file, disagreement, or gap in the thread.",
    "Do not stop merely because the latest assistant message partially answers the user.",
    "During the early part of a user turn, choose another useful role when one can add a distinct perspective.",
    "A short one-or-two sentence contribution is valid; the next speaker does not need to write a full report.",
    "Do not choose a speaker just to keep the group going when every useful role has already contributed.",
    "If the latest turns are repeating the same stance, choose NO_SPEAKER so the primary facilitator can close.",
    "If there is already a clear conclusion or recommendation, choose NO_SPEAKER.",
    "",
    "Roles:",
    roles,
    "",
    "Conversation:",
    request.history,
    "",
    "Candidates:",
    candidates,
    "",
    request.previousSpeakerId !== undefined ? `Previous speaker: ${request.previousSpeakerId}` : "Previous speaker: none",
    ...feedback,
    "Choose exactly one candidate who should speak next.",
    "Return NO_SPEAKER if the conversation has an explicit closing synthesis, a clear conclusion, repeated turns without new information, every useful role has already contributed, or no candidate can add even a short useful reply.",
    "Return only the candidate id, candidate name, or NO_SPEAKER. Do not explain."
  ].join("\n");
}
