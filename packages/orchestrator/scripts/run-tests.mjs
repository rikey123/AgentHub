import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");
const vitestBin = resolve(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
const vitestArgs = [
  "run",
  "packages/orchestrator/test/orchestrator.test.ts",
  "packages/orchestrator/test/public-message-persistence.test.ts",
  "packages/orchestrator/test/run-prompt-source.test.ts",
  "packages/orchestrator/test/room-mcp-tools.test.ts",
  "packages/orchestrator/test/room-mcp-mature-tools.test.ts",
  "packages/orchestrator/test/room-mcp-file-shell.test.ts",
  "packages/orchestrator/test/room-mcp-symlink.test.ts",
  "packages/orchestrator/test/complete-task.test.ts",
  "packages/orchestrator/test/mission-brief.test.ts",
  "packages/orchestrator/test/context-ref-resolver.test.ts",
  "packages/orchestrator/test/planning-phase.test.ts",
  "packages/orchestrator/test/assisted-selector.test.ts",
  "packages/orchestrator/test/assisted-selector-routing.test.ts"
];
const command = process.platform === "win32" ? "cmd.exe" : vitestBin;
const args = process.platform === "win32" ? ["/c", vitestBin, ...vitestArgs] : vitestArgs;

const result = spawnSync(command, args, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: false
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
