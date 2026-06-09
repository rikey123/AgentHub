import { createDaemon } from "@agenthub/daemon";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("desktop same-origin daemon loading", () => {
  let daemon: ReturnType<typeof createDaemon> | undefined;
  let baseUrl = "";
  let root = "";
  let electronResult: ElectronOriginProbeResult | undefined;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "agenthub-desktop-origin-"));
    const webAssetsRoot = join(root, "web-dist");
    mkdirSync(webAssetsRoot, { recursive: true });
    writeFileSync(join(webAssetsRoot, "index.html"), "<!doctype html><title>AgentHub origin test</title><main>origin</main>", "utf8");

    daemon = createDaemon({
      databasePath: join(root, "agenthub.sqlite"),
      workspaceRoot: root,
      webAssetsRoot,
      port: 0,
      modelTestFetch: async () => new Response(JSON.stringify({ model: "test", usage: {} }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const server = await daemon.start();
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("daemon did not bind TCP port");
    baseUrl = `http://127.0.0.1:${address.port}`;
    electronResult = await runElectronOriginProbe(root, baseUrl);
  }, 30_000);

  afterAll(async () => {
    await daemon?.close({ forceCancelAfterMs: 5_000 });
  });

  it("serves the desktop renderer from the daemon origin", async () => {
    expect(electronResult?.pageUrl).toBe(`${baseUrl}/`);
  });

  it("allows browser requests from the daemon-served Electron origin", async () => {
    const result = electronResult?.sameOrigin;
    expect(result.locationOrigin).toBe(baseUrl);
    expect(result.sessionStatus).toBe(200);
    expect(result.csrfTokenLength).toBeGreaterThan(20);
    expect(result.setCookieVisibleToRenderer).toBeNull();
    expect(result.roomsStatus).toBe(200);
    expect(result.roomsError).toBeNull();
    expect(result.roomsCount).toBeGreaterThanOrEqual(0);
  });

  it("rejects requests carrying an illegal Origin even when sent to the same daemon", async () => {
    const response = await fetch(`${baseUrl}/rooms`, {
      headers: { origin: "http://attacker.example.com", authorization: "Bearer bad" }
    });
    const payload = await response.json() as { readonly error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe("origin_or_host_mismatch");
  });
});

type ElectronOriginProbeResult = {
  readonly pageUrl: string;
  readonly sameOrigin: {
    readonly locationOrigin: string;
    readonly sessionStatus: number;
    readonly csrfTokenLength: number;
    readonly setCookieVisibleToRenderer: string | null;
    readonly roomsStatus: number;
    readonly roomsError: string | null;
    readonly roomsCount: number;
  };
};

async function runElectronOriginProbe(root: string, baseUrl: string): Promise<ElectronOriginProbeResult> {
  const mainPath = join(root, "origin-probe.cjs");
  const outputPath = join(root, "origin-probe-result.json");
  writeFileSync(mainPath, electronProbeMainSource(), "utf8");

  const electronPath = createRequire(import.meta.url)("electron") as string;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(electronPath, electronProbeArgs(mainPath), {
      env: electronProbeEnv(baseUrl, outputPath),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron origin probe exited with ${code ?? "unknown"}: ${stderr}`));
    });
  });

  return JSON.parse(readFileSync(outputPath, "utf8")) as ElectronOriginProbeResult;
}

function electronProbeArgs(mainPath: string): string[] {
  if (process.platform === "linux" && process.env.CI === "true") return ["--no-sandbox", mainPath];
  return [mainPath];
}

function electronProbeEnv(baseUrl: string, outputPath: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.AGENTHUB_ORIGIN_TEST_URL = baseUrl;
  env.AGENTHUB_ORIGIN_TEST_OUT = outputPath;
  env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
  return env;
}

function electronProbeMainSource(): string {
  return `
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");

app.whenReady().then(async () => {
  const baseUrl = process.env.AGENTHUB_ORIGIN_TEST_URL;
  const outputPath = process.env.AGENTHUB_ORIGIN_TEST_OUT;
  if (!baseUrl || !outputPath) throw new Error("missing origin probe environment");

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await win.loadURL(baseUrl);
  const sameOrigin = await win.webContents.executeJavaScript(String.raw\`
    (async () => {
      const session = await fetch("/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: "{}"
      });
      const setCookieVisibleToRenderer = session.headers.get("set-cookie");
      const sessionPayload = await session.json();
      const rooms = await fetch("/rooms", { credentials: "same-origin", headers: { accept: "application/json" } });
      const roomsPayload = await rooms.json();
      return {
        locationOrigin: window.location.origin,
        sessionStatus: session.status,
        csrfTokenLength: sessionPayload.csrfToken?.length ?? 0,
        setCookieVisibleToRenderer,
        roomsStatus: rooms.status,
        roomsError: roomsPayload.error ?? null,
        roomsCount: roomsPayload.rooms?.length ?? 0
      };
    })()
  \`, true);
  writeFileSync(outputPath, JSON.stringify({ pageUrl: win.webContents.getURL(), sameOrigin }), "utf8");
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
`;
}
