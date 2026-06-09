import { describe, expect, it, vi } from "vitest";
import {
  buildModelConfigPayload,
  createModelConfig,
  displayFingerprint,
  groupModelConfigsByProvider,
  normalizeModelConfigs,
  providerNeedsApiKey,
  testModelConfig
} from "./ModelsTab.tsx";

describe("ModelsTab REST integration contract", () => {
  it("groups model configs by provider and displays fingerprints without plaintext keys", () => {
    const configs = normalizeModelConfigs([
      {
        id: "mc_openai",
        name: "OpenAI production",
        provider: "openai",
        model: "gpt-4o",
        api_key_fingerprint: "sk-a...z9x1",
        apiKey: "sk-abc-secret-z9x1"
      },
      {
        id: "mc_ollama",
        name: "Local llama",
        provider: "ollama",
        model: "llama3.2",
        base_url: "http://localhost:11434/v1",
        api_key_fingerprint: null
      }
    ]);

    const groups = groupModelConfigsByProvider(configs);

    expect(groups.openai.map((config) => config.id)).toEqual(["mc_openai"]);
    expect(groups.ollama.map((config) => config.id)).toEqual(["mc_ollama"]);
    expect(displayFingerprint(groups.openai[0]!.api_key_fingerprint)).toBe("sk-a...z9x1");
    expect(displayFingerprint(groups.ollama[0]!.api_key_fingerprint)).toBe("无 API 密钥");
    expect(JSON.stringify(configs)).not.toContain("sk-abc-secret-z9x1");
  });

  it("adds an OpenAI model through REST and keeps only the returned fingerprint", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("/model-configs");
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("same-origin");
      expect(JSON.parse(String(init?.body))).toEqual({
        provider: "openai",
        name: "OpenAI production",
        model: "gpt-4o",
        apiKey: "sk-abc-secret-z9x1"
      });

      return jsonResponse(201, {
        modelConfig: {
          id: "mc_openai",
          name: "OpenAI production",
          provider: "openai",
          model: "gpt-4o",
          api_key_fingerprint: "sk-a...z9x1"
        }
      });
    });

    const saved = await createModelConfig(fetchImpl, {
      mode: "add",
      provider: "openai",
      name: "OpenAI production",
      model: "gpt-4o",
      apiKey: "sk-abc-secret-z9x1",
      baseUrl: ""
    });

    expect(saved).toEqual({
      id: "mc_openai",
      name: "OpenAI production",
      provider: "openai",
      model: "gpt-4o",
      base_url: null,
      api_key_fingerprint: "sk-a...z9x1"
    });
    expect(JSON.stringify(saved)).not.toContain("sk-abc-secret-z9x1");
  });

  it("builds Ollama payloads with baseURL and no API key", () => {
    expect(providerNeedsApiKey("ollama")).toBe(false);

    const customPayload = buildModelConfigPayload({
      mode: "add",
      provider: "ollama",
      name: "Local llama",
      model: "llama3.2",
      apiKey: "should-not-send",
      baseUrl: "http://localhost:11434/v1"
    });

    expect(customPayload).toEqual({
      provider: "ollama",
      name: "Local llama",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1"
    });
    expect(customPayload).not.toHaveProperty("apiKey");

    expect(
      buildModelConfigPayload({
        mode: "add",
        provider: "ollama",
        name: "Default local llama",
        model: "llama3.2",
        apiKey: "should-not-send",
        baseUrl: ""
      })
    ).toEqual({
      provider: "ollama",
      name: "Default local llama",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1"
    });
  });

  it("tests model calls through REST success, failure, and job polling without EventBus", async () => {
    const previousEventSource = globalThis.EventSource;
    const eventSourceSpy = vi.fn();
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      writable: true,
      value: eventSourceSpy
    });

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = String(input);
      if (path === "/model-configs/mc_success/test") {
        return jsonResponse(200, {
          ok: true,
          model: "gpt-4o",
          latencyMs: 23,
          inputTokens: 1,
          outputTokens: 1
        });
      }
      if (path === "/model-configs/mc_fail/test") {
        return jsonResponse(400, { ok: false, error: "invalid_api_key" });
      }
      if (path === "/model-configs/mc_poll/test") {
        return jsonResponse(202, { jobId: "job_1" });
      }
      if (path === "/settings/jobs/job_1") {
        return jsonResponse(200, {
          job: {
            status: "completed",
            result: { ok: true, model: "llama3.2", latencyMs: 12, inputTokens: 1, outputTokens: 1 }
          }
        });
      }
      return jsonResponse(404, { error: "not_found" });
    });

    await expect(testModelConfig(fetchImpl, "mc_success")).resolves.toMatchObject({
      ok: true,
      model: "gpt-4o"
    });
    await expect(testModelConfig(fetchImpl, "mc_fail")).resolves.toEqual({
      ok: false,
      error: "invalid_api_key"
    });
    await expect(testModelConfig(fetchImpl, "mc_poll")).resolves.toMatchObject({
      ok: true,
      model: "llama3.2"
    });

    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
      "/model-configs/mc_success/test",
      "/model-configs/mc_fail/test",
      "/model-configs/mc_poll/test",
      "/settings/jobs/job_1"
    ]);
    expect(eventSourceSpy).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      writable: true,
      value: previousEventSource
    });
  });
});

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}
