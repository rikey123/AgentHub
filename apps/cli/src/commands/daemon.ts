import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

import { createDatabase, defaultMigrationsDir } from "@agenthub/db";
import { createDaemon, daemonPidPath, ensureAgentHubHome, ensureParentDirectory, loadAgentHubConfig, redactConfig } from "@agenthub/daemon";

import { valueArg } from "../args.ts";
import { resolveAgentTemplatesDir, resolveMigrationsDir, resolveRoomMcpBridgeDir, resolveWebAssetsRoot } from "../package-resources.ts";

type PidFile = { readonly pid: number; readonly host: string; readonly port: number; readonly startedAt: number };

export async function runDaemonCommand(argv: readonly string[]): Promise<number | undefined> {
  const [command] = argv;
  if (command === "start") return start(argv);
  if (command === "stop") return stop(argv);
  if (command === "status") return status(argv);
  if (command === "doctor") return doctor(argv);
  return undefined;
}

async function start(argv: readonly string[]): Promise<number> {
  const configPath = valueArg(argv, "--config");
  const port = numericArg(argv, "--port");
  const workspaceRoot = daemonWorkspaceRoot(argv);
  const webAssetsRoot = valueArg(argv, "--web-assets-root") ?? resolveWebAssetsRoot();
  const migrationsDir = valueArg(argv, "--migrations-dir") ?? resolveMigrationsDir();
  const agentTemplatesDir = valueArg(argv, "--agent-templates-dir") ?? resolveAgentTemplatesDir();
  const roomMcpBridgeDir = valueArg(argv, "--room-mcp-bridge-dir") ?? resolveRoomMcpBridgeDir();
  const config = loadAgentHubConfig({ ...(configPath !== undefined ? { configPath } : {}), ...(port !== undefined ? { port } : {}) });
  ensureAgentHubHome();
  const daemon = createDaemon({ databasePath: config.databasePath, workspaceRoot, ...(webAssetsRoot !== undefined ? { webAssetsRoot } : {}), ...(migrationsDir !== undefined ? { migrationsDir } : {}), ...(agentTemplatesDir !== undefined ? { agentTemplatesDir } : {}), ...(roomMcpBridgeDir !== undefined ? { roomMcpBridgeDir } : {}), host: config.server.bind, port: config.server.port, allowRemote: config.server.remote.enabled, ...(config.auth.token !== undefined ? { token: config.auth.token } : {}), ...(config.auth.allowedOrigins !== undefined ? { allowedOrigins: config.auth.allowedOrigins } : {}) });
  const server = await daemon.start();
  writePidFile({ pid: process.pid, host: config.server.bind, port: boundPort(server), startedAt: Date.now() });
  process.stdout.write(`${JSON.stringify(redactConfig(config), null, 2)}\n`);
  process.stdout.write(`AgentHub daemon listening on http://${config.server.bind}:${boundPort(server)}\n`);
  const shutdown = async () => {
    const result = await daemon.close({ forceCancelAfterMs: 30_000 });
    deletePidFile();
    process.exitCode = result.forced ? 1 : 0;
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
  await new Promise<void>(() => undefined);
  return 0;
}

export function daemonWorkspaceRoot(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return valueArg(argv, "--workspace-root") ?? env.AGENTHUB_CALLER_CWD ?? cwd;
}

async function stop(argv: readonly string[]): Promise<number> {
  const pid = readPidFile();
  if (pid === undefined) {
    process.stdout.write("daemon not running\n");
    return 1;
  }
  if (argv.includes("--force")) {
    process.stderr.write("可能丢失 in-flight Run 状态\n");
    process.kill(pid.pid, "SIGKILL");
    deletePidFile();
    process.stdout.write("daemon stopped\n");
    return 0;
  }
  const timeoutSeconds = numericArg(argv, "--timeout") ?? 30;
  process.kill(pid.pid, "SIGTERM");
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid.pid)) {
      deletePidFile();
      process.stdout.write("daemon stopped\n");
      return 0;
    }
    await delay(100);
  }
  process.stdout.write(`daemon did not stop in ${timeoutSeconds}s, use --force to send SIGKILL\n`);
  return 1;
}

async function status(argv: readonly string[]): Promise<number> {
  const pid = readPidFile();
  const url = valueArg(argv, "--url") ?? (pid === undefined ? "http://127.0.0.1:6677" : `http://${pid.host}:${pid.port}`);
  try {
    const response = await fetch(`${url}/healthz`);
    const payload = await response.json() as { readonly ok?: boolean; readonly status?: string; readonly error?: string };
    if (payload.status === "shutting_down") process.stdout.write(`daemon: shutting_down (${url})\n`);
    else if (response.status === 503 || payload.error === "service_starting") process.stdout.write("daemon: starting\n");
    else process.stdout.write(`daemon: ready (${url})\n`);
    return 0;
  } catch {
    process.stdout.write("daemon: unreachable\n");
    return 1;
  }
}

async function doctor(argv: readonly string[]): Promise<number> {
  const configPath = valueArg(argv, "--config");
  const port = numericArg(argv, "--port");
  const overrides = { ...(configPath !== undefined ? { configPath } : {}), ...(port !== undefined ? { port } : {}) };
  const migrationsDir = valueArg(argv, "--migrations-dir") ?? resolveMigrationsDir() ?? defaultMigrationsDir;
  const config = safeCheck("config", () => { loadAgentHubConfig(overrides); });
  const parsed = config.ok ? loadAgentHubConfig(overrides) : undefined;
  const checks = [
    safeCheck("SQLite", () => {
      const dbPath = parsed?.databasePath ?? loadAgentHubConfig(overrides).databasePath;
      ensureParentDirectory(dbPath);
      const db = createDatabase({ path: dbPath, applyMigrations: false });
      db.sqlite.pragma("quick_check");
      db.sqlite.close();
    }),
    await portCheck(parsed?.server.port ?? 6677),
    safeCheck("Keychain", () => undefined, "AES fallback (file-based)"),
    safeCheck("migrations", () => {
      if (!existsSync(migrationsDir)) throw new Error("migration directory missing");
    }),
    config
  ];
  for (const check of checks) process.stdout.write(`${check.ok ? "✅" : "❌"} ${check.name}${check.detail === undefined ? "" : `: ${check.detail}`}\n`);
  return checks.every((check) => check.ok) ? 0 : 1;
}

function writePidFile(value: PidFile): void {
  const path = daemonPidPath();
  ensureParentDirectory(path);
  writeFileSync(path, JSON.stringify(value), "utf8");
}

function readPidFile(): PidFile | undefined {
  try { return JSON.parse(readFileSync(daemonPidPath(), "utf8")) as PidFile; } catch { return undefined; }
}

function deletePidFile(): void {
  rmSync(daemonPidPath(), { force: true });
}

function numericArg(argv: readonly string[], name: string): number | undefined {
  const value = valueArg(argv, name) ?? argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boundPort(server: { address(): string | { readonly port: number } | null }): number {
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("daemon did not bind TCP port");
  return address.port;
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeCheck(name: string, fn: () => void, detail?: string): { readonly name: string; readonly ok: boolean; readonly detail?: string } {
  try { fn(); return { name, ok: true, ...(detail !== undefined ? { detail } : {}) }; } catch (error) { return { name, ok: false, detail: error instanceof Error ? error.message : String(error) }; }
}

async function portCheck(port: number): Promise<{ readonly name: string; readonly ok: boolean; readonly detail?: string }> {
  return await new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve({ name: "port", ok: false, detail: `port ${port} is in use` }));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve({ name: "port", ok: true })));
  });
}
