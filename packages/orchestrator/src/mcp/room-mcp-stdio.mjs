#!/usr/bin/env node
/**
 * Standalone stdio MCP bridge for AgentHub's RoomMcpServer.
 * Spawned by ACP adapters and injected into Claude Code / opencode sessions.
 */
/* global Buffer */

import { readFileSync } from "node:fs";
import * as net from "node:net";
import * as readline from "node:readline";
import { URL } from "node:url";

const PORT = parseInt(process.env.ROOM_MCP_PORT ?? "", 10);
const TOKEN = process.env.ROOM_MCP_TOKEN ?? "";
const ROOM_ID = process.env.ROOM_MCP_ROOM_ID ?? "";
const RUN_ID = process.env.ROOM_MCP_RUN_ID ?? "";
const AGENT_ID = process.env.ROOM_MCP_AGENT_ID ?? "";
const SESSION_TOKEN = process.env.ROOM_MCP_SESSION_TOKEN ?? "";

if (!PORT || !TOKEN || !ROOM_ID || !AGENT_ID) {
  process.stderr.write("[room-mcp-stdio] Missing required env vars\n");
  process.exit(1);
}

const TOOLS = JSON.parse(readFileSync(new URL("./room-mcp-tools.json", import.meta.url), "utf8"));

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
      if (total < 4) return;
      const all = Buffer.concat(chunks);
      const bodyLen = all.readUInt32BE(0);
      if (total < 4 + bodyLen) return;
      try {
        finish(null, JSON.parse(all.subarray(4, 4 + bodyLen).toString("utf-8")));
      } catch (error) {
        finish(error);
      }
    });
    socket.on("end", () => finish(new Error("TCP connection ended before response")));
    socket.on("error", (err) => finish(err));
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(new Error("TCP request timeout")));
  });
}

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

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    respond(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments ?? {};
    if (!toolName) {
      respondError(id, -32602, "Missing tool name");
      return;
    }

    try {
      const response = await sendTcpRequest({
        auth_token: TOKEN,
        tool: toolName,
        args: toolArgs,
        room_id: ROOM_ID,
        ...(RUN_ID ? { run_id: RUN_ID } : {}),
        agent_id: AGENT_ID,
        ...(SESSION_TOKEN ? { session_token: SESSION_TOKEN } : {}),
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

  if (id !== undefined && id !== null) respondError(id, -32601, `Method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
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
