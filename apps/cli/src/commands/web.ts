import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

type ChildExit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

export async function runWebCommand(argv: readonly string[]): Promise<number | undefined> {
  if (!isWebCommand(argv)) return undefined;

  const daemonUrl = "http://127.0.0.1:6677";
  const webUrl = "http://127.0.0.1:5173";
  const managedChildren: ChildProcess[] = [];
  const stopState = { requested: false };
  const stop = async (code: number): Promise<void> => {
    if (stopState.requested) return;
    stopState.requested = true;
    process.exitCode = code;
    await Promise.allSettled(managedChildren.map((child) => terminateChild(child)));
  };

  const handleSignal = (signal: NodeJS.Signals, code: number) => {
    process.once(signal, () => { void stop(code); });
  };
  handleSignal("SIGINT", 130);
  handleSignal("SIGTERM", 143);

  try {
    if (!(await probeHealth(daemonUrl))) {
      const daemon = await spawnManaged("pnpm.cmd", ["exec", "tsx", "apps/cli/src/index.ts", "start"], true);
      managedChildren.push(daemon);
      await waitForHealth(`${daemonUrl}/healthz`, daemon, () => stopState.requested, "daemon");
    }

    const web = await spawnManaged("pnpm.cmd", ["--filter", "@agenthub/web", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], true);
    managedChildren.push(web);
    await waitForHealth(webUrl, web, () => stopState.requested, "web");
    await openBrowser(webUrl);

    const winner = await Promise.race(managedChildren.map((child) => waitForExit(child)));
    await stop(winner.code ?? 1);
    return winner.code ?? 1;
  } catch (error) {
    await stop(1);
    throw error;
  }
}

export function isWebCommand(argv: readonly string[]): boolean {
  const [command] = argv;
  return command === "web" || command === "-web";
}

async function spawnManaged(command: string, args: readonly string[], useWindowsShell = false): Promise<ChildProcess> {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: useWindowsShell,
    windowsHide: true
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
  return child;
}

async function probeHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, child: ChildProcess, shouldStop: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (shouldStop()) throw new Error("launch cancelled");
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${label} exited before becoming ready`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label} at ${url}`);
}

async function waitForExit(child: ChildProcess): Promise<ChildExit> {
  return await new Promise<ChildExit>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    child.once("exit", done);
    child.kill("SIGINT");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      setTimeout(done, 0);
    }, 5_000).unref?.();
  });
}

async function openBrowser(url: string): Promise<void> {
  try {
    if (process.platform === "win32") {
      const opener = spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
      opener.unref();
      return;
    }
    if (process.platform === "darwin") {
      const opener = spawn("open", [url], { detached: true, stdio: "ignore", shell: false });
      opener.unref();
      return;
    }
    const opener = spawn("xdg-open", [url], { detached: true, stdio: "ignore", shell: false });
    opener.unref();
  } catch {
    // Ignore browser launch failures; the web URL is still printed by the dev server.
  }
}
