import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeHandle = vi.fn();

vi.mock("../../orchestrator/src/index.ts", () => ({
  AdapterBridge: class {
    handle = bridgeHandle;
  }
}));

let convertMcpToolsToAiSdkTools: typeof import("../src/mcp-tool-converter.ts").convertMcpToolsToAiSdkTools;

beforeEach(async () => {
  bridgeHandle.mockReset();
  ({ convertMcpToolsToAiSdkTools } = await import("../src/mcp-tool-converter.ts"));
});

describe("convertMcpToolsToAiSdkTools", () => {
  it("converts MCP tool metadata into AI SDK tools and emits bridge events", async () => {
    const toolSet = convertMcpToolsToAiSdkTools(
      [{ name: "room.list_tasks", description: "List tasks", inputSchema: { type: "object", properties: {}, additionalProperties: true } }],
      async () => ({ ok: true, data: { tasks: [] } }),
      new (class { handle = bridgeHandle; })() as never
    );

    await toolSet["room.list_tasks"]!.execute?.({}, {} as never);

    expect(bridgeHandle).toHaveBeenCalledWith(expect.objectContaining({ type: "tool.call.requested", name: "room.list_tasks" }));
    expect(bridgeHandle).toHaveBeenCalledWith(expect.objectContaining({ type: "tool.call.completed", ok: true, output: { tasks: [] } }));
  });

  it("surfaces tool errors through the bridge without crashing the run", async () => {
    const toolSet = convertMcpToolsToAiSdkTools(
      [{ name: "room.create_task", description: "Create task", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: true } }],
      async () => ({ ok: false, error: { code: "validation_failed", message: "title is required" } }),
      new (class { handle = bridgeHandle; })() as never
    );

    await expect(toolSet["room.create_task"]!.execute?.({ title: "" }, {} as never)).resolves.toEqual({ code: "validation_failed", message: "title is required" });

    expect(bridgeHandle).toHaveBeenCalledWith(expect.objectContaining({ type: "tool.call.completed", ok: false, output: { code: "validation_failed", message: "title is required" } }));
    expect(bridgeHandle).toHaveBeenCalledTimes(2);
  });
});
