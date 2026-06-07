import { describe, expect, it, vi } from "vitest";

import { createPptPreviewBridge, type PptPreviewBridgeOptions } from "../src/services/ppt-preview-bridge.ts";

describe("PptPreviewBridge", () => {
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
});

function fakeChild(pid: number): ReturnType<NonNullable<PptPreviewBridgeOptions["spawnWatch"]>> & { readonly kill: ReturnType<typeof vi.fn> } {
  return {
    pid,
    kill: vi.fn(() => true),
    once: vi.fn()
  };
}
