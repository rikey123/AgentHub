import { describe, expect, it } from "vitest";

import { daemonWorkspaceRoot } from "../src/commands/daemon.ts";
import { runCli } from "../src/index.ts";

describe("agenthub cli", () => {
  it("resolves daemon start workspace from the caller cwd preserved by the global shim", () => {
    expect(daemonWorkspaceRoot(["start"], { AGENTHUB_CALLER_CWD: "C:\\project\\test" }, "C:\\project\\AgentHub")).toBe("C:\\project\\test");
    expect(daemonWorkspaceRoot(["start", "--workspace-root", "D:\\repo"], { AGENTHUB_CALLER_CWD: "C:\\project\\test" }, "C:\\project\\AgentHub")).toBe("D:\\repo");
    expect(daemonWorkspaceRoot(["start"], {}, "C:\\project\\AgentHub")).toBe("C:\\project\\AgentHub");
  });

  it("runs the Mock Solo smoke path", async () => {
    const originalWrite = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      await expect(runCli(["mock", "solo", "--message", "cli test"])).resolves.toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("prints permission profiles", async () => {
    const originalWrite = process.stdout.write;
    const originalFetch = globalThis.fetch;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    globalThis.fetch = (async () => new Response(JSON.stringify({ profiles: [] }), { status: 200 })) as typeof fetch;
    try {
      await expect(runCli(["permissions", "profiles"])).resolves.toBe(0);
    } finally {
      process.stdout.write = originalWrite;
      globalThis.fetch = originalFetch;
    }
  });

  it("prints intervention lists and debug stats", async () => {
    const originalWrite = process.stdout.write;
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    process.stdout.write = (() => true) as typeof process.stdout.write;
    globalThis.fetch = (async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    try {
      await expect(runCli(["interventions", "list", "--status", "pending_user_decision"])).resolves.toBe(0);
      await expect(runCli(["debug", "stats"])).resolves.toBe(0);
      expect(calls).toEqual(["http://127.0.0.1:6677/interventions?status=pending_user_decision", "http://127.0.0.1:6677/debug/stats"]);
    } finally {
      process.stdout.write = originalWrite;
      globalThis.fetch = originalFetch;
    }
  });

  it("runs doctor and prints five checks", async () => {
    const originalWrite = process.stdout.write;
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => { output += String(chunk); return true; }) as typeof process.stdout.write;
    try {
      await expect(runCli(["doctor", "--port", "0"])).resolves.toBe(0);
      expect(output.trim().split("\n")).toHaveLength(5);
      expect(output).toContain("SQLite");
      expect(output).toContain("Keychain");
      expect(output).toContain("config");
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
