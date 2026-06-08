#!/usr/bin/env node
import { spawn } from "node:child_process";
import readline from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const runtimeKind = process.env.AGENTHUB_FAKE_ACP_KIND ?? "claude-code";
let serverSessionId = `fake-${runtimeKind}-session`;
let roomMcpServer;

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (line.trim().length === 0) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  void handle(message);
});

async function handle(message) {
  if (message.method === "initialize") {
    respond(message.id, { protocolVersion: 1, authMethods: [] });
    return;
  }

  if (message.method === "session/new") {
    serverSessionId = `fake-${runtimeKind}-${Date.now()}`;
    roomMcpServer = Array.isArray(message.params?.mcpServers) ? message.params.mcpServers[0] : undefined;
    respond(message.id, { sessionId: serverSessionId });
    return;
  }

  if (message.method === "session/prompt") {
    const promptText = promptTextFrom(message.params?.prompt);
    if (promptText.includes("AGENTHUB_E2E_UPDATE_EXISTING_ARTIFACT")) {
      const artifactId = /@artifact:([A-Za-z0-9._:-]+)/u.exec(promptText)?.[1];
      if (artifactId === undefined) throw new Error("Missing artifact id in update-existing prompt");
      await callRoomTool("room.publish_artifact", {
        artifactId,
        kind: "web_page",
        filename: "agent-updated.html",
        title: "Agent Updated Artifact",
        content: "<main><h1>Agent updated version</h1><p>Updated through fake ACP Room MCP.</p></main>",
        message: "agent runtime update"
      });
    } else if (promptText.includes("AGENTHUB_E2E_USE_PINNED_CONTEXT")) {
      const includesPinnedMarker = promptText.includes("PINNED-RUNTIME-CONTEXT-42");
      await callRoomTool("room.publish_artifact", {
        kind: "document",
        filename: "pinned-context-result.md",
        title: "Pinned Context Result",
        content: `# Pinned context result\n\n${includesPinnedMarker ? "Used pinned context PINNED-RUNTIME-CONTEXT-42." : "Pinned context missing."}`
      });
    } else {
      const artifactKind = runtimeKind === "opencode" ? "document" : "web_page";
      const filename = runtimeKind === "opencode" ? "runtime-acceptance.md" : "runtime-acceptance.html";
      const title = runtimeKind === "opencode" ? "OpenCode Runtime Document" : "Claude Runtime Page";
      const content = runtimeKind === "opencode"
        ? "# Runtime acceptance\n\nOpenCode produced this document through Room MCP."
        : "<main><h1>Claude runtime acceptance</h1></main>";
      await callRoomTool("room.publish_artifact", { kind: artifactKind, filename, title, content });
    }
    respond(message.id, { stopReason: "completed", modelId: `fake-${runtimeKind}`, usage: { inputTokens: 1, outputTokens: 1 } });
    return;
  }

  if (message.method === "protocol/ping") {
    respond(message.id, {});
    return;
  }

  if (message.method === "session/end" || message.method === "session/cancel") {
    respond(message.id, {});
    process.exit(0);
  }

  if (message.id !== undefined) respondError(message.id, -32601, `Method not found: ${message.method}`);
}

async function callRoomTool(name, args) {
  if (roomMcpServer === undefined) throw new Error("Room MCP server was not provided");
  const child = spawn(roomMcpServer.command, roomMcpServer.args ?? [], {
    env: { ...process.env, ...envObject(roomMcpServer.env) },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  const lines = readline.createInterface({ input: child.stdout, terminal: false });
  const responses = new Map();
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined) responses.set(String(message.id), message);
    } catch {
      // ignore non-JSON output from the bridge
    }
  });

  await sendMcp(child, responses, "initialize", { protocolVersion: "2024-11-05" });
  const result = await sendMcp(child, responses, "tools/call", { name, arguments: args });
  child.stdin.end();
  child.kill();
  if (result.error !== undefined || result.result?.isError === true) {
    throw new Error(JSON.stringify(result.error ?? result.result));
  }
}

function sendMcp(child, responses, method, params) {
  const id = `${method}-${Date.now()}-${Math.random()}`;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return waitFor(() => responses.get(id));
}

async function waitFor(read) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await sleep(10);
  }
  throw new Error("Timed out waiting for MCP response");
}

function envObject(envArray) {
  const env = {};
  if (!Array.isArray(envArray)) return env;
  for (const item of envArray) {
    if (typeof item?.name === "string" && typeof item?.value === "string") env[item.name] = item.value;
  }
  return env;
}

function promptTextFrom(prompt) {
  if (!Array.isArray(prompt)) return "";
  return prompt
    .map((block) => typeof block?.text === "string" ? block.text : "")
    .join("\n");
}

function respond(id, result) {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id, code, message) {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}
