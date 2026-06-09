import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { nativeBridgeChannels, preloadApiWhitelist } from "../src/bridgeContract.ts";
import { configureDesktopUpdates } from "../src/desktopUpdates.ts";
import { focusPermissionScript } from "../src/permissionNotifications.ts";
import { createDaemonCliSpawnSpec, createPackagedDaemonSpawnSpec, DaemonSidecar, packagedMigrationsDir, packagedWebAssetsRoot, resolveWebAssetsRoot } from "../src/sidecar.ts";
import { createMainWindowOptions } from "../src/windowOptions.ts";

const testDir = dirname(fileURLToPath(import.meta.url));

describe("desktop shell contract", () => {
  it("keeps the preload API as a narrow whitelist", () => {
    expect(preloadApiWhitelist).toEqual([
      "openDirectoryPicker",
      "openFilePicker",
      "showNotification",
      "openPath",
      "openExternal",
      "getDaemonStatus",
      "restartDaemon",
      "exportLogs"
    ]);
    expect(Object.keys(nativeBridgeChannels)).toEqual([...preloadApiWhitelist]);
  });

  it("uses BrowserWindow security defaults required by the desktop spec", () => {
    const options = createMainWindowOptions("preload.js");

    expect(options.webPreferences).toMatchObject({
      preload: "preload.js",
      contextIsolation: true,
      nodeIntegration: false
    });
  });

  it("only treats daemon-served web assets as available when index.html exists", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-desktop-assets-"));
    const dist = join(root, "apps", "web", "dist");

    expect(resolveWebAssetsRoot(root)).toBeUndefined();

    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "index.html"), "<!doctype html>", "utf8");

    expect(resolveWebAssetsRoot(root)).toBe(dist);
    expect(existsSync(resolveWebAssetsRoot(root) ?? "")).toBe(true);
  });

  it("finds packaged web assets independently from daemon source resources", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-desktop-packaged-web-"));
    const webDist = join(root, "agenthub-web-dist");

    mkdirSync(webDist, { recursive: true });
    writeFileSync(join(webDist, "index.html"), "<!doctype html>", "utf8");

    expect(packagedWebAssetsRoot(root)).toBe(webDist);
  });

  it("finds packaged database migrations for self-contained installer startup", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-desktop-packaged-migrations-"));
    const migrations = join(root, "agenthub-migrations");

    expect(packagedMigrationsDir(root)).toBeUndefined();

    mkdirSync(migrations, { recursive: true });
    writeFileSync(join(migrations, "0001_init.sql"), "SELECT 1;", "utf8");

    expect(packagedMigrationsDir(root)).toBe(migrations);
  });

  it("spawns the managed daemon as a detached direct node process", () => {
    const sourceRoot = resolve("AgentHubSource");
    const workspaceRoot = resolve("Workspace");
    const webAssetsRoot = resolve(sourceRoot, "apps", "web", "dist");

    const spec = createDaemonCliSpawnSpec({
      sourceRoot,
      workspaceRoot,
      webAssetsRoot,
      port: 6677,
      nodeExecutable: "node-test"
    });

    expect(spec.command).toBe("node-test");
    expect(spec.args).toEqual([
      resolve(sourceRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      "apps/cli/src/index.ts",
      "start",
      "--workspace-root",
      workspaceRoot,
      "--port",
      "6677",
      "--web-assets-root",
      webAssetsRoot
    ]);
    expect(spec.options).toMatchObject({
      cwd: sourceRoot,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
      detached: true
    });
  });

  it("spawns the packaged daemon through the installed Electron executable", () => {
    const workspaceRoot = resolve("Workspace");
    const webAssetsRoot = resolve("Resources", "agenthub-web-dist");
    const migrationsDir = resolve("Resources", "agenthub-migrations");

    const spec = createPackagedDaemonSpawnSpec({
      workspaceRoot,
      webAssetsRoot,
      migrationsDir,
      port: 6677,
      nodeExecutable: "node.exe"
    });

    expect(spec.command).toBe("node.exe");
    expect(spec.args.slice(1)).toEqual([
      "--agenthub-run-daemon-sidecar",
      "--workspace-root",
      workspaceRoot,
      "--port",
      "6677",
      "--web-assets-root",
      webAssetsRoot,
      "--migrations-dir",
      migrationsDir
    ]);
    expect(spec.args[0]).toMatch(/daemon-sidecar\.mjs$/u);
    expect(spec.options).toMatchObject({
      cwd: workspaceRoot,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
      detached: true
    });
  });

  it("routes packaged sidecar through the packaged spawn spec, not the dev cli", async () => {
    const captured: { packaged?: boolean; resourcesPath?: string }[] = [];
    const fakeChild = Object.assign(new EventEmitter(), { pid: 4242, exitCode: null, signalCode: null, unref: () => undefined }) as unknown as ChildProcess;

    const sidecar = new DaemonSidecar({
      packaged: true,
      resourcesPath: resolve("Resources"),
      workspaceRoot: resolve("Workspace"),
      sourceRoot: resolve("Source"),
      port: 6677,
      fetchImpl: (async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
      waitForHealth: async () => undefined,
      spawnDaemon: (options) => {
        captured.push({ packaged: options.packaged, ...(options.resourcesPath !== undefined ? { resourcesPath: options.resourcesPath } : {}) });
        return fakeChild;
      }
    });

    await sidecar.ensureStarted();

    expect(captured).toHaveLength(1);
    expect(captured[0]?.packaged).toBe(true);
    expect(captured[0]?.resourcesPath).toBe(resolve("Resources"));
  });

  it("does not use loadFile for the desktop renderer", () => {
    const mainSource = readFileSync(join(testDir, "..", "src", "main.ts"), "utf8");

    expect(mainSource).not.toContain("loadFile");
    expect(mainSource).toContain("loadURL");
  });

  it("focuses permission requests from the desktop shell without requiring web source changes", () => {
    const script = focusPermissionScript("perm/needs review");

    expect(script).toContain(JSON.stringify("perm/needs review"));
    expect(script).toContain("scrollIntoView");
    expect(script).toContain("focus");
    expect(script).toContain("Permission requested");
  });

  it("restarts a managed daemon after an unexpected crash while desired", async () => {
    const children: FakeChildProcess[] = [];
    const sidecar = new DaemonSidecar({
      sourceRoot: resolve("AgentHubSource"),
      workspaceRoot: resolve("Workspace"),
      webAssetsRoot: resolve("missing-web-dist"),
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 503 })),
      waitForHealth: vi.fn().mockResolvedValue(undefined),
      restartDelay: vi.fn().mockResolvedValue(undefined),
      spawnDaemon: () => {
        const child = new FakeChildProcess(8_000 + children.length);
        children.push(child);
        return child as unknown as ChildProcess;
      }
    });

    await sidecar.ensureStarted();
    children[0]!.crash();
    await waitFor(() => children.length === 2);

    expect(children).toHaveLength(2);
    expect((await sidecar.getStatus()).managed).toBe(true);
  });

  it("checks active SSE clients before retaining the daemon on desktop quit", async () => {
    const sidecar = new DaemonSidecar({
      sourceRoot: resolve("AgentHubSource"),
      workspaceRoot: resolve("Workspace"),
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ sseClientCount: 2 }), { status: 200, headers: { "content-type": "application/json" } }))
    });

    const report = await sidecar.prepareForQuit();

    expect(report).toMatchObject({
      retained: true,
      managed: false,
      activeClientCount: 2
    });
    expect((await sidecar.getStatus()).message).toContain("detected 2 active SSE clients");
  });

  it("keeps desktop auto update disabled unless explicitly configured", () => {
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn()
    };
    const disabled = configureDesktopUpdates({});
    const missingUrl = configureDesktopUpdates({ AGENTHUB_DESKTOP_AUTO_UPDATE: "1" });
    const enabled = configureDesktopUpdates({ AGENTHUB_DESKTOP_AUTO_UPDATE: "1", AGENTHUB_DESKTOP_UPDATE_URL: "https://updates.example/agenthub" }, updater);

    expect(disabled).toEqual({ enabled: false, reason: "AGENTHUB_DESKTOP_AUTO_UPDATE is not enabled" });
    expect(missingUrl).toEqual({ enabled: false, reason: "AGENTHUB_DESKTOP_UPDATE_URL is not configured" });
    expect(enabled).toEqual({ enabled: true, url: "https://updates.example/agenthub" });
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.setFeedURL).toHaveBeenCalledWith({ provider: "generic", url: "https://updates.example/agenthub" });
  });
});

class FakeChildProcess extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  constructor(readonly pid: number) {
    super();
  }

  unref(): void {}

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signalCode = typeof signal === "string" ? signal : "SIGTERM";
    this.emit("exit", null, this.signalCode);
    return true;
  }

  crash(): void {
    this.exitCode = 1;
    this.emit("exit", 1, null);
  }
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(assertion()).toBe(true);
}
