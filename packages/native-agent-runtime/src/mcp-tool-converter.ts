import { jsonSchema, type ToolSet } from "ai";
import { randomUUID } from "node:crypto";

import type { AdapterBridge } from "../../orchestrator/src/index.ts";

export type McpToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};

export type McpToolResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } };

export type McpToolExecutor = (name: string, input: unknown) => Promise<McpToolResult>;

export function convertMcpToolsToAiSdkTools(
  mcpTools: readonly McpToolDefinition[],
  executeTool: McpToolExecutor,
  bridge: AdapterBridge
): ToolSet {
  const usedNames = new Set<string>();
  return Object.fromEntries(
    mcpTools.map((mcpTool) => {
      const aiSdkToolName = providerSafeToolName(mcpTool.name, usedNames);
      return [
        aiSdkToolName,
        {
          description: mcpTool.description,
          inputSchema: jsonSchema(mcpTool.inputSchema as never),
          execute: async (input: unknown) => {
            const toolCallId = randomUUID();
            bridge.handle({ type: "tool.call.requested", toolCallId, name: mcpTool.name, input });
            try {
              const result = await executeTool(mcpTool.name, input);
              if (result.ok) {
                bridge.handle({ type: "tool.call.completed", toolCallId, output: result.data, ok: true });
                return result.data;
              }
              bridge.handle({ type: "tool.call.completed", toolCallId, output: result.error, ok: false });
              return result.error;
            } catch (error) {
              const normalized = normalizeToolError(error);
              bridge.handle({ type: "tool.call.completed", toolCallId, output: normalized, ok: false });
              return normalized;
            }
          }
        }
      ];
    })
  ) satisfies ToolSet;
}

export function providerSafeToolName(name: string, usedNames: Set<string> = new Set()): string {
  const base = name.replace(/[^a-zA-Z0-9_-]+/gu, "_").replace(/_+/gu, "_").replace(/^_+|_+$/gu, "") || "tool";
  let candidate = base.slice(0, 64);
  let suffix = 2;
  while (usedNames.has(candidate)) {
    const suffixText = `_${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 64 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

export function normalizeToolError(error: unknown): { readonly code: string; readonly message: string; readonly details?: unknown } {
  if (error instanceof Error) {
    return { code: "tool_execution_failed", message: error.message };
  }
  return { code: "tool_execution_failed", message: String(error) };
}
