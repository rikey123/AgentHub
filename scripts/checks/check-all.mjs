import { spawn } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./lib.mjs";

const checks = [
  ["ai-sdk-provider:check", "ai-sdk-provider-check.mjs"],
  ["events:check", "events-check.mjs"],
  ["visibility:check", "visibility-check.mjs"],
  ["subscriptions:check", "subscriptions-check.mjs"],
  ["command:check", "command-check.mjs"],
  ["run-state-machine:check", "run-state-machine-check.mjs"]
];

let failed = false;
for (const [name, script] of checks) {
  process.stdout.write(`\n== ${name} ==\n`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(repoRoot, "scripts/checks", script)], { cwd: repoRoot, stdio: "inherit" });
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) failed = true;
}

if (failed) {
  process.stderr.write("\ncheck:all failed\n");
  process.exitCode = 1;
} else {
  process.stdout.write("\ncheck:all passed (6 custom checks)\n");
}
