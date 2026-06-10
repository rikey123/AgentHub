#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAuthCommand } from "./commands/auth.ts";
import { runAgentsCommand } from "./commands/agents.ts";
import { runDaemonCommand } from "./commands/daemon.ts";
import { runLegacyCommand } from "./commands/legacy.ts";
import { runWebCommand } from "./commands/web.ts";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const result = await runAuthCommand(argv) ?? await runAgentsCommand(argv) ?? await runWebCommand(argv) ?? await runDaemonCommand(argv) ?? await runLegacyCommand(argv);
  if (result !== undefined) return result;
  process.stderr.write("Usage: agenthub web|-web | agenthub start|stop|status|doctor | agenthub auth issue|list|revoke | agenthub agents reset --id=<agentId> | agenthub mock solo [--message TEXT] | agenthub context list [--workspace ID] [--status STATUS] | agenthub permissions profiles|requests|resolve ... | agenthub interventions list [--room ID] [--status STATUS] | agenthub artifacts list [--room ID] [--status STATUS] | agenthub debug stats\n");
  return 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
runCli().then((code) => { process.exitCode = code; }, (error: unknown) => {
  const message = error instanceof Error && process.env.AGENTHUB_DEBUG_PHASES === "1" ? error.stack ?? error.message : error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
}
