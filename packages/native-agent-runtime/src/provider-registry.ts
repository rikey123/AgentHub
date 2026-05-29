import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export type ModelConfigRow = {
  id: string;
  provider: string;
  model: string;
  base_url?: string | null;
  api_key_ref?: string | null;
};

export function resolveProvider(modelConfig: ModelConfigRow, apiKey?: string): LanguageModel {
  const baseURL = modelConfig.base_url ?? undefined;
  switch (modelConfig.provider) {
    case "openai": {
      const p = createOpenAI({ ...(apiKey !== undefined ? { apiKey } : {}), ...(baseURL !== undefined ? { baseURL } : {}) });
      return p.languageModel(modelConfig.model) as unknown as LanguageModel;
    }
    case "anthropic": {
      const p = createAnthropic({ ...(apiKey !== undefined ? { apiKey } : {}), ...(baseURL !== undefined ? { baseURL } : {}) });
      return p.languageModel(modelConfig.model) as unknown as LanguageModel;
    }
    case "google": {
      const p = createGoogleGenerativeAI({ ...(apiKey !== undefined ? { apiKey } : {}), ...(baseURL !== undefined ? { baseURL } : {}) });
      return p.languageModel(modelConfig.model) as unknown as LanguageModel;
    }
    case "openai-compatible": {
      const p = createOpenAICompatible({ name: "native-agent-runtime", baseURL: baseURL ?? "http://localhost:11434/v1", ...(apiKey !== undefined ? { apiKey } : {}) });
      return p.languageModel(modelConfig.model) as unknown as LanguageModel;
    }
    case "ollama": {
      const p = createOpenAICompatible({ name: "ollama", apiKey: "ollama", baseURL: baseURL ?? "http://localhost:11434/v1" });
      return p.languageModel(modelConfig.model) as unknown as LanguageModel;
    }
    default:
      throw new Error(`unsupported-provider:${modelConfig.provider}`);
  }
}
