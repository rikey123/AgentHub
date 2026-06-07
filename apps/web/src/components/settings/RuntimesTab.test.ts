import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RuntimesTab,
  deleteRuntimeConfig,
  normalizeRuntimeList,
  persistCustomRuntime,
  testRuntimeConnection,
  type RuntimeConfig
} from "./RuntimesTab.tsx";

describe("RuntimesTab REST integration contract", () => {
  it("normalizes runtime cards with status, version, detected path, args, and env", () => {
    const runtimes = normalizeRuntimeList([
      {
        id: "native-default",
        kind: "native",
        name: "AgentHub Native",
        detected_path: "agenthub-native",
        detected_version: "native",
        args: null,
        env: null
      },
      {
        id: "custom-acp-1",
        kind: "custom-acp",
        name: "Custom ACP",
        command: "acp",
        args: ["--stdio"],
        env: { ACP_TOKEN: "test" },
        status: "missing"
      }
    ]);

    expect(runtimes).toEqual([
      expect.objectContaining({ id: "native-default", kind: "native", name: "AgentHub Native", detectedPath: "agenthub-native", detectedVersion: "native" }),
      expect.objectContaining({ id: "custom-acp-1", kind: "custom-acp", command: "acp", args: ["--stdio"], env: { ACP_TOKEN: "test" }, status: "missing" })
    ]);
  });

  it("creates and updates custom ACP runtimes through REST payloads", async () => {
    const calls: Array<{ path: string; method: string | undefined; body: unknown }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ path: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
      if (String(input) === "/runtimes") {
        return jsonResponse(201, { runtime: { id: "custom-acp-new", kind: "custom-acp", name: "Custom ACP", command: "acp", args: "[\"--stdio\"]", env: "{\"ACP_TOKEN\":\"test\"}" } });
      }
      if (String(input) === "/runtimes/custom-acp-new") {
        return jsonResponse(200, { runtime: { id: "custom-acp-new", kind: "custom-acp", name: "Custom ACP Updated", command: "acp2", args: ["--json"], env: { ACP_TOKEN: "updated" } } });
      }
      return jsonResponse(404, { error: "not_found" });
    });

    const created = await persistCustomRuntime(fetchImpl, customRuntime({ id: "custom-acp-new", command: "", status: "draft" }), {
      name: "Custom ACP",
      command: "acp",
      argsText: '["--stdio"]',
      envText: '{"ACP_TOKEN":"test"}'
    });
    const updated = await persistCustomRuntime(fetchImpl, created, {
      name: "Custom ACP Updated",
      command: "acp2",
      argsText: '["--json"]',
      envText: '{"ACP_TOKEN":"updated"}'
    });

    expect(calls).toEqual([
      {
        path: "/runtimes",
        method: "POST",
        body: expect.objectContaining({ id: "custom-acp-new", name: "Custom ACP", command: "acp", args: ["--stdio"], env: { ACP_TOKEN: "test" } })
      },
      {
        path: "/runtimes/custom-acp-new",
        method: "PATCH",
        body: expect.objectContaining({ id: "custom-acp-new", name: "Custom ACP Updated", command: "acp2", args: ["--json"], env: { ACP_TOKEN: "updated" } })
      }
    ]);
    expect(created).toMatchObject({ id: "custom-acp-new", command: "acp", args: ["--stdio"], env: { ACP_TOKEN: "test" } });
    expect(updated).toMatchObject({ id: "custom-acp-new", name: "Custom ACP Updated", command: "acp2" });
  });

  it("tests runtime connections through 200 success, 202 polling, and failure without EventBus", async () => {
    const previousEventSource = globalThis.EventSource;
    const eventSourceSpy = vi.fn();
    Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: eventSourceSpy });

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = String(input);
      if (path === "/runtimes/native-default/test") return jsonResponse(200, { ok: true, version: "native", latencyMs: 3 });
      if (path === "/runtimes/custom-acp-slow/test") return jsonResponse(202, { jobId: "runtime_job_1" });
      if (path === "/settings/jobs/runtime_job_1") return jsonResponse(200, { status: "completed", result: { ok: true, version: "1.2.3", latencyMs: 12 } });
      if (path === "/runtimes/custom-acp-fail/test") return jsonResponse(200, { ok: false, error: "binary not found", latencyMs: 1 });
      return jsonResponse(404, { error: "not_found" });
    });

    await expect(testRuntimeConnection(fetchImpl, "native-default", 1)).resolves.toEqual({ ok: true, version: "native", latencyMs: 3 });
    await expect(testRuntimeConnection(fetchImpl, "custom-acp-slow", 1)).resolves.toEqual({ ok: true, version: "1.2.3", latencyMs: 12 });
    await expect(testRuntimeConnection(fetchImpl, "custom-acp-fail", 1)).resolves.toEqual({ ok: false, error: "binary not found", latencyMs: 1 });

    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
      "/runtimes/native-default/test",
      "/runtimes/custom-acp-slow/test",
      "/settings/jobs/runtime_job_1",
      "/runtimes/custom-acp-fail/test"
    ]);
    expect(eventSourceSpy).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, "EventSource", { configurable: true, writable: true, value: previousEventSource });
  });

  it("surfaces delete conflicts when a runtime still has bindings", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(409, { error: "runtime_has_bindings" }));

    await expect(deleteRuntimeConfig(fetchImpl, "custom-acp-bound")).rejects.toThrow("Runtime is still used by agent bindings");
    expect(fetchImpl).toHaveBeenCalledWith("/runtimes/custom-acp-bound", expect.objectContaining({ method: "DELETE" }));
  });

  it("shows seeded runtimes as ready to test instead of missing before connection test fails", () => {
    const html = renderToStaticMarkup(createElement(RuntimesTab, {
      data: [
        customRuntime({
          id: "custom-acp-seeded",
          name: "Claude Code",
          command: "claude",
          kind: "custom-acp",
          status: "missing"
        })
      ],
      fetchImpl: vi.fn<typeof fetch>()
    }));

    expect(html).toContain("待测试");
    expect(html).not.toContain(">Missing<");
  });
});

function customRuntime(patch: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    id: "custom-acp",
    workspaceId: null,
    kind: "custom-acp",
    name: "Custom ACP",
    command: "acp",
    args: [],
    env: {},
    detectedPath: null,
    detectedVersion: null,
    version: null,
    status: null,
    ...patch
  };
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}
