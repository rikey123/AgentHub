import { generateObject, jsonSchema, type LanguageModel } from "ai";

import { resolveProvider, type ModelConfigRow } from "./provider-registry.ts";

export type RoleDraft = {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly capabilities: readonly string[];
  readonly suggestedPermissionProfileId: string | null;
};

export type RoleDraftRequest = {
  readonly description: string;
  readonly targetWork: string | null;
  readonly preferredTone: string | null;
  readonly capabilities: readonly string[];
};

export type RoleDraftGenerationInput = {
  readonly modelConfig: ModelConfigRow;
  readonly apiKey?: string;
  readonly request: RoleDraftRequest;
};

const roleDraftSchema = jsonSchema({
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "prompt", "capabilities", "suggestedPermissionProfileId"],
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    prompt: { type: "string", minLength: 1 },
    capabilities: { type: "array", items: { type: "string" } },
    suggestedPermissionProfileId: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] }
  }
});

export async function generateRoleDraftWithModelConfig(input: RoleDraftGenerationInput): Promise<RoleDraft> {
  const model = resolveProvider(input.modelConfig, input.apiKey) as LanguageModel;
  const result = await generateObject({
    model,
    schema: roleDraftSchema,
    schemaName: "RoleDraft",
    prompt: roleDraftPrompt(input.request)
  });
  return normalizeRoleDraft(result.object);
}

function roleDraftPrompt(request: RoleDraftRequest): string {
  return [
    "Generate a user-facing AgentHub RoleDraft as strict JSON.",
    "Return only fields that match the provided schema.",
    `Description: ${request.description}`,
    `Target work: ${request.targetWork ?? "not specified"}`,
    `Preferred tone: ${request.preferredTone ?? "not specified"}`,
    `Requested capabilities: ${request.capabilities.length > 0 ? request.capabilities.join(", ") : "chat"}`,
    "The prompt must be directly usable as a role system prompt and should not mention implementation details of this generation request.",
    "suggestedPermissionProfileId should be a known profile id only when one is clearly implied; otherwise null."
  ].join("\n");
}

function normalizeRoleDraft(value: unknown): RoleDraft {
  if (value === null || typeof value !== "object") throw new Error("json_parse_failure");
  const row = value as Record<string, unknown>;
  const name = stringField(row.name);
  const description = stringField(row.description);
  const prompt = stringField(row.prompt);
  const capabilities = Array.isArray(row.capabilities) ? row.capabilities.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  if (!Object.hasOwn(row, "suggestedPermissionProfileId")) throw new Error("json_parse_failure");
  let suggestedPermissionProfileId: string | null;
  if (row.suggestedPermissionProfileId === null) {
    suggestedPermissionProfileId = null;
  } else {
    const profileId = stringField(row.suggestedPermissionProfileId);
    if (profileId === undefined) throw new Error("json_parse_failure");
    suggestedPermissionProfileId = profileId;
  }
  if (name === undefined || description === undefined || prompt === undefined || !Array.isArray(row.capabilities)) throw new Error("json_parse_failure");
  return { name, description, prompt, capabilities, suggestedPermissionProfileId };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
