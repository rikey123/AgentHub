import type { McpToolDefinition } from "./mcp-tool-converter.ts";

export const roomMcpTools: readonly McpToolDefinition[] = [
  {
    name: "room.create_task",
    description: "Create a task in the current room.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        parentTaskId: { type: "string" },
        description: { type: "string" },
        assigneeAgentId: { type: "string" },
        dependencies: { type: "array", items: { type: "string" } },
        priority: { type: "string" },
        dueAt: { type: "number" },
        idempotencyKey: { type: "string" }
      },
      required: ["title"],
      additionalProperties: true
    }
  },
  {
    name: "room.update_task",
    description: "Update the status of an existing task in the current room.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        status: { type: "string" },
        reason: { type: "string" },
        idempotencyKey: { type: "string" }
      },
      required: ["taskId", "status"],
      additionalProperties: true
    }
  },
  {
    name: "room.list_tasks",
    description: "List the tasks in the current room.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true
    }
  },
  {
    name: "room.read_mailbox",
    description: "Read mailbox messages for the current run.",
    inputSchema: {
      type: "object",
      properties: {
        deliveryBatchId: { type: "string" }
      },
      additionalProperties: true
    }
  },
  {
    name: "room.send_message",
    description: "Send a message into the current room.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        idempotencyKey: { type: "string" }
      },
      required: ["text"],
      additionalProperties: true
    }
  },
  {
    name: "room.list_members",
    description: "List the room members, including roleId values that can be used as room.delegate toRoleId targets.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: true
    }
  },
  {
    name: "room.delegate",
    description: "Leader-only: delegate work to a teammate role. Creates and wakes a Task atomically, or dispatches an existing pending backlog task when taskId is provided.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Existing pending task to dispatch from the backlog." },
        toRoleId: { type: "string", description: "Target teammate role id from room.list_members." },
        title: { type: "string", description: "Task title when creating a new delegated task." },
        description: { type: "string" },
        parentTaskId: { type: "string" },
        expectsReview: { type: "boolean" }
      },
      anyOf: [
        { required: ["taskId"] },
        { required: ["toRoleId", "title"] }
      ],
      additionalProperties: true
    }
  },
  {
    name: "file.read",
    description: "Read the contents of a file in the workspace",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file within the workspace" }
      },
      required: ["path"]
    }
  },
  {
    name: "file.write",
    description: "Write content to a file in the workspace (requires permission approval)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file within the workspace" },
        content: { type: "string", description: "Content to write to the file" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "shell",
    description: "Execute a shell command in the workspace (requires permission approval)",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        cwd: { type: "string", description: "Working directory for the command (optional)" }
      },
      required: ["command"]
    }
  },
  {
    name: "room.spawn_agent",
    description: "Spawn a new agent in the room.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        adapterId: { type: "string" },
        model: { type: "string" }
      },
      required: ["name"],
      additionalProperties: true
    }
  }
] as const;
