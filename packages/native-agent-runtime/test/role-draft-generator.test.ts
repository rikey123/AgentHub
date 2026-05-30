import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObjectMock = vi.hoisted(() => vi.fn());
const resolveProviderMock = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  generateObject: generateObjectMock,
  jsonSchema: (schema: unknown) => ({ kind: "json-schema", schema })
}));

vi.mock("../src/provider-registry.ts", () => ({
  resolveProvider: resolveProviderMock
}));

let generateRoleDraftWithModelConfig: typeof import("../src/role-draft-generator.ts").generateRoleDraftWithModelConfig;

beforeEach(async () => {
  generateObjectMock.mockReset();
  resolveProviderMock.mockReset();
  resolveProviderMock.mockReturnValue({ id: "resolved-role-model" });
  ({ generateRoleDraftWithModelConfig } = await import("../src/role-draft-generator.ts"));
});

describe("generateRoleDraftWithModelConfig", () => {
  it("resolves the configured provider and requests a structured role draft", async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        name: "Frontend Reviewer",
        description: "Reviews frontend refactors",
        prompt: "Review React changes.",
        capabilities: ["chat", "code.review"],
        suggestedPermissionProfileId: "perm-readonly"
      }
    });

    const draft = await generateRoleDraftWithModelConfig({
      modelConfig: { id: "mc-1", provider: "openai-compatible", model: "role-model", base_url: "https://models.example/v1", api_key_ref: "secret-ref" },
      apiKey: "secret-value",
      request: {
        description: "Create a reviewer for frontend refactors",
        targetWork: "code-review",
        preferredTone: "concise",
        capabilities: ["chat", "code.review"]
      }
    });

    expect(resolveProviderMock).toHaveBeenCalledWith({ id: "mc-1", provider: "openai-compatible", model: "role-model", base_url: "https://models.example/v1", api_key_ref: "secret-ref" }, "secret-value");
    expect(generateObjectMock).toHaveBeenCalledWith(expect.objectContaining({
      model: { id: "resolved-role-model" },
      schemaName: "RoleDraft",
      prompt: expect.stringContaining("Create a reviewer for frontend refactors")
    }));
    expect(draft).toEqual({
      name: "Frontend Reviewer",
      description: "Reviews frontend refactors",
      prompt: "Review React changes.",
      capabilities: ["chat", "code.review"],
      suggestedPermissionProfileId: "perm-readonly"
    });
  });

  it("throws json_parse_failure when the model output is not a complete role draft", async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        name: "Incomplete",
        description: "Missing prompt",
        capabilities: ["chat"]
      }
    });

    await expect(generateRoleDraftWithModelConfig({
      modelConfig: { id: "mc-1", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null },
      request: { description: "Create a reviewer", targetWork: null, preferredTone: null, capabilities: [] }
    })).rejects.toThrow("json_parse_failure");
  });

  it("throws json_parse_failure when suggestedPermissionProfileId is missing", async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        name: "Reviewer",
        description: "Reviews changes",
        prompt: "Review changes.",
        capabilities: ["chat"]
      }
    });

    await expect(generateRoleDraftWithModelConfig({
      modelConfig: { id: "mc-1", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null },
      request: { description: "Create a reviewer", targetWork: null, preferredTone: null, capabilities: [] }
    })).rejects.toThrow("json_parse_failure");
  });

  it("throws json_parse_failure when suggestedPermissionProfileId is blank", async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        name: "Reviewer",
        description: "Reviews changes",
        prompt: "Review changes.",
        capabilities: ["chat"],
        suggestedPermissionProfileId: ""
      }
    });

    await expect(generateRoleDraftWithModelConfig({
      modelConfig: { id: "mc-1", provider: "openai", model: "gpt-4o", base_url: null, api_key_ref: null },
      request: { description: "Create a reviewer", targetWork: null, preferredTone: null, capabilities: [] }
    })).rejects.toThrow("json_parse_failure");
  });
});
