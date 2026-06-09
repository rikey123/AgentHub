import { app } from "electron";

export type DesktopUpdateStatus =
  | { readonly enabled: false; readonly reason: string }
  | { readonly enabled: true; readonly url: string };

export type DesktopAutoUpdater = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(options: { readonly provider: "generic"; readonly url: string }): void;
  checkForUpdates(): Promise<unknown>;
};

export function configureDesktopUpdates(env: NodeJS.ProcessEnv = process.env, updater?: DesktopAutoUpdater): DesktopUpdateStatus {
  if (env.AGENTHUB_DESKTOP_AUTO_UPDATE !== "1") {
    return { enabled: false, reason: "AGENTHUB_DESKTOP_AUTO_UPDATE is not enabled" };
  }

  const url = env.AGENTHUB_DESKTOP_UPDATE_URL;
  if (url === undefined || url.length === 0) {
    return { enabled: false, reason: "AGENTHUB_DESKTOP_UPDATE_URL is not configured" };
  }

  if (updater !== undefined) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.setFeedURL({ provider: "generic", url });
  }
  return { enabled: true, url };
}

export function checkForDesktopUpdates(status = configureDesktopUpdates(), updater?: DesktopAutoUpdater): void {
  if (!app.isPackaged || !status.enabled) return;
  if (updater !== undefined) {
    void updater.checkForUpdates().catch(() => undefined);
    return;
  }
  void import("electron-updater").then(({ autoUpdater }) => {
    configureDesktopUpdates({ AGENTHUB_DESKTOP_AUTO_UPDATE: "1", AGENTHUB_DESKTOP_UPDATE_URL: status.url }, autoUpdater);
    return autoUpdater.checkForUpdates();
  }).catch(() => undefined);
}
