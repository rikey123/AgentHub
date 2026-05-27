#!/usr/bin/env node
/**
 * room-mcp-stdio.mjs
 *
 * Standalone stdio MCP bridge for AgentHub's RoomMcpServer.
 * Spawned by the ACP adapter as a child process; injected into Claude Code /
 * opencode via session/new mcpServers[].
 *
 * Protocol: MCP (JSON-RPC 2.0 over stdio, newline-delimited).
 * Transport: proxies every tool call to the daemon's RoomMcpServer via TCP
 *            using 4-byte big-endian length-prefixed JSON frames.
 *
 * Environment variables (set by RoomMcpServer.getStdioConfig):
 *   ROOM_MCP_PORT    - TCP port of the daemon's RoomMcpServer
 *   ROOM_MCP_TOKEN   - auth token (UUID)
 *   ROOM_MCP_ROOM_ID - room context
 *   ROOM_MCP_RUN_ID  - run context
 *   ROOM_MCP_AGENT_ID - agent context
 */

import * as net from "node:net";
import * as readline from "node:readline";

const PORT = parseInt(process.env.ROOM_MCP_PORT ?? "", 10);
const TOKEN = process.env.ROOM_MCP_TOKEN ?? "";
const ROOM_ID = process.env.ROOM_MCP_ROOM_ID ?? "";
const RUN_ID = process.env.ROOM_MCP_RUN_ID ?? "";
const AGENT_ID = process.env.ROOM_MCP_AGENT_ID ?? "";

if (!PORT || !TOKEN || !ROOM_ID || !RUN_ID || !AGENT_ID) {
  process.stderr.write("[room-mcp-stdio] Missing required env vars\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// TCP helpers (inline — no external deps)
// ---------------------------------------------------------------------------

function writeTcpMessage(socket, data) {
  const body = Buffer.from(JSON.stringify(data), "utf-8");
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  socket.write(frame);
}

function sendTcpRequest(data, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection({ host: "127.0.0.1", port: PORT }, () => {
      writeTcpMessage(socket, data);
    });
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };

    const chunks = [];
    let total = 0;
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= 4) {
        const first = chunks[0];
        let bodyLen;
        if (first.length >= 4) {
          bodyLen = first.readUInt32BE(0);
        } else {
          const header = Buffer.allocUnsafe(4);
          let filled = 0;
          for (const c of chunks) {
            const copy = Math.min(c.length, 4 - filled);
            c.copy(header, filled, 0, copy);
            filled += copy;
            if (filled >= 4) break;
          }
          bodyLen = header.readUInt32BE(0);
        }
        if (total >= 4 + bodyLen) {
          const all = Buffer.concat(chunks);
          try { finish(null, JSON.parse(all.subarray(4, 4 + bodyLen).toString("utf-8"))); }
          catch (e) { finish(e); }
        }
      }
    });
    socket.on("end", () => finish(new Error("TCP connection ended before response")));
    socket.on("error", (err) => finish(err));
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(new Error("TCP request timeout")));
  });
}

// ---------------------------------------------------------------------------
// MCP tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "room.list_members",
    description: "List all agents currently in this room with their role, presence, and @slug.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "room.send_message",
    description: "Send a message to one or more agents in the room. Use @slug to mention specific agents. In assisted/team rooms this routes directly to the mentioned agent's mailbox and wakes them.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Message text. Use @slug to mention agents." },
        idempotencyKey: { type: "string", description: "Optional idempotency key." },
      },
      required: ["text"],
    },
  },
  {
    name: "room.read_mailbox",
    description: "Read messages and queued next-turn inputs delivered to this run. The run identity is injected by AgentHub; agents cannot read another run's mailbox.",
    inputSchema: {
      type: "object",
      properties: {
        deliveryBatchId: { type: "string", description: "Optional idempotency key. Reusing it returns the same batch." },
      },
      required: [],
    },
  },
  {
    name: "room.spawn_agent",
    description: "Create a new teammate agent in this room. Leader-only. Requires prior user approval — propose the lineup first, then call this after confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name for the new agent." },
        adapterId: { type: "string", description: "Adapter type: claude-code, opencode, or mock." },
        model: { type: "string", description: "Optional model ID." },
        rolePrompt: { type: "string", description: "Role prompt / system instructions for the new agent." },
        capabilities: { type: "array", items: { type: "string" }, description: "Capability list." },
      },
      required: ["name"],
    },
  },
  {
    name: "room.list_tasks",
    description: "List all tasks on the room's task board.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "room.create_task",
    description: "Create a new task on the room's task board.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        assigneeAgentId: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["title"],
    },
  },
  {
    name: "room.update_task",
    description: "Update the status of a task on the room's task board.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
        reason: { type: "string" },
      },
      required: ["taskId", "status"],
    },
  },
];

// ---------------------------------------------------------------------------
// MCP JSON-RPC 2.0 over stdio
// ---------------------------------------------------------------------------

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleRequest(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    respond(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "agenthub-room", version: "1.0.0" },
    });
    return;
  }

  if (method === "notifications/initialized") return; // no response needed

  if (method === "tools/list") {
    respond(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments ?? {};
    if (!toolName) { respondError(id, -32602, "Missing tool name"); return; }

    try {
      const response = await sendTcpRequest({
        auth_token: TOKEN,
        tool: toolName,
        args: toolArgs,
        room_id: ROOM_ID,
        run_id: RUN_ID,
        agent_id: AGENT_ID,
        ...(jsonRpcRequestId(id) !== undefined ? { mcp_request_id: jsonRpcRequestId(id) } : {}),
      });

      if (response && typeof response === "object" && "error" in response) {
        respond(id, {
          content: [{ type: "text", text: `Error: ${response.error}` }],
          isError: true,
        });
      } else {
        const result = response?.result ?? response;
        respond(id, {
          content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
        });
      }
    } catch (err) {
      respond(id, {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      });
    }
    return;
  }

  if (method === "ping") {
    respond(id, {});
    return;
  }

  // Unknown method
  if (id !== undefined && id !== null) {
    respondError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); } catch { return; }
  void handleRequest(req);
});

rl.on("close", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

function jsonRpcRequestId(id) {
  if (typeof id === "string" && id.length > 0) return id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return undefined;
}
