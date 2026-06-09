import { describe, expect, it } from "vitest";
import viteConfig from "./vite.config";

describe("Vite daemon proxy", () => {
  it("proxies V1.0 settings and room creation bootstrap endpoints to the daemon", () => {
    const config = viteConfig as { server?: { proxy?: Record<string, unknown> } };
    const proxyPrefixes = Object.keys(config.server?.proxy ?? {});

    expect(proxyPrefixes).toEqual(expect.arrayContaining([
      "/roles",
      "/runtimes",
      "/model-configs",
      "/agent-bindings",
      "/settings"
    ]));
  });

  it("proxies V1.1 task, skill, and roadmap endpoints to the daemon", () => {
    const config = viteConfig as { server?: { proxy?: Record<string, unknown> } };
    const proxyPrefixes = Object.keys(config.server?.proxy ?? {});

    expect(proxyPrefixes).toEqual(expect.arrayContaining([
      "/tasks",
      "/mailbox",
      "/skills",
      "/board",
      "/timeline",
      "/scheduler",
      "/cron",
      "/recurring-tasks"
    ]));
  });

  it("proxies V1.2 deployment endpoints to the daemon", () => {
    const config = viteConfig as { server?: { proxy?: Record<string, unknown> } };
    const proxyPrefixes = Object.keys(config.server?.proxy ?? {});

    expect(proxyPrefixes).toEqual(expect.arrayContaining([
      "/deployments",
      "/deployment-providers",
      "/preview",
      "/sites"
    ]));
  });
});
