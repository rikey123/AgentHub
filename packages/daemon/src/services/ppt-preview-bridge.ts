export type PptPreviewSession = {
  readonly port: number;
  readonly filePath: string;
  readonly pid: number;
  readonly status: "starting" | "ready" | "stopped";
};

export type PptPreviewBridge = {
  readonly start: (filePath: string) => Promise<PptPreviewSession>;
  readonly stop: (port: number) => Promise<void>;
  readonly stopAll: () => Promise<void>;
  readonly isActivePreviewPort: (port: number) => boolean;
};

function notImplemented(method: string): never {
  throw new Error(`PptPreviewBridge.${method} is not implemented in the V1.2 contract foundation`);
}

export function createPptPreviewBridge(): PptPreviewBridge {
  return {
    start: async () => notImplemented("start"),
    stop: async () => notImplemented("stop"),
    stopAll: async () => notImplemented("stopAll"),
    isActivePreviewPort: () => false
  };
}
