import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createKeychain, createKeychainAccount } from "../src/index.ts";

let dir: string | undefined;

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("KeychainBridge", () => {
  it("uses the platform keychain for set/get/delete round-trip", async () => {
    const secrets = new Map<string, string>();
    const keytar = {
      setPassword: vi.fn(async (_service: string, account: string, secret: string) => { secrets.set(account, secret); }),
      getPassword: vi.fn(async (_service: string, account: string) => secrets.get(account) ?? null),
      deletePassword: vi.fn(async (_service: string, account: string) => secrets.delete(account))
    };
    const keychain = createKeychain("agenthub-test", { keytar });
    const account = createKeychainAccount({ workspaceId: "default", provider: "anthropic", purpose: "api-key" });

    await keychain.set(account, "sk-ant-test-secret");
    await expect(keychain.get(account)).resolves.toBe("sk-ant-test-secret");
    await expect(keychain.delete(account)).resolves.toBe(true);
    await expect(keychain.get(account)).resolves.toBeNull();
    expect(keytar.setPassword).toHaveBeenCalledWith("agenthub-test", account, "sk-ant-test-secret");
  });

  it("falls back to encrypted file storage when keychain is unavailable", async () => {
    dir = mkdtempSync(join(tmpdir(), "agenthub-keychain-"));
    const fallbackFile = join(dir, "keychain.enc.json");
    const keytar = {
      setPassword: vi.fn(async () => { throw new Error("native keychain unavailable"); }),
      getPassword: vi.fn(async () => { throw new Error("native keychain unavailable"); }),
      deletePassword: vi.fn(async () => { throw new Error("native keychain unavailable"); })
    };
    const keychain = createKeychain("agenthub-test", { keytar, fallbackFile, fallbackKey: "unit-test-key" });
    const account = "agenthub.default.openai.api-key";

    await keychain.set(account, "sk-test-fallback-secret");
    await expect(keychain.get(account)).resolves.toBe("sk-test-fallback-secret");
    expect(readFileSync(fallbackFile, "utf8")).not.toContain("sk-test-fallback-secret");
    await expect(keychain.delete(account)).resolves.toBe(true);
    await expect(keychain.get(account)).resolves.toBeNull();
    expect(keytar.setPassword).toHaveBeenCalledTimes(1);
    expect(keytar.getPassword).not.toHaveBeenCalled();
  });
});
