import { app, BrowserWindow, shell } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PermissionNotificationWatcher } from "./permissionNotifications.js";
import { registerNativeBridge, unregisterNativeBridge } from "./nativeBridge.js";
import { DaemonSidecar } from "./sidecar.js";
import { createMainWindowOptions } from "./windowOptions.js";
import { checkForDesktopUpdates } from "./desktopUpdates.js";

let mainWindow: BrowserWindow | undefined;
let sidecar: DaemonSidecar | undefined;
let permissionWatcher: PermissionNotificationWatcher | undefined;
let quitPrepared = false;

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);

logMain(`boot argv=${JSON.stringify(process.argv)} packaged=${app.isPackaged}`);
process.on("uncaughtException", (error) => logMain(`uncaughtException ${error.stack ?? error.message}`));
process.on("unhandledRejection", (reason) => logMain(`unhandledRejection ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`));

if (process.argv.includes("--agenthub-daemon-sidecar")) {
  logMain("starting electron-hosted daemon sidecar");
  import(new URL("./daemon-sidecar.mjs", import.meta.url).href).then((module: unknown) => runDaemonSidecarModule(module)).then((code) => { process.exitCode = code; }, (error: unknown) => {
    logMain(`daemon sidecar failed ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
} else {
  logMain("waiting for app ready");
  void app.whenReady().then(async () => {
    logMain("app ready");
    checkForDesktopUpdates();
    await createWindow();
    logMain("window flow completed");
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
}

function runDaemonSidecarModule(module: unknown): Promise<number> {
  const candidate = module as { readonly runDaemonSidecarRuntime?: unknown };
  if (typeof candidate.runDaemonSidecarRuntime !== "function") throw new Error("Packaged daemon sidecar runtime is missing");
  return candidate.runDaemonSidecarRuntime() as Promise<number>;
}

async function createWindow(): Promise<void> {
  const logsDir = app.getPath("logs");
  mkdirSync(logsDir, { recursive: true });
  logMain(`createWindow logsDir=${logsDir}`);

  sidecar = new DaemonSidecar({
    logDirectory: logsDir,
    packaged: app.isPackaged,
    ...(typeof process.resourcesPath === "string" && process.resourcesPath.length > 0 ? { resourcesPath: process.resourcesPath } : {}),
    log: logMain
  });
  logMain(`sidecar created packaged=${app.isPackaged} resourcesPath=${process.resourcesPath ?? "none"}`);
  registerNativeBridge({ mainWindow: () => mainWindow, sidecar });

  mainWindow = new BrowserWindow(createMainWindowOptions(resolve(currentDir, "preload.js")));
  logMain("browser window created");

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    const result = await sidecar.ensureStarted();
    logMain(`sidecar ensureStarted state=${result.status.state} webAssets=${result.webAssetsRoot ?? "none"}`);
    if (result.webAssetsRoot === undefined) {
      await loadMissingWebAssetsPage(result.webUrl);
      return;
    }
    await mainWindow.loadURL(result.webUrl);
    logMain(`loaded ${result.webUrl}`);
    permissionWatcher = new PermissionNotificationWatcher({ daemonUrl: result.webUrl, mainWindow: () => mainWindow });
    permissionWatcher.start();
  } catch (error) {
    logMain(`createWindow error ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    await loadErrorPage(error);
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (quitPrepared) return;
  event.preventDefault();
  quitPrepared = true;
  permissionWatcher?.stop();
  const currentSidecar = sidecar;
  void (async () => {
    await currentSidecar?.prepareForQuit();
    unregisterNativeBridge();
    app.quit();
  })();
});

async function loadMissingWebAssetsPage(daemonUrl: string): Promise<void> {
  await mainWindow?.loadURL(errorDataUrl({
    title: "AgentHub Web assets are missing",
    detail: `The daemon is reachable at ${daemonUrl}, but the desktop shell needs daemon-served Web assets. Build apps/web first or set AGENTHUB_WEB_ASSETS_ROOT to a directory containing index.html.`
  }));
}

async function loadErrorPage(error: unknown): Promise<void> {
  await mainWindow?.loadURL(errorDataUrl({
    title: "AgentHub desktop could not start",
    detail: error instanceof Error ? error.message : String(error)
  }));
}

function errorDataUrl(input: { readonly title: string; readonly detail: string }): string {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101418; color: #f6f7f9; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(720px, calc(100vw - 48px)); }
    h1 { margin: 0 0 12px; font-size: 28px; font-weight: 650; letter-spacing: 0; }
    p { margin: 0; color: #b8c0cc; line-height: 1.6; font-size: 15px; }
    code { color: #fff; background: #1e2630; border: 1px solid #2f3a46; border-radius: 6px; padding: 2px 5px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(input.title)}</h1>
    <p>${escapeHtml(input.detail)}</p>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function logMain(message: string): void {
  try {
    appendFileSync(resolve(tmpdir(), "agenthub-desktop-main.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // best-effort startup diagnostics
  }
}
