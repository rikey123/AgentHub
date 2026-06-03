import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeHandle = vi.fn();

vi.mock("../../orchestrator/src/index.ts", () => ({
  AdapterBridge: class {
    handle = bridgeHandle;
  }
}));

let convertMcpToolsToAiSdkTools: typeof import("../src/mcp-tool-converter.ts").convertMcpToolsToAiSdkTools;
let roomMcpTools: typeof import("../src/room-mcp-tools.ts").roomMcpTools;

beforeEach(async () => {
  bridgeHandle.mockReset();
  ({ convertMcpToolsToAiSdkTools } = await import("../src/mcp-tool-converter.ts"));
  ({ roomMcpTools } = await import("../src/room-mcp-tools.ts"));
});

describe("convertMcpToolsToAiSdkTools", () => {
  it("converts MCP tool metadata into AI SDK tools and emits bridge events", async () => {
    const toolSet = convertMcpToolsToAiSdkTools(
      [{ name: "room.list_tasks", description: "List tasks", inputSchema: { type: "object", properties: {}, additionalProperties: true } }],
      async () => ({ ok: true, data: { tasks: [] } }),
      new (class { handle = bridgeHandle; })() as never
    );

    expect(toolSet["room_list_tasks"]!.inputSchema).toHaveProperty("jsonSchema");
    expect(toolSet["room.list_tasks"]).toBeUndefined();
    await toolSet["room_list_tasks"]!.execute?.({}, {} as never);

    expect(bridgeHandle).toHaveBeenCalledWith(expect.objectContaining({ type: "tool.call.requested", name: "room.list_tasks" }));
    expect(bridgeHandle).toHaveBeenCalledWith(expect.objectContaining({ type: "tool.call.completed", ok: true, output: { tasks: [] } }));
  });

  it("surfaces tool errors through the bridge without crashing the run", async () => {
    const toolSet = convertMcpToolsToAiSdkTools(
      [{ name: "room.create_task", description: "Create task", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: true } }],
      async () => ({ ok: false, error: { code: "validation_failed", message: "title is required" } }),
      new (class { handle = bridgeHandle; })() as never
    );

    await expect(toolSet["room_create_task"]!.execute?.({ title: "" }, {} as never)).resolves.toEqual({ code: "validation_failed", message: "title is required" });

    expect(bridgeHandle).toHaveBeenCalledWith(expect.objectContaining({ type: "tool.call.completed", ok: false, output: { code: "validation_failed", message: "title is required" } }));
    expect(bridgeHandle).toHaveBeenCalledTimes(2);
  });

  it("exposes room.delegate to native agents as a provider-safe tool", () => {
    const toolSet = convertMcpToolsToAiSdkTools(
      roomMcpTools,
      async () => ({ ok: true, data: {} }),
      new (class { handle = bridgeHandle; })() as never
    );

    expect(toolSet.room_delegate).toBeDefined();
    expect(toolSet.room_delegate?.description).toContain("delegate");
    expect(toolSet.room_delegate?.inputSchema).toHaveProperty("jsonSchema", expect.objectContaining({
      properties: expect.objectContaining({
        taskId: expect.any(Object),
        toRoleId: expect.any(Object),
        title: expect.any(Object)
      })
    }));
    expect(toolSet.room_delegate?.inputSchema).not.toHaveProperty("jsonSchema.anyOf");
  });

  it("exposes every mature room MCP tool needed by native agents", () => {
    const names = new Set(roomMcpTools.map((tool) => tool.name));

    expect([...names].sort()).toEqual(expect.arrayContaining([
      "file.apply_patch",
      "file.edit",
      "file.glob",
      "file.grep",
      "file.list",
      "file.read",
      "file.write",
      "room.add_participant",
      "room.apply_worktree",
      "room.clear_blocker",
      "room.complete_task",
      "room.describe_role",
      "room.discard_worktree",
      "room.get_board",
      "room.list_blockers",
      "room.list_models",
      "room.list_runtimes",
      "room.list_skills",
      "room.load_skill",
      "room.move_task",
      "room.query_tasks",
      "room.review",
      "room.set_blocker",
      "room.standup",
      "shell",
      "todo.write"
    ]));
  });
});
