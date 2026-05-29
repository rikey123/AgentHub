import { beforeEach, describe, expect, it, vi } from "vitest";

const openaiFactory = vi.hoisted(() => vi.fn());
const anthropicFactory = vi.hoisted(() => vi.fn());
const googleFactory = vi.hoisted(() => vi.fn());
const openaiCompatibleFactory = vi.hoisted(() => vi.fn());

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: openaiFactory
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: anthropicFactory
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: googleFactory
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: openaiCompatibleFactory
}));

type ProviderKind = "openai" | "anthropic" | "google" | "openai-compatible" | "ollama";

let resolveProvider: typeof import("../src/provider-registry.ts").resolveProvider;

beforeEach(async () => {
  openaiFactory.mockReset();
  anthropicFactory.mockReset();
  googleFactory.mockReset();
  openaiCompatibleFactory.mockReset();

  const model = { languageModel: vi.fn((name: string) => ({ kind: "model", name })) };
  openaiFactory.mockReturnValue(model);
  anthropicFactory.mockReturnValue(model);
  googleFactory.mockReturnValue(model);
  openaiCompatibleFactory.mockReturnValue(model);

  ({ resolveProvider } = await import("../src/provider-registry.ts"));
});

describe("resolveProvider", () => {
  it.each<ProviderKind>(["openai", "anthropic", "google", "openai-compatible", "ollama"])("resolves %s to an explicit model instance", (provider) => {
    const modelConfig = {
      id: "mc-1",
      provider,
      model: "gpt-4o",
      base_url: provider === "ollama" ? null : "https://example.invalid/v1",
      api_key_ref: null
    };

    const resolved = resolveProvider(modelConfig, "test-key");

    expect(resolved).toEqual({ kind: "model", name: "gpt-4o" });
    if (provider === "openai") expect(openaiFactory).toHaveBeenCalledWith({ apiKey: "test-key", baseURL: "https://example.invalid/v1" });
    if (provider === "anthropic") expect(anthropicFactory).toHaveBeenCalledWith({ apiKey: "test-key", baseURL: "https://example.invalid/v1" });
    if (provider === "google") expect(googleFactory).toHaveBeenCalledWith({ apiKey: "test-key", baseURL: "https://example.invalid/v1" });
    if (provider === "openai-compatible") expect(openaiCompatibleFactory).toHaveBeenCalledWith({ name: "native-agent-runtime", apiKey: "test-key", baseURL: "https://example.invalid/v1" });
    if (provider === "ollama") expect(openaiCompatibleFactory).toHaveBeenCalledWith({ name: "ollama", apiKey: "ollama", baseURL: "http://localhost:11434/v1" });
  });

  it("throws a deterministic unsupported provider error", () => {
    expect(() => resolveProvider({ id: "mc-unsupported", provider: "unsupported", model: "gpt-4o", base_url: null, api_key_ref: null }, "test-key")).toThrow("unsupported-provider:unsupported");
  });
});
