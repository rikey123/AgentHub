import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { describe, expect, test } from "vitest";

import { roomMcpTools } from "../../native-agent-runtime/src/room-mcp-tools.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const bridgePath = resolve(repoRoot, "packages/orchestrator/src/mcp/room-mcp-stdio.mjs");

describe("Room MCP tool registry", () => {
  test("stdio bridge exposes the same tool names as native runtime", async () => {
    const listed = await listStdioToolNames();
    const native = roomMcpTools.map((tool) => tool.name).sort();

    expect(listed).toEqual(native);
  });
});

function listStdioToolNames(): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [bridgePath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ROOM_MCP_PORT: "1",
        ROOM_MCP_TOKEN: "token",
        ROOM_MCP_ROOM_ID: "room_1",
        ROOM_MCP_AGENT_ID: "agent_1",
        ROOM_MCP_SESSION_TOKEN: "session_token"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("timed out waiting for tools/list"));
    }, 5_000);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/u).filter((line) => line.trim().length > 0);
      for (const line of lines) {
        const parsed = JSON.parse(line) as { readonly id?: number; readonly result?: { readonly tools?: readonly { readonly name: string }[] } };
        if (parsed.id === 1 && Array.isArray(parsed.result?.tools)) {
          clearTimeout(timeout);
          child.kill();
          resolvePromise(parsed.result.tools.map((tool) => tool.name).sort());
          return;
        }
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      if (code !== null && code !== 0 && stdout.length === 0) {
        clearTimeout(timeout);
        reject(new Error(`room-mcp-stdio exited ${code}: ${stderr}`));
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
  });
}
