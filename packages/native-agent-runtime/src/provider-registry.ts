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
  switch (modelConfig.provider) {
    case "openai":
      return createOpenAI({ apiKey, baseURL: modelConfig.base_url ?? undefined }).chatModel(modelConfig.model);
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: modelConfig.base_url ?? undefined }).chatModel(modelConfig.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL: modelConfig.base_url ?? undefined }).chatModel(modelConfig.model);
    case "openai-compatible":
      return createOpenAICompatible({ apiKey, baseURL: modelConfig.base_url ?? undefined }).chatModel(modelConfig.model);
    case "ollama":
      return createOpenAICompatible({ apiKey: "ollama", baseURL: modelConfig.base_url ?? "http://localhost:11434/v1" }).chatModel(modelConfig.model);
    default:
      throw new Error(`unsupported-provider:${modelConfig.provider}`);
  }
}
