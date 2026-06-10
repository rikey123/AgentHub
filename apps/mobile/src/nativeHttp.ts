import { Capacitor, CapacitorHttp } from "@capacitor/core";

// Native HTTP adapter: on a Capacitor native platform, route AgentHub SDK requests through the
// CapacitorHttp plugin instead of the WebView's fetch. Native requests carry no browser Origin, so
// the daemon authenticates them via Bearer token directly (its Origin check runs before Bearer and
// would otherwise 403 a WebView's capacitor://localhost / LAN Host). In dev/web this is a no-op and
// the SDK uses the standard browser fetch (Vite proxy keeps it same-origin).
//
// We import Capacitor lazily/optionally so the module also builds and runs in a plain browser where
// @capacitor/* may be absent at runtime.

type CapacitorHttpResponse = {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly data: unknown;
  readonly url?: string;
};

type CapacitorHttpPlugin = {
  request(options: {
    readonly url: string;
    readonly method: string;
    readonly headers?: Record<string, string>;
    readonly data?: unknown;
    readonly responseType?: "text" | "json" | "arraybuffer" | "blob";
    readonly connectTimeout?: number;
    readonly readTimeout?: number;
  }): Promise<CapacitorHttpResponse>;
};

type CapacitorGlobal = {
  readonly Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  };
  readonly CapacitorHttp?: CapacitorHttpPlugin;
};

function capacitor(): CapacitorGlobal {
  return globalThis as unknown as CapacitorGlobal;
}

function capacitorRuntime(): CapacitorGlobal["Capacitor"] {
  return capacitor().Capacitor ?? Capacitor;
}

function capacitorHttpPlugin(): CapacitorHttpPlugin | undefined {
  return capacitor().CapacitorHttp ?? CapacitorHttp as unknown as CapacitorHttpPlugin;
}

export function isCapacitorNative(): boolean {
  const cap = capacitorRuntime();
  return typeof cap?.isNativePlatform === "function" && cap.isNativePlatform() === true;
}

function headerObject(init?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (init === undefined) return result;
  if (init instanceof Headers) { init.forEach((value, key) => { result[key] = value; }); return result; }
  if (Array.isArray(init)) { for (const [key, value] of init) result[key] = value; return result; }
  for (const [key, value] of Object.entries(init)) result[key] = String(value);
  return result;
}

function bodyToData(body: BodyInit | null | undefined): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") { try { return JSON.parse(body) as unknown; } catch { return body; } }
  return body;
}

// A fetch-compatible function backed by CapacitorHttp. Only the subset the AgentHub SDK uses is
// implemented: method, headers, string body, and reading the response via text()/json().
export async function capacitorFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const plugin = capacitorHttpPlugin();
  if (plugin === undefined) throw new Error("CapacitorHttp plugin is unavailable");
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init.method ?? "GET").toUpperCase();
  const headers = headerObject(init.headers);
  const data = bodyToData(init.body ?? undefined);

  const response = await plugin.request({
    url,
    method,
    headers,
    ...(data !== undefined ? { data } : {}),
    responseType: "text"
  });

  const text = typeof response.data === "string" ? response.data : response.data === undefined || response.data === null ? "" : JSON.stringify(response.data);
  return new Response(text, {
    status: response.status,
    headers: response.headers as HeadersInit
  });
}

// Returns the fetch implementation to give the SDK: native HTTP on a Capacitor device, otherwise the
// platform's standard fetch.
export function resolveFetchImpl(): typeof fetch {
  if (isCapacitorNative() && capacitorHttpPlugin() !== undefined) {
    return capacitorFetch as typeof fetch;
  }
  return globalThis.fetch.bind(globalThis);
}
