import { generateObject, jsonSchema, type LanguageModel, type RepairTextFunction } from "ai";

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
    experimental_repairText: repairRoleDraftText,
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
  const name = stringField(row.name) ?? stringField(row.title);
  const description = stringField(row.description);
  const prompt = stringField(row.prompt) ?? stringField(row.systemPrompt) ?? stringField(row.system_prompt);
  const capabilities = roleCapabilities(row.capabilities);
  const permissionValue = permissionProfileField(row);
  if (permissionValue === undefined) throw new Error("json_parse_failure");
  let suggestedPermissionProfileId: string | null;
  if (permissionValue === null) {
    suggestedPermissionProfileId = null;
  } else {
    const profileId = stringField(permissionValue);
    if (profileId === undefined) throw new Error("json_parse_failure");
    suggestedPermissionProfileId = profileId;
  }
  if (name === undefined || description === undefined || prompt === undefined) throw new Error("json_parse_failure");
  return { name, description, prompt, capabilities, suggestedPermissionProfileId };
}

const repairRoleDraftText: RepairTextFunction = async ({ text }) => {
  const jsonText = extractFirstJsonObject(text);
  if (jsonText === undefined) return null;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    const repaired = {
      name: stringField(row.name) ?? stringField(row.title) ?? "Generated Role",
      description: stringField(row.description) ?? stringField(row.summary) ?? "AI generated role",
      prompt: stringField(row.prompt) ?? stringField(row.systemPrompt) ?? stringField(row.system_prompt) ?? "",
      capabilities: roleCapabilities(row.capabilities),
      suggestedPermissionProfileId: permissionProfileField(row) ?? null
    };
    if (repaired.prompt.length === 0) return null;
    return JSON.stringify(repaired);
  } catch {
    return null;
  }
};

function extractFirstJsonObject(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const source = fenced?.[1] ?? text;
  const start = source.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return undefined;
}

function permissionProfileField(row: Record<string, unknown>): unknown {
  if (Object.hasOwn(row, "suggestedPermissionProfileId")) return row.suggestedPermissionProfileId;
  if (Object.hasOwn(row, "permissionProfileId")) return row.permissionProfileId;
  if (Object.hasOwn(row, "suggested_permission_profile_id")) return row.suggested_permission_profile_id;
  if (Object.hasOwn(row, "permission_profile_id")) return row.permission_profile_id;
  return undefined;
}

function roleCapabilities(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (typeof value === "string" && value.trim().length > 0) return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  return ["chat"];
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
