import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: existsSyncMock
  };
});

import { runWebCommand } from "../src/commands/web.ts";

class FakeChildProcess extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  kill(signal?: NodeJS.Signals): boolean {
    this.signalCode = signal ?? "SIGTERM";
    this.emit("exit", null, this.signalCode);
    return true;
  }

  unref(): void {
    // Browser opener compatibility.
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.chdir(originalCwd);
  globalThis.fetch = originalFetch;
  spawnMock.mockReset();
  existsSyncMock.mockReset();
  delete process.env.AGENTHUB_CALLER_CWD;
  delete process.env.AGENTHUB_WEB_ASSETS_ROOT;
});

describe("agenthub web launcher", () => {
  it("runs internal pnpm commands from the AgentHub repo while preserving the caller workspace root in dev mode", async () => {
    const callerWorkspace = mkdtempSync(join(tmpdir(), "agenthub-caller-"));
    process.chdir(callerWorkspace);
    mockSourceTree({ hasBuiltWebAssets: false });

    globalThis.fetch = vi.fn(async (url) => {
      if (String(url) === "http://127.0.0.1:6677/healthz") {
        const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
        if (calls === 1) throw new Error("daemon not running");
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    spawnMock.mockImplementation(() => {
      const child = new FakeChildProcess();
      queueMicrotask(() => child.emit("spawn"));
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.exitCode = 0;
          child.emit("exit", 0, null);
        }
      }, 20);
      return child;
    });

    try {
      await expect(runWebCommand(["web"])).resolves.toBe(0);

      const managed = spawnMock.mock.calls.filter(([, , options]) => options?.stdio === "inherit");
      expect(managed).toHaveLength(2);
      expect(managed.every(([, , options]) => options?.cwd === repoRoot)).toBe(true);

      expect(managed[0]?.[0]).toBe(process.execPath);
      const daemonArgs = managed[0]?.[1] as readonly string[];
      expect(daemonArgs.map(toPosix)).toContain(`${toPosix(repoRoot)}/apps/cli/src/index.ts`);
      expect(daemonArgs).toContain("start");
      expect(daemonArgs).toContain("--workspace-root");
      expect(daemonArgs[daemonArgs.indexOf("--workspace-root") + 1]).toBe(callerWorkspace);
      expect(daemonArgs).not.toContain("--web-assets-root");
      expect(managed[1]?.[1]).toEqual(expect.arrayContaining(["--filter", "@agenthub/web", "dev"]));
    } finally {
      process.chdir(originalCwd);
      rmSync(callerWorkspace, { recursive: true, force: true });
    }
  });

  it("opens the daemon-served built UI without starting Vite when web assets are available", async () => {
    const callerWorkspace = mkdtempSync(join(tmpdir(), "agenthub-caller-static-"));
    process.chdir(callerWorkspace);
    mockSourceTree({ hasBuiltWebAssets: true });

    globalThis.fetch = vi.fn(async (url) => {
      if (String(url) === "http://127.0.0.1:6677/healthz") {
        const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
        if (calls === 1) throw new Error("daemon not running");
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    spawnMock.mockImplementation(() => {
      const child = new FakeChildProcess();
      queueMicrotask(() => child.emit("spawn"));
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.exitCode = 0;
          child.emit("exit", 0, null);
        }
      }, 20);
      return child;
    });

    try {
      await expect(runWebCommand(["web"])).resolves.toBe(0);

      const managed = spawnMock.mock.calls.filter(([, , options]) => options?.stdio === "inherit");
      expect(managed).toHaveLength(1);
      expect(managed[0]?.[2]?.cwd).toBe(repoRoot);
      expect(JSON.stringify(managed.map((call) => call[1]))).not.toContain("@agenthub/web");

      expect(managed[0]?.[0]).toBe(process.execPath);
      const daemonArgs = managed[0]?.[1] as readonly string[];
      const webAssetsRoot = resolve(repoRoot, "apps", "web", "dist");
      expect(daemonArgs.map(toPosix)).toContain(`${toPosix(repoRoot)}/apps/cli/src/index.ts`);
      expect(daemonArgs).toContain("start");
      expect(daemonArgs).toContain("--workspace-root");
      expect(daemonArgs[daemonArgs.indexOf("--workspace-root") + 1]).toBe(callerWorkspace);
      expect(daemonArgs).toContain("--web-assets-root");
      expect(daemonArgs[daemonArgs.indexOf("--web-assets-root") + 1]).toBe(webAssetsRoot);

      const browserOpen = spawnMock.mock.calls.find(([, , options]) => options?.stdio === "ignore");
      expect(browserOpen?.[1]).toContain("http://127.0.0.1:6677");
    } finally {
      process.chdir(originalCwd);
      rmSync(callerWorkspace, { recursive: true, force: true });
    }
  });

  it("opens an already-running daemon-served built UI and exits without waiting for child processes", async () => {
    const callerWorkspace = mkdtempSync(join(tmpdir(), "agenthub-caller-running-"));
    process.chdir(callerWorkspace);
    mockSourceTree({ hasBuiltWebAssets: true });

    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch;
    spawnMock.mockImplementation(() => {
      const child = new FakeChildProcess();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    try {
      await expect(runWebCommand(["web"])).resolves.toBe(0);

      const managed = spawnMock.mock.calls.filter(([, , options]) => options?.stdio === "inherit");
      expect(managed).toHaveLength(0);
      const browserOpen = spawnMock.mock.calls.find(([, , options]) => options?.stdio === "ignore");
      expect(browserOpen?.[1]).toContain("http://127.0.0.1:6677");
    } finally {
      process.chdir(originalCwd);
      rmSync(callerWorkspace, { recursive: true, force: true });
    }
  });
});

function mockSourceTree(input: { readonly hasBuiltWebAssets: boolean }): void {
  const root = toPosix(repoRoot);
  const webAssetsIndex = toPosix(resolve(repoRoot, "apps", "web", "dist", "index.html"));
  existsSyncMock.mockImplementation((pathLike: string | URL) => {
    const path = toPosix(pathLike);
    if (path === `${root}/package.json`) return true;
    if (path === `${root}/apps/cli/src/index.ts`) return true;
    if (path === `${root}/apps/web/package.json`) return true;
    if (path === webAssetsIndex) return input.hasBuiltWebAssets;
    return false;
  });
}

function toPosix(value: string | URL): string {
  return String(value).replace(/\\/gu, "/");
}
