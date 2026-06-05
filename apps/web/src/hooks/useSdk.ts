import { useMemo } from "react";
import { AgentHubClient } from "@agenthub/sdk";

type AuthSessionResponse = { readonly csrfToken: string; readonly expiresAt: number };

let csrfToken: string | undefined;
let csrfTokenExpiresAt = 0;
let bootstrapPromise: Promise<string> | undefined;

export async function ensureAuthSession(fetchImpl: typeof fetch = fetch): Promise<string> {
  const now = Date.now();
  if (csrfToken !== undefined && csrfTokenExpiresAt > now + 5_000) return csrfToken;
  bootstrapPromise ??= fetchImpl("/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: "{}"
  }).then(async (response) => {
    const payload = await response.json() as AuthSessionResponse;
    if (!response.ok) throw new Error(`auth session bootstrap failed: ${response.status}`);
    csrfToken = payload.csrfToken;
    csrfTokenExpiresAt = payload.expiresAt;
    return payload.csrfToken;
  }).finally(() => {
    bootstrapPromise = undefined;
  });
  return bootstrapPromise;
}

export function createCsrfFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (input, init = {}) => {
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const mutating = method === "POST" || method === "PATCH" || method === "DELETE";
    if (isAuthSessionRequest(input)) {
      return fetchImpl(input, { ...init, credentials: init.credentials ?? "same-origin" });
    }
    const token = await ensureAuthSession(fetchImpl);
    if (!mutating) {
      return fetchImpl(input, { ...init, credentials: init.credentials ?? "same-origin" });
    }
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("x-agenthub-csrf", token);
    if (!headers.has("content-type") && !isFormDataBody(init.body)) headers.set("content-type", "application/json");
    if (!headers.has("accept")) headers.set("accept", "application/json");
    return fetchImpl(input, { ...init, method, credentials: init.credentials ?? "same-origin", headers });
  };
}

export function useSdk(): AgentHubClient {
  return useMemo(() => new AgentHubClient({ baseUrl: "", fetchImpl: createCsrfFetch() }), []);
}

export function useCsrfFetch(): typeof fetch {
  return useMemo(() => createCsrfFetch(), []);
}

function isAuthSessionRequest(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const baseUrl = typeof window === "undefined" ? "http://agenthub.local" : window.location.href;
  return new URL(url, baseUrl).pathname === "/auth/session";
}

function isFormDataBody(body: BodyInit | null | undefined): boolean {
  return typeof FormData !== "undefined" && body instanceof FormData;
}
