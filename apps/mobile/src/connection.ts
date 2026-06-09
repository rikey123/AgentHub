import { parseMobileConnectionConfig, type MobileConnectionConfig } from "@agenthub/sdk";

import { isCapacitorNative } from "./nativeHttp.ts";

const CONNECTION_KEY = "agenthub.mobile.connection";

export function loadStoredConnection(storage: Pick<Storage, "getItem"> = window.localStorage): MobileConnectionConfig | null {
  const raw = storage.getItem(CONNECTION_KEY);
  if (raw === null) return null;
  try {
    return parseMobileConnectionConfig(raw);
  } catch {
    return null;
  }
}

export function storeConnection(config: MobileConnectionConfig, storage: Pick<Storage, "setItem"> = window.localStorage): void {
  storage.setItem(CONNECTION_KEY, JSON.stringify(config));
}

export function forgetConnection(storage: Pick<Storage, "removeItem"> = window.localStorage): void {
  storage.removeItem(CONNECTION_KEY);
}

export function normalizeManualConnection(input: { readonly host: string; readonly port: string; readonly token: string }): MobileConnectionConfig {
  const host = input.host.trim().replace(/^https?:\/\//u, "").replace(/\/$/u, "");
  const port = Number(input.port.trim());
  if (host.length === 0) throw new Error("Host is required");
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error("Port is invalid");
  const token = input.token.trim();
  if (token.length === 0) throw new Error("Token is required");
  return parseMobileConnectionConfig(JSON.stringify({ version: 1, url: `http://${host}:${port}`, host, port, token }));
}

export function connectionCursorKey(config: MobileConnectionConfig): string {
  return `agenthub.mobile.cursor.${config.url}.${config.token.slice(0, 12)}`;
}

export function clientBaseUrl(config: MobileConnectionConfig): string {
  // On a Capacitor native device the app talks to the daemon's real LAN URL via native HTTP
  // (no browser Origin, no Vite proxy). The dev-proxy rewrite only applies to the browser dev server.
  if (isCapacitorNative()) return config.url;
  if (shouldUseDevProxy()) return window.location.origin;
  return config.url;
}

export function shouldUseDevProxy(location: Pick<Location, "port"> = window.location): boolean {
  return import.meta.env.DEV && location.port === "5174" && !isCapacitorNative();
}
