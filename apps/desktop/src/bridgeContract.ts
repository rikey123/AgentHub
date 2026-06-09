export const nativeBridgeChannels = {
  openDirectoryPicker: "agenthub:open-directory-picker",
  openFilePicker: "agenthub:open-file-picker",
  showNotification: "agenthub:show-notification",
  openPath: "agenthub:open-path",
  openExternal: "agenthub:open-external",
  getDaemonStatus: "agenthub:get-daemon-status",
  restartDaemon: "agenthub:restart-daemon",
  exportLogs: "agenthub:export-logs"
} as const;

export const preloadApiWhitelist = [
  "openDirectoryPicker",
  "openFilePicker",
  "showNotification",
  "openPath",
  "openExternal",
  "getDaemonStatus",
  "restartDaemon",
  "exportLogs"
] as const;
