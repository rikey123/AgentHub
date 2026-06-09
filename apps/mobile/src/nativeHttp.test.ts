import { afterEach, describe, expect, it, vi } from "vitest";

import { capacitorFetch, isCapacitorNative, resolveFetchImpl } from "./nativeHttp.ts";

type MutableGlobal = typeof globalThis & {
  Capacitor?: unknown;
  CapacitorHttp?: unknown;
};

const g = globalThis as MutableGlobal;

afterEach(() => {
  delete g.Capacitor;
  delete g.CapacitorHttp;
  vi.restoreAllMocks();
});

describe("native http adapter", () => {
  it("reports non-native when Capacitor is absent", () => {
    expect(isCapacitorNative()).toBe(false);
  });

  it("reports native only when Capacitor.isNativePlatform() is true", () => {
    g.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
    expect(isCapacitorNative()).toBe(true);
    g.Capacitor = { isNativePlatform: () => false };
    expect(isCapacitorNative()).toBe(false);
  });

  it("uses browser fetch (not the native adapter) when not native", () => {
    const impl = resolveFetchImpl();
    expect(impl).not.toBe(capacitorFetch);
    expect(typeof impl).toBe("function");
  });

  it("uses the native fetch adapter on a Capacitor device with the http plugin", () => {
    g.Capacitor = { isNativePlatform: () => true };
    g.CapacitorHttp = { request: async () => ({ status: 200, headers: {}, data: "" }) };
    expect(resolveFetchImpl()).toBe(capacitorFetch);
  });

  it("routes a request through CapacitorHttp and exposes a fetch-like Response", async () => {
    let captured: { url: string; method: string; headers: Record<string, string> } | undefined;
    g.CapacitorHttp = {
      request: async (options: { url: string; method: string; headers?: Record<string, string> }) => {
        captured = { url: options.url, method: options.method, headers: options.headers ?? {} };
        return { status: 200, headers: { "content-type": "application/json" }, data: JSON.stringify({ ok: true }) };
      }
    };

    const response = await capacitorFetch("http://192.168.1.10:6677/sync/snapshot?view=mobile", {
      method: "GET",
      headers: { authorization: "Bearer test-token" }
    });

    expect(captured?.url).toBe("http://192.168.1.10:6677/sync/snapshot?view=mobile");
    expect(captured?.method).toBe("GET");
    // The Bearer token is forwarded; crucially there is no browser Origin header on native requests.
    expect(captured?.headers.authorization).toBe("Bearer test-token");
    expect(captured?.headers.origin).toBeUndefined();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("serializes a string JSON body into structured data for CapacitorHttp", async () => {
    let capturedData: unknown;
    g.CapacitorHttp = {
      request: async (options: { data?: unknown }) => {
        capturedData = options.data;
        return { status: 200, headers: {}, data: "" };
      }
    };

    await capacitorFetch("http://192.168.1.10:6677/rooms/r1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi", idempotencyKey: "abc" })
    });

    expect(capturedData).toEqual({ text: "hi", idempotencyKey: "abc" });
  });
});
