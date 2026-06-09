import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { app, dialog, ipcMain, Notification, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

import { nativeBridgeChannels, preloadApiWhitelist } from "./bridgeContract.js";
import type { DaemonSidecar } from "./sidecar.js";
import type { ExportLogsResult, OpenExternalInput, OpenPathInput, PickerResult, ShowNotificationInput } from "./types.js";

export { nativeBridgeChannels, preloadApiWhitelist };

type RegisterNativeBridgeOptions = {
  readonly mainWindow: () => BrowserWindow | undefined;
  readonly sidecar: DaemonSidecar;
};

export function registerNativeBridge(options: RegisterNativeBridgeOptions): void {
  ipcMain.handle(nativeBridgeChannels.openDirectoryPicker, async () => {
    const result = await showOpenDialog(options.mainWindow(), { properties: ["openDirectory"] });
    return { canceled: result.canceled, paths: result.filePaths } satisfies PickerResult;
  });

  ipcMain.handle(nativeBridgeChannels.openFilePicker, async () => {
    const result = await showOpenDialog(options.mainWindow(), { properties: ["openFile"] });
    return { canceled: result.canceled, paths: result.filePaths } satisfies PickerResult;
  });

  ipcMain.handle(nativeBridgeChannels.showNotification, (_event: IpcMainInvokeEvent, input: ShowNotificationInput) => {
    assertPlainObject(input, "notification");
    const title = boundedString(input.title, "title", 120);
    const body = input.body === undefined ? undefined : boundedString(input.body, "body", 500);
    if (!Notification.isSupported()) return;
    new Notification({ title, ...(body !== undefined ? { body } : {}) }).show();
  });

  ipcMain.handle(nativeBridgeChannels.openPath, async (_event: IpcMainInvokeEvent, input: OpenPathInput) => {
    assertPlainObject(input, "openPath");
    const path = boundedString(input.path, "path", 2048);
    const resolved = resolve(path);
    if (!existsSync(resolved)) throw new Error("path does not exist");
    const error = await shell.openPath(resolved);
    if (error.length > 0) throw new Error(error);
  });

  ipcMain.handle(nativeBridgeChannels.openExternal, async (_event: IpcMainInvokeEvent, input: OpenExternalInput) => {
    assertPlainObject(input, "openExternal");
    const url = boundedString(input.url, "url", 2048);
    const parsed = new URL(url);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) throw new Error("unsupported external URL protocol");
    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle(nativeBridgeChannels.getDaemonStatus, async () => await options.sidecar.getStatus());

  ipcMain.handle(nativeBridgeChannels.restartDaemon, async () => await options.sidecar.restart());

  ipcMain.handle(nativeBridgeChannels.exportLogs, async () => {
    const result = await showSaveDialog(options.mainWindow(), {
      title: "Export AgentHub desktop logs",
      defaultPath: `agenthub-desktop-logs-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`
    });
    if (result.canceled || result.filePath === undefined) return { canceled: true } satisfies ExportLogsResult;
    ensureParent(result.filePath);
    writeFileSync(result.filePath, JSON.stringify(collectLogManifest(), null, 2), "utf8");
    return { canceled: false, path: result.filePath } satisfies ExportLogsResult;
  });
}

async function showOpenDialog(parent: BrowserWindow | undefined, options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return parent === undefined ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
}

async function showSaveDialog(parent: BrowserWindow | undefined, options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  return parent === undefined ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(parent, options);
}

export function unregisterNativeBridge(): void {
  for (const channel of Object.values(nativeBridgeChannels)) ipcMain.removeHandler(channel);
}

function collectLogManifest(): unknown {
  const candidateDirs = [
    safePath(() => app.getPath("logs")),
    join(app.getPath("userData"), "logs"),
    join(homedir(), ".agenthub", "logs")
  ].filter((value): value is string => value !== undefined);
  return {
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    directories: candidateDirs.map((directory) => ({
      path: directory,
      exists: existsSync(directory),
      files: existsSync(directory) ? readdirSync(directory).slice(0, 200).map((file) => fileInfo(join(directory, file))) : []
    }))
  };
}

function fileInfo(path: string): unknown {
  try {
    const stat = statSync(path);
    return { name: basename(path), bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
  } catch {
    return { name: basename(path), error: "unreadable" };
  }
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} input must be an object`);
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) throw new Error(`${label} must be a non-empty string up to ${maxLength} characters`);
  return value;
}

function safePath(fn: () => string): string | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
