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
    "You are selecting the next speaker in an AgentHub assisted group chat.",
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
    "Return NO_SPEAKER only if the group should stop because the conversation is complete or no candidate should reply.",
    "Return only the candidate id, candidate name, or NO_SPEAKER. Do not explain."
  ].join("\n");
}
