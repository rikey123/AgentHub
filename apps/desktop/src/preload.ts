import { contextBridge, ipcRenderer } from "electron";

import { nativeBridgeChannels } from "./nativeBridge.js";
import type { AgentHubDesktopApi, OpenExternalInput, OpenPathInput, ShowNotificationInput } from "./types.js";

const api: AgentHubDesktopApi = {
  openDirectoryPicker: async () => await ipcRenderer.invoke(nativeBridgeChannels.openDirectoryPicker) as Awaited<ReturnType<AgentHubDesktopApi["openDirectoryPicker"]>>,
  openFilePicker: async () => await ipcRenderer.invoke(nativeBridgeChannels.openFilePicker) as Awaited<ReturnType<AgentHubDesktopApi["openFilePicker"]>>,
  showNotification: async (input: ShowNotificationInput) => { await ipcRenderer.invoke(nativeBridgeChannels.showNotification, input); },
  openPath: async (input: OpenPathInput) => { await ipcRenderer.invoke(nativeBridgeChannels.openPath, input); },
  openExternal: async (input: OpenExternalInput) => { await ipcRenderer.invoke(nativeBridgeChannels.openExternal, input); },
  getDaemonStatus: async () => await ipcRenderer.invoke(nativeBridgeChannels.getDaemonStatus) as Awaited<ReturnType<AgentHubDesktopApi["getDaemonStatus"]>>,
  restartDaemon: async () => await ipcRenderer.invoke(nativeBridgeChannels.restartDaemon) as Awaited<ReturnType<AgentHubDesktopApi["restartDaemon"]>>,
  exportLogs: async () => await ipcRenderer.invoke(nativeBridgeChannels.exportLogs) as Awaited<ReturnType<AgentHubDesktopApi["exportLogs"]>>
};

contextBridge.exposeInMainWorld("agentHubDesktop", api);
