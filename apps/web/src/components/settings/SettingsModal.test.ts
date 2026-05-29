import { describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { FeatureRail } from "../shell/FeatureRail.tsx";
import { SETTINGS_TABS, fetchSettingsBootstrap } from "./SettingsModal.tsx";

describe("SettingsModal integration contract", () => {
  it("defines the six top-level tabs with Roles first", () => {
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual([
      "Roles",
      "Runtimes",
      "Models",
      "Permissions",
      "Workspace",
      "MCP"
    ]);
    expect(SETTINGS_TABS[0]?.id).toBe("roles");
  });

  it("opens settings from the FeatureRail Settings entry point", () => {
    const onOpenSettings = vi.fn();
    const onSelect = vi.fn();
    const tree = FeatureRail({ active: "chat", onSelect, onOpenSettings });
    const settingsButton = findElementByProp(tree, "aria-label", "Settings");

    expect(settingsButton).toBeDefined();
    const onClick = settingsButton?.props.onClick;
    expect(typeof onClick).toBe("function");
    if (typeof onClick === "function") onClick();

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalledWith("settings");
  });

  it("bootstraps settings with four parallel REST requests, then workspace metadata, and no EventSource", async () => {
    const previousEventSource = globalThis.EventSource;
    const eventSourceSpy = vi.fn();
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      writable: true,
      value: eventSourceSpy
    });

    const calls: Array<{ path: string; signal: AbortSignal | undefined }> = [];
    const pendingResolvers: Array<() => void> = [];
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      calls.push({ path: String(input), signal: init?.signal ?? undefined });
      return new Promise<Response>((resolve) => {
        pendingResolvers.push(() => {
          const path = String(input);
          const body = path === "/agent-bindings"
            ? { agentBindings: [{ id: "binding_1", workspaceId: "ws_1", role: { name: "Reviewer" }, runtime: { kind: "native", name: "Native", detectedVersion: "native" }, modelConfig: { id: "model_1", name: "OpenAI", provider: "openai", model: "gpt-4o" } }] }
            : path === "/workspaces/ws_1"
              ? { workspace: { id: "ws_1", name: "Workspace", root_path: "." } }
              : { path };
          resolve(new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" }
          }));
        });
      });
    });

    const controller = new AbortController();
    const resultPromise = fetchSettingsBootstrap(fetchImpl, controller.signal);

    // First 4 requests fire in parallel immediately
    expect(calls.map((call) => call.path).sort()).toEqual([
      "/agent-bindings",
      "/model-configs",
      "/roles",
      "/runtimes"
    ]);
    expect(calls.every((call) => call.signal === controller.signal)).toBe(true);
    expect(eventSourceSpy).not.toHaveBeenCalled();

    // Resolve all pending fetches (including the sequential workspace fetch that fires after the first 4)
    // Need multiple rounds because workspace fetch fires after first 4 resolve + json() parse
    for (let i = 0; i < 10; i++) {
      const batch = pendingResolvers.splice(0, pendingResolvers.length);
      for (const resolve of batch) resolve();
      await Promise.resolve();
    }

    // After resolving, the workspace fetch should have been added
    expect(calls.map((call) => call.path).sort()).toEqual([
      "/agent-bindings",
      "/model-configs",
      "/roles",
      "/runtimes",
      "/workspaces/ws_1"
    ]);
    await expect(resultPromise).resolves.toEqual({
      roles: { path: "/roles" },
      runtimes: { path: "/runtimes" },
      modelConfigs: { path: "/model-configs" },
      agentBindings: { agentBindings: [{ id: "binding_1", workspaceId: "ws_1", role: { name: "Reviewer" }, runtime: { kind: "native", name: "Native", detectedVersion: "native" }, modelConfig: { id: "model_1", name: "OpenAI", provider: "openai", model: "gpt-4o" } }] },
      workspace: { workspace: { id: "ws_1", name: "Workspace", root_path: "." } }
    });

    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      writable: true,
      value: previousEventSource
    });
  });

  it("wires abort signals into every pending settings request", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });

    const controller = new AbortController();
    const resultPromise = fetchSettingsBootstrap(fetchImpl, controller.signal);
    controller.abort();

    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
  });
});

function findElementByProp(element: unknown, prop: string, value: unknown): { props: Record<string, unknown> } | undefined {
  if (!isValidElement(element)) return undefined;
  const props = element.props as Record<string, unknown>;
  if (props[prop] === value) return { props };

  const children = props.children;
  const childList = Array.isArray(children) ? children : [children];
  for (const child of childList) {
    const found = findElementByProp(child, prop, value);
    if (found) return found;
  }
  return undefined;
}
