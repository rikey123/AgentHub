import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..", "..");
const vitestBin = resolve(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
const vitestArgs = ["run", "packages/adapters/claude-code/test/claude-code-adapter.test.ts"];
const command = process.platform === "win32" ? "cmd.exe" : vitestBin;
const args = process.platform === "win32" ? ["/c", vitestBin, ...vitestArgs] : vitestArgs;

const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", shell: false });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
