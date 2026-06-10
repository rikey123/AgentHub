import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CliLaunch = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
};

const currentModuleDir = dirname(fileURLToPath(import.meta.url));

export function findAgentHubSourceRoot(): string | undefined {
  return walkUp(currentModuleDir, (current) =>
    existsSync(resolve(current, "package.json")) &&
    existsSync(resolve(current, "apps", "cli", "src", "index.ts")) &&
    existsSync(resolve(current, "apps", "web", "package.json"))
  );
}

export function findAgentHubPackageRoot(): string | undefined {
  const explicitRoot = process.env.AGENTHUB_PACKAGE_ROOT;
  if (explicitRoot !== undefined && explicitRoot.length > 0 && isPackageRoot(resolve(explicitRoot))) {
    return resolve(explicitRoot);
  }
  return walkUp(currentModuleDir, isPackageRoot);
}

export function resolveWebAssetsRoot(): string | undefined {
  return firstExistingFileParent("index.html", [
    process.env.AGENTHUB_WEB_ASSETS_ROOT,
    packageResourcePath("web"),
    sourceResourcePath("apps", "web", "dist")
  ]);
}

export function resolveMigrationsDir(): string | undefined {
  return firstExistingFileParent("0001_init.sql", [
    process.env.AGENTHUB_MIGRATIONS_DIR,
    packageResourcePath("migrations"),
    sourceResourcePath("packages", "db", "migrations")
  ]);
}

export function resolveAgentTemplatesDir(): string | undefined {
  return firstExistingFileParent("mock-builder.md", [
    process.env.AGENTHUB_AGENT_TEMPLATES_DIR,
    packageResourcePath("agent-templates"),
    sourceResourcePath("packages", "agents", "templates")
  ]);
}

export function resolveRoomMcpBridgeDir(): string | undefined {
  return firstExistingFileParent("room-mcp-stdio.mjs", [
    process.env.AGENTHUB_ROOM_MCP_BRIDGE_DIR,
    packageResourcePath("room-mcp"),
    sourceResourcePath("packages", "orchestrator", "src", "mcp")
  ]);
}

export function cliLaunch(): CliLaunch {
  const sourceRoot = findAgentHubSourceRoot();
  if (sourceRoot !== undefined) {
    return {
      command: process.execPath,
      args: [...process.execArgv, resolve(sourceRoot, "apps", "cli", "src", "index.ts")],
      cwd: sourceRoot
    };
  }

  const packageRoot = findAgentHubPackageRoot() ?? resolve(currentModuleDir, "..");
  return {
    command: process.execPath,
    args: [...process.execArgv, fileURLToPath(import.meta.url)],
    cwd: packageRoot
  };
}

function packageResourcePath(name: string): string | undefined {
  const packageRoot = findAgentHubPackageRoot();
  return packageRoot === undefined ? undefined : resolve(packageRoot, "resources", name);
}

function sourceResourcePath(...segments: readonly string[]): string | undefined {
  const sourceRoot = findAgentHubSourceRoot();
  return sourceRoot === undefined ? undefined : resolve(sourceRoot, ...segments);
}

function firstExistingFileParent(markerFile: string, candidates: readonly (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.length === 0) continue;
    const root = resolve(candidate);
    if (existsSync(resolve(root, markerFile))) return root;
  }
  return undefined;
}

function isPackageRoot(candidate: string): boolean {
  return existsSync(resolve(candidate, "resources", "migrations", "0001_init.sql")) &&
    existsSync(resolve(candidate, "resources", "agent-templates", "mock-builder.md")) &&
    existsSync(resolve(candidate, "resources", "room-mcp", "room-mcp-stdio.mjs"));
}

function walkUp(start: string, predicate: (candidate: string) => boolean): string | undefined {
  let current = start;
  for (;;) {
    if (predicate(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
