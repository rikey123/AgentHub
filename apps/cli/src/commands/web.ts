import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

type ChildExit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

export async function runWebCommand(argv: readonly string[]): Promise<number | undefined> {
  if (!isWebCommand(argv)) return undefined;

  const callerWorkspaceRoot = resolve(process.env.AGENTHUB_CALLER_CWD ?? process.cwd());
  const agenthubSourceRoot = findAgentHubSourceRoot();
  const webAssetsRoot = resolveWebAssetsRoot(agenthubSourceRoot);
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
      const daemon = await spawnCli([
        "start",
        "--workspace-root",
        callerWorkspaceRoot,
        ...(webAssetsRoot !== undefined ? ["--web-assets-root", webAssetsRoot] : [])
      ], agenthubSourceRoot);
      managedChildren.push(daemon);
      await waitForHealth(`${daemonUrl}/healthz`, daemon, () => stopState.requested, "daemon");
    }

    if (webAssetsRoot !== undefined) {
      await openBrowser(daemonUrl);
      if (managedChildren.length === 0) return 0;
      const winner = await Promise.race(managedChildren.map((child) => waitForExit(child)));
      await stop(winner.code ?? 1);
      return winner.code ?? 1;
    }

    const web = await spawnPnpm(["--filter", "@agenthub/web", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], agenthubSourceRoot);
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

function findAgentHubSourceRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (
      existsSync(resolve(current, "package.json")) &&
      existsSync(resolve(current, "apps", "cli", "src", "index.ts")) &&
      existsSync(resolve(current, "apps", "web", "package.json"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    current = parent;
  }
}

function resolveWebAssetsRoot(agenthubSourceRoot: string): string | undefined {
  const explicitRoot = process.env.AGENTHUB_WEB_ASSETS_ROOT;
  const candidates = [
    explicitRoot,
    resolve(agenthubSourceRoot, "apps", "web", "dist")
  ].filter((value): value is string => value !== undefined && value.length > 0);
  for (const candidate of candidates) {
    const root = resolve(candidate);
    if (existsSync(resolve(root, "index.html"))) return root;
  }
  return undefined;
}

async function spawnPnpm(args: readonly string[], cwd: string): Promise<ChildProcess> {
  if (process.platform === "win32") return spawnManaged("cmd.exe", ["/d", "/s", "/c", "pnpm.cmd", ...args], cwd);
  return spawnManaged("pnpm", args, cwd);
}

async function spawnCli(args: readonly string[], cwd: string): Promise<ChildProcess> {
  return spawnManaged(process.execPath, [...process.execArgv, resolve(cwd, "apps", "cli", "src", "index.ts"), ...args], cwd);
}

async function spawnManaged(command: string, args: readonly string[], cwd: string): Promise<ChildProcess> {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
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
