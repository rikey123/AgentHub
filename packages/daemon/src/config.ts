import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { parse } from "smol-toml";

export type AgentHubConfig = {
  readonly databasePath: string;
  readonly server: {
    readonly bind: string;
    readonly port: number;
    readonly previewPort: number;
    readonly remote: { readonly enabled: boolean };
  };
  readonly auth: {
    readonly token?: string;
    readonly expiresDays: number;
    readonly allowedOrigins?: readonly string[];
  };
  readonly debug: {
    readonly enabled: boolean;
    readonly allowRemote: boolean;
  };
  readonly adapters: Record<string, { readonly binary?: string }>;
  readonly configPath: string;
};

export type ConfigOverrides = {
  readonly configPath?: string;
  readonly databasePath?: string;
  readonly bind?: string;
  readonly port?: number;
  readonly token?: string;
  readonly remoteEnabled?: boolean;
  readonly allowedOrigins?: readonly string[];
};

type PartialAgentHubConfig = {
  readonly databasePath?: string;
  readonly server?: {
    readonly bind?: string;
    readonly port?: number;
    readonly previewPort?: number;
    readonly remote?: { readonly enabled?: boolean };
  };
  readonly auth?: {
    readonly token?: string;
    readonly expiresDays?: number;
    readonly allowedOrigins?: readonly string[];
  };
  readonly debug?: {
    readonly enabled?: boolean;
    readonly allowRemote?: boolean;
  };
  readonly adapters?: Record<string, { readonly binary?: string }>;
  readonly configPath?: string;
};

type TomlObject = Record<string, unknown>;

const defaultRoot = join(homedir(), ".agenthub");
const defaults: AgentHubConfig = {
  databasePath: join(defaultRoot, "agenthub.db"),
  server: { bind: "127.0.0.1", port: 6677, previewPort: 6678, remote: { enabled: false } },
  auth: { expiresDays: 30 },
  debug: { enabled: false, allowRemote: false },
  adapters: {},
  configPath: join(defaultRoot, "config.toml")
};

export function defaultConfigPath(): string {
  return defaults.configPath;
}

export function daemonPidPath(): string {
  return join(defaultRoot, "daemon.pid");
}

export function loadAgentHubConfig(overrides: ConfigOverrides = {}, env: NodeJS.ProcessEnv = process.env): AgentHubConfig {
  const configPath = overrides.configPath ?? env.AGENTHUB_CONFIG ?? defaults.configPath;
  const fileConfig = readTomlConfig(configPath);
  const envConfig = configFromEnv(env);
  const merged = mergeConfig(defaults, fileConfig, envConfig, configFromOverrides(overrides), { configPath });
  validateRemoteConfig(merged);
  return merged;
}

export function redactConfig(config: AgentHubConfig): unknown {
  return {
    databasePath: config.databasePath,
    configPath: config.configPath,
    server: config.server,
    auth: {
      token: config.auth.token === undefined ? undefined : "***",
      expiresDays: config.auth.expiresDays,
      allowedOrigins: config.auth.allowedOrigins === undefined ? undefined : "***"
    },
    debug: config.debug,
    adapters: config.adapters
  };
}

export function ensureAgentHubHome(): void {
  mkdirSync(defaultRoot, { recursive: true });
}

function readTomlConfig(path: string): PartialAgentHubConfig {
  if (!existsSync(path)) return {};
  try {
    const parsed = parse(readFileSync(path, "utf8")) as TomlObject;
    return configFromToml(parsed);
  } catch (error) {
    process.stderr.write(`Failed to parse config.toml: ${error instanceof Error ? error.message : String(error)}; using defaults\n`);
    return {};
  }
}

function configFromToml(parsed: TomlObject): PartialAgentHubConfig {
  const server = objectValue(parsed.server);
  const remote = objectValue(server?.remote);
  const auth = objectValue(parsed.auth);
  const debug = objectValue(parsed.debug);
  const adapters = objectValue(parsed.adapters);
  return {
    ...(typeof parsed.databasePath === "string" ? { databasePath: parsed.databasePath } : {}),
    server: {
      ...(typeof server?.bind === "string" ? { bind: server.bind } : {}),
      ...(typeof server?.port === "number" ? { port: server.port } : {}),
      ...(typeof server?.preview_port === "number" ? { previewPort: server.preview_port } : {}),
      ...(typeof server?.previewPort === "number" ? { previewPort: server.previewPort } : {}),
      remote: { ...(typeof remote?.enabled === "boolean" ? { enabled: remote.enabled } : {}) }
    },
    auth: {
      ...(typeof auth?.token === "string" ? { token: auth.token } : {}),
      ...(typeof auth?.expires_days === "number" ? { expiresDays: auth.expires_days } : {}),
      ...(typeof auth?.expiresDays === "number" ? { expiresDays: auth.expiresDays } : {}),
      ...(isStringArray(auth?.allowedOrigins) ? { allowedOrigins: auth.allowedOrigins } : {})
    },
    debug: {
      ...(typeof debug?.enabled === "boolean" ? { enabled: debug.enabled } : {}),
      ...(typeof debug?.allowRemote === "boolean" ? { allowRemote: debug.allowRemote } : {})
    },
    ...(adapters !== undefined ? { adapters: adapterConfig(adapters) } : {})
  };
}

function configFromEnv(env: NodeJS.ProcessEnv): PartialAgentHubConfig {
  return {
    ...(env.AGENTHUB_DB !== undefined ? { databasePath: env.AGENTHUB_DB } : {}),
    server: {
      ...(env.AGENTHUB_BIND !== undefined ? { bind: env.AGENTHUB_BIND } : {}),
      ...(env.AGENTHUB_PORT !== undefined ? { port: numberValue(env.AGENTHUB_PORT, defaults.server.port) } : {}),
      remote: { ...(env.AGENTHUB_REMOTE_ENABLED !== undefined ? { enabled: booleanValue(env.AGENTHUB_REMOTE_ENABLED) } : {}) }
    },
    auth: {
      ...(env.AGENTHUB_TOKEN !== undefined ? { token: env.AGENTHUB_TOKEN } : {})
    }
  };
}

function configFromOverrides(overrides: ConfigOverrides): PartialAgentHubConfig {
  return {
    ...(overrides.databasePath !== undefined ? { databasePath: overrides.databasePath } : {}),
    server: {
      ...(overrides.bind !== undefined ? { bind: overrides.bind } : {}),
      ...(overrides.port !== undefined ? { port: overrides.port } : {}),
      remote: { ...(overrides.remoteEnabled !== undefined ? { enabled: overrides.remoteEnabled } : {}) }
    },
    auth: {
      ...(overrides.token !== undefined ? { token: overrides.token } : {}),
      ...(overrides.allowedOrigins !== undefined ? { allowedOrigins: overrides.allowedOrigins } : {})
    }
  };
}

function mergeConfig(...parts: readonly PartialAgentHubConfig[]): AgentHubConfig {
  let config: AgentHubConfig = defaults;
  for (const part of parts) {
    const token = part.auth?.token ?? config.auth.token;
    const allowedOrigins = part.auth?.allowedOrigins ?? config.auth.allowedOrigins;
    config = {
      databasePath: part.databasePath ?? config.databasePath,
      configPath: part.configPath ?? config.configPath,
      server: {
        bind: part.server?.bind ?? config.server.bind,
        port: part.server?.port ?? config.server.port,
        previewPort: part.server?.previewPort ?? config.server.previewPort,
        remote: { enabled: part.server?.remote?.enabled ?? config.server.remote.enabled }
      },
      auth: {
        expiresDays: part.auth?.expiresDays ?? config.auth.expiresDays,
        ...(token !== undefined ? { token } : {}),
        ...(allowedOrigins !== undefined ? { allowedOrigins } : {})
      },
      debug: {
        enabled: part.debug?.enabled ?? config.debug.enabled,
        allowRemote: part.debug?.allowRemote ?? config.debug.allowRemote
      },
      adapters: { ...config.adapters, ...(part.adapters ?? {}) }
    };
  }
  return config;
}

function validateRemoteConfig(config: AgentHubConfig): void {
  if (isLoopbackHost(config.server.bind)) return;
  if (config.auth.token === undefined || config.auth.token.length === 0) {
    throw new Error(`Refusing to bind ${config.server.bind} without auth.token. Set [auth] token = "..." or use bind = "127.0.0.1".`);
  }
  if (config.server.remote.enabled !== true) {
    throw new Error(`Refusing to bind ${config.server.bind} without [server.remote] enabled = true. Set enabled = true to allow remote access.`);
  }
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function adapterConfig(value: TomlObject): Record<string, { readonly binary?: string }> {
  const result: Record<string, { readonly binary?: string }> = {};
  for (const [key, entry] of Object.entries(value)) {
    const adapter = objectValue(entry);
    if (typeof adapter?.binary === "string") result[key] = { binary: adapter.binary };
  }
  return result;
}

function objectValue(value: unknown): TomlObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as TomlObject : undefined;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: string): boolean {
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function ensureParentDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}
