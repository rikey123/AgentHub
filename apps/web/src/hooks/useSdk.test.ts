import { describe, expect, it, vi } from "vitest";
import { createCsrfFetch } from "./useSdk.ts";

describe("createCsrfFetch", () => {
  it("bootstraps a browser auth session before same-origin reads", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input) === "/auth/session") {
        return jsonResponse(200, { csrfToken: "csrf_get", expiresAt: 0 });
      }
      return jsonResponse(200, { ok: true });
    });
    const csrfFetch = createCsrfFetch(fetchImpl);

    await csrfFetch("/roles", { headers: { accept: "application/json" } });

    expect(calls.map((call) => call.input)).toEqual(["/auth/session", "/roles"]);
    expect(calls[1]?.init?.credentials).toBe("same-origin");
    expect(new Headers(calls[1]?.init?.headers).get("x-agenthub-csrf")).toBeNull();
  });

  it("bootstraps a browser auth session and attaches CSRF to mutating requests", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input) === "/auth/session") {
        return jsonResponse(200, { csrfToken: "csrf_test", expiresAt: Date.now() + 60_000 });
      }
      return jsonResponse(200, { ok: true });
    });
    const csrfFetch = createCsrfFetch(fetchImpl);

    await csrfFetch("/model-configs", {
      method: "POST",
      body: JSON.stringify({ name: "OpenAI", provider: "openai", model: "gpt-4o" })
    });

    expect(calls.map((call) => call.input)).toEqual(["/auth/session", "/model-configs"]);
    expect(new Headers(calls[1]?.init?.headers).get("x-agenthub-csrf")).toBe("csrf_test");
  });

  it("does not force JSON content-type for FormData uploads", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input) === "/auth/session") {
        return jsonResponse(200, { csrfToken: "csrf_upload", expiresAt: Date.now() + 60_000 });
      }
      return jsonResponse(200, { ok: true });
    });
    const csrfFetch = createCsrfFetch(fetchImpl);
    const fd = new FormData();
    fd.append("file", new Blob(["hello"], { type: "text/plain" }), "hello.txt");

    await csrfFetch("/attachments", { method: "POST", body: fd });

    const uploadCall = calls.find((call) => call.input === "/attachments");
    expect(uploadCall).toBeDefined();
    const headers = new Headers(uploadCall?.init?.headers);
    expect(headers.get("x-agenthub-csrf")).toMatch(/^csrf_/);
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("accept")).toBe("application/json");
  });
});

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}
