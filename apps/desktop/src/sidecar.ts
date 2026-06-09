import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import type { DaemonStatus } from "./types.js";

export type SidecarOptions = {
  readonly sourceRoot?: string;
  readonly workspaceRoot?: string;
  readonly port?: number;
  readonly host?: string;
  readonly packaged?: boolean;
  readonly resourcesPath?: string;
  readonly webAssetsRoot?: string;
  readonly migrationsDir?: string;
  readonly logDirectory?: string;
  readonly fetchImpl?: typeof fetch;
  readonly spawnDaemon?: (options: SpawnDaemonOptions) => ChildProcess;
  readonly waitForHealth?: (url: string, child: ChildProcess) => Promise<void>;
  readonly restartDelay?: (milliseconds: number) => Promise<void>;
  readonly log?: (message: string) => void;
};

export type SidecarStartResult = {
  readonly status: DaemonStatus;
  readonly webUrl: string;
  readonly webAssetsRoot?: string;
};

export type DaemonCliSpawnSpec = {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
};

export type DaemonSidecarSpawnSpec = DaemonCliSpawnSpec;

export type SpawnDaemonOptions = {
  readonly sourceRoot: string;
  readonly workspaceRoot: string;
  readonly port: number;
  readonly packaged?: boolean;
  readonly resourcesPath?: string;
  readonly webAssetsRoot?: string;
  readonly migrationsDir?: string;
  readonly logDirectory?: string;
  readonly log?: (message: string) => void;
};

export type SidecarCloseReport = {
  readonly retained: true;
  readonly managed: boolean;
  readonly activeClientCount?: number;
  readonly message: string;
};

export class DaemonSidecar {
  private readonly sourceRoot: string;
  private readonly workspaceRoot: string;
  private readonly host: string;
  private readonly port: number;
  private readonly packaged: boolean;
  private readonly resourcesPath: string | undefined;
  private readonly logDirectory: string | undefined;
  private readonly migrationsDir: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly spawnManagedDaemon: (options: SpawnDaemonOptions) => ChildProcess;
  private readonly waitForManagedHealth: (url: string, child: ChildProcess) => Promise<void>;
  private readonly restartDelay: (milliseconds: number) => Promise<void>;
  private readonly log: (message: string) => void;
  private child: ChildProcess | undefined;
  private desired = false;
  private restartAttempts = 0;
  private lastMessage: string | undefined;
  private webAssetsRoot: string | undefined;

  constructor(options: SidecarOptions = {}) {
    this.sourceRoot = options.sourceRoot ?? findAgentHubSourceRoot();
    this.workspaceRoot = options.workspaceRoot ?? process.env.AGENTHUB_CALLER_CWD ?? process.cwd();
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? numberEnv("AGENTHUB_PORT") ?? 6677;
    this.packaged = options.packaged ?? false;
    this.resourcesPath = options.resourcesPath ?? (typeof process.resourcesPath === "string" && process.resourcesPath.length > 0 ? process.resourcesPath : undefined);
    this.logDirectory = options.logDirectory;
    this.log = options.log ?? (() => undefined);
    this.webAssetsRoot = resolveWebAssetsRoot(this.sourceRoot, options.webAssetsRoot, this.resourcesPath);
    this.migrationsDir = options.migrationsDir ?? packagedMigrationsDir(this.resourcesPath);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.spawnManagedDaemon = options.spawnDaemon ?? spawnDaemonCli;
    this.waitForManagedHealth = options.waitForHealth ?? waitForHealth;
    this.restartDelay = options.restartDelay ?? delay;
  }

  get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  get status(): DaemonStatus {
    if (this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null) {
      return { state: "starting", url: this.baseUrl, managed: true, ...(this.child.pid !== undefined ? { pid: this.child.pid } : {}), ...(this.lastMessage !== undefined ? { message: this.lastMessage } : {}) };
    }
    if (this.lastMessage !== undefined) return { state: "error", url: this.baseUrl, managed: false, message: this.lastMessage };
    return { state: "unreachable", url: this.baseUrl, managed: false };
  }

  async ensureStarted(): Promise<SidecarStartResult> {
    this.webAssetsRoot = resolveWebAssetsRoot(this.sourceRoot, this.webAssetsRoot, this.resourcesPath);
    if (await this.probeHealth()) {
      return { status: { state: "external", url: this.baseUrl, managed: false, message: "Using an already running AgentHub daemon." }, webUrl: this.baseUrl, ...(this.webAssetsRoot !== undefined ? { webAssetsRoot: this.webAssetsRoot } : {}) };
    }
    await this.startManagedDaemon();
    return { status: { state: "ready", url: this.baseUrl, managed: true, ...(this.child?.pid !== undefined ? { pid: this.child.pid } : {}) }, webUrl: this.baseUrl, ...(this.webAssetsRoot !== undefined ? { webAssetsRoot: this.webAssetsRoot } : {}) };
  }

  async getStatus(): Promise<DaemonStatus> {
    if (await this.probeHealth()) {
      return { state: this.child === undefined ? "external" : "ready", url: this.baseUrl, managed: this.child !== undefined, ...(this.child?.pid !== undefined ? { pid: this.child.pid } : {}), ...(this.lastMessage !== undefined ? { message: this.lastMessage } : {}) };
    }
    return this.status;
  }

  async restart(): Promise<DaemonStatus> {
    if (this.child === undefined) {
      if (await this.probeHealth()) return { state: "external", url: this.baseUrl, managed: false, message: "Daemon was not started by the desktop app; leave it running and restart it with the CLI if needed." };
      await this.startManagedDaemon();
      return await this.getStatus();
    }
    await terminateChild(this.child);
    this.child = undefined;
    await this.startManagedDaemon();
    return await this.getStatus();
  }

  close(): void {
    this.desired = false;
    this.lastMessage = "Leaving daemon running after desktop shutdown.";
    this.child = undefined;
  }

  async prepareForQuit(): Promise<SidecarCloseReport> {
    this.desired = false;
    const managed = this.child !== undefined;
    const activeClientCount = await this.detectActiveClientCount();
    const message = activeClientCount === undefined
      ? "Leaving daemon running after desktop shutdown; active client detection unavailable."
      : `Leaving daemon running after desktop shutdown; detected ${activeClientCount} active SSE client${activeClientCount === 1 ? "" : "s"}.`;
    this.lastMessage = message;
    this.child = undefined;
    return {
      retained: true,
      managed,
      ...(activeClientCount !== undefined ? { activeClientCount } : {}),
      message
    };
  }

  private async startManagedDaemon(): Promise<void> {
    this.desired = true;
    this.lastMessage = undefined;
    this.child = this.spawnManagedDaemon({
      sourceRoot: this.sourceRoot,
      workspaceRoot: this.workspaceRoot,
      port: this.port,
      packaged: this.packaged,
      ...(this.resourcesPath !== undefined ? { resourcesPath: this.resourcesPath } : {}),
      ...(this.webAssetsRoot !== undefined ? { webAssetsRoot: this.webAssetsRoot } : {}),
      ...(this.migrationsDir !== undefined ? { migrationsDir: this.migrationsDir } : {}),
      ...(this.logDirectory !== undefined ? { logDirectory: this.logDirectory } : {}),
      log: this.log
    });
    this.child.once("exit", (code, signal) => {
      const wasDesired = this.desired;
      this.lastMessage = `managed daemon exited with ${code ?? signal ?? "unknown"}`;
      this.child = undefined;
      if (wasDesired) void this.restartAfterCrash();
    });
    await this.waitForManagedHealth(`${this.baseUrl}/healthz`, this.child);
  }

  private async restartAfterCrash(): Promise<void> {
    if (!this.desired) return;
    if (this.restartAttempts >= 3) {
      this.lastMessage = "managed daemon exited repeatedly; restart paused";
      return;
    }
    this.restartAttempts += 1;
    await this.restartDelay(1_000 * this.restartAttempts);
    if (!this.desired) return;
    try {
      await this.startManagedDaemon();
      this.restartAttempts = 0;
    } catch (error) {
      this.lastMessage = error instanceof Error ? error.message : String(error);
    }
  }

  private async probeHealth(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/healthz`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async detectActiveClientCount(): Promise<number | undefined> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/debug/stats`, { headers: { accept: "application/json" } });
      if (!response.ok) return undefined;
      const value = await response.json() as { readonly sseClientCount?: unknown };
      return typeof value.sseClientCount === "number" && Number.isFinite(value.sseClientCount) ? value.sseClientCount : undefined;
    } catch {
      return undefined;
    }
  }
}

export function findAgentHubSourceRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (
      existsSync(resolve(current, "package.json")) &&
      existsSync(resolve(current, "apps", "cli", "src", "index.ts")) &&
      existsSync(resolve(current, "apps", "web", "package.json"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    current = parent;
  }
}

export function packagedWebAssetsRoot(resourcesPath = process.resourcesPath): string | undefined {
  if (resourcesPath === undefined || resourcesPath.length === 0) return undefined;
  const candidate = resolve(resourcesPath, "agenthub-web-dist");
  return existsSync(resolve(candidate, "index.html")) ? candidate : undefined;
}

export function packagedMigrationsDir(resourcesPath = process.resourcesPath): string | undefined {
  if (resourcesPath === undefined || resourcesPath.length === 0) return undefined;
  const candidate = resolve(resourcesPath, "agenthub-migrations");
  return existsSync(resolve(candidate, "0001_init.sql")) ? candidate : undefined;
}

export function resolveWebAssetsRoot(sourceRoot: string, explicitRoot?: string, resourcesPath = process.resourcesPath): string | undefined {
  const candidates = [
    explicitRoot,
    process.env.AGENTHUB_WEB_ASSETS_ROOT,
    packagedWebAssetsRoot(resourcesPath),
    resolve(sourceRoot, "apps", "web", "dist")
  ].filter((value): value is string => value !== undefined && value.length > 0);
  for (const candidate of candidates) {
    const root = resolve(candidate);
    if (existsSync(resolve(root, "index.html"))) return root;
  }
  return undefined;
}

export function createDaemonCliSpawnSpec(options: {
  readonly sourceRoot: string;
  readonly workspaceRoot: string;
  readonly port: number;
  readonly webAssetsRoot?: string;
  readonly nodeExecutable?: string;
}): DaemonCliSpawnSpec {
  return {
    command: options.nodeExecutable ?? process.env.AGENTHUB_NODE_BINARY ?? process.env.npm_node_execpath ?? "node",
    args: [
      resolve(options.sourceRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      "apps/cli/src/index.ts",
      "start",
      "--workspace-root",
      resolve(options.workspaceRoot),
      "--port",
      String(options.port),
      ...(options.webAssetsRoot !== undefined ? ["--web-assets-root", options.webAssetsRoot] : [])
    ],
    options: {
      cwd: options.sourceRoot,
      env: process.env,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
      detached: true
    }
  };
}

export function createPackagedDaemonSpawnSpec(options: {
  readonly workspaceRoot: string;
  readonly port: number;
  readonly resourcesPath?: string;
  readonly webAssetsRoot?: string;
  readonly migrationsDir?: string;
  readonly agentTemplatesDir?: string;
  readonly roomMcpBridgeDir?: string;
  readonly nodeExecutable?: string;
  readonly electronExecutable?: string;
}): DaemonSidecarSpawnSpec {
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const nodeExecutable = options.nodeExecutable ?? packagedNodeExecutable(resourcesPath);
  const nodePath = packagedDaemonNodeModulesPath(resourcesPath);
  // The sidecar runs under the built-in node.exe, where process.resourcesPath is undefined and the
  // runtime would otherwise resolve these dirs relative to dirname(process.execPath) (the agenthub-node
  // folder) — wrong. Pass every resource dir explicitly, derived from the authoritative resourcesPath.
  const agentTemplatesDir = options.agentTemplatesDir ?? packagedResourceDir(resourcesPath, "agenthub-agent-templates");
  const roomMcpBridgeDir = options.roomMcpBridgeDir ?? packagedResourceDir(resourcesPath, "agenthub-room-mcp");
  return {
    command: nodeExecutable ?? options.electronExecutable ?? process.execPath,
    args: [
      ...(nodeExecutable === undefined ? ["--agenthub-daemon-sidecar"] : [packagedDaemonRuntimePath(resourcesPath), "--agenthub-run-daemon-sidecar"]),
      "--workspace-root",
      resolve(options.workspaceRoot),
      "--port",
      String(options.port),
      ...(options.webAssetsRoot !== undefined ? ["--web-assets-root", options.webAssetsRoot] : []),
      ...(options.migrationsDir !== undefined ? ["--migrations-dir", options.migrationsDir] : []),
      ...(agentTemplatesDir !== undefined ? ["--agent-templates-dir", agentTemplatesDir] : []),
      ...(roomMcpBridgeDir !== undefined ? ["--room-mcp-bridge-dir", roomMcpBridgeDir] : [])
    ],
    options: {
      cwd: resolve(options.workspaceRoot),
      env: {
        ...process.env,
        ...(nodePath !== undefined ? { NODE_PATH: [nodePath, process.env.NODE_PATH].filter((value): value is string => value !== undefined && value.length > 0).join(process.platform === "win32" ? ";" : ":") } : {})
      },
      stdio: "ignore",
      shell: false,
      windowsHide: true,
      detached: true
    }
  };
}

export function packagedNodeExecutable(resourcesPath = process.resourcesPath): string | undefined {
  if (resourcesPath === undefined || resourcesPath.length === 0) return undefined;
  const candidate = resolve(resourcesPath, "agenthub-node", process.platform === "win32" ? "node.exe" : "node");
  return existsSync(candidate) ? candidate : undefined;
}

function packagedDaemonRuntimePath(resourcesPath = process.resourcesPath): string {
  if (resourcesPath !== undefined && resourcesPath.length > 0) {
    const unpacked = resolve(resourcesPath, "agenthub-daemon", "daemon-sidecar.mjs");
    if (existsSync(unpacked)) return unpacked;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "daemon-sidecar.mjs");
}

function packagedDaemonNodeModulesPath(resourcesPath = process.resourcesPath): string | undefined {
  if (resourcesPath === undefined || resourcesPath.length === 0) return undefined;
  // Native deps now ship as a real node_modules next to the bundle (resources/agenthub-daemon/node_modules)
  // so Node ESM resolves bare imports automatically. Kept on NODE_PATH too for any CJS sub-require.
  const candidate = resolve(resourcesPath, "agenthub-daemon", "node_modules");
  return existsSync(candidate) ? candidate : undefined;
}

function packagedResourceDir(resourcesPath: string | undefined, name: string): string | undefined {
  if (resourcesPath === undefined || resourcesPath.length === 0) return undefined;
  const candidate = resolve(resourcesPath, name);
  return existsSync(candidate) ? candidate : undefined;
}

function spawnDaemonCli(options: SpawnDaemonOptions): ChildProcess {
  if (options.logDirectory !== undefined) mkdirSync(options.logDirectory, { recursive: true });
  const log = options.log ?? (() => undefined);
  // Packaged-ness is decided by the authoritative `app.isPackaged` signal injected from main.ts,
  // not by re-probing process.resourcesPath sentinel files at spawn time (which proved unreliable
  // across asar / ELECTRON_RUN_AS_NODE permutations and silently fell back to the dev spawn).
  const spec = options.packaged === true
    ? createPackagedDaemonSpawnSpec(options)
    : createDaemonCliSpawnSpec(options);
  log(`sidecar spawn packaged=${options.packaged === true} command=${spec.command} resourcesPath=${options.resourcesPath ?? "none"} args=${JSON.stringify(spec.args)}`);
  const child = spawn(spec.command, spec.args, spec.options);
  child.unref();
  return child;
}

async function waitForHealth(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("daemon exited before becoming ready");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for daemon at ${url}`);
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    child.once("exit", done);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      setTimeout(done, 0);
    }, 5_000).unref?.();
  });
}

function numberEnv(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
