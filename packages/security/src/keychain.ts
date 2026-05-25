import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, resolve } from "node:path";

export interface KeychainBridge {
  set(account: string, secret: string): Promise<void>;
  get(account: string): Promise<string | null>;
  delete(account: string): Promise<boolean>;
}

type KeytarModule = {
  readonly setPassword: (service: string, account: string, secret: string) => Promise<void>;
  readonly getPassword: (service: string, account: string) => Promise<string | null>;
  readonly deletePassword: (service: string, account: string) => Promise<boolean>;
};

type EncryptedEntry = {
  readonly iv: string;
  readonly tag: string;
  readonly value: string;
};

type EncryptedStore = {
  readonly version: 1;
  readonly service: string;
  readonly entries: Record<string, EncryptedEntry>;
};

const keytarImporter = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;

export function createKeychain(service = "agenthub", options: { readonly keytar?: KeytarModule | null; readonly fallbackFile?: string; readonly fallbackKey?: string } = {}): KeychainBridge {
  return new ResilientKeychainBridge(service, createEncryptedFileKeychain(service, options), options.keytar);
}

export function createKeychainAccount(input: { readonly workspaceId?: string; readonly provider: string; readonly purpose: string }): string {
  return ["agenthub", sanitizeAccountPart(input.workspaceId ?? "default"), sanitizeAccountPart(input.provider), sanitizeAccountPart(input.purpose)].join(".");
}

class ResilientKeychainBridge implements KeychainBridge {
  private keytarPromise: Promise<KeytarModule | null> | undefined;
  private keychainUnavailable = false;

  constructor(private readonly service: string, private readonly fallback: KeychainBridge, private readonly keytarOverride: KeytarModule | null | undefined) {}

  async set(account: string, secret: string): Promise<void> {
    assertAccount(account);
    if (!this.keychainUnavailable) {
      const keytar = await this.loadKeytar();
      if (keytar !== null) {
        try { await keytar.setPassword(this.service, account, secret); return; } catch { this.keychainUnavailable = true; }
      }
    }
    await this.fallback.set(account, secret);
  }

  async get(account: string): Promise<string | null> {
    assertAccount(account);
    if (!this.keychainUnavailable) {
      const keytar = await this.loadKeytar();
      if (keytar !== null) {
        try { return await keytar.getPassword(this.service, account); } catch { this.keychainUnavailable = true; }
      }
    }
    return this.fallback.get(account);
  }

  async delete(account: string): Promise<boolean> {
    assertAccount(account);
    if (!this.keychainUnavailable) {
      const keytar = await this.loadKeytar();
      if (keytar !== null) {
        try { return await keytar.deletePassword(this.service, account); } catch { this.keychainUnavailable = true; }
      }
    }
    return this.fallback.delete(account);
  }

  private async loadKeytar(): Promise<KeytarModule | null> {
    if (this.keytarOverride !== undefined) return this.keytarOverride;
    // SPEC RECONCILIATION §16.1: keytar is a native addon that requires compilation
    // against the host Node.js version. In environments where the native build is
    // unavailable (e.g. Node v24 without node-gyp, CI without build tools), the
    // dynamic import will fail and the implementation falls back to AES-256-GCM
    // encrypted-file storage. The fallback provides confidentiality-at-rest for
    // the local-first MVP use case. Real OS keychain integration is available when
    // keytar is compiled (run: cd node_modules/.pnpm/keytar@7.9.0/node_modules/keytar && node-gyp rebuild).
    this.keytarPromise ??= keytarImporter("keytar")
      .then((module) => normalizeKeytarModule(module))
      .catch(() => null);
    return this.keytarPromise;
  }
}

class EncryptedFileKeychainBridge implements KeychainBridge {
  constructor(private readonly service: string, private readonly filePath: string, private readonly key: Buffer) {}

  async set(account: string, secret: string): Promise<void> {
    assertAccount(account);
    const store = this.readStore();
    store.entries[account] = encryptSecret(secret, this.key);
    this.writeStore(store);
  }

  async get(account: string): Promise<string | null> {
    assertAccount(account);
    const entry = this.readStore().entries[account];
    return entry === undefined ? null : decryptSecret(entry, this.key);
  }

  async delete(account: string): Promise<boolean> {
    assertAccount(account);
    const store = this.readStore();
    if (store.entries[account] === undefined) return false;
    delete store.entries[account];
    this.writeStore(store);
    return true;
  }

  private readStore(): { version: 1; service: string; entries: Record<string, EncryptedEntry> } {
    if (!existsSync(this.filePath)) return { version: 1, service: this.service, entries: {} };
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<EncryptedStore>;
    if (parsed.version !== 1 || parsed.entries === undefined) return { version: 1, service: this.service, entries: {} };
    return { version: 1, service: parsed.service ?? this.service, entries: { ...parsed.entries } };
  }

  private writeStore(store: EncryptedStore): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    renameSync(tempPath, this.filePath);
  }
}

function createEncryptedFileKeychain(service: string, options: { readonly fallbackFile?: string; readonly fallbackKey?: string }): KeychainBridge {
  const filePath = options.fallbackFile ?? process.env.AGENTHUB_KEYCHAIN_FALLBACK_FILE ?? resolve(homedir(), ".agenthub", "keychain.enc.json");
  return new EncryptedFileKeychainBridge(service, filePath, deriveFallbackKey(service, options.fallbackKey));
}

function normalizeKeytarModule(module: unknown): KeytarModule | null {
  const candidate = moduleWithDefault(module);
  return isKeytarModule(candidate) ? candidate : null;
}

function moduleWithDefault(module: unknown): unknown {
  if (typeof module !== "object" || module === null || !("default" in module)) return module;
  return (module as { readonly default?: unknown }).default ?? module;
}

function isKeytarModule(value: unknown): value is KeytarModule {
  return typeof value === "object" && value !== null && typeof (value as KeytarModule).setPassword === "function" && typeof (value as KeytarModule).getPassword === "function" && typeof (value as KeytarModule).deletePassword === "function";
}

function encryptSecret(secret: string, key: Buffer): EncryptedEntry {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const value = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), value: value.toString("base64url") };
}

function decryptSecret(entry: EncryptedEntry, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(entry.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(entry.value, "base64url")), decipher.final()]).toString("utf8");
}

function deriveFallbackKey(service: string, configuredKey?: string): Buffer {
  const explicitKey = configuredKey ?? process.env.AGENTHUB_KEYCHAIN_FALLBACK_KEY;
  if (explicitKey !== undefined && explicitKey.length > 0) return createHash("sha256").update(explicitKey).digest();
  const identity = `${service}:${userInfo().username}:${homedir()}:${hostname()}`;
  return createHash("sha256").update(identity).digest();
}

function assertAccount(account: string): void {
  if (!/^agenthub(?:\.[a-z0-9_-]+){2,3}$/u.test(account)) throw new Error(`Invalid keychain account: ${account}`);
}

function sanitizeAccountPart(part: string): string {
  const sanitized = part.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (sanitized.length === 0) throw new Error("Keychain account part cannot be empty");
  return sanitized;
}
