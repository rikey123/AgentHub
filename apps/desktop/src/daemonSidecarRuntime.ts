import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { createDaemon, ensureAgentHubHome, ensureParentDirectory, loadAgentHubConfig, redactConfig } from "@agenthub/daemon";

type SidecarRuntimeOptions = {
  readonly argv?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly resourcesPath?: string;
  readonly pid?: number;
};

type PidFile = { readonly pid: number; readonly host: string; readonly port: number; readonly startedAt: number };

export async function runDaemonSidecarRuntime(options: SidecarRuntimeOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const resourcesPath = options.resourcesPath ?? electronResourcesPath() ?? dirname(process.execPath);
  const port = numericArg(argv, "--port") ?? numberEnv(env, "AGENTHUB_PORT") ?? 6677;
  const workspaceRoot = valueArg(argv, "--workspace-root") ?? env.AGENTHUB_CALLER_CWD ?? process.cwd();
  const webAssetsRoot = valueArg(argv, "--web-assets-root") ?? resolve(resourcesPath, "agenthub-web-dist");
  const migrationsDir = valueArg(argv, "--migrations-dir") ?? resolve(resourcesPath, "agenthub-migrations");
  const agentTemplatesDir = valueArg(argv, "--agent-templates-dir") ?? resolve(resourcesPath, "agenthub-agent-templates");
  const roomMcpBridgeDir = valueArg(argv, "--room-mcp-bridge-dir") ?? resolve(resourcesPath, "agenthub-room-mcp");
  const configPath = valueArg(argv, "--config");

  process.stderr.write(`[agenthub-daemon-sidecar] starting on port ${port}\n`);
  const config = loadAgentHubConfig({ ...(configPath !== undefined ? { configPath } : {}), port }, env);
  ensureAgentHubHome();
  ensureParentDirectory(config.databasePath);
  const daemon = createDaemon({
    databasePath: config.databasePath,
    workspaceRoot,
    webAssetsRoot,
    migrationsDir,
    agentTemplatesDir,
    roomMcpBridgeDir,
    host: config.server.bind,
    port: config.server.port,
    allowRemote: config.server.remote.enabled,
    ...(config.auth.token !== undefined ? { token: config.auth.token } : {}),
    ...(config.auth.allowedOrigins !== undefined ? { allowedOrigins: config.auth.allowedOrigins } : {}),
    onLifecyclePhase: (event) => {
      process.stderr.write(`[agenthub-daemon-sidecar] ${event.direction}: ${event.phase}\n`);
    }
  });
  const server = await daemon.start();
  writeDesktopPidFile({ pid: options.pid ?? process.pid, host: config.server.bind, port: boundPort(server), startedAt: Date.now() });
  process.stdout.write(`${JSON.stringify(redactConfig(config), null, 2)}\n`);
  process.stdout.write(`AgentHub daemon listening on http://${config.server.bind}:${boundPort(server)}\n`);

  const shutdown = async () => {
    const result = await daemon.close({ forceCancelAfterMs: 30_000 });
    process.exitCode = result.forced ? 1 : 0;
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
  await new Promise<void>(() => undefined);
  return 0;
}

if (process.argv.includes("--agenthub-run-daemon-sidecar")) {
  runDaemonSidecarRuntime().then((code) => { process.exitCode = code; }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

function writeDesktopPidFile(value: PidFile): void {
  const path = join(homedir(), ".agenthub", "daemon.pid");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value), "utf8");
}

function valueArg(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function numericArg(argv: readonly string[], name: string): number | undefined {
  const value = valueArg(argv, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberEnv(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boundPort(server: { address(): string | { readonly port: number } | null }): number {
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("daemon did not bind TCP port");
  return address.port;
}

function electronResourcesPath(): string | undefined {
  const value = (process as NodeJS.Process & { readonly resourcesPath?: unknown }).resourcesPath;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
