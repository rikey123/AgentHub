export type DaemonStatus = {
  readonly state: "starting" | "ready" | "unreachable" | "external" | "error";
  readonly url: string;
  readonly managed: boolean;
  readonly pid?: number;
  readonly message?: string;
};

export type PickerResult = {
  readonly canceled: boolean;
  readonly paths: readonly string[];
};

export type ShowNotificationInput = {
  readonly title: string;
  readonly body?: string;
};

export type OpenExternalInput = {
  readonly url: string;
};

export type OpenPathInput = {
  readonly path: string;
};

export type ExportLogsResult = {
  readonly canceled: boolean;
  readonly path?: string;
};

export type AgentHubDesktopApi = {
  readonly openDirectoryPicker: () => Promise<PickerResult>;
  readonly openFilePicker: () => Promise<PickerResult>;
  readonly showNotification: (input: ShowNotificationInput) => Promise<void>;
  readonly openPath: (input: OpenPathInput) => Promise<void>;
  readonly openExternal: (input: OpenExternalInput) => Promise<void>;
  readonly getDaemonStatus: () => Promise<DaemonStatus>;
  readonly restartDaemon: () => Promise<DaemonStatus>;
  readonly exportLogs: () => Promise<ExportLogsResult>;
};

declare global {
  interface Window {
    readonly agentHubDesktop?: AgentHubDesktopApi;
  }
}
