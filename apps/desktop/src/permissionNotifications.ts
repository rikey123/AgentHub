import { Notification, type BrowserWindow } from "electron";

type PermissionNotificationOptions = {
  readonly daemonUrl: string;
  readonly mainWindow: () => BrowserWindow | undefined;
};

export class PermissionNotificationWatcher {
  private readonly daemonUrl: string;
  private readonly mainWindow: () => BrowserWindow | undefined;
  private abortController: AbortController | undefined;
  private cursor = 0;
  private stopped = true;

  constructor(options: PermissionNotificationOptions) {
    this.daemonUrl = options.daemonUrl;
    this.mainWindow = options.mainWindow;
  }

  start(): void {
    if (!Notification.isSupported()) return;
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
    this.abortController = undefined;
  }

  private async connect(): Promise<void> {
    while (!this.stopped) {
      this.abortController = new AbortController();
      try {
        const response = await fetch(this.eventUrl(), { signal: this.abortController.signal });
        if (!response.ok || response.body === null) throw new Error(`SSE returned ${response.status}`);
        await this.readStream(response.body);
      } catch {
        if (!this.stopped) await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  private async readStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true });
      for (;;) {
        const index = buffer.indexOf("\n\n");
        if (index < 0) break;
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        this.handleFrame(frame);
      }
    }
  }

  private handleFrame(frame: string): void {
    if (frame.startsWith(":")) return;
    const data = frame.split(/\r?\n/u).find((line) => line.startsWith("data: "))?.slice(6);
    if (data === undefined) return;
    try {
      const event = JSON.parse(data) as { readonly type?: string; readonly seq?: number; readonly roomId?: string; readonly payload?: { readonly requestId?: string; readonly reason?: string; readonly resource?: unknown } };
      if (typeof event.seq === "number") this.cursor = Math.max(this.cursor, event.seq);
      if (event.type !== "permission.requested") return;
      const requestId = event.payload?.requestId;
      const notification = new Notification({
        title: "AgentHub permission requested",
        body: event.payload?.reason ?? "A local agent is waiting for approval."
      });
      notification.on("click", () => this.focusPermission(requestId));
      notification.show();
    } catch {
      // Ignore malformed SSE frames.
    }
  }

  private focusPermission(requestId: string | undefined): void {
    const window = this.mainWindow();
    if (window === undefined) return;
    if (window.isMinimized()) window.restore();
    window.focus();
    if (requestId !== undefined) {
      void window.webContents.executeJavaScript(focusPermissionScript(requestId), true);
    }
  }

  private eventUrl(): string {
    const params = new URLSearchParams({ view: "main" });
    if (this.cursor > 0) params.set("cursor", String(this.cursor));
    return `${this.daemonUrl}/event?${params.toString()}`;
  }
}

export function focusPermissionScript(requestId: string): string {
  return `
(() => {
  const requestId = ${JSON.stringify(requestId)};
  const candidates = Array.from(document.querySelectorAll("[data-slot='card'], article, section, div"));
  const target = candidates.find((element) => {
    const text = element.textContent || "";
    return text.includes(requestId) || (text.includes("Permission requested") && text.length < 4000);
  });
  if (!target) return false;
  target.scrollIntoView({ block: "center" });
  if (target instanceof HTMLElement) {
    target.tabIndex = target.tabIndex < 0 ? -1 : target.tabIndex;
    target.focus({ preventScroll: true });
    const previousOutline = target.style.outline;
    const previousOutlineOffset = target.style.outlineOffset;
    target.style.outline = "2px solid color-mix(in oklab, oklch(0.78 0.13 78) 48%, transparent)";
    target.style.outlineOffset = "2px";
    window.setTimeout(() => {
      target.style.outline = previousOutline;
      target.style.outlineOffset = previousOutlineOffset;
    }, 800);
  }
  return true;
})()
`;
}
