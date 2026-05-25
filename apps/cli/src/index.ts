#!/usr/bin/env node
import { runAuthCommand } from "./commands/auth.ts";
import { runAgentsCommand } from "./commands/agents.ts";
import { runDaemonCommand } from "./commands/daemon.ts";
import { runLegacyCommand } from "./commands/legacy.ts";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const result = await runAuthCommand(argv) ?? await runAgentsCommand(argv) ?? await runDaemonCommand(argv) ?? await runLegacyCommand(argv);
  if (result !== undefined) return result;
  process.stderr.write("Usage: agenthub start|stop|status|doctor | agenthub auth issue|list|revoke | agenthub agents reset --id=<agentId> | agenthub mock solo [--message TEXT] | agenthub context list [--workspace ID] [--status STATUS] | agenthub permissions profiles|requests|resolve ... | agenthub interventions list [--room ID] [--status STATUS] | agenthub artifacts list [--room ID] [--status STATUS] | agenthub debug stats\n");
  return 1;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  runCli().then((code) => { process.exitCode = code; }, (error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
