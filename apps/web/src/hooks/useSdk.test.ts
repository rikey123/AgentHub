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
});

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}
