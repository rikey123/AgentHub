import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPptPreviewBridge, type PptPreviewBridgeOptions } from "../src/services/ppt-preview-bridge.ts";

const execFileMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: execFileMock
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: existsSyncMock
  };
});

describe("PptPreviewBridge", () => {
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const originalPath = process.env.Path;
  const originalUpperPath = process.env.PATH;

  afterEach(() => {
    execFileMock.mockReset();
    existsSyncMock.mockReset();
    process.env.LOCALAPPDATA = originalLocalAppData;
    process.env.Path = originalPath;
    process.env.PATH = originalUpperPath;
  });

  it("starts officecli watch on a per-file port and tracks active sessions", async () => {
    const child = fakeChild(1234);
    const bridge = createPptPreviewBridge({
      detectOfficecli: async () => true,
      findFreePort: async () => 61234,
      spawnWatch: vi.fn(() => child),
      waitForReady: async () => undefined
    });

    const session = await bridge.start("deck.pptx");

    expect(session).toMatchObject({ port: 61234, filePath: "deck.pptx", pid: 1234, status: "ready" });
    expect(bridge.isActivePreviewPort(61234)).toBe(true);
    await bridge.stop(61234);
    expect(child.kill).toHaveBeenCalled();
    expect(bridge.isActivePreviewPort(61234)).toBe(false);
  });

  it("installs officecli once, retries detection, and guards repeated failed installs", async () => {
    const install = vi.fn(async () => undefined);
    const bridge = createPptPreviewBridge({
      detectOfficecli: vi.fn(async () => false),
      installOfficecli: install,
      findFreePort: async () => 61235,
      spawnWatch: vi.fn(() => fakeChild(1)),
      waitForReady: async () => undefined
    });

    await expect(bridge.start("deck.pptx")).rejects.toThrow("officecli is not available");
    await expect(bridge.start("deck.pptx")).rejects.toThrow("officecli is not available");
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("waits for a Watch marker on stdout before reporting the preview ready", async () => {
    const child = fakeChild(1235, true);
    const bridge = createPptPreviewBridge({
      detectOfficecli: async () => true,
      findFreePort: async () => 61236,
      spawnWatch: vi.fn(() => child)
    });

    const pending = bridge.start("deck.pptx");
    await vi.waitFor(() => expect(child.stdout.listenerCount("data")).toBeGreaterThan(0));
    expect(child.kill).not.toHaveBeenCalled();
    child.stdout.emit("data", Buffer.from("Watch: http://127.0.0.1:61236"));

    await expect(pending).resolves.toMatchObject({ port: 61236, status: "ready" });
  });

  it("kills the watch child and removes the session when readiness times out", async () => {
    const child = fakeChild(1236, true);
    const bridge = createPptPreviewBridge({
      detectOfficecli: async () => true,
      findFreePort: async () => 61237,
      spawnWatch: vi.fn(() => child),
      readyTimeoutMs: 10
    });

    const pending = bridge.start("deck.pptx");

    await expect(pending).rejects.toThrow("ppt preview did not become ready");
    expect(child.kill).toHaveBeenCalled();
    expect(bridge.isActivePreviewPort(61237)).toBe(false);
  });

  it("detects officecli on non-Windows through a shell instead of the command builtin executable", async () => {
    execFileMock.mockImplementation((command: string, args: readonly string[], callback: (error: Error | null) => void) => {
      callback(null);
    });
    const child = fakeChild(1237);
    const bridge = createPptPreviewBridge({
      findFreePort: async () => 61238,
      spawnWatch: vi.fn(() => child),
      waitForReady: async () => undefined,
      platform: () => "linux"
    });

    await expect(bridge.start("deck.pptx")).resolves.toMatchObject({ port: 61238, status: "ready" });

    expect(execFileMock).toHaveBeenCalledWith("sh", ["-c", "command -v officecli"], expect.any(Function));
  });

  it("detects the Windows installer directory when the current process PATH has not refreshed", async () => {
    execFileMock.mockImplementation((command: string, args: readonly string[], callback: (error: Error | null) => void) => {
      expect(command).toBe("where.exe");
      expect(args).toEqual(["officecli"]);
      callback(new Error("not found"));
    });
    existsSyncMock.mockReturnValue(true);
    process.env.LOCALAPPDATA = "C:\\Users\\tester\\AppData\\Local";
    process.env.Path = "C:\\Windows\\System32";
    process.env.PATH = process.env.Path;
    const child = fakeChild(1238);
    const bridge = createPptPreviewBridge({
      findFreePort: async () => 61239,
      spawnWatch: vi.fn(() => child),
      waitForReady: async () => undefined,
      platform: () => "win32"
    });

    await expect(bridge.start("deck.pptx")).resolves.toMatchObject({ port: 61239, status: "ready" });

    expect(existsSyncMock).toHaveBeenCalledWith("C:\\Users\\tester\\AppData\\Local\\OfficeCLI\\officecli.exe");
    expect(process.env.Path?.split(";")[0]).toBe("C:\\Users\\tester\\AppData\\Local\\OfficeCLI");
  });

  it("uses the current OfficeCLI installer source when auto-installing", async () => {
    let attempts = 0;
    execFileMock.mockImplementation((command: string, args: readonly string[], callback: (error: Error | null) => void) => {
      attempts += 1;
      if (attempts === 1) {
        expect(command).toBe("where.exe");
        callback(new Error("not found"));
        return;
      }
      if (attempts === 2) {
        expect(command).toBe("powershell.exe");
        expect(args).toEqual([
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "irm https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.ps1 | iex"
        ]);
        callback(null);
        return;
      }
      callback(null);
    });
    existsSyncMock.mockReturnValue(false);
    const child = fakeChild(1239);
    const bridge = createPptPreviewBridge({
      findFreePort: async () => 61240,
      spawnWatch: vi.fn(() => child),
      waitForReady: async () => undefined,
      platform: () => "win32"
    });

    await expect(bridge.start("deck.pptx")).resolves.toMatchObject({ port: 61240, status: "ready" });

    expect(attempts).toBe(3);
  });
});

function fakeChild(pid: number, withStreams = false): ReturnType<NonNullable<PptPreviewBridgeOptions["spawnWatch"]>> & { readonly kill: ReturnType<typeof vi.fn>; readonly stdout: EventEmitter; readonly stderr: EventEmitter } {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  return {
    pid,
    kill: vi.fn(() => true),
    once: vi.fn(),
    removeListener: vi.fn(),
    ...(withStreams ? { stdout, stderr } : {}),
    stdout,
    stderr
  };
}
