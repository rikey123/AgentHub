import { describe, expect, it } from "vitest";

import { runCli } from "../src/index.ts";

describe("agenthub cli", () => {
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
});
