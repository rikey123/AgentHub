import roomMcpToolRegistry from "../../orchestrator/src/mcp/room-mcp-tools.json" with { type: "json" };

import type { McpToolDefinition } from "./mcp-tool-converter.ts";

export const roomMcpTools = roomMcpToolRegistry as readonly McpToolDefinition[];
