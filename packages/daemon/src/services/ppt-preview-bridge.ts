import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { platform } from "node:os";

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

export type PptPreviewBridgeOptions = {
  readonly detectOfficecli?: () => Promise<boolean>;
  readonly installOfficecli?: () => Promise<void>;
  readonly findFreePort?: () => Promise<number>;
  readonly spawnWatch?: (filePath: string, port: number) => ChildProcessLike;
  readonly waitForReady?: (child: ChildProcessLike, port: number) => Promise<void>;
};

type ChildProcessLike = Pick<ChildProcess, "pid" | "kill" | "once">;

export function createPptPreviewBridge(options: PptPreviewBridgeOptions = {}): PptPreviewBridge {
  const sessions = new Map<number, { readonly filePath: string; readonly child: ChildProcessLike; status: PptPreviewSession["status"] }>();
  let installFailed = false;
  const detectOfficecli = options.detectOfficecli ?? defaultDetectOfficecli;
  const installOfficecli = options.installOfficecli ?? defaultInstallOfficecli;
  const findFreePortImpl = options.findFreePort ?? findFreePort;
  const spawnWatch = options.spawnWatch ?? ((filePath, port) => spawn("officecli", ["watch", filePath, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] }));
  const waitForReady = options.waitForReady ?? defaultWaitForReady;

  return {
    start: async (filePath) => {
      if (!(await detectOfficecli())) {
        if (!installFailed) {
          try {
            await installOfficecli();
          } catch {
            installFailed = true;
          }
        }
        if (!(await detectOfficecli())) {
          installFailed = true;
          throw new Error("officecli is not available");
        }
      }
      const port = await findFreePortImpl();
      const child = spawnWatch(filePath, port);
      const pid = child.pid ?? 0;
      sessions.set(port, { filePath, child, status: "starting" });
      child.once?.("exit", () => {
        sessions.delete(port);
      });
      try {
        await waitForReady(child, port);
        const active = sessions.get(port);
        if (active !== undefined) active.status = "ready";
        return { port, filePath, pid, status: "ready" };
      } catch (error) {
        sessions.delete(port);
        child.kill();
        throw error;
      }
    },
    stop: async (port) => {
      const session = sessions.get(port);
      if (session === undefined) return;
      sessions.delete(port);
      session.status = "stopped";
      session.child.kill();
    },
    stopAll: async () => {
      for (const port of Array.from(sessions.keys())) {
        const session = sessions.get(port);
        sessions.delete(port);
        session?.child.kill();
      }
    },
    isActivePreviewPort: (port) => {
      const session = sessions.get(port);
      return session !== undefined && session.status !== "stopped";
    }
  };
}

async function defaultDetectOfficecli(): Promise<boolean> {
  const command = platform() === "win32" ? "where.exe" : "command";
  const args = platform() === "win32" ? ["officecli"] : ["-v", "officecli"];
  return await new Promise((resolve) => {
    execFile(command, args, (error) => resolve(error === null));
  });
}

async function defaultInstallOfficecli(): Promise<void> {
  const command = platform() === "win32" ? "powershell.exe" : "sh";
  const args = platform() === "win32"
    ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://raw.githubusercontent.com/officecli/install/main/install.ps1 | iex"]
    : ["-c", "curl -fsSL https://raw.githubusercontent.com/officecli/install/main/install.sh | sh"];
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, (error) => error === null ? resolve() : reject(error));
  });
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address !== null) resolve(address.port);
        else reject(new Error("failed to allocate preview port"));
      });
    });
    server.once("error", reject);
  });
}

async function defaultWaitForReady(_child: ChildProcessLike, _port: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
