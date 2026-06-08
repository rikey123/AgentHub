import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");
const vitestBin = resolve(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
const vitestArgs = [
  "run",
  "packages/daemon/test/daemon.test.ts",
  "packages/daemon/test/assisted-selector-continuation.test.ts",
  "packages/daemon/test/route-stubs.test.ts",
  "packages/daemon/test/ppt-preview-bridge.test.ts",
  "packages/daemon/test/v12-artifacts-backend.test.ts"
];
const result = spawnSync(process.platform === "win32" ? "cmd.exe" : vitestBin, process.platform === "win32" ? ["/c", vitestBin, ...vitestArgs] : vitestArgs, { cwd: repoRoot, stdio: "inherit", shell: false });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
